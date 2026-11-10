/* 固定纸质试卷：从现有题库抽题，不修改在线诊断会话。 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DiagPaper = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const SUBJECTS = { math: '数学', english: '英语', physics: '物理', chinese: '语文', science: '科学', morality: '道德与法治', history: '历史', geography: '地理', biology: '生物', chemistry: '化学' };
  const escape = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function randomFor(seed) {
    let state = 2166136261;
    for (const char of String(seed)) state = Math.imul(state ^ char.charCodeAt(0), 16777619) >>> 0;
    return () => { state += 0x6D2B79F5; let x = state; x = Math.imul(x ^ x >>> 15, x | 1); x ^= x + Math.imul(x ^ x >>> 7, x | 61); return ((x ^ x >>> 14) >>> 0) / 4294967296; };
  }
  function shuffled(values, random) {
    const out = values.slice();
    for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
    return out;
  }
  function buildPaper(graph, options) {
    const scope = options.scope || 'range';
    if (!['current', 'topic', 'range'].includes(scope)) throw new Error('试卷范围不正确。');
    const count = Math.max(1, Math.min(60, Math.floor(Number(options.count) || 1)));
    const current = options.currentQuestion;
    const currentTopic = options.currentTopicId;
    if (scope === 'current') {
      const question = (graph.bank[currentTopic] || []).find(q => current && q.id === current.id);
      if (!question) throw new Error('当前题目不在题库中，无法打印。');
      return { scope, label: graph.byId[currentTopic].name, requested: 1, available: 1, topicCount: 1, questions: [{ ...question, topic: graph.byId[currentTopic] }] };
    }
    const ids = [...new Set(scope === 'topic' ? [currentTopic] : options.targets || [])];
    if (!ids.length || ids.some(id => !graph.byId[id])) throw new Error('没有可用的诊断范围。');
    const random = randomFor(options.seed || 'paper');
    const banks = new Map();
    for (const id of ids) {
      const candidates = (graph.bank[id] || []).filter(q => options.includeChallenge || !['challenge', 'advanced'].includes(q.difficulty));
      // 首轮优先提高题，后续补基础；每轮每个知识点最多取一题。
      const rank = q => q.difficulty === 'standard' ? 0 : q.difficulty === 'basic' ? 1 : 2;
      banks.set(id, shuffled(candidates, random).sort((a, b) => rank(a) - rank(b)));
    }
    const chapters = new Map();
    for (const id of shuffled(ids, random)) {
      const chapter = graph.byId[id].chapter || '';
      if (!chapters.has(chapter)) chapters.set(chapter, []);
      if (banks.get(id).length) chapters.get(chapter).push(id);
    }
    const order = [];
    while ([...chapters.values()].some(a => a.length)) for (const list of chapters.values()) if (list.length) order.push(list.shift());
    const available = new Set([...banks.values()].flat().map(q => q.id)).size;
    if (!available) throw new Error('所选范围没有符合条件的题目，请尝试包含拓展题。');
    const picked = [], seen = new Set(), covered = new Set();
    const take = (q, id) => { if (q && !seen.has(q.id)) { seen.add(q.id); covered.add(id); picked.push({ ...q, topic: graph.byId[id] }); return true; } return false; };
    // 当前题在范围和难度允许时放在首题，方便纸面接着当前题测试。
    if (current && banks.has(currentTopic)) take(banks.get(currentTopic).find(q => q.id === current.id), currentTopic);
    while (picked.length < Math.min(count, available)) {
      let added = false;
      for (const id of order) {
        if (picked.length >= count) break;
        if (covered.size < order.length && covered.has(id)) continue;
        const q = banks.get(id).find(q => !seen.has(q.id));
        if (take(q, id)) added = true;
      }
      if (!added) {
        // 全部知识点已覆盖后，可继续从每个知识点取后续题。
        for (const id of order) {
          if (picked.length >= count) break;
          if (take(banks.get(id).find(q => !seen.has(q.id)), id)) added = true;
        }
      }
      if (!added) break;
    }
    return { scope, label: scope === 'topic' ? graph.byId[currentTopic].name : options.label || '诊断范围', requested: count, available, topicCount: covered.size, questions: picked };
  }
  function safeSVG(value) {
    if (typeof value !== 'string' || !/^<svg[\s>]/i.test(value.trim())) return '';
    const probe = value.replace(/xmlns(?::xlink)?=["']http:\/\/www\.w3\.org\/(?:2000\/svg|1999\/xlink)["']/gi, '');
    if (/<\s*(?:script|foreignObject|image|iframe|object|embed|style)\b|\bon\w+\s*=|https?:|javascript:|data:|\b(?:href|xlink:href)\s*=\s*["'](?!#)|url\(\s*["']?(?!#)/i.test(probe)) return '';
    return value;
  }
  function figure(value) {
    if (!value) return '';
    const svg = safeSVG(value);
    return svg ? '<div class="figure">' + svg + '</div>' : '<p class="figure-missing">图示无法导出，请核对原题图示。</p>';
  }
  function answerText(q) {
    if (q.type === 'choice') {
      const choice = (q.choices || []).find(c => c.key === q.answer);
      return escape(q.answer) + (choice && !(q.hideChoiceText && choice.figure) ? '. ' + escape(choice.text) : '') + (choice && choice.figure ? figure(choice.figure) : '');
    }
    return escape(Array.isArray(q.answer) ? q.answer.join('，') : q.answer);
  }
  function renderPaper(paper, options = {}) {
    const space = [14, 24, 40].includes(Number(options.space)) ? Number(options.space) : 24;
    const title = (SUBJECTS[options.subject] || '学习') + '纸质测试';
    const questions = paper.questions.map((q, i) => {
      const choices = q.type === 'choice' ? '<ol class="choices">' + (q.choices || []).map(c => '<li><b>' + escape(c.key) + '.</b> ' + (q.hideChoiceText && c.figure ? '' : escape(c.text)) + figure(c.figure) + '</li>').join('') + '</ol>' : '';
      return '<li class="question" data-question-id="' + escape(q.id) + '"><div class="prompt"><b>' + (i + 1) + '.</b> ' + escape(q.prompt) + '</div>' + figure(q.figure) + choices + '<div class="answer-space' + (q.type === 'choice' ? ' choice-space' : '') + '"><span>答：</span></div></li>';
    }).join('');
    const answers = options.answers ? '<section class="answer-key"><h1>参考答案与解析（家长用）</h1><p>' + escape(paper.label) + ' · 请勿随学生试卷一起发放。</p><ol>' + paper.questions.map((q, i) => '<li class="key-item"><h2>' + (i + 1) + '. ' + escape(q.topic.name) + '</h2><div><strong>参考答案：</strong>' + answerText(q) + '</div>' + (q.explanation ? '<p class="explanation">' + escape(q.explanation) + '</p>' : '') + '<p class="source">' + escape(q.topic.chapter) + ' · ' + escape(q.id) + '</p></li>').join('') + '</ol></section>' : '';
    return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + escape(title + ' · ' + paper.label) + '</title><style>' +
      '@page{size:A4;margin:14mm}*{box-sizing:border-box}body{margin:0;background:#fff;color:#111;font-family:"Noto Sans CJK SC","Microsoft YaHei",sans-serif;font-size:12pt;line-height:1.65}main{max-width:182mm;margin:auto;padding:10mm 0}h1{font-size:20pt;margin:0 0 3mm}h2{font-size:12pt;margin:0 0 2mm}.paper-head{border-bottom:1px solid #444;padding-bottom:5mm;margin-bottom:6mm}.scope{margin:0 0 4mm}.identity{display:flex;gap:12mm;flex-wrap:wrap}.instructions{font-size:10pt;margin:4mm 0 0}.questions,.answer-key>ol{list-style:none;margin:0;padding:0}.question{break-inside:avoid;page-break-inside:avoid;margin-bottom:6mm;padding-bottom:3mm}.prompt{font-size:13pt;white-space:pre-wrap;overflow-wrap:anywhere}.choices{list-style:none;padding:0;margin:3mm 0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:3mm 5mm}.choices li{white-space:pre-wrap;overflow-wrap:anywhere;break-inside:avoid}.figure{margin:3mm 0;color:#111}.figure svg{display:block;max-width:100%;width:auto;height:auto;max-height:65mm}.choices .figure svg{max-height:36mm}.answer-space{min-height:' + space + 'mm;border-bottom:1px dotted #aaa;padding:2mm 0;color:#333}.answer-space.choice-space{min-height:10mm}.answer-key{break-before:page;page-break-before:always}.key-item{break-inside:avoid;margin:5mm 0;padding-bottom:4mm;border-bottom:1px solid #ddd}.explanation{white-space:pre-wrap;overflow-wrap:anywhere;margin:2mm 0}.source,.figure-missing{font-size:9pt;color:#444}.key-item .figure svg{max-height:35mm}@media screen{body{background:#e7e9ed;padding:12px}main{background:#fff;padding:14mm;max-width:210mm;box-shadow:0 2px 12px #0002}.answer-key{border-top:2px dashed #999;padding-top:10mm;margin-top:12mm}}@media print{main{padding:0}.question{box-shadow:none}}' +
      '</style></head><body><main><header class="paper-head"><h1>' + escape(title) + '</h1><p class="scope">' + escape(paper.label) + ' · 共 ' + paper.questions.length + ' 题</p><div class="identity"><span>姓名：____________</span><span>日期：____________</span></div><p class="instructions">请在题目下方写出答案或解题过程。选择题填写选项字母；有多个问题时按顺序作答。</p></header><ol class="questions">' + questions + '</ol>' + answers + '</main></body></html>';
  }
  function open(options) {
    const doc = document;
    const old = doc.getElementById('paper-dialog'); if (old) old.remove();
    const el = (tag, text, attrs = {}) => { const n = doc.createElement(tag); if (text != null) n.textContent = text; for (const [key, value] of Object.entries(attrs)) n.setAttribute(key, value); return n; };
    const dialog = el('dialog', null, { id: 'paper-dialog', class: 'paper-dialog', 'aria-labelledby': 'paper-title' });
    const header = el('div', null, { class: 'paper-toolbar' });
    const title = el('h2', '打印纸质测试', { id: 'paper-title' });
    const close = el('button', '关闭', { type: 'button', id: 'paper-close' }); close.onclick = () => dialog.close(); header.append(title, close);
    const controls = el('div', null, { class: 'paper-controls' });
    const field = (name, input) => { const label = el('label', name); label.append(input); controls.append(label); return input; };
    const scope = el('select', null, { id: 'paper-scope' });
    for (const [value, name] of [['range', '本次诊断目标范围'], ['topic', '当前知识点'], ['current', '只打印当前这一题']]) {
      if (value !== 'range' && !options.currentQuestion) continue;
      scope.append(el('option', name, { value }));
    }
    field('出题范围', scope);
    const count = field('题数', el('input', null, { id: 'paper-count', type: 'number', min: '1', max: '60', value: String(Math.max(1, Math.min(60, options.count || 16))) }));
    const space = el('select', null, { id: 'paper-space' });
    for (const [value, name] of [[14, '紧凑'], [24, '适中'], [40, '充足（便于列式）']]) space.append(el('option', name, { value: String(value) })); space.value = '24'; field('答题留白', space);
    const answers = field('附参考答案（另起一页）', el('input', null, { id: 'paper-answers', type: 'checkbox' }));
    const challenge = field('包含拓展题', el('input', null, { id: 'paper-challenge', type: 'checkbox' }));
    const actions = el('div', null, { class: 'paper-actions' });
    const refresh = el('button', '重新选题', { type: 'button', id: 'paper-refresh' });
    const print = el('button', '打印 / 另存为 PDF', { type: 'button', id: 'paper-print', class: 'primary' }); actions.append(refresh, print);
    const status = el('p', '', { id: 'paper-status', role: 'status' });
    const note = el('p', '纸质试卷是固定题目，按章节轮流抽取、优先覆盖不同知识点；不会随作答自适应回溯，也不会改变当前线上答题进度。默认不附答案；涉及颜色的图形题请使用彩色打印。', { class: 'paper-note' });
    const frame = el('iframe', null, { id: 'paper-preview', title: '纸质试卷预览', sandbox: 'allow-same-origin allow-modals' });
    dialog.append(header, controls, actions, status, note, frame); doc.body.append(dialog);
    let seed = String(options.seed || Date.now()); let version = 0;
    const render = () => {
      const currentVersion = ++version; print.disabled = true;
      count.disabled = scope.value === 'current'; challenge.disabled = scope.value === 'current';
      count.value = String(scope.value === 'current' ? 1 : Math.max(1, Math.min(60, Math.floor(Number(count.value) || 1))));
      try {
        const paper = buildPaper(options.graph, { ...options, scope: scope.value, count: count.value, seed, includeChallenge: challenge.checked });
        status.textContent = '已生成 ' + paper.questions.length + ' 题，覆盖 ' + paper.topicCount + ' 个知识点。' + (paper.questions.length < paper.requested ? '符合条件的题目共 ' + paper.available + ' 道，已全部列出。' : '');
        frame.onload = () => { if (currentVersion === version && frame.contentDocument.querySelector('.questions')) print.disabled = false; };
        frame.srcdoc = renderPaper(paper, { subject: options.subject, space: Number(space.value), answers: answers.checked });
      } catch (e) { status.textContent = e.message; frame.srcdoc = '<!doctype html><title>无法生成试卷</title>'; }
    };
    for (const input of [scope, count, space, answers, challenge]) input.addEventListener('change', render);
    refresh.onclick = () => { seed = String(Date.now()) + Math.random(); render(); };
    print.onclick = async () => {
      const win = frame.contentWindow;
      if (!win || print.disabled) return;
      try { await frame.contentDocument.fonts.ready; win.focus(); win.print(); }
      catch { status.textContent = '无法打开打印窗口，请重试。'; }
    };
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    dialog.showModal(); render();
    return dialog;
  }
  return { buildPaper, renderPaper, safeSVG, open };
});
