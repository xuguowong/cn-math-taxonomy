#!/usr/bin/env python3
"""端到端浏览器验证。需要 Python playwright 和本机 Chrome；无需在线模型。"""
import argparse
import base64
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
REQUESTS = []


class Model(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_POST(self):
        assert self.path == '/v1/chat/completions'
        data = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        REQUESTS.append(data)
        content = data['messages'][1]['content']
        image = isinstance(content, list)
        text = content[0]['text'] if image else content
        if 'slow-test' in text:
            time.sleep(2)
        analysis = {
            'questionSummary': '求两个分数的和',
            'recognizedText': '计算 1/3 + 1/4' if image else '',
            'solutionOutline': ['将两个分数通分，再相加。'],
            'targets': [{
                'topicId': 'cnm_p173',
                'reason': '分母不同，需要异分母分数加法。',
                'evidence': '图中的 1/3 + 1/4' if image else '1/3 + 1/4',
                'evidenceSource': 'image' if image else 'text',
                **({'imageIndex': 1} if image else {})
            }],
            'unresolved': [], 'assumptions': []
        }
        body = json.dumps({'choices': [{'message': {'content': json.dumps(analysis, ensure_ascii=False)}}]}).encode()
        try:
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass


def start_site(config):
    code = "const s=require('./scripts/question-server').createServer({config:JSON.parse(process.env.BROWSER_TEST_CONFIG)});s.listen(0,'127.0.0.1',()=>console.log(s.address().port));"
    env = dict(os.environ, BROWSER_TEST_CONFIG=json.dumps(config))
    process = subprocess.Popen(['node', '-e', code], cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    line = process.stdout.readline().strip()
    if not line.isdigit():
        process.terminate()
        raise RuntimeError('Test server failed to start: ' + line)
    return process, 'http://127.0.0.1:' + line


def run():
    parser = argparse.ArgumentParser()
    parser.add_argument('--chrome', default='/opt/google/chrome/chrome')
    parser.add_argument('--screenshots', default='/tmp/cn-math-analysis-browser')
    args = parser.parse_args()
    shots = Path(args.screenshots)
    shots.mkdir(parents=True, exist_ok=True)
    model = ThreadingHTTPServer(('127.0.0.1', 0), Model)
    threading.Thread(target=model.serve_forever, daemon=True).start()
    offline, offline_url = start_site({})
    online, online_url = start_site({'baseURL': 'http://127.0.0.1:%s/v1' % model.server_port, 'model': 'browser-test-vision', 'vision': True})
    try:
        with tempfile.TemporaryDirectory() as temp, sync_playwright() as p:
            browser = p.chromium.launch(executable_path=args.chrome, headless=True, args=['--no-sandbox'])
            context = browser.new_context(viewport={'width': 1440, 'height': 1000}, accept_downloads=True)
            page = context.new_page()
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(offline_url + '/analyze/')
            page.wait_for_function("document.querySelector('#mode').value === 'local' && !document.querySelector('#analyze').disabled")
            page.screenshot(path=str(shots / 'desktop.png'), full_page=True)
            page.locator('[data-example="fraction"]').click()
            page.locator('#analyze').click()
            page.locator('.target-card').filter(has_text='异分母分数加减').locator('input').check()
            page.locator('#build-plan').click()
            page.wait_for_selector('#plan-panel:not([hidden])')
            assert '1 个直接考点' in page.locator('#plan-summary').inner_text()
            assert 'cnm_p173' in page.locator('#diagnose-link').get_attribute('href')
            page.locator('#topic-search').fill('通分')
            page.locator('.search-row').first.locator('button').click()
            page.locator('#build-plan').click()
            assert '2 个直接考点' in page.locator('#plan-summary').inner_text()
            with page.expect_download() as download:
                page.locator('#export').click()
            exported = json.loads(Path(download.value.path()).read_text())
            assert set(exported['plan']['targets']) == {'cnm_p173', 'cnm_p172'}
            assert exported['imageCount'] == 0
            positions = {node['id']: i for i, node in enumerate(exported['plan']['nodes'])}
            for edge in exported['plan']['edges']:
                assert positions[edge['prerequisiteId']] < positions[edge['topicId']]
            page.screenshot(path=str(shots / 'local-result.png'), full_page=True)
            page.locator('#question').fill('另一个题目')
            assert page.locator('#analysis-result').is_hidden()
            page.set_viewport_size({'width': 390, 'height': 844})
            page.goto(offline_url + '/analyze/')
            page.wait_for_function("!document.querySelector('#analyze').disabled")
            assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
            page.screenshot(path=str(shots / 'mobile.png'), full_page=True)
            print('PASS: local matching, manual correction, dependency order, export, stale result reset, mobile layout')

            fixture = context.new_page()
            fixture.set_content('<div id="fixture" style="padding:36px;width:500px;font:24px sans-serif;background:white">计算下面的分数加法：<p style="font:36px Georgia">1/3 + 1/4 = ?</p></div>')
            image_path = Path(temp) / 'math-question.png'
            fixture.locator('#fixture').screenshot(path=str(image_path))
            fixture.close()
            data_url = 'data:image/png;base64,' + base64.b64encode(image_path.read_bytes()).decode()
            page.set_viewport_size({'width': 1440, 'height': 1000})
            page.goto(online_url + '/analyze/')
            page.wait_for_function("document.querySelector('#service-status').textContent.includes('已启用图片') && !document.querySelector('#analyze').disabled")
            page.locator('#question').fill('计算 1/3 + 1/4')
            page.locator('#analyze').click()
            page.wait_for_selector('#analysis-result:not([hidden])')
            assert 'AI 分析' in page.locator('#analysis-mode').inner_text()
            page.locator('#images').set_input_files(str(image_path))
            page.wait_for_selector('.preview')
            page.locator('#question').fill('')
            page.evaluate("""async (url) => {
                const blob = await (await fetch(url)).blob(); const dt = new DataTransfer();
                dt.items.add(new File([blob], 'pasted.png', {type:'image/png'}));
                document.dispatchEvent(new ClipboardEvent('paste', {clipboardData: dt, bubbles:true, cancelable:true}));
            }""", data_url)
            page.wait_for_function("document.querySelectorAll('.preview').length === 2 && !document.querySelector('#analyze').disabled")
            page.evaluate("""async (url) => {
                const blob = await (await fetch(url)).blob(); const dt = new DataTransfer();
                dt.items.add(new File([blob], 'dropped.png', {type:'image/png'}));
                document.querySelector('#drop-zone').dispatchEvent(new DragEvent('drop', {dataTransfer:dt, bubbles:true, cancelable:true}));
            }""", data_url)
            page.wait_for_function("document.querySelectorAll('.preview').length === 3 && !document.querySelector('#analyze').disabled")
            page.locator('#images').set_input_files(str(image_path))
            assert '最多添加 3 张' in page.locator('#message').inner_text()
            page.locator('.preview button').last.click()
            page.locator('.preview button').last.click()
            page.locator('#analyze').click()
            page.wait_for_selector('#analysis-result:not([hidden])')
            assert page.locator('#recognition').is_visible()
            assert '图片 1 识别依据' in page.locator('.target-card').inner_text()
            assert REQUESTS[-1]['messages'][1]['content'][1]['image_url']['url'].startswith('data:image/png;base64,')
            page.locator('#build-plan').click()
            assert '1 个直接考点' in page.locator('#plan-summary').inner_text()
            with page.expect_download() as download:
                page.locator('#export').click()
            exported_text = Path(download.value.path()).read_text()
            assert json.loads(exported_text)['imageCount'] == 1
            assert 'data:image' not in exported_text
            page.screenshot(path=str(shots / 'image-result.png'), full_page=True)
            page.set_viewport_size({'width': 390, 'height': 844})
            assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
            page.screenshot(path=str(shots / 'mobile-image-result.png'), full_page=True)
            print('PASS: OpenAI text/image request, upload, paste, drag/drop, image limit/removal, recognition, image-free export')

            page.locator('#question').fill('slow-test 1/3 + 1/4')
            page.locator('#analyze').click()
            page.locator('#cancel').click()
            page.wait_for_function("document.querySelector('#message').textContent === '已取消分析。'")
            assert page.locator('#analysis-result').is_hidden()
            assert not errors, errors
            print('PASS: cancellation; no browser JavaScript errors')
            print('Screenshots:', shots)
            browser.close()
    finally:
        for process in [offline, online]:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
        model.shutdown()
        model.server_close()


if __name__ == '__main__':
    run()
