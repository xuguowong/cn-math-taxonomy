/* 全站路由和导航：学科上下文与页面入口只在这里维护。 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else api.mount(root, document.currentScript);
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  const subjects = [['math', '数学'], ['chinese', '语文'], ['science', '科学'], ['morality', '道德与法治'], ['history', '历史'], ['geography', '地理'], ['biology', '生物'], ['chemistry', '化学'], ['english', '英语'], ['physics', '物理']];
  const pages = [
    { id: 'home', path: '', label: '首页', scoped: true },
    { id: 'analyze', path: 'analyze/', label: '题目分析' },
    { id: 'explore', path: 'explore/', label: '知识图谱', scoped: true },
    { id: 'diagnose', path: 'diagnose/', label: '学习诊断', scoped: true },
    { id: 'children', path: 'children/', label: '孩子档案' },
    { id: 'history', path: 'children/history.html', label: '盲区与历史' }
  ];
  const validSubject = value => subjects.some(s => s[0] === value);
  const prefixes = { cnm: 'math', cne: 'english', cnp: 'physics', cnc: 'chinese', cns: 'science', cnd: 'morality', cnh: 'history', cng: 'geography', cnb: 'biology', cnk: 'chemistry' };
  function resolveSubject({ explicit, target, hash, remembered } = {}) {
    if (validSubject(explicit)) return explicit;
    const id = String(target || hash || '').replace(/^#/, '').split(',')[0].trim();
    const prefix = /^([a-z]+)_/.exec(id);
    return (prefix && prefixes[prefix[1]]) || (validSubject(remembered) ? remembered : 'math');
  }
  function pageURL(base, id, subject = 'math') {
    const page = pages.find(p => p.id === id);
    if (!page) throw new Error('未知页面：' + id);
    const url = new URL(page.path, base);
    if (page.scoped) url.searchParams.set('subject', validSubject(subject) ? subject : 'math');
    return url;
  }
  function subjectURL(current, subject) {
    const url = new URL(current);
    url.searchParams.set('subject', validSubject(subject) ? subject : 'math');
    for (const key of ['target', 'chapter', 'grade', 'volume', 'demo', 'step', 'seed', 'limit']) url.searchParams.delete(key);
    url.hash = '';
    return url;
  }
  function mount(win, script) {
    const doc = win.document, host = doc.querySelector('[data-navigation-page]');
    if (!host || !script) return;
    const page = pages.find(p => p.id === host.dataset.navigationPage);
    if (!page) return;
    const base = new URL('../', script.src);
    const current = new URL(win.location.href);
    let remembered;
    try { remembered = win.sessionStorage.getItem('cnmNavigation.subject.v1'); } catch { /* storage optional */ }
    let subject = resolveSubject({ explicit: current.searchParams.get('subject'), target: current.searchParams.get('target'), hash: current.hash, remembered });
    if (page.scoped) {
      // Run before page scripts so the visible subject and the loaded dataset agree.
      current.searchParams.set('subject', subject);
      win.history.replaceState(win.history.state, '', current);
      try { win.sessionStorage.setItem('cnmNavigation.subject.v1', subject); } catch { /* storage optional */ }
    }
    const href = (id, override) => pageURL(base, id, override || subject).href;
    win.CnmNavigation = {
      get subject() { return subject; }, page: page.id, href,
      setSubject(value) {
        if (!validSubject(value)) return;
        subject = value;
        try { win.sessionStorage.setItem('cnmNavigation.subject.v1', subject); } catch { /* storage optional */ }
        host.querySelectorAll('[data-page-link]').forEach(link => { link.href = href(link.dataset.pageLink); });
        const brandLink = host.querySelector('.brand'); if (brandLink) brandLink.href = href('home');
      }
    };
    doc.body.dataset.page = page.id;
    const el = (tag, text, cls) => { const n = doc.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; };
    const row = el('div', null, 'workspace-header-row');
    const brand = el('a', null, 'brand'); brand.href = href('home');
    const logo = el('span', '∑', 'workspace-logo'); logo.setAttribute('aria-hidden', 'true');
    const copy = el('span', null, 'brand-copy'); copy.append(el('span', '中小学·高中知识图谱', 'brand-name'), el('span', '学习工作台', 'brand-kicker')); brand.append(logo, copy);
    const nav = el('nav', null, 'workspace-primary'); nav.setAttribute('aria-label', '主导航');
    for (const entry of pages) {
      const link = el('a', entry.label, 'workspace-nav-link'); link.href = href(entry.id); link.dataset.pageLink = entry.id;
      if (entry.id === page.id) { link.classList.add('active'); link.setAttribute('aria-current', 'page'); }
      nav.append(link);
    }
    row.append(brand, nav);
    const context = el('div', null, 'workspace-context');
    const title = el('div', null, 'workspace-location'); title.append(el('span', '工作台 / ', 'muted'), el('strong', page.label)); context.append(title);
    if (page.scoped) {
      const label = el('label', '当前学科', 'workspace-subject-label'); label.htmlFor = 'navigation-subject';
      const select = el('select'); select.id = 'navigation-subject';
      for (const s of subjects) { const option = el('option', s[1]); option.value = s[0]; option.selected = s[0] === subject; select.append(option); }
      select.addEventListener('change', () => win.location.assign(subjectURL(win.location.href, select.value)));
      const field = el('div', null, 'workspace-subject'); field.append(label, select); context.append(field);
    } else context.append(el('span', page.id === 'analyze' ? '仅数学 · 文字与图片题目分析' : '全部学科 · 档案与诊断记录保存在当前浏览器', 'workspace-scope'));
    host.replaceChildren(row, context);
    win.requestAnimationFrame(() => {
      const active = nav.querySelector('[aria-current="page"]');
      if (active && nav.scrollWidth > nav.clientWidth) nav.scrollLeft = active.offsetLeft - nav.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2;
    });
  }
  return { pages, subjects, resolveSubject, pageURL, subjectURL, mount };
});
