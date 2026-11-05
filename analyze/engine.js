/* 题目检索与先修路径。浏览器 / Node 共用，无外部依赖。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QuestionKnowledge = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const normalize = s => String(s || '').replace(/²/g, '^2').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
  const mathTopics = topics => topics.filter(t => /^cnm_/.test(t.id) && !t.external);
  function grams(text) {
    const s = normalize(text); const out = new Set();
    for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
    return out;
  }
  function searchTopics(topics, query, limit = 12) {
    const q = normalize(query); if (!q) return [];
    const g = grams(q);
    return mathTopics(topics).map(t => {
      const name = normalize(t.name), body = normalize(t.description + (t.mastery_criteria || []).join(''));
      let score = name === q || t.id === q ? 100 : name.includes(q) ? 60 : q.includes(name) ? 45 : 0;
      for (const part of g) { if (name.includes(part)) score += 3; else if (body.includes(part)) score += 0.35; }
      return { topic: t, score };
    }).filter(r => r.score >= 3).sort((a, b) => b.score - a.score || a.topic.id.localeCompare(b.topic.id)).slice(0, limit);
  }
  // 本地检索只给候选，不声称完成语义分析或判断掌握程度。
  function suggestTopics(topics, question) {
    const hints = [];
    const q = normalize(question);
    const fractions = [...q.matchAll(/\d+\/(\d+)/g)];
    if (fractions.length >= 2 && /[+＋]|一共|总共|相加|和是多少|相减|还剩|[-−]/.test(q)) {
      hints.push(new Set(fractions.map(m => m[1])).size > 1 ? '异分母分数加减' : '同分母分数加减');
    }
    if (/直角三角形|勾股/.test(q) && /边|斜边|长|距离/.test(q)) hints.push('勾股定理');
    if (/配方法/.test(q)) hints.push('配方法');
    if (/解方程/.test(q) && /[a-z](?:\^2|²)|[a-z][²]/.test(q)) hints.push('一元二次方程解法的选择');
    if (/求导|导数/.test(q)) hints.push('导数的四则运算');
    const candidates = new Map();
    for (const hint of hints) {
      for (const row of searchTopics(topics, hint, 1)) {
        candidates.set(row.topic.id, { topic: row.topic, reason: '题目形式提示可能涉及「' + hint + '」，请核对。', score: 100 });
      }
    }
    for (const row of searchTopics(topics, question, 10)) {
      if (!candidates.has(row.topic.id)) candidates.set(row.topic.id, { ...row, reason: '名称或掌握标准与题目有文字重合，请核对。' });
    }
    return [...candidates.values()].sort((a, b) => b.score - a.score).slice(0, 10);
  }
  function validateAnalysis(raw, topics, question, imageCount = 0) {
    if (!raw || !Array.isArray(raw.targets) || raw.targets.length > 8) throw new Error('模型返回的考点格式不正确。');
    const byId = new Map(mathTopics(topics).map(t => [t.id, t]));
    const ids = new Set();
    const text = (s, max) => { if (typeof s !== 'string' || s.length > max) throw new Error('模型返回的文字格式不正确。'); return s.trim(); };
    const targets = raw.targets.map(t => {
      if (!t || !byId.has(t.topicId) || ids.has(t.topicId)) throw new Error('模型返回了未知或重复的知识点，请重试或手动选择。');
      ids.add(t.topicId);
      const evidence = text(t.evidence, 500);
      const evidenceSource = t.evidenceSource || 'text';
      if (evidenceSource !== 'text' && evidenceSource !== 'image') throw new Error('模型返回的依据来源不正确。');
      if (!evidence || (evidenceSource === 'text' && !question.includes(evidence))) throw new Error('模型的题目引用无法核对，请重试或手动选择。');
      if (evidenceSource === 'image' && (!Number.isInteger(t.imageIndex) || t.imageIndex < 1 || t.imageIndex > imageCount)) throw new Error('模型引用了不存在的图片。');
      const reason = text(t.reason, 1000);
      if (!reason) throw new Error('模型缺少考点匹配依据。');
      return { topicId: t.topicId, reason, evidence, evidenceSource, ...(evidenceSource === 'image' ? { imageIndex: t.imageIndex } : {}) };
    });
    const list = (a, max) => {
      if (!Array.isArray(a) || a.length > max) throw new Error('模型返回的分析格式不正确。');
      return a.map(s => text(s, 1500));
    };
    return {
      questionSummary: text(raw.questionSummary, 1500), recognizedText: text(raw.recognizedText || '', 6000),
      solutionOutline: list(raw.solutionOutline, 12), targets,
      unresolved: list(raw.unresolved, 12), assumptions: list(raw.assumptions, 12)
    };
  }
  function buildPlan(topics, dependencies, targetIds, options = {}) {
    const ts = mathTopics(topics), byId = new Map(ts.map(t => [t.id, t]));
    const targets = [...new Set(targetIds)];
    if (!targets.length || targets.length > 8 || targets.some(id => !byId.has(id))) throw new Error('请选择 1–8 个有效的数学知识点。');
    const allEdges = new Map();
    for (const e of dependencies) {
      if (!byId.has(e.topicId) || !byId.has(e.prerequisiteId) || (!options.includeSoft && e.strength === 'soft')) continue;
      const key = e.topicId + ':' + e.prerequisiteId;
      if (!allEdges.has(key) || e.strength === 'hard') allEdges.set(key, e);
    }
    const incoming = new Map(ts.map(t => [t.id, []]));
    for (const e of allEdges.values()) incoming.get(e.topicId).push(e);
    const selected = new Set(targets), queue = [...targets], depths = new Map(targets.map(id => [id, 0]));
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i];
      for (const e of incoming.get(id)) if (!selected.has(e.prerequisiteId)) {
        selected.add(e.prerequisiteId); depths.set(e.prerequisiteId, depths.get(id) + 1); queue.push(e.prerequisiteId);
      }
    }
    const edges = [...allEdges.values()].filter(e => selected.has(e.topicId) && selected.has(e.prerequisiteId));
    const counts = new Map([...selected].map(id => [id, 0])), outgoing = new Map([...selected].map(id => [id, []]));
    for (const e of edges) { counts.set(e.topicId, counts.get(e.topicId) + 1); outgoing.get(e.prerequisiteId).push(e); }
    const compare = (a, b) => (byId.get(a).grade || 0) - (byId.get(b).grade || 0) || a.localeCompare(b, 'en', { numeric: true });
    const ready = [...selected].filter(id => counts.get(id) === 0), ordered = [];
    while (ready.length) {
      ready.sort(compare); const id = ready.shift(); ordered.push(id);
      for (const e of outgoing.get(id)) { counts.set(e.topicId, counts.get(e.topicId) - 1); if (!counts.get(e.topicId)) ready.push(e.topicId); }
    }
    if (ordered.length !== selected.size) throw new Error('先修数据存在环，无法生成可靠的学习顺序。');
    return {
      targets, includeSoft: !!options.includeSoft,
      nodes: ordered.map((id, i) => ({ ...byId.get(id), order: i + 1, isTarget: targets.includes(id), depth: depths.get(id),
        requiredBy: outgoing.get(id).map(e => ({ topicId: e.topicId, strength: e.strength, reason: e.reason || '' })) })),
      edges: edges.map(e => ({ topicId: e.topicId, prerequisiteId: e.prerequisiteId, strength: e.strength, reason: e.reason || '' })),
      note: '这是图谱中的先修学习顺序，不代表每个前置知识都需要重学，也不代表已经诊断出薄弱点。'
    };
  }
  return { mathTopics, searchTopics, suggestTopics, validateAnalysis, buildPlan };
});
