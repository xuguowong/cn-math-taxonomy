#!/usr/bin/env python3
"""验证共享导航、学科上下文、跨页面操作和桌面/手机布局。无需模型服务。"""
import argparse
import functools
import json
from pathlib import Path
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
ROUTES = [('home', '/'), ('analyze', '/analyze/'), ('explore', '/explore/'),
          ('diagnose', '/diagnose/'), ('children', '/children/'), ('history', '/children/history.html')]


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass


def run():
    parser = argparse.ArgumentParser()
    parser.add_argument('--chrome', default='/opt/google/chrome/chrome')
    parser.add_argument('--screenshots', default='/tmp/cnm-workspace-browser')
    args = parser.parse_args()
    out = Path(args.screenshots)
    out.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = 'http://127.0.0.1:%s' % server.server_port
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path=args.chrome, headless=True, args=['--no-sandbox'])
            errors = []

            def page_for(width=1440, theme='dark'):
                page = browser.new_page(viewport={'width': width, 'height': 1000}, color_scheme=theme)
                page.on('pageerror', lambda error: errors.append(str(error)))
                return page

            def check_menu(page, name):
                page.wait_for_selector('.workspace-primary')
                assert page.locator('.workspace-nav-link').count() == 6
                assert page.locator('.workspace-nav-link[aria-current=page]').get_attribute('data-page-link') == name
                assert page.locator('.workspace-nav-link').evaluate_all('(links)=>links.map(l=>l.dataset.pageLink)') == [r[0] for r in ROUTES]
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), (name, page.viewport_size)

            for theme in ['dark', 'light']:
                for width in [1440, 390]:
                    page = page_for(width, theme)
                    for name, path in ROUTES:
                        page.goto(base + path)
                        check_menu(page, name)
                        page.wait_for_timeout(150)
                        if name == 'diagnose':
                            page.wait_for_selector('#search')
                        if name == 'home':
                            page.wait_for_selector('a.grade-card')
                        if width == 1440 and name not in ['explore']:
                            assert page.locator('main').bounding_box()['width'] >= 1300
                        if theme == 'dark':
                            page.screenshot(path=str(out / ('%s-%s.png' % (name, width))), full_page=True)
                    page.close()
                    print('PASS six-page shared layout', theme, width, flush=True)

            page = page_for()
            # Click every primary menu from every page, instead of only checking link strings.
            for source, path in ROUTES:
                for target, _ in ROUTES:
                    page.goto(base + path)
                    page.locator('[data-page-link="%s"]' % target).click()
                    check_menu(page, target)
            print('PASS all 36 primary menu transitions', flush=True)

            prefixes = {'math': 'cnm_', 'english': 'cne_', 'physics': 'cnp_', 'chinese': 'cnc_', 'science': 'cns_', 'morality': 'cnd_', 'history': 'cnh_', 'geography': 'cng_', 'biology': 'cnb_', 'chemistry': 'cnk_'}
            topics = json.loads((ROOT / 'data/topics.json').read_text())
            for subject, prefix in prefixes.items():
                expected = sum(1 for topic in topics if topic['id'].startswith(prefix))
                page.goto(base + '/?subject=' + subject)
                page.wait_for_function("/^\\d+$/.test(document.querySelector('#n-topics').textContent)")
                assert int(page.locator('#n-topics').inner_text()) == expected
                for button, target in [('home-diagnose-link', '/diagnose/'), ('home-explore-link', '/explore/'), ('home-analyze-link', '/analyze/')]:
                    url = urlparse(page.locator('#' + button).get_attribute('href'))
                    assert url.path == target
                    assert parse_qs(url.query).get('subject') == (None if button == 'home-analyze-link' else [subject])
                page.locator('[data-page-link=explore]').click()
                page.wait_for_function("document.querySelector('#count').textContent.startsWith('显示 ')")
                assert page.locator('#count').inner_text().endswith('/ ' + str(expected))
                assert page.locator('#navigation-subject').input_value() == subject
                page.locator('[data-page-link=diagnose]').click()
                page.wait_for_selector('#search')
                assert page.locator('#navigation-subject').input_value() == subject
            print('PASS all ten subjects: homepage counts, action buttons, graph data and diagnosis context', flush=True)

            page.goto(base + '/?subject=english')
            page.wait_for_selector('#home-analyze-link')
            assert urlparse(page.locator('#home-analyze-link').get_attribute('href')).path == '/analyze/'
            assert urlparse(page.locator('#home-explore-link').get_attribute('href')).path == '/explore/'
            assert parse_qs(urlparse(page.locator('#home-explore-link').get_attribute('href')).query)['subject'] == ['english']
            page.locator('[data-page-link=explore]').click()
            assert page.locator('#navigation-subject').input_value() == 'english'
            page.locator('[data-page-link=diagnose]').click()
            page.wait_for_selector('#search')
            assert page.locator('#navigation-subject').input_value() == 'english'
            assert '英语' in page.title()
            page.go_back()
            check_menu(page, 'explore')
            page.go_forward()
            check_menu(page, 'diagnose')
            page.locator('[data-page-link=analyze]').click()
            assert 'subject' not in parse_qs(urlparse(page.url).query)
            assert page.locator('#navigation-subject').count() == 0
            assert '仅数学' in page.locator('.workspace-scope').inner_text()
            assert parse_qs(urlparse(page.locator('[data-page-link=diagnose]').get_attribute('href')).query)['subject'] == ['english']
            print('PASS subject retained across pages/back/forward; analysis explicitly math-only', flush=True)

            page.wait_for_function("!document.querySelector('#analyze').disabled && document.querySelector('#mode').value==='local'")
            page.locator('[data-example=fraction]').click()
            page.locator('#analyze').click()
            page.locator('.target-card').filter(has_text='异分母分数加减').locator('input').check()
            page.locator('#build-plan').click()
            page.locator('#diagnose-link').click()
            page.wait_for_selector('#q-text')
            assert page.locator('#navigation-subject').input_value() == 'math'
            assert '分数' in page.locator('.q-title').inner_text()
            page.locator('#navigation-subject').select_option('english')
            page.wait_for_selector('#search')
            assert parse_qs(urlparse(page.url).query) == {'subject': ['english']}
            assert page.locator('#q-text').count() == 0
            page.goto(base + '/explore/?subject=math&grade=9#cnm_221')
            page.locator('#navigation-subject').select_option('physics')
            page.wait_for_function("new URL(location.href).searchParams.get('subject')==='physics'")
            assert parse_qs(urlparse(page.url).query) == {'subject': ['physics']}
            assert not urlparse(page.url).fragment
            print('PASS analysis-to-math diagnosis and clean subject switching', flush=True)

            page.locator('[data-page-link=children]').click()
            page.locator('#f-name').fill('布局测试')
            page.locator('#f-grade').select_option('二年级')
            page.locator('#f-submit').click()
            page.wait_for_selector('.kid-card')
            page.locator('[data-page-link=history]').click()
            page.wait_for_selector('#kid-select')
            page.wait_for_selector('.kid-section')
            check_menu(page, 'history')
            sections = page.locator('.history-content > .kid-section')
            assert sections.count() == 2
            assert sections.nth(0).bounding_box()['x'] < sections.nth(1).bounding_box()['x']
            page.screenshot(path=str(out / 'history-with-child.png'), full_page=True)
            page.locator('[data-page-link=diagnose]').click()
            assert page.locator('#navigation-subject').input_value() == 'physics'
            page.wait_for_selector('#child-select')
            assert '布局测试' in page.locator('#child-select').inner_text()
            page.locator('[data-page-link=history]').click()
            page.wait_for_selector('.kid-tabs')
            page.locator('.kid-tabs [role=tab]').filter(has_text='数学').click()
            page.locator('[data-page-link=diagnose]').click()
            assert page.locator('#navigation-subject').input_value() == 'math'
            page.wait_for_selector('#child-select')
            other = page.evaluate("(()=>{CnmChildren.add({name:'另一个孩子',grade:'三年级',textbook:'人教版'});return CnmChildren.list().find(c=>c.name==='另一个孩子').id})()")
            page.goto(base + '/children/history.html?child=' + other)
            page.wait_for_selector('#kid-select')
            assert page.locator('#kid-select').input_value() == other
            page.locator('[data-page-link=diagnose]').click()
            page.wait_for_selector('#child-select')
            assert page.locator('#child-select').input_value() == other
            page.goto(base + '/diagnose/?target=cnm_221&demo=1')
            page.wait_for_selector('#path-cy')
            assert page.locator('#root').get_attribute('data-view') == 'result'
            assert page.locator('.diagnosis-result').evaluate("e=>![...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim()==='null')")
            assert page.locator('#roots').bounding_box()['x'] < page.locator('#shaky').bounding_box()['x']
            page.screenshot(path=str(out / 'diagnosis-result.png'), full_page=True)
            assert not errors, errors
            print('PASS profile/history round trip, current child and wide diagnosis results', flush=True)
            print('Screenshots:', out, flush=True)
            browser.close()
    finally:
        server.shutdown()
        server.server_close()


if __name__ == '__main__':
    run()
