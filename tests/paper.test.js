'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../diagnose/engine');
const P = require('../diagnose/paper');
const topics = require('../data/topics.json');
const deps = require('../data/dependencies.json');
const questions = require('../data/questions.json');
const graph = E.buildGraph(topics, deps, questions);
const range = E.gradeTargets(graph, '二上', 'math');
const currentTopicId = range.ids[range.ids.length - 1];
const currentQuestion = graph.bank[currentTopicId].find(q => q.difficulty === 'standard');
const options = { targets: range.ids, label: range.label, count: 40, seed: 'paper-test', currentTopicId, currentQuestion };

test('当前题原样打印；当前知识点和年级范围互不混用', () => {
  const current = P.buildPaper(graph, { ...options, scope: 'current' });
  assert.equal(current.questions.length, 1); assert.equal(current.questions[0].id, currentQuestion.id);
  const topic = P.buildPaper(graph, { ...options, scope: 'topic', count: 60, includeChallenge: true });
  assert.equal(topic.questions.length, graph.bank[currentTopicId].length);
  assert.ok(topic.questions.every(q => q.topicId === currentTopicId));
  const paper = P.buildPaper(graph, options);
  assert.equal(paper.questions.length, 40);
  assert.equal(paper.questions[0].id, currentQuestion.id);
  assert.ok(paper.questions.every(q => range.ids.includes(q.topicId)));
});
test('不重复题目，优先覆盖知识点，先轮流覆盖各章节', () => {
  const ts = ['A', 'A', 'A', 'B', 'B', 'C'].map((chapter, i) => ({ id: 't' + i, chapter, name: 'topic' + i }));
  const bank = Object.fromEntries(ts.map(t => [t.id, ['standard', 'basic'].map((difficulty, i) => ({ id: t.id + '_' + i, topicId: t.id, difficulty, prompt: 'Q', answer: 'A' }))]));
  const mini = { byId: Object.fromEntries(ts.map(t => [t.id, t])), bank };
  const result = P.buildPaper(mini, { targets: ts.map(t => t.id), count: 10, seed: 'test' });
  assert.equal(new Set(result.questions.map(q => q.id)).size, 10);
  assert.equal(new Set(result.questions.slice(0, 6).map(q => q.topicId)).size, 6);
  assert.equal(new Set(result.questions.slice(0, 3).map(q => q.topic.chapter)).size, 3);
});
test('固定种子可复现，不修改题库或线上会话；默认不选拓展题', () => {
  const session = E.createSession(graph, range.ids, { mode: 'screen', limit: 40, seed: 'original' });
  const before = JSON.stringify({ session, bank: graph.bank });
  const a = P.buildPaper(graph, options), b = P.buildPaper(graph, options);
  assert.deepEqual(a.questions.map(q => q.id), b.questions.map(q => q.id));
  assert.ok(a.questions.every(q => !['challenge', 'advanced'].includes(q.difficulty)));
  assert.equal(JSON.stringify({ session, bank: graph.bank }), before);
});
test('题库不足时缩减，约束题量和无效范围，支持无题库时的原有诊断题回退', () => {
  const paper = P.buildPaper(graph, { ...options, targets: [range.ids[0]], count: 60 });
  assert.ok(paper.questions.length < paper.requested);
  assert.equal(paper.questions.length, paper.available);
  const limited = P.buildPaper(graph, { ...options, count: 1000 });
  assert.equal(limited.requested, 60);
  assert.throws(() => P.buildPaper(graph, { targets: ['bad'], count: 1 }), /范围/);
  assert.throws(() => P.buildPaper(graph, { ...options, scope: 'bad' }), /范围/);
  const fallback = E.buildGraph([topics[0]], [], []);
  assert.equal(P.buildPaper(fallback, { targets: [topics[0].id], count: 10 }).questions.length, 1);
});
test('学生试卷默认没有参考答案，姓名日期和留白齐全；答案单独分页', () => {
  const paper = P.buildPaper(graph, { ...options, count: 3 });
  const html = P.renderPaper(paper, { subject: 'math' });
  assert.ok(html.includes('姓名：')); assert.ok(html.includes('日期：'));
  assert.equal((html.match(/class="answer-space/g) || []).length, 3);
  assert.equal(html.includes('<section class="answer-key">'), false);
  const keyed = P.renderPaper(paper, { subject: 'math', answers: true, space: 40 });
  assert.ok(keyed.includes('<section class="answer-key">'));
  assert.ok(keyed.includes('break-before:page')); assert.ok(keyed.includes('min-height:40mm'));
});
test('选择题保留选项、图形和隐藏文字规则；参考答案包含解析', () => {
  const q = questions.find(q => q.type === 'choice' && q.figure);
  const paper = P.buildPaper(graph, { scope: 'current', currentTopicId: q.topicId, currentQuestion: q });
  const html = P.renderPaper(paper, { answers: true });
  assert.ok(html.includes('<svg')); assert.ok(html.includes('class="choices"'));
  for (const c of q.choices) assert.ok(html.includes('>' + c.key + '.</b>'));
  assert.ok(html.includes('参考答案：'));
  const source = questions.find(q => q.hideChoiceText && q.choices.some(c => c.figure));
  const hidden = { ...source, topic: graph.byId[source.topicId], choices: source.choices.map((c, i) => ({ ...c, text: '不应泄露的图形选项名称' + i })) };
  const student = P.renderPaper({ label: '图形选择', questions: [hidden] });
  assert.ok(student.includes('<svg'));
  for (const c of hidden.choices) if (c.figure) assert.equal(student.includes(c.text), false);
});
test('文本按文本输出，拒绝可执行或外部 SVG', () => {
  assert.equal(P.safeSVG('<svg onload="alert(1)"></svg>'), '');
  assert.equal(P.safeSVG('<svg><script>alert(1)</script></svg>'), '');
  assert.equal(P.safeSVG('<svg><image href="https://example.com/x"/></svg>'), '');
  const q = { ...currentQuestion, prompt: '<script>alert("test")</script>', answer: '<img src=x>', topic: graph.byId[currentTopicId] };
  const html = P.renderPaper({ label: '<unsafe>', questions: [q] }, { answers: true });
  assert.equal(html.includes('<script>'), false); assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('&lt;img src=x&gt;'));
});
test('现有题库全部题干与选项图示都能安全导出', () => {
  const figures = questions.flatMap(q => [q.figure, ...(q.choices || []).map(c => c.figure)]).filter(Boolean);
  assert.ok(figures.length > 300);
  for (const svg of figures) assert.ok(P.safeSVG(svg), svg.slice(0, 100));
});
