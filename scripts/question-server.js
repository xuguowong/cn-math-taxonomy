#!/usr/bin/env node
'use strict';
// 本地 AI 代理 + 静态站点。API Key 只在服务端使用，不写入页面。
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { analyzeQuestion, validateImages } = require('../analyze/ai');
const ROOT = path.resolve(__dirname, '..');
const MAX_BODY = 34 * 1024 * 1024;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };

function loadConfig(env = process.env) {
  const result = { baseURL: env.MATH_AI_BASE_URL || '', model: env.MATH_AI_MODEL || '', apiKey: env.MATH_AI_API_KEY || '' };
  const ms = Number(env.MATH_AI_TIMEOUT_MS || 120000);
  result.timeoutMs = Number.isFinite(ms) ? Math.max(1000, Math.min(ms, 300000)) : 120000;
  result.vision = env.MATH_AI_VISION === '1';
  result.host = (env.HOST || '127.0.0.1').trim();
  result.allowedHosts = (env.ALLOWED_HOSTS || '').split(',').map(s => s.trim()).filter(Boolean);
  return result;
}
function hostname(value) {
  const url = new URL('http://' + (net.isIP(value) === 6 ? '[' + value + ']' : value));
  if (url.hostname.includes('*') || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) throw new Error('ALLOWED_HOSTS 只能填写主机名或 IP，不包含协议、端口、路径和通配符。');
  return url.hostname;
}
function allowedHosts(config, interfaces = os.networkInterfaces()) {
  const hosts = new Set(['localhost', '127.0.0.1', '[::1]']);
  const bind = config.host || '127.0.0.1';
  if (!['127.0.0.1', '::1', 'localhost'].includes(bind)) {
    for (const entries of Object.values(interfaces)) for (const entry of entries || []) hosts.add(hostname(entry.address));
    if (bind !== '0.0.0.0' && bind !== '::') hosts.add(hostname(bind));
  }
  for (const name of config.allowedHosts || []) hosts.add(hostname(name));
  return hosts;
}
function createServer({ config = loadConfig(), analyze = analyzeQuestion } = {}) {
  const topics = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/topics.json'), 'utf8'));
  const acceptedHosts = allowedHosts(config);
  let active = 0;
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
    // Accept local interface addresses in LAN mode, plus explicit aliases. No cross-origin API access.
    const host = req.headers.host;
    let url;
    try { url = new URL(req.url, 'http://' + host); } catch { return json(400, { error: '请求地址不正确。' }); }
    if (req.headers.origin && req.headers.origin !== 'http://' + host && req.headers.origin !== 'https://' + host) return json(403, { error: '只接受同源请求。' });
    let hostname;
    try { hostname = new URL('http://' + host).hostname; } catch { return json(400, { error: 'Host 不正确。' }); }
    if (!acceptedHosts.has(hostname)) return json(403, { error: '访问主机未获允许。请使用服务器本机 IP，或在 ALLOWED_HOSTS 中配置主机名。' });
    if (url.pathname === '/api/analysis-status' && req.method === 'GET') return json(200, { configured: !!(config.baseURL && config.model), vision: !!config.vision });
    if (url.pathname === '/api/analyze') {
      if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return json(405, { error: '请使用 POST。' }); }
      if ((req.headers['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'application/json') return json(415, { error: '请发送 JSON。' });
      if (Number(req.headers['content-length']) > MAX_BODY) { req.resume(); return json(413, { error: '上传内容过大，请缩小图片。' }); }
      if (active >= 2) return json(429, { error: '已有分析正在进行，请稍后重试。' });
      active++;
      const controller = new AbortController();
      res.on('close', () => { if (!res.writableEnded) controller.abort(); });
      try {
        let bytes = 0; let oversized = false; const parts = [];
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > MAX_BODY) { oversized = true; parts.length = 0; }
          else if (!oversized) parts.push(chunk);
        }
        if (oversized) return json(413, { error: '上传内容过大，请缩小图片。' });
        let body;
        try { body = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { return json(400, { error: 'JSON 格式不正确。' }); }
        if (!body || typeof body.question !== 'string' || body.question.length > 6000) return json(400, { error: '题目文字最多 6000 字。' });
        const images = validateImages(body.images === undefined ? [] : body.images);
        if (!body.question.trim() && !images.length) return json(400, { error: '请输入题目文字或上传图片。' });
        const question = body.question.trim();
        const result = await analyze({ question, images, topics, config, signal: controller.signal });
        if (!controller.signal.aborted) json(200, { mode: 'ai', analysis: result });
      } catch (e) {
        if (!res.writableEnded && !controller.signal.aborted) json(e.status || 500, { error: e.status ? e.message : '分析失败，请重试。' });
      } finally { active--; }
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(405, { error: '不支持的请求方法。' });
    let pathname;
    try { pathname = decodeURIComponent(url.pathname); } catch { return json(400, { error: '路径编码不正确。' }); }
    const parts = pathname.split('/').filter(Boolean);
    // Never serve credentials, Git history, backend source or arbitrary local files.
    if (parts.some(p => p.startsWith('.') || p.includes('\\') || p.includes('\0')) ||
        !['analyze', 'assets', 'data', 'diagnose', 'explore', 'children', 'index.html', 'manifest.webmanifest', 'sw.js'].includes(parts[0] || 'index.html') ||
        (parts[0] === 'analyze' && parts.length > 1 && (parts.length !== 2 || !['index.html', 'app.js', 'engine.js', 'style.css'].includes(parts[1])))) return json(404, { error: '未找到页面。' });
    const filename = path.join(ROOT, pathname, pathname.endsWith('/') ? 'index.html' : '');
    if (!filename.startsWith(ROOT + path.sep)) return json(404, { error: '未找到页面。' });
    try {
      const real = fs.realpathSync(filename);
      if (!real.startsWith(ROOT + path.sep)) return json(404, { error: '未找到页面。' });
      const stat = fs.statSync(real);
      if (stat.isDirectory()) { res.writeHead(302, { Location: url.pathname + '/' + url.search }); return res.end(); }
      if (!stat.isFile()) return json(404, { error: '未找到页面。' });
      res.writeHead(200, { 'Content-Type': MIME[path.extname(real)] || 'application/octet-stream', 'Content-Length': stat.size, 'Cache-Control': 'no-cache' });
      if (req.method === 'HEAD') return res.end();
      const stream = fs.createReadStream(real); stream.on('error', () => res.destroy()); stream.pipe(res);
    } catch { json(404, { error: '未找到页面。' }); }
  });
  server.requestTimeout = 30000;
  return server;
}
if (require.main === module) {
  const port = Number(process.env.PORT || 8787);
  const config = loadConfig();
  const server = createServer({ config });
  server.on('error', e => { console.error('无法启动服务：' + e.message); process.exitCode = 1; });
  server.listen(port, config.host, () => {
    const actualPort = server.address().port;
    const localHost = config.host === '0.0.0.0' || config.host === '::' ? '127.0.0.1' : hostname(config.host);
    console.log('题目知识分析：http://' + localHost + ':' + actualPort + '/analyze/');
    if (!['127.0.0.1', '::1', 'localhost'].includes(config.host)) {
      console.log('局域网监听地址：' + config.host + ':' + actualPort);
      for (const entries of Object.values(os.networkInterfaces())) for (const entry of entries || []) {
        if (!entry.internal && entry.family === 'IPv4' && (config.host === '0.0.0.0' || config.host === '::' || config.host === entry.address)) console.log('局域网访问：http://' + entry.address + ':' + actualPort + '/analyze/');
      }
    }
  });
}
module.exports = { createServer, loadConfig, allowedHosts };
