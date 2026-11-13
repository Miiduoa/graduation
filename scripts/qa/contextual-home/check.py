import asyncio
import functools
import http.server
import json
import os
import threading
from pathlib import Path

from playwright.async_api import async_playwright, expect

OUTPUT = Path(__file__).resolve().parents[3] / 'artifacts' / 'contextual-home'


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


async def scenario(browser, origin, width, theme):
    page = await browser.new_page(viewport={'width': width, 'height': 900}, device_scale_factor=1)
    errors, external = [], []
    page.on('pageerror', lambda error: errors.append(str(error)))

    async def local_only(route):
        if route.request.url.startswith(origin):
            await route.continue_()
        else:
            external.append(route.request.url)
            await route.abort()

    await page.route('**/*', local_only)
    report = {'viewport': width, 'theme': theme, 'checks': [], 'screenshots': []}

    async def layout(name):
        assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), name
        assert await page.locator('button:visible').evaluate_all(
            '(nodes) => nodes.every(node => node.getBoundingClientRect().height >= 43.5)'), name
        report['checks'].append(name + ': no horizontal overflow; touch buttons at least 44px')
        file = f'{width}-{theme}-{name}.png'
        await page.screenshot(path=str(OUTPUT / file), full_page=True)
        report['screenshots'].append(file)

    await page.goto(origin + '?theme=' + theme)
    await expect(page.get_by_role('heading', name='讓首頁更適合你')).to_be_visible()
    await layout('entry')
    await page.get_by_label('你目前的階段').select_option('year-4')
    await page.get_by_label('生活優先', exact=True).check()
    await page.get_by_text('更多安排（選填）', exact=True).click()
    await page.get_by_label('平常怎麼到學校').select_option('commute')
    await page.get_by_label('準備升學', exact=True).check()
    await page.get_by_label('這段時間的重點').select_option('finals')
    await page.get_by_label('開始日期', exact=True).fill('2026-11-13')
    await page.get_by_label('結束日期（包含當天）', exact=True).fill('2026-11-20')
    await layout('expanded')
    await page.get_by_role('button', name='套用首頁安排', exact=True).click()
    await expect(page.get_by_role('heading', name='期末準備', exact=True)).to_be_visible()
    await expect(page.get_by_role('list', name='為你推薦的下一步').get_by_role('link')).to_have_count(3)
    assert await page.get_by_role('list', name='為你推薦的下一步').get_by_role('link').evaluate_all(
        '(nodes) => nodes.every(node => new URL(node.href).searchParams.get("campus") === "pu")')
    await expect(page.get_by_role('button', name='調整安排')).to_be_focused()
    report['checks'].append('Save updates recommendations, keeps campus and returns keyboard focus')
    await layout('saved')
    await page.reload()
    await expect(page.get_by_role('heading', name='期末準備', exact=True)).to_be_visible()
    report['checks'].append('Preferences survive page reload')
    await page.get_by_role('button', name='測試切換帳號').click()
    await expect(page.get_by_role('heading', name='讓首頁更適合你')).to_be_visible()
    await expect(page.get_by_label('你目前的階段')).to_have_value('unspecified')
    await expect(page.get_by_role('heading', name='期末準備', exact=True)).to_have_count(0)
    await page.get_by_role('button', name='測試切換帳號').click()
    await expect(page.get_by_role('heading', name='期末準備', exact=True)).to_be_visible()
    report['checks'].append('A different account cannot see or inherit the first account profile')
    await page.get_by_role('button', name='調整安排').click()
    await page.get_by_text('更多安排（選填）', exact=True).click()
    await page.get_by_label('結束日期（包含當天）').fill('2026-11-12')
    await page.get_by_role('button', name='套用首頁安排').click()
    await expect(page.get_by_role('alert')).to_contain_text('結束日期要')
    await expect(page.get_by_label('你目前的階段')).to_have_value('year-4')
    report['checks'].append('Invalid date ranges retain the draft and display an accessible error')
    await page.get_by_role('button', name='取消', exact=True).click()
    await page.get_by_role('button', name='測試準備期間到期').click()
    await expect(page.get_by_role('heading', name='日常安排', exact=True)).to_be_visible()
    await expect(page.get_by_text('先前設定的期末準備已在 2026-11-20 結束。', exact=True)).to_be_visible()
    await layout('expired')
    report['checks'].append('Expired manual preparation returns to normal recommendations')
    assert not errors, errors
    assert not external, external
    report.update({'pageErrors': errors, 'externalRequests': external})
    await page.close()
    return report


async def main():
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0),
        functools.partial(QuietHandler, directory=str(OUTPUT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    reports = []
    try:
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(
                executable_path=os.environ.get('CHROME_PATH'))
            try:
                for width, theme in [(320, 'light'), (390, 'dark'), (1280, 'light')]:
                    reports.append(await scenario(browser, f'http://127.0.0.1:{server.server_port}/', width, theme))
            finally:
                await browser.close()
        print(json.dumps({'scenarios': len(reports), 'checks': sum(len(row['checks']) for row in reports)}))
    finally:
        server.shutdown()
        (OUTPUT / 'report.json').write_text(json.dumps(reports, ensure_ascii=False, indent=2))


asyncio.run(main())
