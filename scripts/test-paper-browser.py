#!/usr/bin/env python3
"""验证纸质试卷预览、打印调用、A4 PDF 与答案分页。需要 Playwright、pypdf 和 Chrome。"""
import argparse
import functools
from pathlib import Path
import re
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from playwright.sync_api import sync_playwright
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parent.parent


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass


def run():
    parser = argparse.ArgumentParser()
    parser.add_argument('--chrome', default='/opt/google/chrome/chrome')
    parser.add_argument('--output', default='/tmp/cnm-paper-browser')
    args = parser.parse_args()
    out = Path(args.output)
    out.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = 'http://127.0.0.1:%s' % server.server_port
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path=args.chrome, headless=True, args=['--no-sandbox'])
            page = browser.new_page(viewport={'width': 1440, 'height': 1000}, color_scheme='dark')
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(base + '/diagnose/?grade=二年级&volume=二上&seed=paper-browser')
            page.wait_for_selector('#btn-paper')
            original_question = page.locator('#q-text').inner_text()
            if page.locator('#ans').count():
                page.locator('#ans').fill('尚未提交的草稿')
            storage = page.evaluate('JSON.stringify({...localStorage})')
            page.locator('#btn-paper').click()
            page.wait_for_selector('#paper-dialog[open]')
            page.wait_for_function("!document.querySelector('#paper-print').disabled")
            preview = page.frame_locator('#paper-preview')
            assert preview.locator('.questions > .question').count() == 40
            assert preview.locator('.answer-key').count() == 0
            assert original_question in preview.locator('.questions > .question').first.inner_text()
            page.locator('#paper-count').fill('8')
            page.locator('#paper-count').dispatch_event('change')
            page.wait_for_function("document.querySelector('#paper-preview').contentDocument.querySelectorAll('.question').length===8 && !document.querySelector('#paper-print').disabled")
            source = page.locator('#paper-preview').evaluate('(f)=>f.contentDocument.documentElement.outerHTML')
            pdf_page = browser.new_page()
            pdf_page.set_content(source)
            pdf_page.pdf(path=str(out / 'student-test.pdf'), prefer_css_page_size=True, display_header_footer=False)
            reader = PdfReader(str(out / 'student-test.pdf'))
            assert len(reader.pages) >= 2
            text = '\n'.join(p.extract_text() for p in reader.pages)
            assert '姓名' in text
            assert '参考答案与解析' not in text
            for sheet in reader.pages:
                assert abs(float(sheet.mediabox.width) - 595.28) < 2
                assert abs(float(sheet.mediabox.height) - 841.89) < 2
            page.locator('#paper-answers').check()
            page.wait_for_function("!!document.querySelector('#paper-preview').contentDocument.querySelector('.answer-key') && !document.querySelector('#paper-print').disabled")
            source = page.locator('#paper-preview').evaluate('(f)=>f.contentDocument.documentElement.outerHTML')
            pdf_page.set_content(source)
            pdf_page.pdf(path=str(out / 'test-with-answer-key.pdf'), prefer_css_page_size=True, display_header_footer=False)
            keyed = PdfReader(str(out / 'test-with-answer-key.pdf'))
            pages = [sheet.extract_text() for sheet in keyed.pages]
            key_page = next(i for i, text in enumerate(pages) if '参考答案与解析' in text)
            assert key_page > 0
            assert pages[key_page].strip().startswith('参考答案与解析')
            assert all('参考答案：' not in text for text in pages[:key_page])
            assert preview.locator('.answer-key .key-item').count() == 8
            page.screenshot(path=str(out / 'paper-dialog.png'), full_page=True)
            # The print button must print the clean iframe, not the online page.
            page.locator('#paper-preview').evaluate('(f)=>{f.contentWindow.print=()=>{parent.__paperPrinted=true}}')
            page.locator('#paper-print').click()
            page.wait_for_function('window.__paperPrinted === true')
            page.locator('#paper-scope').select_option('current')
            page.wait_for_function("document.querySelector('#paper-preview').contentDocument.querySelectorAll('.question').length===1 && !document.querySelector('#paper-print').disabled")
            assert page.locator('#paper-count').is_disabled()
            assert page.locator('#paper-count').input_value() == '1'
            assert original_question in preview.locator('.question').inner_text()
            page.locator('#paper-close').click()
            page.locator('#paper-dialog').wait_for(state='detached')
            assert page.locator('#paper-dialog').count() == 0
            assert page.locator('#q-text').inner_text() == original_question
            if page.locator('#ans').count():
                assert page.locator('#ans').input_value() == '尚未提交的草稿'
            assert page.evaluate('JSON.stringify({...localStorage})') == storage
            print('PASS range/current printing, question count, actual A4 PDFs and separate answer pages', flush=True)
            print('PASS iframe print invocation, online draft/session preserved', flush=True)

            page.goto(base + '/diagnose/?subject=math')
            page.wait_for_selector('#btn-grade-paper')
            page.locator('#grade-card [aria-label=年级] [data-value="二"]').click()
            page.locator('#btn-grade-paper').click()
            page.wait_for_function("!document.querySelector('#paper-print').disabled")
            assert page.locator('#paper-scope option').count() == 1
            assert preview.locator('.question').count() == 40
            page.locator('#paper-close').click()
            page.goto(base + '/diagnose/?target=cnm_050&seed=paper-figure')
            page.wait_for_selector('#btn-paper')
            page.locator('#btn-paper').click()
            page.locator('#paper-scope').select_option('topic')
            page.wait_for_function("!document.querySelector('#paper-print').disabled && document.querySelector('#paper-preview').contentDocument.querySelector('.figure svg')")
            assert preview.locator('.figure svg').count() > 0
            assert preview.locator('.figure-missing').count() == 0
            page.set_viewport_size({'width': 390, 'height': 844})
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            rect = page.locator('#paper-dialog').bounding_box()
            assert rect['width'] <= 390
            assert not errors, errors
            print('PASS print before starting online test, SVG figures and mobile dialog', flush=True)
            print('Artifacts:', out, flush=True)
            browser.close()
    finally:
        server.shutdown()
        server.server_close()


if __name__ == '__main__':
    run()
