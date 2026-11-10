'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('../analyze/engine');
const { analyzeQuestion, validateImages, parseJSON } = require('../analyze/ai');
const topics = require('../data/topics.json');
const deps = require('../data/dependencies.json');
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=';
const result = overrides => ({ questionSummary: '求两个分数的和', recognizedText: '', solutionOutline: ['先通分，再相加。'],
  targets: [{ topicId: 'cnm_p173', reason: '两个分数分母不同，需要异分母加法。', evidence: '1/3 + 1/4', evidenceSource: 'text' }], unresolved: [], assumptions: [], ...overrides });

test('真实题目给出分数加法候选，搜索可以手动修正，且只检索数学', () => {
  assert.equal(K.suggestTopics(topics, '计算 1/3 + 1/4')[0].topic.id, 'cnm_p173');
  assert.equal(K.searchTopics(topics, '通分')[0].topic.id, 'cnm_p172');
  assert.deepEqual(K.searchTopics(topics, ''), []);
  assert.ok(K.searchTopics(topics, '导数').every(r => r.topic.id.startsWith('cnm_')));
});
test('真实图谱的每条依赖都在目标前面，多目标合并且无重复', () => {
  for (const includeSoft of [false, true]) {
    const p = K.buildPlan(topics, deps, ['cnm_p173', 'cnm_221', 'cnm_221'], { includeSoft });
    const position = new Map(p.nodes.map((n, i) => [n.id, i]));
    assert.equal(position.size, p.nodes.length); assert.equal(p.targets.length, 2);
    assert.ok(position.has('cnm_p172'));
    for (const e of p.edges) {
      assert.ok(position.get(e.prerequisiteId) < position.get(e.topicId), JSON.stringify(e));
      if (!includeSoft) assert.equal(e.strength, 'hard');
    }
    assert.ok(p.nodes.find(n => n.id === 'cnm_p173').isTarget);
    assert.ok(p.nodes.some(n => n.requiredBy.length));
  }
});
test('只展开选中的先修类型，保持拓扑顺序而非强按年级排序', () => {
  const ts = [{ id: 'cnm_a', grade: 9 }, { id: 'cnm_b', grade: 1 }, { id: 'cnm_c', grade: 2 }];
  const edges = [{ topicId: 'cnm_b', prerequisiteId: 'cnm_a', strength: 'hard' }, { topicId: 'cnm_b', prerequisiteId: 'cnm_c', strength: 'soft' }];
  assert.deepEqual(K.buildPlan(ts, edges, ['cnm_b']).nodes.map(n => n.id), ['cnm_a', 'cnm_b']);
  assert.equal(K.buildPlan(ts, edges, ['cnm_b'], { includeSoft: true }).nodes.length, 3);
});
test('坏目标、超量目标、循环依赖均明确报错', () => {
  assert.throws(() => K.buildPlan(topics, deps, ['made_up']), /有效/);
  assert.throws(() => K.buildPlan(topics, deps, []), /有效/);
  assert.throws(() => K.buildPlan(topics, deps, K.mathTopics(topics).slice(0, 9).map(t => t.id)), /有效/);
  assert.throws(() => K.buildPlan([{ id: 'cnm_a' }, { id: 'cnm_b' }], [{ topicId: 'cnm_a', prerequisiteId: 'cnm_b' }, { topicId: 'cnm_b', prerequisiteId: 'cnm_a' }], ['cnm_a']), /环/);
});
test('模型不能发明 ID、重复考点或伪造文字引用', () => {
  assert.equal(K.validateAnalysis(result(), topics, '计算 1/3 + 1/4').targets[0].topicId, 'cnm_p173');
  assert.throws(() => K.validateAnalysis(result({ targets: [{ topicId: 'fake' }] }), topics, ''), /未知/);
  const r = result(); assert.throws(() => K.validateAnalysis(result({ targets: [r.targets[0], r.targets[0]] }), topics, '1/3 + 1/4'), /重复/);
  assert.throws(() => K.validateAnalysis(r, topics, '另一个题目'), /引用/);
  assert.throws(() => K.validateAnalysis(result({ solutionOutline: 'wrong' }), topics, '1/3 + 1/4'), /格式/);
});
test('图片来源明确标记，拒绝不存在的图片编号；允许无可靠考点', () => {
  const target = { topicId: 'cnm_p173', reason: '图片中的两个分数需要相加', evidence: '图中为 1/3 + 1/4', evidenceSource: 'image', imageIndex: 1 };
  assert.equal(K.validateAnalysis(result({ targets: [target] }), topics, '', 1).targets[0].imageIndex, 1);
  assert.throws(() => K.validateAnalysis(result({ targets: [target] }), topics, '', 0), /不存在/);
  assert.throws(() => K.validateAnalysis(result({ targets: [{ ...target, imageIndex: 1.5 }] }), topics, '', 2), /不存在/);
  assert.deepEqual(K.validateAnalysis(result({ targets: [], unresolved: ['图片不清晰，无法可靠分析。'] }), topics, '', 1).targets, []);
});
test('图片数据校验拒绝 SVG、假 MIME、无效 base64、过量和过大文件', () => {
  assert.equal(validateImages([PNG])[0], PNG);
  assert.throws(() => validateImages(['data:image/svg+xml;base64,PHN2Zz4=']), /格式/);
  assert.throws(() => validateImages(['data:image/png;base64,SGVsbG8=']), /不符/);
  assert.throws(() => validateImages(['data:image/png;base64,a===']), /格式/);
  assert.throws(() => validateImages([PNG, PNG, PNG, PNG]), /最多/);
  assert.throws(() => validateImages(['a'.repeat(12 * 1024 * 1024)]), /8 MB/);
});
test('OpenAI 文字请求使用配置的地址、模型和 Bearer；JSON 围栏可解析', async () => {
  let request;
  const answer = await analyzeQuestion({ question: '1/3 + 1/4', topics, config: { baseURL: 'http://localhost:8000/v1/', model: 'my-model', apiKey: 'test-only-key' },
    fetchImpl: async (url, opts) => { request = { url: String(url), ...opts }; return new Response(JSON.stringify({ choices: [{ message: { content: '```json\n' + JSON.stringify(result()) + '\n```' } }] })); } });
  assert.equal(request.url, 'http://localhost:8000/v1/chat/completions');
  const body = JSON.parse(request.body); assert.equal(body.model, 'my-model'); assert.equal(body.messages[1].content, '1/3 + 1/4');
  assert.equal(request.headers.Authorization, 'Bearer test-only-key'); assert.ok(body.messages[0].content.includes('cnm_p173'));
  assert.equal(answer.targets[0].topicId, 'cnm_p173');
  assert.throws(() => parseJSON('not json'), /JSON/);
});
test('OpenAI 图片使用 image_url data URL，文本可空，无 Key 时不发 Authorization', async () => {
  let request;
  const target = { topicId: 'cnm_p173', reason: '图中异分母相加', evidence: '图中 1/3 + 1/4', evidenceSource: 'image', imageIndex: 1 };
  await analyzeQuestion({ question: '', images: [PNG], topics, config: { baseURL: 'http://localhost/v1', model: 'my-vision', vision: true },
    fetchImpl: async (url, opts) => { request = opts; return Response.json({ choices: [{ message: { content: JSON.stringify(result({ targets: [target], recognizedText: '1/3 + 1/4' })) } }] }); } });
  const content = JSON.parse(request.body).messages[1].content;
  assert.equal(content[0].type, 'text'); assert.deepEqual(content[1], { type: 'image_url', image_url: { url: PNG } });
  assert.equal(request.headers.Authorization, undefined);
});
test('缺少配置、纯文本模型、上游认证失败、坏响应和连接错误有明确提示', async () => {
  const base = { question: '1/3 + 1/4', topics };
  await assert.rejects(analyzeQuestion({ ...base, config: {} }), /尚未配置/);
  await assert.rejects(analyzeQuestion({ ...base, images: [PNG], config: { baseURL: 'http://localhost/v1', model: 'text' } }), /视觉/);
  await assert.rejects(analyzeQuestion({ ...base, config: { baseURL: 'file:///tmp', model: 'bad' } }), /地址/);
  const config = { baseURL: 'http://localhost/v1', model: 'test' };
  await assert.rejects(analyzeQuestion({ ...base, config, fetchImpl: async () => new Response('secret error', { status: 401 }) }), /认证/);
  await assert.rejects(analyzeQuestion({ ...base, config, fetchImpl: async () => new Response('<html>') }), /无法解析/);
  await assert.rejects(analyzeQuestion({ ...base, config, fetchImpl: async () => { throw new Error('secret'); } }), /无法连接/);
});

module.exports = { PNG, result };
