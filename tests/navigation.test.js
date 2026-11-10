'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const N = require('../assets/navigation');

test('全部菜单采用同一路由表，支持部署在子目录', () => {
  const base = 'https://example.com/cn-math-taxonomy/';
  assert.equal(N.pages.length, 6);
  for (const page of N.pages) {
    const url = N.pageURL(base, page.id, 'english');
    assert.ok(url.pathname.startsWith('/cn-math-taxonomy/'));
    assert.equal(url.searchParams.get('subject'), page.scoped ? 'english' : null);
    assert.equal(url.hash, '');
  }
  assert.notEqual(N.pageURL(base, 'children').pathname, N.pageURL(base, 'history').pathname);
  assert.throws(() => N.pageURL(base, 'made-up'), /未知页面/);
});
test('数学必须显式传递，避免返回诊断时误恢复之前的英语', () => {
  assert.equal(N.resolveSubject({ explicit: 'math', remembered: 'english' }), 'math');
  assert.equal(N.pageURL('https://example.com/', 'diagnose', 'math').searchParams.get('subject'), 'math');
  assert.equal(N.resolveSubject({ remembered: 'physics' }), 'physics');
  assert.equal(N.resolveSubject({ explicit: 'invalid', remembered: 'invalid' }), 'math');
});
test('旧深链接从题目或 hash 推断学科，优先于记忆值，显式学科优先', () => {
  assert.equal(N.resolveSubject({ target: 'cnm_221', remembered: 'english' }), 'math');
  assert.equal(N.resolveSubject({ hash: '#cnp_001', remembered: 'math' }), 'physics');
  assert.equal(N.resolveSubject({ target: 'cne_001,cne_002', remembered: 'math' }), 'english');
  assert.equal(N.resolveSubject({ target: 'cnm_221', explicit: 'english' }), 'english');
});
test('切换学科清除旧题目、年级、章节、演示与 hash 参数', () => {
  const url = N.subjectURL('https://example.com/diagnose/?subject=math&target=cnm_221&chapter=a&grade=七&volume=七上&demo=1&step=2&seed=a&limit=20#cnm_221', 'english');
  assert.equal(url.pathname, '/diagnose/');
  assert.deepEqual([...url.searchParams], [['subject', 'english']]);
  assert.equal(url.hash, '');
});
