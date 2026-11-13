"""Run build.mjs first. Requires the existing Python Playwright + Chromium."""
import asyncio
import functools
import http.server
import json
import os
import shutil
import threading
from pathlib import Path

from playwright.async_api import async_playwright, expect

OUTPUT = Path(__file__).resolve().parents[3] / 'artifacts' / 'today-agent'


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


async def geometry(page):
    return await page.evaluate('''() => {
      const visible = node => { const r=node.getBoundingClientRect();return r.width>0 && r.height>0; };
      const buttons = [...document.querySelectorAll('button')].filter(visible).map(node => {
        const r=node.getBoundingClientRect();
        return {label:node.getAttribute('aria-label')||node.textContent.trim(),width:r.width,height:r.height};
      });
      const overflow = [...document.querySelectorAll('main,section,article,button,a,li')].filter(visible)
        .map(node=>({tag:node.tagName,text:node.textContent.trim().slice(0,60),left:node.getBoundingClientRect().left,right:node.getBoundingClientRect().right}))
        .filter(r=>r.left < -1 || r.right > innerWidth + 1);
      return {viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,buttons,overflow,
        smallButtons:buttons.filter(button=>button.width < 44 || button.height < 44)};
    }''')


async def scenario(browser, port, width, mode, theme):
    label = f'{width}-{mode}-{theme}'
    origin = f'http://127.0.0.1:{port}/'
    page = await browser.new_page(viewport={'width': width, 'height': 844},
                                  device_scale_factor=1, timezone_id='Asia/Taipei')
    page.set_default_timeout(10_000)
    errors, external, failures = [], [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('requestfailed', lambda request: failures.append({'url': request.url, 'failure': request.failure}))

    async def local_only(route):
        if route.request.url.startswith(origin):
            await route.continue_()
        else:
            external.append(route.request.url)
            await route.abort()

    await page.route('**/*', local_only)
    result = {'scenario': label, 'fixture': True, 'pageErrors': errors,
              'externalRequests': external, 'requestFailures': failures, 'geometry': []}
    try:
        await page.goto(f'{origin}?mode={mode}&theme={theme}', wait_until='networkidle')
        confirm = page.get_by_role('button', name='確認', exact=True)
        await expect(confirm).to_be_enabled()
        await expect(page.get_by_role('heading', name='替待辦安排時間')).to_be_visible()
        await expect(page.get_by_role('article', name='行程確認卡')).to_contain_text('14:00–14:30')
        before = await page.evaluate('window.__todayAgentQA.snapshot()')
        assert [row['action'] for row in before['requests']] == ['plan', 'plan'], before
        assert not before['writes'] and not before['imports'] and not before['journal'], before
        assert before['nativeLocks'] and not before['violations'], before
        assert await page.get_by_role('textbox').count() == 0
        result['before'] = before
        result['geometry'].append(await geometry(page))
        await page.screenshot(path=str(OUTPUT / f'{label}-preview.png'), full_page=True)

        if mode == 'normal':
            # Reach the real button through tab order instead of calling focus().
            visited = []
            for _ in range(12):
                await page.keyboard.press('Tab')
                visited.append(await page.evaluate('document.activeElement.textContent.trim()'))
                if await confirm.evaluate('(node) => document.activeElement === node'):
                    break
            await expect(confirm).to_be_focused()
            result['keyboard'] = {'tabOrder': visited, 'activatedBy': 'Enter'}
            await page.screenshot(path=str(OUTPUT / f'{label}-keyboard.png'), full_page=True)
            await page.keyboard.press('Enter')
        else:
            await confirm.click()
        await expect(page.get_by_role('link', name='開啟這筆行程', exact=True)).to_be_visible()
        await expect(page.get_by_text('已核對並加入個人行事曆', exact=True)).to_be_visible()
        after = await page.evaluate('window.__todayAgentQA.snapshot()')
        expected = ['plan', 'plan', 'confirm'] + (['reconcile'] if mode == 'lost-response' else [])
        assert [row['action'] for row in after['requests']] == expected, after
        assert len(after['writes']) == len(after['records']) == len(after['imports']) == 1, after
        assert after['imports'] == after['records'] == after['writes'], after
        assert not after['journal'] and not after['violations'] and after['readbacks'] == 1, after
        assert len(after['journalAtConfirm']) == 1, after
        assert after['journalAtConfirm'][0]['card']['mutationId'] == after['imports'][0]['id'], after
        if mode == 'lost-response':
            assert after['requests'][2]['body'] == after['requests'][3]['body'], after
            assert after['requests'][2]['outcome'] == 'committed-response-lost', after
        result['after'] = after
        result['geometry'].append(await geometry(page))
        await page.screenshot(path=str(OUTPUT / f'{label}-verified.png'), full_page=True)
        for measured in result['geometry']:
            assert measured['documentWidth'] <= width, measured
            assert not measured['smallButtons'], measured['smallButtons']
            assert not measured['overflow'], measured['overflow']
        assert not errors and not external and not failures, result
        result['status'] = 'passed'
    except Exception as error:
        result.update(status='failed', error=str(error))
        await page.screenshot(path=str(OUTPUT / f'{label}-failed.png'), full_page=True)
    finally:
        await page.close()
    return result


async def main():
    if not (OUTPUT / 'index.html').exists():
        raise SystemExit('Run node scripts/qa/today-agent/build.mjs first.')
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0),
        functools.partial(QuietHandler, directory=str(OUTPUT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    results = []
    try:
        async with async_playwright() as playwright:
            installed = playwright.chromium.executable_path
            browser = await playwright.chromium.launch(headless=True,
                executable_path=os.environ.get('QA_CHROMIUM_EXECUTABLE') or
                    (installed if Path(installed).is_file() else shutil.which('chromium')))
            for width, mode, theme in [(390, 'normal', 'light'), (1280, 'normal', 'light'),
                                        (390, 'lost-response', 'dark'), (1280, 'lost-response', 'dark')]:
                results.append(await scenario(browser, server.server_address[1], width, mode, theme))
            await browser.close()
    except Exception as error:
        results.append({'scenario': 'browser-runtime', 'status': 'blocked', 'fixture': True, 'error': str(error)})
    finally:
        server.shutdown()
        server.server_close()
        (OUTPUT / 'browser-check.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
    print(json.dumps([{'scenario': row['scenario'], 'status': row['status'],
        **({'error': row['error']} if 'error' in row else {})} for row in results], ensure_ascii=False, indent=2))
    if not results or any(row['status'] != 'passed' for row in results):
        raise SystemExit(1)


asyncio.run(main())
