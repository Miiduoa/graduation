"""Exercise announcement reading against a local production build and Firestore emulator.

Seed demo-campus-services with seed-service-browser-fixtures.py first. No real
accounts or external services are used. The existing Firestore rules stay active.
"""

import asyncio
import json
import os
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from playwright.async_api import async_playwright, expect

BASE = os.environ.get('CAMPUS_SERVICE_URL', 'http://127.0.0.1:3105')
if urlparse(BASE).hostname not in ('localhost', '127.0.0.1'):
    raise RuntimeError('Service checks must run against a local server')
OUT = Path('artifacts/announcement-browser')
OUT.mkdir(parents=True, exist_ok=True)


async def fixtures(route):
    url = urlparse(route.request.url)
    if url.hostname not in ('localhost', '127.0.0.1'):
        await route.abort()
    elif url.path == '/api/schools':
        await route.fulfill(json={'schools': [
            {'id': 'pu', 'name': '靜宜大學', 'status': 'not-open'},
            {'id': 'nthu', 'name': '國立清華大學', 'status': 'not-open'},
        ]})
    elif url.path in ('/api/nuni/session', '/auth/session'):
        await route.fulfill(json={'authenticated': False})
    elif url.path == '/auth/platform/providers':
        await route.fulfill(json={'kinds': ['google-consumer']})
    else:
        await route.continue_()


async def no_overflow(page):
    assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth'), \
        'Page overflows horizontally'


async def readable_filter_labels(page):
    for group in ['公告檢視', '公告分類']:
        for button in await page.locator(f'[aria-label="{group}"] button').all():
            metrics = await button.evaluate('''button => {
                const text = document.createRange();
                text.selectNodeContents(button);
                const lines = [...text.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0);
                return {lines: lines.length, height: button.getBoundingClientRect().height};
            }''')
            assert metrics['lines'] == 1, f'Filter label wraps into vertical text: {await button.inner_text()}'
            assert metrics['height'] >= 44, f'Filter target is too short: {await button.inner_text()}'


async def goto(page, path):
    await page.goto(BASE + path, wait_until='load')


def query(url):
    return parse_qs(urlparse(url).query)


async def main():
    checks = []
    errors = []
    async with async_playwright() as playwright:
        launch = {}
        executable = os.environ.get('CAMPUS_SERVICE_CHROMIUM') or os.environ.get('CAMPUS_VISUAL_CHROMIUM')
        if executable:
            launch['executable_path'] = executable
        browser = await playwright.chromium.launch(**launch)
        context = await browser.new_context(
            viewport={'width': 1440, 'height': 1000}, locale='zh-TW',
            timezone_id='Asia/Taipei', color_scheme='light', reduced_motion='reduce',
            service_workers='block',
        )
        await context.route('**/*', fixtures)
        page = await context.new_page()
        page.set_default_timeout(15000)
        page.on('pageerror', lambda error: errors.append(str(error)))
        try:
            await goto(page, '/announcements?schoolId=pu&campus=pu')
            await expect(page.get_by_role('link', name='選課與加退選時程', exact=True)).to_be_visible()
            await expect(page.get_by_role('article')).to_have_count(30)
            await no_overflow(page)
            await page.screenshot(path=str(OUT / 'announcements-desktop.png'), animations='disabled')
            checks.append('public announcement list reads emulator documents and limits initial display to 30 rows')

            await page.get_by_role('button', name='顯示更多公告（剩餘 36 則）').click()
            await expect(page.get_by_role('article')).to_have_count(60)
            assert query(page.url).get('page') == ['2'], page.url
            older = page.get_by_role('article').nth(45).get_by_role('heading').get_by_role('link')
            older_title = await older.inner_text()
            await older.click()
            await expect(page.get_by_role('heading', name=older_title, exact=True)).to_be_visible()
            await page.get_by_role('link', name='← 返回公告列表').click()
            await expect(page.get_by_role('article')).to_have_count(60)
            assert query(page.url).get('page') == ['2'], page.url
            checks.append('opening an older announcement and returning restores the expanded list')

            search = page.get_by_label('搜尋公告', exact=True)
            await search.fill('必要文件')
            await expect(page.get_by_role('article')).to_have_count(1)
            await expect(page.get_by_role('link', name='選課與加退選時程', exact=True)).to_be_visible()
            assert 'page' not in query(page.url)
            await search.fill('選課')
            await page.get_by_role('button', name='學術', exact=True).click()
            await page.get_by_label('只看置頂', exact=True).check()
            await expect(page.get_by_role('article')).to_have_count(1)
            expected = {'q': ['選課'], 'category': ['academic'], 'pinned': ['1'], 'schoolId': ['pu'], 'campus': ['pu']}
            for key, value in expected.items():
                assert query(page.url).get(key) == value, page.url
            detail = page.get_by_role('link', name='選課與加退選時程', exact=True)
            await detail.click()
            await expect(page.get_by_role('heading', name='選課與加退選時程', exact=True)).to_be_visible()
            await expect(page.get_by_role('article')).to_contain_text('完成選課後請重新核對課表，必要文件請洽課務組。')
            await expect(page.get_by_role('article')).to_contain_text('完整公告第一段。')
            await page.screenshot(path=str(OUT / 'announcement-reading-desktop.png'), full_page=True, animations='disabled')
            checks.append('search includes complete body text and the detail page shows the full announcement instead of its summary')

            await page.go_back(wait_until='load')
            await expect(page.get_by_role('article')).to_have_count(1)
            await expect(page.get_by_label('搜尋公告', exact=True)).to_have_value('選課')
            await expect(page.get_by_label('只看置頂', exact=True)).to_be_checked()
            await page.get_by_role('link', name='選課與加退選時程', exact=True).click()
            await page.get_by_role('link', name='← 返回公告列表').click()
            await page.wait_for_url(lambda url: urlparse(url).path == '/announcements')
            await expect(page.get_by_label('搜尋公告', exact=True)).to_have_value('選課')
            for key, value in expected.items():
                assert query(page.url).get(key) == value, page.url
            await page.reload(wait_until='load')
            await expect(page.get_by_label('搜尋公告', exact=True)).to_have_value('選課')
            await expect(page.get_by_role('article')).to_have_count(1)
            checks.append('browser Back, detail return link and page reload keep the search, category, pin and campus filters')

            await page.get_by_label('搜尋公告', exact=True).fill('不會有的關鍵字')
            await expect(page.get_by_role('heading', name='沒有符合條件的公告')).to_be_visible()
            await page.get_by_role('button', name='清除篩選', exact=True).click()
            await expect(page.get_by_role('article')).to_have_count(30)
            await expect(page.get_by_label('搜尋公告', exact=True)).to_be_focused()
            checks.append('empty search has a working reset that restores results and keyboard focus')

            await page.get_by_role('button', name='全部公告', exact=True).click()
            await page.get_by_label('搜尋公告', exact=True).fill('教師研習')
            await expect(page.get_by_role('link', name='教師研習報名通知', exact=True)).to_be_visible()
            await page.reload(wait_until='load')
            await expect(page.get_by_role('button', name='全部公告', exact=True)).to_have_attribute('aria-pressed', 'true')
            await expect(page.get_by_role('link', name='教師研習報名通知', exact=True)).to_be_visible()
            checks.append('official-only announcements remain reachable and the all-announcements view survives reload')

            await goto(page, '/announcements/hidden-notice?campus=pu')
            await expect(page.get_by_role('heading', name='找不到這則公告', exact=True)).to_be_visible()
            await expect(page.get_by_text('已撤下的測試公告', exact=True)).to_have_count(0)
            checks.append('a hidden announcement stays absent when its detail URL is opened directly')

            await goto(page, '/announcements?schoolId=pu&campus=nthu')
            await expect(page.get_by_role('link', name='清華校園閱讀活動', exact=True)).to_be_visible()
            await expect(page.get_by_role('link', name='選課與加退選時程', exact=True)).to_have_count(0)
            await expect(page.get_by_role('article')).to_have_count(4)
            checks.append('explicit campus selection reads only the selected school even with a stale schoolId')

            for theme in ['light', 'dark']:
                await page.emulate_media(color_scheme=theme)
                for width in [390, 320]:
                    await page.set_viewport_size({'width': width, 'height': 844})
                    await goto(page, '/announcements?campus=pu&q=選課&category=academic&pinned=1')
                    await expect(page.get_by_role('article')).to_have_count(1)
                    await no_overflow(page)
                    await readable_filter_labels(page)
                    if width == 390:
                        await page.screenshot(path=str(OUT / f'announcements-{theme}-mobile.png'), full_page=True, animations='disabled')
                    await page.locator('html').evaluate('el => el.style.fontSize = "32px"')
                    await no_overflow(page)
                    await readable_filter_labels(page)
                    if width == 320:
                        await page.screenshot(path=str(OUT / f'announcements-{theme}-large.png'), full_page=True, animations='disabled')
                    await page.locator('html').evaluate('el => el.style.fontSize = ""')
                    await page.get_by_role('link', name='選課與加退選時程', exact=True).click()
                    await expect(page.get_by_role('article')).to_contain_text('完整公告第一段。')
                    await no_overflow(page)
                    await page.locator('html').evaluate('el => el.style.fontSize = "32px"')
                    await no_overflow(page)
                    await expect(page.get_by_role('button', name='更新公告', exact=True)).to_be_visible()
                    if width == 320:
                        await page.screenshot(path=str(OUT / f'announcement-reading-{theme}-large.png'), full_page=True, animations='disabled')
                    await page.locator('html').evaluate('el => el.style.fontSize = ""')
                checks.append(f'announcement list and full reading flow fit 320/390px in {theme} mode, including 200% reading text')

            await goto(page, '/lost-found?schoolId=pu&campus=pu&q=雨傘&type=lost')
            await expect(page.get_by_text('查看失物招領需要學校帳號。', exact=True)).to_be_visible()
            await expect(page.get_by_role('link', name='連線學校帳號', exact=True)).to_be_visible()
            await expect(page.get_by_role('link', name='刊登物品', exact=True)).to_have_count(0)
            await no_overflow(page)
            checks.append('guest lost-and-found entry keeps the school-account gate and exposes no item or posting controls')
            assert not errors, errors
        except Exception:
            await page.screenshot(path=str(OUT / 'failure.png'), full_page=True, animations='disabled')
            (OUT / 'failure-dom.txt').write_text(await page.locator('body').aria_snapshot(), encoding='utf-8')
            raise
        finally:
            (OUT / 'results.json').write_text(json.dumps({'checks': checks, 'pageErrors': errors}, ensure_ascii=False, indent=2), encoding='utf-8')
            await browser.close()
    print(json.dumps({'passed': len(checks), 'checks': checks}, ensure_ascii=False))


if __name__ == '__main__':
    asyncio.run(main())
