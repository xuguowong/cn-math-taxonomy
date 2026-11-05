(function () {
  'use strict';
  const K = window.QuestionKnowledge;
  const $ = id => document.getElementById(id);
  const state = { topics: [], deps: [], ready: false, images: [], analysis: null, candidates: [], selected: new Set(), plan: null, controller: null, processing: false, configured: false, vision: false, version: 0 };
  const examples = {
    fraction: '小明吃了一个蛋糕的 1/3，小红吃了同一个蛋糕的 1/4，两人一共吃了这个蛋糕的几分之几？',
    equation: '请用配方法解方程 x² - 6x + 5 = 0，并写出配方步骤。',
    geometry: '一个直角三角形的两条直角边分别长 3 cm 和 4 cm，求斜边长。'
  };
  function el(tag, text, cls) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (cls) node.className = cls; return node; }
  function message(text, error = false) { $('message').textContent = text; $('message').classList.toggle('error', error); }
  function updateButtons() {
    $('analyze').disabled = !state.ready || state.processing || !!state.controller;
    $('cancel').hidden = !state.controller;
    $('build-plan').disabled = !state.selected.size;
    $('target-count').textContent = state.selected.size + ' / 8 已选';
  }
  function invalidate() {
    state.version++; state.controller?.abort(); state.controller = null;
    state.analysis = null; state.plan = null; state.selected.clear(); state.candidates = [];
    $('analysis-result').hidden = true; $('empty-state').hidden = false; $('plan-panel').hidden = true;
    $('topic-search').value = ''; $('search-results').replaceChildren(); message(''); updateButtons();
  }
  async function loadData() {
    try {
      const values = await Promise.all(['topics', 'dependencies'].map(async name => {
        const res = await fetch('../data/' + name + '.json'); if (!res.ok) throw new Error('图谱加载失败（HTTP ' + res.status + '）。'); return res.json();
      }));
      if (!values.every(Array.isArray)) throw new Error('图谱数据格式不正确。');
      state.topics = K.mathTopics(values[0]); state.deps = values[1]; state.ready = true; updateButtons();
    } catch (e) { message(e.message + ' 请检查服务是否启动，并刷新重试。', true); }
  }
  async function checkService() {
    try {
      const response = await fetch('../api/analysis-status', { signal: AbortSignal.timeout(3000), cache: 'no-store' });
      if (!response.ok) throw new Error(); const data = await response.json();
      state.configured = data.configured === true; state.vision = data.vision === true;
    } catch { state.configured = false; }
    $('service-status').textContent = state.configured ? (state.vision ? 'AI 服务已配置 · 已启用图片输入。' : 'AI 服务已配置 · 当前仅文字，图片需要启用视觉模型。') : 'AI 服务未配置。可先用本地文字候选检索，或展开下方配置说明。';
    if (!state.configured && !state.images.length && !state.controller) $('mode').value = 'local';
  }
  function readDataURL(blob) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('无法读取图片。')); reader.readAsDataURL(blob); }); }
  async function prepareImage(file) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('仅支持 PNG、JPEG、WebP 图片。');
    if (file.size > 20 * 1024 * 1024) throw new Error('原始图片请控制在 20 MB 以内。');
    const url = URL.createObjectURL(file);
    try {
      const img = new Image(); img.src = url; await img.decode();
      if (!img.naturalWidth || !img.naturalHeight) throw new Error('图片无法解码。');
      if (Math.max(img.naturalWidth, img.naturalHeight) <= 2048 && file.size <= 8 * 1024 * 1024) return { name: file.name || '截图', url: await readDataURL(file), resized: false };
      const ratio = Math.min(1, 2048 / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(img.naturalWidth * ratio)); canvas.height = Math.max(1, Math.round(img.naturalHeight * ratio));
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92));
      if (!blob || blob.size > 8 * 1024 * 1024) throw new Error('图片处理后仍过大，请裁剪题目区域。');
      return { name: file.name || '截图', url: await readDataURL(blob), resized: true };
    } finally { URL.revokeObjectURL(url); }
  }
  function renderImages() {
    $('previews').replaceChildren();
    state.images.forEach((image, i) => {
      const figure = el('figure', undefined, 'preview'); const img = el('img'); img.src = image.url; img.alt = '题目图片 ' + (i + 1);
      const remove = el('button', '移除图片 ' + (i + 1)); remove.type = 'button'; remove.addEventListener('click', () => { invalidate(); state.images.splice(i, 1); renderImages(); });
      figure.append(img, el('figcaption', (i + 1) + '. ' + image.name + (image.resized ? '（已缩放，请检查清晰度）' : '')), remove); $('previews').append(figure);
    });
  }
  async function addImages(files) {
    if (state.processing) { message('正在处理上一组图片，请稍候。', true); return; }
    const items = [...files]; if (!items.length) return;
    if (state.images.length + items.length > 3) { message('最多添加 3 张图片，请先移除已有图片。', true); return; }
    invalidate(); state.processing = true; updateButtons(); message('正在准备图片…');
    try {
      const prepared = await Promise.all(items.map(prepareImage)); state.images.push(...prepared); renderImages(); $('mode').value = 'ai';
      message('图片已添加。请检查清晰度；需要支持视觉的 OpenAI 兼容模型。');
    } catch (e) { message(e.message || '图片无法读取，请重新选择。', true); }
    finally { state.processing = false; $('images').value = ''; updateButtons(); }
  }
  function renderCandidates() {
    const box = $('target-list'); box.replaceChildren();
    if (!state.candidates.length) box.append(el('p', '没有可靠匹配的考点。可补充题目条件，或在下面手动搜索。', 'muted'));
    for (const c of state.candidates) {
      const card = el('label', undefined, 'target-card'); const input = el('input'); input.type = 'checkbox'; input.value = c.topic.id; input.checked = state.selected.has(c.topic.id);
      input.addEventListener('change', () => {
        if (input.checked && state.selected.size >= 8) { input.checked = false; message('最多选择 8 个直接考点。', true); return; }
        if (input.checked) state.selected.add(c.topic.id); else state.selected.delete(c.topic.id);
        state.plan = null; $('plan-panel').hidden = true; updateButtons(); renderSearch();
      });
      const content = el('div'); content.append(el('strong', c.topic.name), el('div', c.topic.chapter + ' · ' + c.topic.id, 'topic-meta'), el('p', c.reason));
      if (c.evidence) content.append(el('blockquote', (c.evidenceSource === 'image' ? '图片 ' + c.imageIndex + ' 识别依据（待核对）：' : '题目原文：') + c.evidence));
      card.append(input, content); box.append(card);
    }
    updateButtons();
  }
  function showAnalysis() {
    const a = state.analysis; $('empty-state').hidden = true; $('analysis-result').hidden = false;
    $('analysis-mode').textContent = a.mode === 'ai' ? 'AI 分析 · 请核对后确认考点' : '本地文字检索 · 候选结果';
    $('summary-text').textContent = a.questionSummary;
    $('recognition').hidden = !a.recognizedText; $('recognized-text').textContent = a.recognizedText || '';
    $('outline-wrap').hidden = !a.solutionOutline.length; $('outline').replaceChildren(...a.solutionOutline.map(s => el('li', s)));
    const notes = [...a.unresolved, ...a.assumptions.map(s => '采用的假设 / 解法：' + s)];
    $('uncertainties').hidden = !notes.length; $('uncertainties').replaceChildren();
    if (notes.length) { const ul = el('ul'); ul.append(...notes.map(s => el('li', s))); $('uncertainties').append(el('strong', '需要核对的内容'), ul); }
    renderCandidates();
  }
  async function runAnalysis() {
    if (!state.ready || state.processing || state.controller) return;
    const question = $('question').value.trim(); const mode = $('mode').value;
    if (!question && !state.images.length) { message('请输入题目文字或添加图片。', true); $('question').focus(); return; }
    if (mode === 'local' && state.images.length) { message('本地检索不能读图。请选择 AI 分析，或移除图片并输入题目文字。', true); return; }
    invalidate();
    if (mode === 'local') {
      state.candidates = K.suggestTopics(state.topics, question);
      state.analysis = { mode: 'local', questionSummary: '以下是按文字和常见题目形式找到的候选知识点，请手动勾选后生成路径。', solutionOutline: [], unresolved: ['本地检索没有理解完整题意，可能漏掉或误匹配考点。'], assumptions: [], recognizedText: '' };
      showAnalysis(); message('找到 ' + state.candidates.length + ' 个候选，请确认直接考点。'); return;
    }
    if (!state.configured) { message('AI 服务尚未配置。请按「连接自部署模型」说明配置，并用 npm start 启动。', true); return; }
    if (state.images.length && !state.vision) { message('当前模型未启用图片输入。请使用视觉模型，并设置 MATH_AI_VISION=1 后重启服务。', true); return; }
    const version = state.version; const controller = new AbortController(); state.controller = controller; updateButtons(); message(state.images.length ? '正在读取图片并分析考点，可能需要一两分钟…' : '正在分析题意与解题步骤，可能需要一两分钟…');
    try {
      const response = await fetch('../api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(330000)]),
        body: JSON.stringify({ question, images: state.images.map(i => i.url) }) });
      let data; try { data = await response.json(); } catch { throw new Error('分析接口返回异常，请确认使用 npm start 启动。'); }
      if (!response.ok) throw new Error(data.error || '分析失败，请重试。');
      if (version !== state.version) return;
      const a = K.validateAnalysis(data.analysis, state.topics, question, state.images.length);
      state.analysis = { ...a, mode: 'ai' };
      state.candidates = a.targets.map(t => ({ ...t, topic: state.topics.find(topic => topic.id === t.topicId) }));
      state.selected = new Set(a.targets.map(t => t.topicId)); showAnalysis();
      message(a.targets.length ? '分析完成。请核对题意和考点，再生成学习顺序。' : '未找到可靠考点，请查看说明或手动搜索。');
    } catch (e) { if (version === state.version) message(controller.signal.aborted ? '已取消分析。' : (e.name === 'TimeoutError' ? '分析超时，请重试。' : e.message), !controller.signal.aborted); }
    finally { if (state.controller === controller) state.controller = null; updateButtons(); }
  }
  function renderSearch() {
    const box = $('search-results'); box.replaceChildren(); const query = $('topic-search').value;
    if (!query.trim()) return;
    const results = K.searchTopics(state.topics, query, 8);
    if (!results.length) { box.append(el('p', '没有匹配的知识点，可尝试更短的关键词。', 'muted')); return; }
    for (const row of results) {
      const line = el('div', undefined, 'search-row'); const label = el('div'); label.append(el('strong', row.topic.name), el('div', row.topic.chapter, 'topic-meta'));
      const button = el('button', state.selected.has(row.topic.id) ? '已选择' : '添加'); button.type = 'button'; button.disabled = state.selected.has(row.topic.id);
      button.addEventListener('click', () => {
        if (state.selected.size >= 8) { message('最多选择 8 个直接考点。', true); return; }
        if (!state.candidates.some(c => c.topic.id === row.topic.id)) state.candidates.push({ topic: row.topic, reason: '手动添加，请确认题目确实需要这个知识点。' });
        state.selected.add(row.topic.id); state.plan = null; $('plan-panel').hidden = true; renderCandidates(); renderSearch();
      });
      line.append(label, button); box.append(line);
    }
  }
  function pathNode(node, byId) {
    const item = el('li', undefined, 'path-node' + (node.isTarget ? ' target' : '')); const heading = el('h3');
    heading.append(el('span', String(node.order).padStart(2, '0'), 'order'), document.createTextNode(node.name));
    if (node.isTarget) heading.append(el('span', '直接考点', 'small-badge'));
    item.append(heading, el('div', node.chapter + ' · ' + node.id, 'topic-meta'), el('p', node.description));
    const details = el('details'); details.append(el('summary', '掌握标准与先修依据'));
    const criteria = el('ul'); criteria.append(...(node.mastery_criteria || []).map(s => el('li', s))); details.append(criteria);
    for (const e of node.requiredBy) details.append(el('p', '→ ' + byId.get(e.topicId).name + '（' + (e.strength === 'soft' ? '软先修' : '硬先修') + '）：' + e.reason));
    if (node.standards?.length) details.append(el('p', '图谱关联课标：' + node.standards.map(s => s.id || s).join('、')));
    const link = el('a', '在图谱中查看 ↗'); link.href = '../explore/#' + encodeURIComponent(node.id); details.append(link); item.append(details); return item;
  }
  function generatePlan() {
    try {
      const plan = K.buildPlan(state.topics, state.deps, [...state.selected], { includeSoft: $('include-soft').checked }); state.plan = plan;
      $('plan-panel').hidden = false; const byId = new Map(plan.nodes.map(t => [t.id, t]));
      $('plan-summary').textContent = plan.targets.length + ' 个直接考点 · ' + (plan.nodes.length - plan.targets.length) + ' 个前置知识 · ' + (plan.includeSoft ? '包含硬、软先修' : '只展开硬先修');
      $('learning-path').replaceChildren(); $('deep-list').replaceChildren();
      // 完整顺序不截断；长链先折叠展示，保持基础到目标的顺序。
      plan.nodes.forEach((node, index) => (index < 12 ? $('learning-path') : $('deep-list')).append(pathNode(node, byId)));
      $('deep-path').hidden = plan.nodes.length <= 12; $('deep-summary').textContent = '继续查看后续 ' + (plan.nodes.length - 12) + ' 个知识点（完整顺序）';
      const params = new URLSearchParams({ target: plan.targets.join(',') }); $('diagnose-link').href = '../diagnose/?' + params;
      message('学习顺序已生成。可以展开掌握标准，或继续诊断。');
    } catch (e) { message(e.message, true); }
  }
  $('question').addEventListener('input', invalidate);
  $('mode').addEventListener('change', invalidate);
  $('analyze').addEventListener('click', runAnalysis);
  $('cancel').addEventListener('click', () => state.controller?.abort());
  $('images').addEventListener('change', event => addImages(event.target.files));
  document.querySelectorAll('[data-example]').forEach(button => button.addEventListener('click', () => { invalidate(); state.images = []; renderImages(); $('question').value = examples[button.dataset.example]; $('question').focus(); }));
  document.addEventListener('paste', event => { const images = [...(event.clipboardData?.files || [])]; if (images.length) { event.preventDefault(); addImages(images); } });
  const drop = $('drop-zone');
  for (const type of ['dragenter', 'dragover']) drop.addEventListener(type, event => { event.preventDefault(); drop.classList.add('dragging'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('dragging'));
  drop.addEventListener('drop', event => { event.preventDefault(); drop.classList.remove('dragging'); addImages(event.dataTransfer.files); });
  $('topic-search').addEventListener('input', renderSearch);
  $('build-plan').addEventListener('click', generatePlan);
  $('include-soft').addEventListener('change', () => { if (state.plan) generatePlan(); });
  $('export').addEventListener('click', () => {
    if (!state.plan) return;
    const payload = { version: 1, question: $('question').value.trim(), imageCount: state.images.length, analysis: state.analysis, plan: state.plan };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })); const link = el('a'); link.href = url; link.download = 'question-knowledge-plan.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  updateButtons(); loadData(); checkService();
})();
