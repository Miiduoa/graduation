import asyncio
import functools
import http.server
import json
import os
import threading
from pathlib import Path

from playwright.async_api import async_playwright, expect

OUTPUT = Path(__file__).resolve().parents[3] / 'artifacts' / 'class-gap-followups'


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


async def geometry(page):
    return await page.evaluate('''() => {
      const nodes = [...document.querySelectorAll('*')];
      const visible = node => { const rect = node.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; };
      const controls = nodes.filter(node => node.matches('[role="button"],button,input,textarea') && visible(node))
        .map(node => { const rect = node.getBoundingClientRect(); return {label:node.getAttribute('aria-label') || node.textContent, width:rect.width,height:rect.height}; });
      const clipped = nodes.filter(node => !['HTML','BODY','SCRIPT','STYLE'].includes(node.tagName) && visible(node))
        .filter(node => { const rect=node.getBoundingClientRect(); return rect.right > window.innerWidth + 1.5 || rect.left < -1.5 || node.scrollWidth > node.clientWidth + 1.5; })
        .map(node => {const rect=node.getBoundingClientRect();return {tag:node.tagName,text:node.textContent.slice(0,80),left:rect.left,right:rect.right,clientWidth:node.clientWidth,scrollWidth:node.scrollWidth};});
      return {width:window.innerWidth, documentWidth:document.documentElement.scrollWidth,
        controls, clipped, smallControls:controls.filter(control=>control.height<44 || control.width<44)};
    }''')


async def scenario(browser, port, width, mode):
    label = f'{width}-{mode}'
    origin = f'http://127.0.0.1:{port}/'
    page = await browser.new_page(viewport={'width': width, 'height': 844}, device_scale_factor=1)
    page.set_default_timeout(10_000)
    page_errors, external_requests, request_failures = [], [], []
    page.on('pageerror', lambda error: page_errors.append(str(error)))
    page.on('requestfailed', lambda request: request_failures.append({'url': request.url, 'failure': request.failure}))

    async def local_only(route):
        if route.request.url.startswith(origin):
            await route.continue_()
        else:
            external_requests.append(route.request.url)
            await route.abort()

    await page.route('**/*', local_only)
    result = {'scenario': label, 'pageErrors': page_errors, 'externalRequests': external_requests,
              'requestFailures': request_failures, 'geometry': []}
    try:
        await page.goto(f'{origin}?theme={mode}', wait_until='networkidle')
        await page.get_by_role('button', name='查詢空堂', exact=True).click()
        initial = page.get_by_test_id('gap-reply-0')
        await expect(initial.get_by_text('明日空堂', exact=True)).to_be_visible()
        await expect(initial).to_contain_text('13:00–17:00（240 分鐘）')
        await expect(initial).to_contain_text('至少 90 分鐘')
        result['geometry'].append(await geometry(page))
        await page.screenshot(path=str(OUTPUT / f'{label}-initial.png'), full_page=True)

        await page.get_by_role('textbox', name='空堂問題').fill('改成下午三點半以後')
        await page.get_by_role('button', name='查詢空堂', exact=True).click()
        clock = page.get_by_test_id('gap-reply-1')
        await expect(clock).to_contain_text('15:30–17:00（90 分鐘）')
        await expect(initial.get_by_role('button')).to_have_count(1)
        await expect(initial.get_by_role('button', name='開啟我的課表', exact=True)).to_be_visible()
        result['geometry'].append(await geometry(page))
        await page.screenshot(path=str(OUTPUT / f'{label}-clock.png'), full_page=True)

        change_day = clock.get_by_role('button', name='改查後天', exact=True)
        await change_day.focus()
        await expect(change_day).to_be_focused()
        await change_day.press('Enter')
        after_tomorrow = page.get_by_test_id('gap-reply-2')
        await expect(after_tomorrow.get_by_text('後天空堂', exact=True)).to_be_visible()
        await expect(after_tomorrow).to_contain_text('沒有至少 90 分鐘的課間空堂')
        await expect(after_tomorrow).not_to_contain_text('15:30–16:00（30 分鐘）')
        result['geometry'].append(await geometry(page))

        await after_tomorrow.get_by_role('button', name='不限長度', exact=True).click()
        unrestricted = page.get_by_test_id('gap-reply-3')
        await expect(unrestricted).to_contain_text('15:30–16:00（30 分鐘）')
        await expect(unrestricted.get_by_role('button', name='不限長度', exact=True)).to_have_count(0)
        result['geometry'].append(await geometry(page))

        await unrestricted.get_by_role('button', name='查看全天', exact=True).click()
        full_day = page.get_by_test_id('gap-reply-4')
        await expect(full_day).to_contain_text('10:00–12:00（120 分鐘）')
        await expect(full_day).to_contain_text('13:00–16:00（180 分鐘）')
        await expect(full_day.get_by_role('button', name='查看全天', exact=True)).to_have_count(0)
        await expect(full_day.get_by_role('button', name='只看下午', exact=True)).to_be_visible()
        result['geometry'].append(await geometry(page))
        await page.screenshot(path=str(OUTPUT / f'{label}-full-day.png'), full_page=True)
        await full_day.get_by_role('button', name='開啟我的課表', exact=True).click()
        await expect(page.get_by_role('status')).to_have_text('已選取我的課表')

        events = await page.evaluate('window.qaEvents')
        assert [event['question'] for event in events if event['kind'] == 'ask'] == [
            '明天下午有一個半小時的空堂嗎？', '改成下午三點半以後', '那後天呢？', '不限長度', '全天',
        ], events
        assert events[-1] == {'kind': 'open-route', 'route': '/timetable'}, events
        result['events'] = events
        for measured in result['geometry']:
            assert measured['documentWidth'] <= width, measured
            assert not measured['smallControls'], measured['smallControls']
            assert not measured['clipped'], measured['clipped']
        assert not page_errors, page_errors
        assert not external_requests, external_requests
        assert not request_failures, request_failures
        result['status'] = 'passed'
    except Exception as error:
        result.update(status='failed', error=str(error))
        await page.screenshot(path=str(OUTPUT / f'{label}-failed.png'), full_page=True)
    finally:
        await page.close()
    return result


async def main():
    if not (OUTPUT / 'index.html').exists():
        raise SystemExit('Run node scripts/qa/class-gap-followups/build.mjs first.')
    handler = functools.partial(QuietHandler, directory=str(OUTPUT))
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    results = []
    try:
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(headless=True, executable_path=os.environ.get('QA_CHROMIUM_EXECUTABLE'))
            for width, mode in [(390, 'light'), (320, 'dark')]:
                results.append(await scenario(browser, server.server_address[1], width, mode))
            await browser.close()
    finally:
        server.shutdown()
        server.server_close()
        (OUTPUT / 'browser-check.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
    print(json.dumps([{'scenario': result['scenario'], 'status': result['status'],
                       **({'error': result['error']} if 'error' in result else {})} for result in results], ensure_ascii=False, indent=2))
    if any(result['status'] != 'passed' for result in results):
        raise SystemExit(1)


asyncio.run(main())
