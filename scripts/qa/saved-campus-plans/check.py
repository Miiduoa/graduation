import asyncio
import functools
import http.server
import json
import os
import re
import threading
from pathlib import Path

from playwright.async_api import async_playwright, expect

ROOT = Path(__file__).resolve().parents[3] / 'artifacts' / 'saved-campus-plans'


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


async def geometry(page):
    return await page.evaluate('''() => {
      const nodes = [...document.querySelectorAll('*')];
      const visible = node => { const rect = node.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; };
      const controls = nodes.filter(node => node.matches('[role="button"],[role="checkbox"],button') && visible(node))
        .map(node => { const rect = node.getBoundingClientRect(); return {label:node.getAttribute('aria-label') || node.textContent, width:rect.width,height:rect.height}; });
      const clipped = nodes.filter(node => !['HTML','BODY','SCRIPT','STYLE'].includes(node.tagName) && visible(node))
        .filter(node => { const rect=node.getBoundingClientRect(); return rect.right > window.innerWidth + 1.5 || rect.left < -1.5 || node.scrollWidth > node.clientWidth + 1.5; })
        .map(node => {const rect=node.getBoundingClientRect();return {tag:node.tagName,text:node.textContent.slice(0,100),left:rect.left,right:rect.right,clientWidth:node.clientWidth,scrollWidth:node.scrollWidth};});
      return {width:window.innerWidth, documentWidth:document.documentElement.scrollWidth,
        controls, clipped, smallControls:controls.filter(control=>control.height<44 || control.width<44)};
    }''')


async def scenario(browser, port, width, mode):
    label = f'{width}-{mode}'
    page = await browser.new_page(viewport={'width': width, 'height': 844}, device_scale_factor=1)
    page_errors = []
    external_requests = []
    page.on('pageerror', lambda error: page_errors.append(str(error)))
    page.on('request', lambda request: external_requests.append(request.url) if not request.url.startswith(f'http://127.0.0.1:{port}/') else None)
    await page.goto(f'http://127.0.0.1:{port}/saved-plans-preview.html?theme={mode}', wait_until='networkidle')
    first_header = page.get_by_role('button', name=re.compile(r'^查看這週的資料庫'))
    await expect(first_header).to_be_visible()
    await expect(page.get_by_text('資料庫系統期末專題：校園跨校資料整合與權限隔離實作報告', exact=True)).to_have_count(0)
    await page.screenshot(path=str(ROOT / f'{label}-collapsed.png'), full_page=True)

    await first_header.focus()
    await first_header.press('Enter')
    await expect(page.get_by_role('button', name=re.compile(r'^收起這週的資料庫'))).to_have_attribute('aria-expanded', 'true')
    await expect(page.get_by_text('整理時間：2026/11/06 23:58（台灣時間）', exact=True)).to_be_visible()
    expanded_geometry = await geometry(page)
    await page.screenshot(path=str(ROOT / f'{label}-expanded.png'), full_page=True)

    checkbox = page.get_by_role('checkbox', name=re.compile(r'我已處理：資料庫系統期末專題'))
    await checkbox.scroll_into_view_if_needed()
    await checkbox.click()
    await expect(checkbox).to_have_attribute('aria-checked', 'true')
    await expect(page.get_by_text('已處理 1 / 3', exact=True)).to_be_visible()
    await page.evaluate('''() => {const element=document.querySelector('[role="checkbox"]');const rect=element.getBoundingClientRect();window.scrollTo(0,window.scrollY+rect.top-450);}''')
    await page.screenshot(path=str(ROOT / f'{label}-checklist.png'))

    await page.get_by_role('button', name='開啟課程與作業核對', exact=True).first.click()
    await page.get_by_role('button', name='刪除計畫', exact=True).click()
    confirm = page.get_by_role('button', name='確認刪除', exact=True)
    await expect(confirm).to_be_visible()
    confirmation_geometry = await geometry(page)
    await confirm.scroll_into_view_if_needed()
    await page.screenshot(path=str(ROOT / f'{label}-confirm.png'))
    await page.get_by_role('button', name='保留計畫', exact=True).click()
    await expect(confirm).to_have_count(0)
    await page.get_by_role('button', name='依目前資料重新規劃', exact=True).click()
    events = await page.evaluate('window.qaEvents')
    assert events == [
        {'kind': 'toggle', 'id': 'week-study', 'stepId': 'assignment-0', 'done': True},
        {'kind': 'open-route', 'route': '/classroom'},
        {'kind': 'replan', 'id': 'week-study', 'completed': ['assignment-0']},
    ], events

    preview = page.get_by_test_id('comparison-preview')
    await expect(preview.get_by_role('heading', name='這次調整了什麼', exact=True)).to_be_visible()
    await expect(preview.get_by_text('原計畫整理：2026/11/06 23:58（台灣時間）', exact=True)).to_be_visible()
    await expect(preview.get_by_text('本次整理：2026/11/07 10:15（台灣時間）', exact=True)).to_be_visible()
    await expect(preview.get_by_text('2026/11/06 23:59 截止', exact=True)).to_be_visible()
    await expect(preview.get_by_text('2026/11/07 18:00 截止', exact=True)).to_be_visible()
    await expect(preview.get_by_text('本次摘要未列出，不能判定已繳交或已取消。', exact=True)).to_be_visible()
    await expect(preview.get_by_text('本次只取得部分課程摘要，未列出的作業不能當作已繳交或已取消。', exact=True).first).to_be_visible()
    await expect(preview.get_by_text('部分課程資料還沒同步', exact=True)).to_have_count(0)
    await expect(preview.get_by_role('checkbox')).to_have_count(0)
    comparison_geometry = await geometry(page)
    await preview.scroll_into_view_if_needed()
    await page.screenshot(path=str(ROOT / f'{label}-comparison.png'), full_page=True)

    expand_changes = preview.get_by_role('button', name='查看全部 8 項', exact=True)
    await expect(expand_changes).to_have_attribute('aria-expanded', 'false')
    await expand_changes.focus()
    await expect(expand_changes).to_be_focused()
    await expand_changes.press('Enter')
    collapse_changes = preview.get_by_role('button', name='收起調整清單', exact=True)
    await expect(collapse_changes).to_have_attribute('aria-expanded', 'true')
    await expect(preview.get_by_text('部分課程資料還沒同步', exact=True)).to_be_visible()
    await expect(preview.get_by_text('InterdisciplinaryCampusSystemsResearchAndCrossSchoolInformationManagementFinalPresentation', exact=True)).to_be_visible()
    comparison_expanded_geometry = await geometry(page)
    await page.screenshot(path=str(ROOT / f'{label}-comparison-expanded.png'), full_page=True)
    await collapse_changes.focus()
    await expect(collapse_changes).to_be_focused()
    await collapse_changes.press('Enter')
    await expect(expand_changes).to_have_attribute('aria-expanded', 'false')
    await expect(preview.get_by_text('部分課程資料還沒同步', exact=True)).to_have_count(0)

    open_original = preview.get_by_role('button', name='查看原計畫', exact=True)
    await open_original.focus()
    await expect(open_original).to_be_focused()
    await open_original.press('Enter')
    await expect(preview).to_have_count(0)
    await expect(checkbox).to_have_attribute('aria-checked', 'true')
    await expect(page.get_by_text('已處理 1 / 3', exact=True)).to_be_visible()

    await page.get_by_role('button', name=re.compile(r'^查看明日學習行動')).click()
    await expect(checkbox).to_have_count(0)
    await expect(page.get_by_role('checkbox', name='我已處理：核對已儲存課表', exact=True)).to_have_attribute('aria-checked', 'true')
    await page.get_by_role('button', name='依目前資料重新規劃', exact=True).click()
    await expect(preview.get_by_text('目前沒有足夠資料可比對，請先查看下方說明。', exact=True)).to_be_visible()
    await expect(preview.get_by_text('這份舊計畫沒有逐日資料，無法完整比對課表與作業期限；請重新核對課程頁。', exact=True)).to_be_visible()
    await expect(preview.get_by_text(re.compile(r'沒有變動|沒有差異|沒有列出可確認的調整'))).to_have_count(0)
    await expect(preview.get_by_role('button', name=re.compile(r'^查看全部'))).to_have_count(0)
    legacy_geometry = await geometry(page)
    await preview.scroll_into_view_if_needed()
    await page.screenshot(path=str(ROOT / f'{label}-comparison-legacy.png'), full_page=True)
    await preview.get_by_role('button', name='查看原計畫', exact=True).click()
    await expect(preview).to_have_count(0)
    await expect(page.get_by_role('checkbox', name='我已處理：核對已儲存課表', exact=True)).to_have_attribute('aria-checked', 'true')
    comparison_events = await page.evaluate('window.qaEvents.slice(3)')
    assert comparison_events == [
        {'kind': 'original', 'id': 'week-study'},
        {'kind': 'replan', 'id': 'tomorrow-study', 'completed': ['timetable-review']},
        {'kind': 'original', 'id': 'tomorrow-study'},
    ], comparison_events
    assert not page_errors, page_errors
    assert not external_requests, external_requests

    result = {'scenario': label, 'events': events, 'pageErrors': page_errors, 'externalRequests': external_requests,
              'expandedGeometry': expanded_geometry, 'confirmationGeometry': confirmation_geometry,
              'comparisonEvents': comparison_events, 'comparisonGeometry': comparison_geometry,
              'comparisonExpandedGeometry': comparison_expanded_geometry, 'legacyComparisonGeometry': legacy_geometry,
              'fixtureScope': 'Real presentation components with synthetic comparison and plan data; no school, storage or live-agent verification.'}
    for current in [expanded_geometry, confirmation_geometry, comparison_geometry, comparison_expanded_geometry, legacy_geometry]:
        assert current['documentWidth'] <= width, current
        assert not current['smallControls'], current['smallControls']
        assert not current['clipped'], current['clipped']
    await page.close()
    return result


async def main():
    handler = functools.partial(QuietHandler, directory=str(ROOT))
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    port = server.server_address[1]
    results = []
    try:
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(
                headless=True, executable_path=os.environ.get('QA_CHROMIUM_EXECUTABLE'),
            )
            for width, mode in [(390, 'light'), (320, 'dark')]:
                results.append(await scenario(browser, port, width, mode))
            await browser.close()
    finally:
        server.shutdown()
        (ROOT / 'saved-plans-browser-check.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
    print(json.dumps(results, ensure_ascii=False, indent=2))


asyncio.run(main())
