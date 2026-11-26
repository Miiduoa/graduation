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


async def platform_scenario(browser, port, width, mode):
    label = f'{width}-{mode}-platform'
    page = await browser.new_page(viewport={'width': width, 'height': 844}, device_scale_factor=1)
    page_errors = []
    external_requests = []
    page.on('pageerror', lambda error: page_errors.append(str(error)))
    page.on('request', lambda request: external_requests.append(request.url) if not request.url.startswith(f'http://127.0.0.1:{port}/') else None)
    await page.goto(f'http://127.0.0.1:{port}/saved-plans-preview.html?theme={mode}&scenario=platform', wait_until='networkidle')
    await expect(page.get_by_role('heading', name='課業助理', exact=True)).to_be_visible()
    await expect(page.get_by_text('依這個帳號保存的課表安排時間，並連線核對已連結的 nuni 課堂作業。未連結或讀取不完整的部分會另外標示。', exact=True)).to_be_visible()
    today = page.get_by_role('button', name='整理今日重點', exact=True)
    week = page.get_by_role('button', name='規劃未來七天', exact=True)
    await expect(today).to_be_enabled()
    await expect(week).to_be_enabled()
    initial_geometry = await geometry(page)
    await today.focus()
    await expect(today).to_be_focused()
    await today.press('Enter')
    preview = page.get_by_test_id('platform-plan-preview')
    await expect(preview.get_by_text('今日課業重點', exact=True)).to_be_visible()
    await expect(preview.get_by_role('button', name=re.compile(r'逐日安排$'))).to_have_count(1)
    await expect(preview.get_by_text(re.compile(r'^09:10–10:00｜InterdisciplinaryCampusSystemsResearchAndCrossSchoolInformationManagementFinalPresentation'))).to_be_visible()
    await expect(preview.get_by_text('11/8 23:30–11/9 00:30｜跨夜資料整理與小組討論 · 資訊大樓協作研究室', exact=True)).to_be_visible()
    await expect(preview.get_by_text('23:59 截止 · 資訊管理實務', exact=True)).to_be_visible()
    await expect(preview.get_by_text(re.compile(r'尚未連接校務資料'))).to_be_visible()
    await expect(preview.get_by_text(re.compile(r'本次只取得部分 nuni 課堂作業'))).to_be_visible()
    await expect(preview.get_by_text(re.compile(r'第\s*\d+.*節|副本課間空堂'))).to_have_count(0)
    await expect(preview.get_by_text('鐘點課表無法完整核對，暫不推算課間時段或重疊。', exact=True)).to_be_visible()
    await expect(preview.get_by_text('課間時段（依保存課表）', exact=True)).to_have_count(0)
    await expect(preview.get_by_role('alert').filter(has_text='課表重疊：')).to_have_count(0)
    today_geometry = await geometry(page)
    await page.screenshot(path=str(ROOT / f'{label}-today.png'), full_page=True)

    await week.focus()
    await expect(week).to_be_focused()
    await week.press('Enter')
    await expect(preview.get_by_text('未來七天課業計畫', exact=True)).to_be_visible()
    await expect(preview.get_by_role('button', name=re.compile(r'逐日安排$'))).to_have_count(7)
    sunday = preview.get_by_role('button', name='11/8（週日）逐日安排', exact=True)
    monday = preview.get_by_role('button', name='11/9（週一）逐日安排', exact=True)
    await expect(sunday).to_have_attribute('aria-expanded', 'true')
    await expect(monday).to_have_attribute('aria-expanded', 'false')
    await monday.focus()
    await expect(monday).to_be_focused()
    await monday.press('Enter')
    await expect(monday).to_have_attribute('aria-expanded', 'true')
    await expect(preview.get_by_text('11/8 23:30–11/9 00:30｜跨夜資料整理與小組討論 · 資訊大樓協作研究室', exact=True)).to_have_count(2)
    await expect(preview.get_by_text('鐘點課表無法完整核對，暫不推算課間時段或重疊。', exact=True)).to_have_count(2)
    await expect(preview.get_by_text('課間時段（依保存課表）', exact=True)).to_have_count(0)
    await expect(preview.get_by_role('alert').filter(has_text='課表重疊：')).to_have_count(0)
    await expect(preview.get_by_text(re.compile(r'第\s*\d+.*節|副本課間空堂'))).to_have_count(0)
    week_geometry = await geometry(page)
    await page.screenshot(path=str(ROOT / f'{label}-week.png'), full_page=True)

    outside = preview.get_by_role('button', name='查看其他 1 項作業', exact=True)
    await outside.focus()
    await expect(outside).to_be_focused()
    await outside.press('Enter')
    await expect(preview.get_by_text('截止時間未確認', exact=True)).to_be_visible()
    await expect(preview.get_by_text('企業資源規劃跨校協作專題資料蒐集', exact=True)).to_be_visible()
    outside_geometry = await geometry(page)
    await page.screenshot(path=str(ROOT / f'{label}-incomplete.png'), full_page=True)
    fourth_limitation = preview.get_by_text(re.compile(r'部分課堂尚未連結作業來源，缺少的資料不代表沒有作業。'))
    await expect(fourth_limitation).to_have_count(0)
    expand_limitations = preview.get_by_role('button', name='查看全部 4 項資料限制', exact=True)
    await expect(expand_limitations).to_have_attribute('aria-expanded', 'false')
    await expand_limitations.focus()
    await expect(expand_limitations).to_be_focused()
    await expand_limitations.press('Enter')
    collapse_limitations = preview.get_by_role('button', name='收起資料限制', exact=True)
    await expect(collapse_limitations).to_have_attribute('aria-expanded', 'true')
    await expect(fourth_limitation).to_be_visible()
    limitations_geometry = await geometry(page)
    await page.screenshot(path=str(ROOT / f'{label}-limitations-expanded.png'), full_page=True)
    await collapse_limitations.focus()
    await expect(collapse_limitations).to_be_focused()
    await collapse_limitations.press('Enter')
    await expect(expand_limitations).to_have_attribute('aria-expanded', 'false')
    await expect(fourth_limitation).to_have_count(0)
    await preview.get_by_role('button', name='收起其他 1 項作業', exact=True).press('Enter')
    await expect(preview.get_by_text('截止時間未確認', exact=True)).to_have_count(0)
    await monday.focus()
    await monday.press('Enter')
    await expect(monday).to_have_attribute('aria-expanded', 'false')
    await preview.get_by_role('button', name='開啟我的課表核對', exact=True).click()
    await today.focus()
    await today.press('Enter')
    await expect(preview.get_by_text('今日課業重點', exact=True)).to_be_visible()
    await expect(preview.get_by_role('button', name=re.compile(r'逐日安排$'))).to_have_count(1)
    events = await page.evaluate('window.qaEvents')
    assert events == [
        {'kind': 'today'}, {'kind': 'week'},
        {'kind': 'open-route', 'route': '/timetable'}, {'kind': 'today'},
    ], events
    assert not page_errors, page_errors
    assert not external_requests, external_requests
    for current in [initial_geometry, today_geometry, week_geometry, outside_geometry, limitations_geometry]:
        assert current['documentWidth'] <= width, current
        assert not current['smallControls'], current['smallControls']
        assert not current['clipped'], current['clipped']
    await page.close()
    return {'scenario': label, 'events': events, 'pageErrors': page_errors, 'externalRequests': external_requests,
            'initialGeometry': initial_geometry, 'todayGeometry': today_geometry,
            'weekGeometry': week_geometry, 'incompleteGeometry': outside_geometry,
            'limitationsExpandedGeometry': limitations_geometry,
            'fixtureScope': 'Real NuniStudyPlanActions, CampusEvidencePlanCard and CampusStudyAgendaCard with synthetic dated courses and partial assignments; no login, school linkage, source fetch, storage or live-agent verification.'}


async def clock_scenario(browser, port, width, mode):
    label = f'{width}-{mode}-clock'
    page = await browser.new_page(viewport={'width': width, 'height': 844}, device_scale_factor=1)
    page_errors = []
    external_requests = []
    page.on('pageerror', lambda error: page_errors.append(str(error)))
    page.on('request', lambda request: external_requests.append(request.url) if not request.url.startswith(f'http://127.0.0.1:{port}/') else None)
    await page.goto(f'http://127.0.0.1:{port}/saved-plans-preview.html?theme={mode}&scenario=clock', wait_until='networkidle')
    today = page.get_by_role('button', name='整理今日重點', exact=True)
    await today.focus()
    await expect(today).to_be_focused()
    await today.press('Enter')
    preview = page.get_by_test_id('platform-plan-preview')
    await expect(preview.get_by_text('今日課業重點', exact=True)).to_be_visible()
    await expect(preview.get_by_text(re.compile(r'建議先用 11/8（週日） 10:10–10:40（30 分鐘）準備這份作業，再依進度調整。'))).to_be_visible()
    await expect(preview.get_by_text(re.compile(r'尚未建立行事曆事件'))).to_be_visible()
    await expect(preview.get_by_text('課間時段（依保存課表）', exact=True)).to_be_visible()
    await expect(preview.get_by_text('10:00–23:30', exact=True)).to_be_visible()
    await expect(preview.get_by_text('尚未排除私人行程、通勤或課表更新，安排前請自行核對。', exact=True)).to_be_visible()
    await expect(preview.get_by_role('alert').filter(has_text='課表重疊：')).to_have_count(0)
    today_geometry = await geometry(page)
    await page.screenshot(path=str(ROOT / f'{label}-today-gap.png'), full_page=True)

    week = page.get_by_role('button', name='規劃未來七天', exact=True)
    await week.focus()
    await expect(week).to_be_focused()
    await week.press('Enter')
    await expect(preview.get_by_role('button', name=re.compile(r'逐日安排$'))).to_have_count(7)
    sunday = preview.get_by_role('button', name='11/8（週日）逐日安排', exact=True)
    await expect(sunday).to_have_attribute('aria-expanded', 'true')
    await sunday.focus()
    await sunday.press('Enter')
    await expect(sunday).to_have_attribute('aria-expanded', 'false')
    tuesday = preview.get_by_role('button', name='11/10（週二）逐日安排', exact=True)
    await expect(tuesday).to_have_attribute('aria-expanded', 'false')
    await tuesday.focus()
    await expect(tuesday).to_be_focused()
    await tuesday.press('Enter')
    await expect(tuesday).to_have_attribute('aria-expanded', 'true')
    await expect(preview.get_by_role('alert')).to_have_text(
        '課表重疊：09:30–11:00、11/10 23:45–11/11 00:00。請先核對正式課表，不能當作可安排的空堂。')
    await expect(preview.get_by_text('13:00–14:00', exact=True)).to_be_visible()
    await expect(preview.get_by_text('15:00–23:30', exact=True)).to_be_visible()
    await expect(preview.get_by_text('11:00–12:00', exact=True)).to_have_count(0)
    await expect(preview.get_by_text('12:00–13:00｜接續工作坊的課程 · 資訊大樓 302', exact=True)).to_be_visible()
    await expect(preview.get_by_text('尚未排除私人行程、通勤或課表更新，安排前請自行核對。', exact=True)).to_be_visible()
    nested_geometry = await geometry(page)
    await page.screenshot(path=str(ROOT / f'{label}-nested-overlap.png'), full_page=True)

    await tuesday.focus()
    await tuesday.press('Enter')
    await expect(tuesday).to_have_attribute('aria-expanded', 'false')
    wednesday = preview.get_by_role('button', name='11/11（週三）逐日安排', exact=True)
    await wednesday.focus()
    await expect(wednesday).to_be_focused()
    await wednesday.press('Enter')
    await expect(wednesday).to_have_attribute('aria-expanded', 'true')
    await expect(preview.get_by_role('alert')).to_have_text(
        '課表重疊：00:00–00:15。請先核對正式課表，不能當作可安排的空堂。')
    await expect(preview.get_by_text('11/10 23:30–11/11 00:30｜跨夜專題工作坊 · 資訊大樓協作研究室', exact=True)).to_be_visible()
    await expect(preview.get_by_text('00:30–01:00', exact=True)).to_be_visible()
    await expect(preview.get_by_text('尚未排除私人行程、通勤或課表更新，安排前請自行核對。', exact=True)).to_be_visible()
    overnight_geometry = await geometry(page)
    await page.screenshot(path=str(ROOT / f'{label}-overnight.png'), full_page=True)

    await wednesday.focus()
    await wednesday.press('Enter')
    await expect(wednesday).to_have_attribute('aria-expanded', 'false')
    thursday = preview.get_by_role('button', name='11/12（週四）逐日安排', exact=True)
    await thursday.focus()
    await expect(thursday).to_be_focused()
    await thursday.press('Enter')
    await expect(thursday).to_have_attribute('aria-expanded', 'true')
    await expect(preview.get_by_text('09:00–10:00｜相鄰第一堂課 · 資訊大樓 301', exact=True)).to_be_visible()
    await expect(preview.get_by_text('10:00–11:00｜相鄰第二堂課 · 資訊大樓 301', exact=True)).to_be_visible()
    await expect(preview.get_by_text('已保存課程之間沒有可列出的課間時段。', exact=True)).to_be_visible()
    await expect(preview.get_by_role('alert')).to_have_count(0)
    await expect(preview.get_by_text('課間時段（依保存課表）', exact=True)).to_have_count(0)
    await expect(thursday).not_to_contain_text('有課表重疊')
    adjacent_geometry = await geometry(page)
    await page.screenshot(path=str(ROOT / f'{label}-adjacent.png'), full_page=True)
    await preview.get_by_role('button', name='核對個人課表', exact=True).press('Enter')
    await preview.get_by_role('button', name='開啟課程與作業核對', exact=True).press('Enter')
    events = await page.evaluate('window.qaEvents')
    assert events == [
        {'kind': 'today'}, {'kind': 'week'},
        {'kind': 'open-route', 'route': '/timetable'},
        {'kind': 'open-route', 'route': '/classroom'},
    ], events
    assert not page_errors, page_errors
    assert not external_requests, external_requests
    for current in [today_geometry, nested_geometry, overnight_geometry, adjacent_geometry]:
        assert current['documentWidth'] <= width, current
        assert not current['smallControls'], current['smallControls']
        assert not current['clipped'], current['clipped']
    await page.close()
    return {'scenario': label, 'events': events, 'pageErrors': page_errors, 'externalRequests': external_requests,
            'todayGeometry': today_geometry, 'nestedGeometry': nested_geometry,
            'overnightGeometry': overnight_geometry, 'adjacentGeometry': adjacent_geometry,
            'fixtureScope': 'Real clock availability calculations and presentation components with synthetic occurrences and representative preparation-step text; no live planner policy, authentication, school linkage, data fetch, storage or device verification.'}


async def assignment_scenario(browser, port, width, mode):
    label = f'{width}-{mode}-assignment'
    page = await browser.new_page(viewport={'width': width, 'height': 844}, device_scale_factor=1)
    page_errors = []
    external_requests = []
    page.on('pageerror', lambda error: page_errors.append(str(error)))
    page.on('request', lambda request: external_requests.append(request.url) if not request.url.startswith(f'http://127.0.0.1:{port}/') else None)
    await page.goto(f'http://127.0.0.1:{port}/saved-plans-preview.html?theme={mode}&scenario=assignment', wait_until='networkidle')
    preview = page.get_by_test_id('assignment-plan-preview')
    await expect(preview.get_by_text('從計畫核對原始作業', exact=True)).to_be_visible()
    await expect(page.get_by_text(re.compile(r'來源、核對回覆與導覽皆為合成控制'))).to_be_visible()
    actions = preview.get_by_role('button', name='查看這份作業', exact=True)
    await expect(actions).to_have_count(2)
    await expect(preview.get_by_text('開啟前會重新核對帳號、課程與作業；不會自動送出。', exact=True)).to_have_count(2)
    progress = preview.get_by_role('checkbox', name=re.compile(r'^我已處理：資訊管理實務'))
    await expect(progress).to_have_attribute('aria-checked', 'false')
    assert await page.evaluate('window.qaEvents') == []
    initial_geometry = await geometry(page)
    await page.screenshot(path=str(ROOT / f'{label}-ready.png'), full_page=True)

    await actions.first.focus()
    await expect(actions.first).to_be_focused()
    await actions.first.press('Enter')
    checking = preview.get_by_role('button', name='正在核對作業…', exact=True)
    await expect(checking).to_be_disabled()
    await page.keyboard.press('Enter')
    assert len(await page.evaluate('window.qaEvents')) == 1
    await expect(progress).to_have_attribute('aria-checked', 'false')
    checking_geometry = await geometry(page)
    await page.screenshot(path=str(ROOT / f'{label}-checking.png'), full_page=True)

    await page.evaluate("window.qaSettleAssignmentRead('unavailable')")
    await expect(preview.get_by_role('alert')).to_have_text(
        '暫時無法核對這份作業，請稍後重試，或從課程與作業入口確認。')
    retry = preview.get_by_role('button', name='重新核對這份作業', exact=True)
    await expect(retry).to_be_enabled()
    generic = preview.get_by_role('button', name='開啟課程與作業核對', exact=True)
    await expect(generic).to_be_enabled()
    await generic.focus()
    await expect(generic).to_be_focused()
    await generic.press('Enter')
    unavailable_geometry = await geometry(page)
    await page.screenshot(path=str(ROOT / f'{label}-unavailable.png'), full_page=True)

    await retry.focus()
    await expect(retry).to_be_focused()
    await retry.press('Enter')
    await expect(checking).to_be_disabled()
    await page.evaluate("window.qaSettleAssignmentRead('ready')")
    await expect(preview.get_by_role('alert')).to_have_count(0)
    await expect(actions).to_have_count(2)
    await expect(progress).to_have_attribute('aria-checked', 'false')

    # The expanded daily deadline must retain the same exact live source.
    await actions.nth(1).focus()
    await expect(actions.nth(1)).to_be_focused()
    await actions.nth(1).press('Enter')
    await expect(checking).to_be_disabled()
    await page.evaluate("window.qaSettleAssignmentRead('ready')")
    await expect(actions).to_have_count(2)

    # Outside-window work has a different source; an unavailable target cannot
    # silently open the already verified item with a similar title or course.
    outside = preview.get_by_role('button', name='查看其他 1 項作業', exact=True)
    await outside.focus()
    await expect(outside).to_be_focused()
    await outside.press('Enter')
    await expect(preview.get_by_text('企業資源規劃跨校協作專題資料蒐集', exact=True)).to_be_visible()
    await expect(preview.get_by_text('截止時間未確認', exact=True)).to_be_visible()
    await expect(actions).to_have_count(3)
    outside_geometry = await geometry(page)
    await page.screenshot(path=str(ROOT / f'{label}-outside.png'), full_page=True)
    await actions.last.focus()
    await expect(actions.last).to_be_focused()
    await actions.last.press('Enter')
    await expect(checking).to_be_disabled()
    await page.evaluate("window.qaSettleAssignmentRead('changed')")
    await expect(preview.get_by_role('alert')).to_have_text(
        '作業來源或課程連結已變更，請重新核對，或從課程與作業入口確認。')
    await expect(retry).to_be_enabled()
    await expect(generic).to_be_enabled()
    await expect(progress).to_have_attribute('aria-checked', 'false')
    changed_geometry = await geometry(page)
    await page.screenshot(path=str(ROOT / f'{label}-changed-outside.png'), full_page=True)

    source = {
        'accountId': 'pa_11111111-1111-4111-8111-111111111111', 'schoolId': 'pu', 'academicYear': '115', 'semester': '1',
        'workspaceId': 'cw_11111111-1111-4111-8111-111111111111',
        'assignmentId': 'cwa_11111111-1111-4111-8111-111111111111',
    }
    opened = {'kind': 'assignment-navigation', 'route': 'NuniWorkspace', 'params': {
        'tab': 'courses', 'workspaceId': source['workspaceId'], 'assignmentId': source['assignmentId'],
        'assistantAccountId': source['accountId'],
    }}
    events = await page.evaluate('window.qaEvents')
    assert events == [
        {'kind': 'assignment-read', 'source': source},
        {'kind': 'open-route', 'route': '/classroom'},
        {'kind': 'assignment-read', 'source': source}, opened,
        {'kind': 'assignment-read', 'source': source}, opened,
        {'kind': 'assignment-read', 'source': {**source,
            'workspaceId': 'cw_22222222-2222-4222-8222-222222222222',
            'assignmentId': 'cwa_22222222-2222-4222-8222-222222222222'}},
    ], events
    assert not page_errors, page_errors
    assert not external_requests, external_requests
    for current in [initial_geometry, checking_geometry, unavailable_geometry, outside_geometry, changed_geometry]:
        assert current['documentWidth'] <= width, current
        assert not current['smallControls'], current['smallControls']
        assert not current['clipped'], current['clipped']
    await page.close()
    return {'scenario': label, 'events': events, 'pageErrors': page_errors, 'externalRequests': external_requests,
            'initialGeometry': initial_geometry, 'checkingGeometry': checking_geometry,
            'unavailableGeometry': unavailable_geometry, 'outsideGeometry': outside_geometry,
            'changedGeometry': changed_geometry,
            'fixtureScope': 'Real CampusEvidencePlanCard and NuniPlanAssignmentOpenButton with synthetic live-source metadata, controlled reader outcomes and navigation callbacks; no planner, fresh authorization, account transition, destination, network, storage or native-device verification.'}


async def quiz_scenario(browser, port, width, mode):
    label = f'quiz-{width}-{mode}'
    page = await browser.new_page(viewport={'width': width, 'height': 844}, device_scale_factor=1)
    errors, external = [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('request', lambda request: external.append(request.url)
            if not request.url.startswith(f'http://127.0.0.1:{port}/') else None)
    await page.goto(f'http://127.0.0.1:{port}/saved-plans-preview.html?theme={mode}&scenario=quiz', wait_until='networkidle')
    preview = page.get_by_test_id('quiz-plan-preview')
    actions = preview.get_by_role('button', name='查看這份測驗', exact=True)
    await expect(actions).to_have_count(2)
    await expect(preview.get_by_text('依據：已授權測驗摘要', exact=True)).to_be_visible()
    await expect(preview.get_by_text(re.compile(r'^測驗參考期限 18:00'))).to_be_visible()
    await expect(preview.get_by_role('button', name='查看這份作業', exact=True)).to_have_count(2)
    checks = [await geometry(page)]
    await page.screenshot(path=str(ROOT / f'{label}-mixed-plan.png'), full_page=True)
    await actions.first.focus()
    await actions.first.press('Enter')
    await expect(preview.get_by_role('button', name='正在核對測驗…', exact=True)).to_be_disabled()
    await page.evaluate("window.qaSettleQuizRead('unavailable')")
    await expect(preview.get_by_role('alert')).to_have_text('暫時無法核對這份測驗，請稍後重試，或從課程與作業入口確認。')
    retry = preview.get_by_role('button', name='重新核對這份測驗', exact=True)
    await expect(retry).to_be_enabled()
    checks.append(await geometry(page))
    await page.screenshot(path=str(ROOT / f'{label}-retry.png'), full_page=True)
    await retry.focus()
    await retry.press('Enter')
    await page.evaluate("window.qaSettleQuizRead('ready')")
    await expect(preview.get_by_role('alert')).to_have_count(0)
    await preview.get_by_role('button', name='查看其他 1 項課業', exact=True).click()
    await expect(preview.get_by_text('測驗 · 參考期限未確認', exact=True)).to_be_visible()
    await expect(actions).to_have_count(3)
    checks.append(await geometry(page))
    await page.screenshot(path=str(ROOT / f'{label}-undated.png'), full_page=True)
    await actions.last.click()
    await page.evaluate("window.qaSettleQuizRead('changed')")
    await expect(preview.get_by_role('alert')).to_have_text('測驗來源或課程連結已變更，請重新核對，或從課程與作業入口確認。')
    for checkbox in await preview.get_by_role('checkbox').all():
        await expect(checkbox).to_have_attribute('aria-checked', 'false')
    checks.append(await geometry(page))
    await page.screenshot(path=str(ROOT / f'{label}-changed.png'), full_page=True)
    events = await page.evaluate('window.qaEvents')
    assert [event['kind'] for event in events] == ['quiz-read', 'quiz-read', 'assignment-navigation', 'quiz-read'], events
    assert events[0]['source'] == events[1]['source'], events
    assert events[2]['params']['assignmentId'] == events[0]['source']['quizId'], events
    assert events[3]['source']['quizId'] != events[0]['source']['quizId'], events
    assert not errors and not external, [errors, external]
    for result in checks:
        assert result['documentWidth'] <= width and not result['clipped'] and not result['smallControls'], result
    await page.close()
    return {'scenario': label, 'events': events, 'geometry': checks, 'pageErrors': errors, 'externalRequests': external,
            'fixtureScope': 'Production mixed plan and quiz button with synthetic data, controlled reader and navigation; no account authorization, real quiz submission or native-device verification.'}


async def receipt_scenario(browser, port, width, mode):
    label = f'receipt-{width}-{mode}'
    page = await browser.new_page(viewport={'width': width, 'height': 844}, device_scale_factor=1)
    errors, external = [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('request', lambda request: external.append(request.url)
            if not request.url.startswith(f'http://127.0.0.1:{port}/') else None)
    await page.goto(f'http://127.0.0.1:{port}/saved-plans-preview.html?theme={mode}&scenario=receipt', wait_until='networkidle')
    saved = page.get_by_role('button', name=re.compile(r'^查看回到計畫核對作業與測驗'))
    await saved.focus()
    await saved.press('Enter')
    checkboxes = page.get_by_role('checkbox')
    await expect(checkboxes).to_have_count(2)
    await checkboxes.first.focus()
    # Repeated keydown while Space is held must still produce one checkbox change.
    await page.keyboard.down('Space')
    await page.keyboard.down('Space')
    await page.keyboard.up('Space')
    await expect(checkboxes.first).to_have_attribute('aria-checked', 'true')
    await expect(checkboxes.last).to_have_attribute('aria-checked', 'false')
    # A historical plan never restores the precise live coursework buttons.
    await expect(page.get_by_role('button', name='查看這份測驗', exact=True)).to_have_count(0)
    await expect(page.get_by_role('button', name='查看這份作業', exact=True)).to_have_count(0)
    checks = [await geometry(page)]
    await page.screenshot(path=str(ROOT / f'{label}-original.png'), full_page=True)

    replan = page.get_by_role('button', name='依目前資料重新規劃', exact=True)
    await replan.focus()
    await replan.press('Enter')
    preview = page.get_by_test_id('receipt-comparison-preview')
    await expect(preview.get_by_text('平台紀錄', exact=True)).to_have_count(2)
    await expect(preview.get_by_text(re.compile(r'08:30')).first).to_be_visible()
    await expect(preview.get_by_text(re.compile(r'08:31')).first).to_be_visible()
    await expect(preview.get_by_role('checkbox')).to_have_count(0)
    await expect(checkboxes.first).to_have_attribute('aria-checked', 'true')
    await expect(checkboxes.last).to_have_attribute('aria-checked', 'false')
    checks.append(await geometry(page))
    await page.screenshot(path=str(ROOT / f'{label}-received.png'), full_page=True)
    await preview.get_by_role('button', name='查看原計畫', exact=True).click()
    await expect(preview).to_have_count(0)
    await expect(page.get_by_text('已處理 1 / 2', exact=True)).to_be_visible()

    await page.evaluate("window.qaReceiptRead = 'closed'")
    await replan.focus()
    await replan.press('Enter')
    await expect(preview.get_by_text('平台紀錄', exact=True)).to_have_count(0)
    await expect(preview.get_by_text(re.compile(r'關閉')).first).to_be_visible()
    await expect(checkboxes.first).to_have_attribute('aria-checked', 'true')
    await expect(checkboxes.last).to_have_attribute('aria-checked', 'false')
    checks.append(await geometry(page))
    await page.screenshot(path=str(ROOT / f'{label}-closed.png'), full_page=True)
    await preview.get_by_role('button', name='查看原計畫', exact=True).click()

    await page.evaluate("window.qaReceiptRead = 'unavailable'")
    await replan.click()
    await expect(preview.get_by_text('平台紀錄', exact=True)).to_have_count(0)
    await expect(preview.get_by_text('來源不可用', exact=True)).to_have_count(2)
    await expect(checkboxes.first).to_have_attribute('aria-checked', 'true')
    await expect(checkboxes.last).to_have_attribute('aria-checked', 'false')
    checks.append(await geometry(page))
    await page.screenshot(path=str(ROOT / f'{label}-unavailable.png'), full_page=True)
    events = await page.evaluate('window.qaEvents')
    assert [event['kind'] for event in events] == [
        'receipt-toggle', 'receipt-replan', 'receipt-original',
        'receipt-replan', 'receipt-original', 'receipt-replan',
    ], events
    assert events[0] == {'kind': 'receipt-toggle', 'stepId': 'quiz-preparation', 'done': True}, events
    replans = [event for event in events if event['kind'] == 'receipt-replan']
    assert [event['read'] for event in replans] == ['received', 'closed', 'unavailable'], events
    assert all(event['completed'] == ['quiz-preparation'] for event in replans), events
    assert sorted(replans[0]['receiptKinds']) == ['assignment', 'quiz'], events
    assert replans[1]['receiptKinds'] == [] and replans[2]['receiptKinds'] == [], events
    assert not errors and not external, [errors, external]
    for result in checks:
        assert result['documentWidth'] <= width and not result['clipped'] and not result['smallControls'], result
    await page.close()
    return {'scenario': label, 'events': events, 'geometry': checks, 'pageErrors': errors, 'externalRequests': external,
            'fixtureScope': 'Real saved-plan projection, comparison and presentation with controlled source snapshots; no account authorization, live submission, persistent storage or native-device verification.'}


async def receipt_date_query_scenario(browser, port, width, mode):
    label = f'receipt-date-query-{width}-{mode}'
    page = await browser.new_page(viewport={'width': width, 'height': 844}, device_scale_factor=1)
    errors, external, failed = [], [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('request', lambda request: external.append(request.url)
            if not request.url.startswith(f'http://127.0.0.1:{port}/') else None)
    page.on('requestfailed', lambda request: failed.append({'url': request.url, 'failure': request.failure}))
    # The real query captures Date.now() at each question. Saturday in Taipei
    # keeps tomorrow (Sunday) separate from the following Monday–Sunday week.
    await page.add_init_script("Date.now = () => Date.parse('2026-11-07T02:00:00.000Z');")
    await page.goto(f'http://127.0.0.1:{port}/saved-plans-preview.html?theme={mode}&scenario=receipt-date-query', wait_until='networkidle')
    preview = page.get_by_test_id('receipt-date-query-preview')
    expand = preview.get_by_role('button', name='問課業助理', exact=True)
    await expand.focus()
    await expand.press('Enter')
    partial = preview.get_by_text('部分課程未完整載入，結果只包含這次取得的項目。', exact=True)
    await expect(partial).to_be_visible()
    checks = [await geometry(page)]
    question = preview.get_by_role('textbox', name='輸入課業問題', exact=True)
    query = preview.get_by_role('button', name='查詢課業', exact=True)
    rows = preview.get_by_role('button', name=re.compile(r'^查看作業：'))
    tomorrow_scope = preview.get_by_text('截止範圍：「明天」（台灣時間），依作業參考期限篩選。', exact=True)
    undated = preview.get_by_text('另有 1 筆無可核對的參考期限，無法依日期判斷。', exact=True)

    async def ask(text):
        await question.fill(text)
        await query.click()
        await expect(question).to_have_value('')

    await ask('我明天還沒交的作業有哪些？')
    await expect(rows).to_have_count(1)
    pending = preview.get_by_role('button', name='查看作業：資料庫 · 明日資料整理報告', exact=True)
    await expect(pending).to_be_visible()
    await expect(pending.get_by_text('本次未見繳交紀錄 · 請到原頁核對', exact=True)).to_be_visible()
    await expect(pending.get_by_text('參考期限 2026/11/8 上午10:00', exact=True)).to_be_visible()
    await expect(tomorrow_scope).to_be_visible()
    await expect(undated).to_be_visible()
    for title in ['資料庫概念摘要', '下週索引練習', '期末報告', '期限待確認報告', '期限待確認摘要']:
        await expect(preview.get_by_text(title, exact=True)).to_have_count(0)
    checks.append(await geometry(page))
    await page.screenshot(path=str(ROOT / f'{label}-tomorrow-pending.png'), full_page=True)

    await ask('那已交的呢？')
    await expect(rows).to_have_count(1)
    received = preview.get_by_role('button', name='查看作業：資料庫 · 資料庫概念摘要', exact=True)
    await expect(received).to_be_visible()
    await expect(received.get_by_text('已載入繳交紀錄 · 繳交時間 2026/11/7 上午9:15', exact=True)).to_be_visible()
    await expect(received.get_by_text('參考期限 2026/11/8 下午6:00', exact=True)).to_be_visible()
    await expect(tomorrow_scope).to_be_visible()
    await expect(undated).to_be_visible()
    await expect(pending).to_have_count(0)
    await expect(preview.get_by_text('期末報告', exact=True)).to_have_count(0)
    checks.append(await geometry(page))
    await page.screenshot(path=str(ROOT / f'{label}-tomorrow-received.png'), full_page=True)

    # Explicitly establish the course and deadline meaning before changing only
    # the date. A receipt's submission time is deliberately outside that week.
    await ask('資料庫明天截止的已繳交作業有哪些？')
    await expect(rows).to_have_count(1)
    await expect(received).to_be_visible()
    await expect(tomorrow_scope).to_be_visible()
    await ask('那下週呢？')
    await expect(rows).to_have_count(1)
    next_week = preview.get_by_role('button', name='查看作業：資料庫 · 期末報告', exact=True)
    await expect(next_week).to_be_visible()
    await expect(next_week.get_by_text('已載入繳交紀錄 · 繳交時間 2026/11/6 下午5:30', exact=True)).to_be_visible()
    await expect(next_week.get_by_text('參考期限 2026/11/10 下午6:00', exact=True)).to_be_visible()
    await expect(preview.get_by_text('截止範圍：「下週」（台灣時間），依作業參考期限篩選。', exact=True)).to_be_visible()
    await expect(tomorrow_scope).to_have_count(0)
    await expect(undated).to_be_visible()
    await expect(partial).to_be_visible()
    await expect(preview.get_by_role('button', name='查看作業：程式設計 · 期末報告', exact=True)).to_have_count(0)
    for title in ['明日資料整理報告', '資料庫概念摘要', '下週索引練習', '期限待確認報告', '期限待確認摘要']:
        await expect(preview.get_by_text(title, exact=True)).to_have_count(0)
    await expect(preview.get_by_text('來源：本次載入的 nuni 課程繳交紀錄。未見紀錄不代表校方 LMS 已確認未交。', exact=True)).to_be_visible()
    checks.append(await geometry(page))
    await page.screenshot(path=str(ROOT / f'{label}-next-week-received.png'), full_page=True)
    await next_week.focus()
    await expect(next_week).to_be_focused()
    await next_week.press('Enter')
    events = await page.evaluate('window.qaEvents')
    assert events == [{
        'kind': 'receipt-date-open', 'courseId': 'receipt-database',
        'activityId': 'database-next-week-received',
    }], events
    assert not errors and not external and not failed, [errors, external, failed]
    for result in checks:
        assert result['documentWidth'] <= width and not result['clipped'] and not result['smallControls'], result
    await page.close()
    return {'scenario': label, 'events': events, 'geometry': checks, 'pageErrors': errors,
            'externalRequests': external, 'failedRequests': failed,
            'fixtureScope': 'Real StudyAssignmentAssistant, receipt/date query services and ThemeProvider with a controlled loaded NuniStudyAgenda and fixed query clock; real status/date follow-ups and exact-ID open callback. No account authorization, live fetch, submission, destination or native-device verification.'}


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
                results.append(await platform_scenario(browser, port, width, mode))
                results.append(await clock_scenario(browser, port, width, mode))
                results.append(await assignment_scenario(browser, port, width, mode))
                results.append(await quiz_scenario(browser, port, width, mode))
                results.append(await receipt_scenario(browser, port, width, mode))
                results.append(await receipt_date_query_scenario(browser, port, width, mode))
            await browser.close()
    finally:
        server.shutdown()
        (ROOT / 'saved-plans-browser-check.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
    print(json.dumps(results, ensure_ascii=False, indent=2))


asyncio.run(main())
