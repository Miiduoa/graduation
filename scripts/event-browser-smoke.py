"""Exercise real event pages in a local production build with the Firestore emulator.

Run seed-service-browser-fixtures.py first. Fixtures stay in the fixed demo
project; external requests and service workers are blocked.
"""

import asyncio
import json
import os
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from playwright.async_api import async_playwright, expect
from importlib.util import module_from_spec, spec_from_file_location

_spec = spec_from_file_location('announcement_smoke', Path(__file__).with_name('announcement-browser-smoke.py'))
_helpers = module_from_spec(_spec)
_spec.loader.exec_module(_helpers)
fixtures = _helpers.fixtures

BASE = os.environ.get('CAMPUS_SERVICE_URL', 'http://127.0.0.1:3105')
if urlparse(BASE).hostname not in ('localhost', '127.0.0.1'):
    raise RuntimeError('Service checks must run against a local server')
OUT = Path('artifacts/campus-services/events')
OUT.mkdir(parents=True, exist_ok=True)


def query(url):
    return parse_qs(urlparse(url).query)


async def no_overflow(page):
    assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Horizontal overflow'


async def check_filter_labels(page):
    for button in await page.get_by_role('group', name='活動時間').get_by_role('button').all():
        assert await button.evaluate('''el => {
            const text = [...el.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
            if (!text) return false;
            const range = document.createRange();
            range.selectNodeContents(text);
            return range.getClientRects().length === 1 && el.getBoundingClientRect().height >= 44;
        }'''), 'Activity filter label is squeezed onto multiple lines'


async def goto(page, path):
    await page.goto(BASE + path, wait_until='load')


async def detail_ready(page, event_id, title):
    await page.wait_for_url(lambda value: urlparse(value).path == f'/events/{event_id}')
    await expect(page.get_by_role('heading', name=title, exact=True)).to_be_visible()


async def main():
    checks, errors = [], []
    async with async_playwright() as playwright:
        executable = os.environ.get('CAMPUS_SERVICE_CHROMIUM') or os.environ.get('CAMPUS_VISUAL_CHROMIUM')
        browser = await playwright.chromium.launch(**({'executable_path': executable} if executable else {}))
        context = await browser.new_context(
            viewport={'width': 1440, 'height': 1000}, locale='zh-TW', timezone_id='Asia/Taipei',
            color_scheme='light', reduced_motion='reduce', service_workers='block', accept_downloads=True,
        )
        await context.route('**/*', fixtures)
        page = await context.new_page()
        page.set_default_timeout(15000)
        page.on('pageerror', lambda error: errors.append(str(error)))
        try:
            await goto(page, '/events?schoolId=nthu&campus=nthu')
            await expect(page.get_by_role('link', name='校園攝影散步', exact=True)).to_be_visible()
            await expect(page.get_by_role('article')).to_have_count(25)
            await expect(page.get_by_role('article').first.get_by_role('heading')).to_have_text('在地文化導覽')
            await no_overflow(page)
            await page.screenshot(path=str(OUT / 'events-desktop.png'), animations='disabled')
            checks.append('production event list reads 25 real emulator records and prioritizes the ongoing event')

            time_filters = page.get_by_role('group', name='活動時間', exact=True)
            await time_filters.get_by_role('button', name='進行中', exact=True).click()
            await expect(page.get_by_role('article')).to_have_count(1)
            await expect(page.get_by_role('link', name='在地文化導覽', exact=True)).to_be_visible()
            await time_filters.get_by_role('button', name='已開始／過往', exact=True).click()
            await expect(page.get_by_role('article')).to_have_count(2)
            unknown_end = page.get_by_role('article').filter(has=page.get_by_role('link', name='開始時間已過的展覽', exact=True))
            await expect(unknown_end.get_by_text('已開始', exact=True)).to_be_visible()
            await expect(unknown_end.get_by_text('已結束', exact=True)).to_have_count(0)
            await time_filters.get_by_role('button', name='時間待公告', exact=True).click()
            await expect(page.get_by_role('article')).to_have_count(1)
            await expect(page.get_by_role('link', name='時間待公布的學生交流會', exact=True)).to_be_visible()
            checks.append('time filters distinguish ongoing, ended, unknown end time and unannounced time')

            await time_filters.get_by_role('button', name='全部活動', exact=True).click()
            search = page.get_by_role('searchbox')
            await search.fill('天文')
            await expect(page.get_by_role('heading', name='已載入的活動中沒有符合的結果')).to_be_visible()
            await page.get_by_role('button', name='載入更多', exact=True).click()
            await expect(page.get_by_role('link', name='第二頁的天文觀測活動', exact=True)).to_be_visible()
            await expect(search).to_have_value('天文')
            assert query(page.url).get('page') == ['2'], page.url
            await page.get_by_role('link', name='第二頁的天文觀測活動', exact=True).click()
            await detail_ready(page, 'event-026', '第二頁的天文觀測活動')
            await page.go_back(wait_until='load')
            await page.wait_for_url(lambda value: urlparse(value).path == '/events')
            await expect(page.get_by_role('searchbox')).to_have_value('天文')
            await expect(page.get_by_role('link', name='第二頁的天文觀測活動', exact=True)).to_be_visible()
            checks.append('search can find a later page and browser Back restores both the query and loaded depth')

            await page.get_by_role('link', name='第二頁的天文觀測活動', exact=True).click()
            await detail_ready(page, 'event-026', '第二頁的天文觀測活動')
            await page.get_by_role('link', name='回到活動列表', exact=True).click()
            await page.wait_for_url(lambda value: urlparse(value).path == '/events')
            await expect(page.get_by_role('searchbox')).to_have_value('天文')
            await expect(page.get_by_role('link', name='第二頁的天文觀測活動', exact=True)).to_be_visible()
            await page.reload(wait_until='load')
            await expect(page.get_by_role('link', name='第二頁的天文觀測活動', exact=True)).to_be_visible()
            await page.get_by_role('button', name='更新活動', exact=True).click()
            await expect(page.get_by_role('link', name='第二頁的天文觀測活動', exact=True)).to_be_visible()
            await expect(page.get_by_role('button', name='更新活動', exact=True)).to_be_enabled()
            checks.append('detail return, reload and refresh retain the later-page search result')

            await page.get_by_role('searchbox').fill('不會有的關鍵字')
            await page.get_by_role('button', name='清除全部篩選', exact=True).click()
            await expect(page.get_by_role('searchbox')).to_be_focused()
            await expect(page.get_by_role('article')).to_have_count(30)
            checks.append('empty filters reset without losing loaded events and restore keyboard focus')

            await page.get_by_role('link', name='校園攝影散步', exact=True).click()
            await detail_ready(page, 'event-001', '校園攝影散步')
            async with page.expect_download() as pending:
                await page.get_by_role('button', name='加入行事曆', exact=True).click()
            download = await pending.value
            target = OUT / 'campus-event.ics'
            await download.save_as(target)
            content = target.read_bytes().decode('utf-8').replace('\r\n ', '')
            assert 'SUMMARY:校園攝影散步\r\n' in content, content
            assert 'DTSTART:' in content and 'DTEND:' in content
            assert 'BEGIN:VALARM' not in content and 'ATTENDEE:' not in content
            event_url = next(line[4:] for line in content.split('\r\n') if line.startswith('URL:'))
            assert urlparse(event_url).path == '/events/event-001'
            assert query(event_url) == {'schoolId': ['nthu'], 'campus': ['nthu'], 'source': ['school-club-events']}
            await expect(page.get_by_text('行事曆檔案已備妥，開啟下載的檔案即可加入；活動報名請另行完成。', exact=True)).to_be_visible()
            checks.append('a real browser download produces a calendar snapshot with canonical school/source and no implicit registration or alarm')

            await goto(page, '/events/event-006?schoolId=nthu&source=school-club-events')
            await expect(page.get_by_role('heading', name='開始時間已過的展覽', exact=True)).to_be_visible()
            async with page.expect_download() as pending:
                await page.get_by_role('button', name='加入行事曆', exact=True).click()
            download = await pending.value
            target = OUT / 'campus-event-no-end.ics'
            await download.save_as(target)
            assert 'DTEND:' not in target.read_text(encoding='utf-8')
            await goto(page, '/events/event-004?schoolId=nthu&source=school-club-events')
            await expect(page.get_by_role('heading', name='時間待公布的學生交流會', exact=True)).to_be_visible()
            await expect(page.get_by_role('button', name='加入行事曆', exact=True)).to_be_disabled()
            checks.append('missing end time is not invented and an unknown start cannot be exported')

            for theme in ['light', 'dark']:
                await page.emulate_media(color_scheme=theme)
                for width in [390, 320]:
                    await page.set_viewport_size({'width': width, 'height': 844})
                    await goto(page, '/events?campus=nthu&view=ongoing')
                    await expect(page.get_by_role('article')).to_have_count(1)
                    await no_overflow(page)
                    await check_filter_labels(page)
                    if width == 390:
                        await page.screenshot(path=str(OUT / f'events-{theme}-mobile.png'), full_page=True, animations='disabled')
                    await page.locator('html').evaluate('el => el.style.fontSize = "32px"')
                    await no_overflow(page)
                    await check_filter_labels(page)
                    item = page.get_by_role('article').first
                    assert await item.get_by_role('heading').evaluate('el => el.getBoundingClientRect().width >= 240'), 'Large text is squeezed by the decorative date column'
                    if width == 320:
                        await page.screenshot(path=str(OUT / f'events-{theme}-large.png'), full_page=True, animations='disabled')
                    await page.locator('html').evaluate('el => el.style.fontSize = ""')
                    await page.get_by_role('link', name='在地文化導覽', exact=True).click()
                    await detail_ready(page, 'event-003', '在地文化導覽')
                    await no_overflow(page)
                    if width == 390:
                        await page.screenshot(path=str(OUT / f'event-detail-{theme}-mobile.png'), full_page=True, animations='disabled')
                checks.append(f'event list/detail fit 320/390px {theme} views, including 200% list text and 44px filter targets')

            await goto(page, '/events?schoolId=nthu&campus=pu')
            await expect(page.get_by_role('article')).to_have_count(5)
            await expect(page.get_by_role('link', name='第二頁的天文觀測活動', exact=True)).to_have_count(0)
            for link in await page.get_by_role('article').get_by_role('heading').get_by_role('link').all():
                assert query(await link.get_attribute('href')).get('schoolId') == ['pu']
            checks.append('campus selection supersedes a stale schoolId for all displayed activities and detail links')
            assert not errors, errors
        except Exception:
            (OUT / 'failure-url.txt').write_text(page.url, encoding='utf-8')
            await page.screenshot(path=str(OUT / 'failure.png'), full_page=True, animations='disabled')
            (OUT / 'failure-dom.txt').write_text(await page.locator('body').aria_snapshot(), encoding='utf-8')
            raise
        finally:
            (OUT / 'results.json').write_text(json.dumps({'checks': checks, 'pageErrors': errors}, ensure_ascii=False, indent=2), encoding='utf-8')
            await browser.close()
    print(json.dumps({'passed': len(checks), 'checks': checks}, ensure_ascii=False))


if __name__ == '__main__':
    asyncio.run(main())
