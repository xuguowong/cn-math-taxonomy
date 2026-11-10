'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { createServer, loadConfig, allowedHosts } = require('../scripts/question-server');
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=';
async function start(server, t) { server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => { server.closeAllConnections(); server.close(); }); return 'http://127.0.0.1:' + server.address().port; }
const post = (base, body, headers = {}) => fetch(base + '/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('静态页面、目录重定向和状态接口可用，API 不暴露 Key', async t => {
  const base = await start(createServer({ config: { baseURL: 'http://localhost:8000/v1', model: 'vision', apiKey: 'do-not-leak', vision: true } }), t);
  const status = await fetch(base + '/api/analysis-status');
  assert.deepEqual(await status.json(), { configured: true, vision: true });
  const page = await fetch(base + '/analyze/'); assert.equal(page.status, 200); assert.ok((await page.text()).includes('题目分析'));
  const redirect = await fetch(base + '/analyze', { redirect: 'manual' }); assert.equal(redirect.status, 302); assert.equal(redirect.headers.get('location'), '/analyze/');
  const head = await fetch(base + '/analyze/engine.js', { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(await head.text(), '');
});
test('拒绝配置、Git、后端源码和非同源请求', async t => {
  const base = await start(createServer(), t);
  for (const name of ['/.env', '/.git/config', '/scripts/question-server.js', '/analyze/ai.js', '/analyze//ai.js', '/analyze%2fai.js', '/analyze/%2e%2e/.env', '/analyze/%5c..%5c.env']) assert.equal((await fetch(base + name)).status, 404, name);
  assert.equal((await post(base, { question: 'test' }, { Origin: 'https://example.com' })).status, 403);
  const status = await new Promise((resolve, reject) => { const req = http.get(base + '/api/analysis-status', { headers: { Host: 'attacker.example' } }, res => { res.resume(); resolve(res.statusCode); }); req.on('error', reject); });
  assert.equal(status, 403);
});
test('校验题目、图片、Content-Type 和请求方法', async t => {
  const base = await start(createServer(), t);
  assert.equal((await post(base, { question: '' })).status, 400);
  assert.equal((await post(base, null)).status, 400);
  assert.equal((await post(base, { question: 'a'.repeat(6001) })).status, 400);
  assert.equal((await post(base, { question: 'test', images: ['bad'] })).status, 400);
  assert.equal((await post(base, { question: 'test', images: null })).status, 400);
  assert.equal((await fetch(base + '/api/analyze')).status, 405);
  assert.equal((await post(base, { question: 'test' }, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await fetch(base + '/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken' })).status, 400);
  assert.equal((await post(base, { question: 'test' })).status, 503);
  const tooLarge = await new Promise((resolve, reject) => {
    const req = http.request(base + '/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': String(35 * 1024 * 1024) } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject); req.end();
  });
  assert.equal(tooLarge, 413);
});
test('真实 HTTP 链路按 OpenAI 格式发送文字和图片，并验证模型返回的知识点', async t => {
  let received;
  const mock = http.createServer(async (req, res) => {
    assert.equal(req.url, '/v1/chat/completions'); const parts = []; for await (const c of req) parts.push(c); received = JSON.parse(Buffer.concat(parts));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ questionSummary: '分数相加', recognizedText: '1/3 + 1/4', solutionOutline: ['通分，再相加'],
      targets: [{ topicId: 'cnm_p173', reason: '分母不同，使用异分母分数加法', evidence: '图中的 1/3 + 1/4', evidenceSource: 'image', imageIndex: 1 }], unresolved: [], assumptions: [] }) } }] }));
  });
  const upstream = await start(mock, t);
  const base = await start(createServer({ config: { baseURL: upstream + '/v1', model: 'self-hosted-vision', vision: true } }), t);
  const response = await post(base, { question: '', images: [PNG] }); assert.equal(response.status, 200);
  const data = await response.json(); assert.equal(data.analysis.targets[0].topicId, 'cnm_p173');
  assert.equal(received.model, 'self-hosted-vision'); assert.equal(received.messages[1].content[1].image_url.url, PNG);
});
test('最多并行两个 AI 请求，完成后释放额度', async t => {
  const resolvers = [];
  const base = await start(createServer({ analyze: () => new Promise(resolve => resolvers.push(resolve)) }), t);
  const first = post(base, { question: 'one' }), second = post(base, { question: 'two' });
  for (let i = 0; i < 100 && resolvers.length < 2; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(resolvers.length, 2);
  assert.equal((await post(base, { question: 'three' })).status, 429);
  resolvers.forEach(resolve => resolve({ targets: [] }));
  assert.equal((await first).status, 200); assert.equal((await second).status, 200);
});
test('配置解析保留自部署地址和可选 Key，约束超时', () => {
  const config = loadConfig({ MATH_AI_BASE_URL: 'http://localhost:40000/v1', MATH_AI_MODEL: 'local-model', MATH_AI_VISION: '1', MATH_AI_TIMEOUT_MS: '999999' });
  assert.equal(config.vision, true); assert.equal(config.apiKey, ''); assert.equal(config.timeoutMs, 300000);
  assert.equal(loadConfig({ MATH_AI_TIMEOUT_MS: 'bad' }).timeoutMs, 120000);
});
test('局域网模式自动接受本机网卡 IP，本机模式不自动开放；别名须显式配置', () => {
  const interfaces = { eth0: [{ address: '192.168.1.14' }, { address: 'fd00::14' }] };
  assert.equal(allowedHosts({}, interfaces).has('192.168.1.14'), false);
  const hosts = allowedHosts({ host: '0.0.0.0', allowedHosts: ['mathbox.local'] }, interfaces);
  for (const name of ['localhost', '192.168.1.14', '[fd00::14]', 'mathbox.local']) assert.ok(hosts.has(name), name);
  assert.equal(hosts.has('attacker.example'), false);
  assert.throws(() => allowedHosts({ allowedHosts: ['*'] }), /通配符/);
  assert.throws(() => allowedHosts({ allowedHosts: ['http://mathbox.local:8787/'] }), /ALLOWED_HOSTS/);
  const config = loadConfig({ HOST: '0.0.0.0', ALLOWED_HOSTS: ' mathbox.local,192.168.1.14 ' });
  assert.equal(config.host, '0.0.0.0'); assert.deepEqual(config.allowedHosts, ['mathbox.local', '192.168.1.14']);
});
test('局域网主机名可打开页面及提交文字/图片，继续拒绝其他来源', async t => {
  const seen = [];
  const base = await start(createServer({ config: { host: '0.0.0.0', allowedHosts: ['mathbox.local'] }, analyze: async input => { seen.push(input); return { targets: [] }; } }), t);
  const host = 'mathbox.local:' + new URL(base).port;
  const request = (pathname, body, origin) => new Promise((resolve, reject) => {
    const headers = { Host: host };
    if (origin) headers.Origin = origin;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const req = http.request(base + pathname, { method: body === undefined ? 'GET' : 'POST', headers }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject); req.end(body === undefined ? undefined : JSON.stringify(body));
  });
  assert.equal(await request('/analyze/'), 200);
  assert.equal(await request('/api/analysis-status'), 200);
  assert.equal(await request('/api/analyze', { question: '1/3 + 1/4' }, 'http://' + host), 200);
  assert.equal(await request('/api/analyze', { question: '', images: [PNG] }, 'http://' + host), 200);
  assert.equal(seen.length, 2); assert.equal(seen[1].images[0], PNG);
  assert.equal(await request('/api/analyze', { question: 'test' }, 'http://another-computer.local:8787'), 403);
});
test('使用真实网卡 IP 访问监听所有接口的服务', async t => {
  const os = require('node:os');
  const address = Object.values(os.networkInterfaces()).flat().find(e => !e.internal && e.family === 'IPv4')?.address;
  if (!address) return t.skip('没有非回环 IPv4 网卡');
  const server = createServer({ config: { host: '0.0.0.0' } });
  server.listen(0, '0.0.0.0'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = 'http://' + address + ':' + server.address().port;
  assert.equal((await fetch(base + '/analyze/')).status, 200);
  assert.equal((await fetch(base + '/api/analysis-status')).status, 200);
  assert.equal((await post(base, { question: 'test' }, { Origin: base })).status, 503);
});
