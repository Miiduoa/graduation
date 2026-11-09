"""Real Chromium interactions on production Assistant with fixed fake API data.

No model, school system, deployed backend or real account is used. Normal cases
use native UI actions. Explicit controlled faults alter only fixture API replies.
Build with build.mjs first. Artifacts include screenshots, requests and fake writes.
"""
import asyncio
import functools
import hashlib
import json
import os
import re
import subprocess
import threading
import traceback
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from playwright.async_api import async_playwright, expect

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'artifacts/assistant-plan-revision'
CHANGE = '第二筆改到21:00至21:30，第一筆保持不變'
ORIGINAL = [
    {'title': '測試微積分複習', 'date': '2026-11-12', 'allDay': False, 'startTime': '19:00', 'endTime': '19:30'},
    {'title': '測試英文閱讀', 'date': '2026-11-12', 'allDay': False, 'startTime': '20:00', 'endTime': '20:30'},
]


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def card_list(page):
    return page.get_by_role('article', name='行程確認卡', exact=True)


async def snapshot(page):
    return await page.evaluate('window.__agentQA.snapshot()')


def actions(state):
    return [row['action'] for row in state['requests'] if row['action'] != 'capability']


async def no_writes(page):
    state = await snapshot(page)
    assert state['writes'] == [], state
    assert 'confirm' not in actions(state), state
    local_key = f"campus.personal-imports.v1:platform%3A{state['account']}:{state['school']}"
    assert await page.evaluate('key => localStorage.getItem(key)', local_key) is None, state


async def idle(page):
    await expect(page.get_by_role('log')).not_to_have_attribute('aria-busy', 'true')


async def start_plan(page, events=None):
    events = ORIGINAL if events is None else events
    consent = page.get_by_role('checkbox', name=re.compile('同意在本次對話'))
    await expect(consent).to_be_enabled()
    await consent.check()
    question = page.get_by_role('textbox', name='問題', exact=True)
    await question.fill('請幫我安排兩段讀書時間')
    await question.press('Enter')
    await expect(card_list(page)).to_have_count(len(events))
    for index, event in enumerate(events):
        await expect(card_list(page).nth(index)).to_contain_text(event['title'])
        await expect(card_list(page).nth(index)).to_contain_text(event['startTime'] + '–' + event['endTime'])
    await expect(card_list(page).nth(0).get_by_role('button', name='確認', exact=True)).to_be_enabled()
    await expect(card_list(page).nth(1).get_by_role('button', name='確認', exact=True)).to_be_disabled()
    await no_writes(page)


async def open_revision(page, keyboard=False, instruction=CHANGE):
    entry = page.get_by_role('button', name='修改時間或條件', exact=True).first
    if keyboard:
        await entry.focus()
        await page.keyboard.press('Enter')
    else:
        await entry.click()
    field = page.get_by_role('textbox', name='修改條件', exact=True)
    await expect(field).to_be_focused()
    await field.fill(instruction)
    if keyboard:
        await page.keyboard.press('Tab')
        await expect(page.get_by_role('button', name='重新預覽', exact=True)).to_be_focused()
    return field


async def assert_preview(page, expected_asks=2):
    await expect(card_list(page)).to_have_count(4)
    await idle(page)
    for index in range(2):
        old = card_list(page).nth(index)
        await expect(old).to_contain_text('已撤銷未執行提議')
        await expect(old.get_by_role('button', name='確認', exact=True)).to_have_count(0)
    await expect(card_list(page).nth(2)).to_contain_text('測試微積分複習')
    await expect(card_list(page).nth(2)).to_contain_text('19:00–19:30')
    await expect(card_list(page).nth(3)).to_contain_text('測試英文閱讀')
    await expect(card_list(page).nth(3)).to_contain_text('21:00–21:30')
    await expect(card_list(page).nth(3).get_by_role('button', name='確認', exact=True)).to_be_disabled()
    await no_writes(page)
    state = await snapshot(page)
    asks = [row for row in state['requests'] if row['action'] == 'ask']
    assert len(asks) == expected_asks, state
    body = asks[-1]['body']
    assert body['consent'] is True and body['schoolId'] == 'fixture-campus-a', body
    assert body['history'] == [], body
    assert CHANGE in body['question'], body
    # Decode the allowlisted snapshot independently, and check every event field.
    payload = body['question'].split('原安排：', 1)[1].split('\n修改條件：', 1)[0]
    assert json.loads(payload) == ORIGINAL, payload
    assert 'token' not in body['question'] and 'mutationId' not in body['question'], body
    for row in state['requests']:
        if row['action'] == 'cancel':
            assert row['body']['token'] not in body['question'], body
    assert state['revoked'] == ['qa-original-1', 'qa-original-2'], state
    await basic_comparison(page)


def comparison(page):
    return page.get_by_role('region', name='這次提議改了什麼', exact=True)


async def changed_field(row, label, before, after):
    term = row.get_by_text(label, exact=True)
    await expect(term).to_have_count(1)
    values = term.locator('xpath=following-sibling::dd').locator(':scope > div')
    await expect(values).to_have_count(2)
    await expect(values.nth(0)).to_have_text('原提議：' + before)
    await expect(values.nth(1)).to_have_text('新提議：' + after)


async def comparison_before_cards(page):
    panel = comparison(page)
    await expect(panel).to_be_visible()
    assert await panel.evaluate('''node => {
      const firstNewCard = document.querySelectorAll('article[aria-label="行程確認卡"]')[2];
      return !!firstNewCard && Boolean(node.compareDocumentPosition(firstNewCard) & Node.DOCUMENT_POSITION_FOLLOWING);
    }'''), 'Comparison must precede the revised confirmation cards'
    return panel


async def basic_comparison(page):
    panel = await comparison_before_cards(page)
    ledger = await snapshot(page)
    await expect(panel.get_by_text('內容未變更：1 項。', exact=True)).to_be_visible()
    changed = panel.get_by_role('list', name='內容變更的提議', exact=True)
    await expect(changed.get_by_role('listitem')).to_have_count(1)
    row = changed.get_by_role('listitem', name='測試英文閱讀', exact=True)
    assert sorted(await row.locator('dt').all_text_contents()) == ['結束時間', '開始時間']
    await changed_field(row, '開始時間', '2026-11-12 20:00（台灣時間）', '2026-11-12 21:00（台灣時間）')
    await changed_field(row, '結束時間', '2026-11-12 20:30（台灣時間）', '2026-11-12 21:30（台灣時間）')
    for label in ['新提議新增', '新提議不再列入', '原提議行程', '新提議行程']:
        await expect(panel.get_by_role('list', name=label, exact=True)).to_have_count(0)
    assert await snapshot(page) == ledger, 'Reading the comparison caused an API call or write'


async def comparison_readability(page, name):
    """Read the actual scrollable UI; never hide the sticky composer for evidence."""
    panel = comparison(page)
    dock = page.get_by_role('form', name='傳送問題', exact=True).locator('..')
    await expect(dock).to_be_visible()
    dock_element = await dock.element_handle()
    ledger = await snapshot(page)
    evidence = {'viewportScreenshots': [], 'fields': []}
    evidence_path = OUT / f'{name}-readability.json'

    def save():
        evidence_path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding='utf-8')

    async def scroll(target, block):
        await target.evaluate('''(node, block) => new Promise(resolve => {
          node.scrollIntoView({block, inline:'nearest', behavior:'instant'});
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        })''', block)

    async def geometry(target):
        # Read target and the entire composer dock in one layout snapshot.
        return await target.evaluate('''(node, dock) => {
          const box = element => {const r=element.getBoundingClientRect();
            return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height};};
          return {target:box(node),dock:box(dock),viewport:{width:innerWidth,height:innerHeight},
            dockPosition:getComputedStyle(dock).position};
        }''', dock_element)

    def readable(value):
        target, dock_box, viewport = value['target'], value['dock'], value['viewport']
        return (target['width'] > 0 and target['height'] > 0 and target['top'] >= 0
                and target['bottom'] < min(dock_box['top'], viewport['height'])
                and target['left'] >= 0 and target['right'] <= viewport['width'])

    await scroll(panel, 'start')
    evidence['panelAtStart'] = await geometry(panel)
    evidence['headingAtStart'] = await geometry(panel.get_by_role('heading', name='這次提議改了什麼', exact=True))
    save()
    assert readable(evidence['headingAtStart']), evidence
    start_image = f'{name}-viewport-start.png'
    await page.screenshot(path=str(OUT / start_image), full_page=False)
    evidence['viewportScreenshots'].append(start_image)
    element_image = OUT / f'{name}.png'
    if readable(evidence['panelAtStart']):
        # Only an already unobscured element may be captured; no screenshot-only styling.
        await panel.screenshot(path=str(element_image))
        evidence['panelAfterElementScreenshot'] = await geometry(panel)
        save()
        assert readable(evidence['panelAfterElementScreenshot']), evidence
        evidence['elementScreenshot'] = element_image.name
    else:
        # Avoid retaining a stale, previously obscured element shot on local reruns.
        element_image.unlink(missing_ok=True)
        evidence['elementScreenshot'] = None
        evidence['elementScreenshotNote'] = 'Panel does not fit above the composer; use real start/end viewport evidence.'
    save()

    terms = panel.locator('dt')
    for index in range(await terms.count()):
        term = terms.nth(index)
        field = term.locator('..')  # The actual grid row includes dt and both old/new dd values.
        await scroll(field, 'center')
        value = await geometry(field)
        value.update({'label': await term.inner_text(), 'text': await field.inner_text()})
        value['readable'] = readable(value)
        evidence['fields'].append(value)
        save()
        assert value['readable'], f'Comparison field is obscured after native scrolling: {value}'
    if evidence['fields']:
        end_image = f'{name}-viewport-end.png'
        await page.screenshot(path=str(OUT / end_image), full_page=False)
        evidence['viewportScreenshots'].append(end_image)
        evidence['panelAtLastField'] = await geometry(panel)
    evidence['ledgerUnchangedWhileScrolling'] = await snapshot(page) == ledger
    save()
    assert evidence['ledgerUnchangedWhileScrolling'], 'Scrolling the comparison caused an API call or write'
    return evidence


async def comparison_case(page, name):
    # Independent fixed scenarios: no production comparison helper is used as an oracle.
    before = [dict(event) for event in ORIGINAL]
    after = [dict(event) for event in ORIGINAL]
    scenario = name.removesuffix('-320')
    if scenario == 'cross-day-rename':
        after[0].update(date='2026-11-13', endDate='2026-11-14', startTime='23:30', endTime='00:30')
        after[1]['title'] = '測試英文精讀'
        instruction = '第一筆改到11月13日23:30至11月14日00:30，第二筆改名為測試英文精讀，時間不變'
    elif scenario == 'reordered':
        after.reverse()
        instruction = '交換兩筆安排的順序，日期與時間不變'
    elif scenario == 'added':
        after.append({**ORIGINAL[1], 'title': '測試整理筆記', 'startTime': '22:00', 'endTime': '22:30'})
        instruction = '新增11月12日22:00至22:30的測試整理筆記，原安排保持不變'
    elif scenario == 'removed':
        after = after[:1]
        instruction = '新版只列出第一筆提議'
    elif scenario == 'same-name-ambiguous':
        for event in before + after:
            event['title'] = '測試讀書'
        after[0].update(startTime='21:00', endTime='21:30')
        after[1].update(startTime='22:00', endTime='22:30')
        instruction = '把兩段測試讀書改為21:00與22:00，各30分鐘'
    else:
        assert scenario == 'unchanged', scenario
        instruction = '保留兩筆安排的日期、時間與名稱'
    await page.evaluate('value => window.__agentQA.configurePlan(value)', {'originalEvents': before, 'revisedEvents': after})
    await start_plan(page, before)
    await expect(comparison(page)).to_have_count(0)
    await open_revision(page, keyboard=True, instruction=instruction)
    await page.keyboard.press('Enter')
    await expect(card_list(page)).to_have_count(len(before) + len(after))
    await idle(page)
    for index in range(len(before)):
        await expect(card_list(page).nth(index)).to_contain_text('已撤銷未執行提議')
        await expect(card_list(page).nth(index).get_by_role('button', name='確認', exact=True)).to_have_count(0)
    for index, event in enumerate(after):
        card = card_list(page).nth(len(before) + index)
        await expect(card.get_by_role('heading', name=event['title'], exact=True)).to_be_visible()
        await expect(card).to_contain_text(event['startTime'] + '–' + event['endTime'])
        button = card.get_by_role('button', name='確認', exact=True)
        if index == 0:
            await expect(button).to_be_enabled()
        else:
            await expect(button).to_be_disabled()
    await no_writes(page)
    ledger = await snapshot(page)
    assert actions(ledger) == ['ask', 'cancel', 'cancel', 'ask'], ledger
    request = [row for row in ledger['requests'] if row['action'] == 'ask'][-1]['body']
    assert request['history'] == [] and request['consent'] is True, request
    assert instruction in request['question'], request
    payload = request['question'].split('原安排：', 1)[1].split('\n修改條件：', 1)[0]
    assert json.loads(payload) == before, payload
    assert 'token' not in request['question'] and 'mutationId' not in request['question'], request
    panel = await comparison_before_cards(page)
    changed = panel.get_by_role('list', name='內容變更的提議', exact=True)
    if scenario == 'cross-day-rename':
        await expect(changed.get_by_role('listitem')).to_have_count(2)
        row = changed.get_by_role('listitem', name='測試微積分複習', exact=True)
        assert set(await row.locator('dt').all_text_contents()) == {'開始日期', '結束日期', '開始時間', '結束時間'}
        for label, old, new in [
            ('開始日期', '2026-11-12', '2026-11-13'),
            ('結束日期', '2026-11-12', '2026-11-14'),
            ('開始時間', '2026-11-12 19:00（台灣時間）', '2026-11-13 23:30（台灣時間）'),
            ('結束時間', '2026-11-12 19:30（台灣時間）', '2026-11-14 00:30（台灣時間）'),
        ]:
            await changed_field(row, label, old, new)
        rename = changed.get_by_role('listitem', name='測試英文精讀', exact=True)
        assert await rename.locator('dt').all_text_contents() == ['名稱']
        await changed_field(rename, '名稱', '測試英文閱讀', '測試英文精讀')
    else:
        await expect(changed).to_have_count(0)
    unchanged_count = {'cross-day-rename': 0, 'reordered': 2, 'added': 2, 'removed': 1, 'same-name-ambiguous': 0, 'unchanged': 2}[scenario]
    unchanged_note = panel.locator('p').filter(has_text='內容未變更：')
    await expect(unchanged_note).to_have_count(1 if unchanged_count else 0)
    if unchanged_count:
        await expect(unchanged_note).to_have_text(f'內容未變更：{unchanged_count} 項。')
    await expect(panel.get_by_text('兩份提議的安排內容相同。', exact=True)).to_have_count(
        1 if scenario in ['reordered', 'unchanged'] else 0)
    order_note = panel.get_by_text('顯示順序與原提議不同，請依新版確認卡的順序核對。', exact=True)
    await expect(order_note).to_have_count(1 if scenario == 'reordered' else 0)
    for label, expected in [('新提議新增', [after[-1]] if scenario == 'added' else []),
                            ('新提議不再列入', [before[-1]] if scenario == 'removed' else [])]:
        listing = panel.get_by_role('list', name=label, exact=True)
        if expected:
            await expect(listing.get_by_role('listitem')).to_have_count(1)
            event = expected[0]
            await expect(listing).to_contain_text(event['title'])
            await expect(listing).to_contain_text(f"{event['date']} {event['startTime']} – {event['date']} {event['endTime']}（台灣時間）")
        else:
            await expect(listing).to_have_count(0)
    if scenario == 'removed':
        await expect(panel.get_by_text('只表示新版提議未列入這些項目，不代表刪除既有行程。', exact=True)).to_be_visible()
    await expect(panel.get_by_role('heading', name='無法可靠逐筆對照', exact=True)).to_have_count(1 if scenario == 'same-name-ambiguous' else 0)
    for label, events in [('原提議行程', before), ('新提議行程', after)]:
        listing = panel.get_by_role('list', name=label, exact=True)
        if scenario == 'same-name-ambiguous':
            await expect(listing.get_by_role('listitem')).to_have_count(2)
            for index, event in enumerate(events):
                item = listing.get_by_role('listitem').nth(index)
                await expect(item).to_contain_text(event['title'])
                await expect(item).to_contain_text(
                    f"{event['date']} {event['startTime']} – {event['date']} {event['endTime']}（台灣時間）")
        else:
            await expect(listing).to_have_count(0)
    overflow = await no_overflow(page)
    panel_size = await panel.evaluate('node => ({client:node.clientWidth,scroll:node.scrollWidth})')
    assert panel_size['scroll'] <= panel_size['client'] + 1, panel_size
    readability = await comparison_readability(page, f'comparison-{name}-summary')
    await capture(page, f'comparison-{name}-zero-writes')
    assert await snapshot(page) == ledger, 'Comparison rendering or reading caused another API call or write'
    assert await page.evaluate("localStorage.getItem('campus.personal-imports.v1:platform%3Aqa-agent:fixture-campus-a')") is None
    return {'mode': 'native UI with configured fixed comparison data; no model or backend',
            'fixtureOriginal': before, 'fixtureRevised': after, 'summaryText': await panel.inner_text(),
            'overflow': overflow, 'panelSize': panel_size, 'ledgerUnchangedWhileReading': True,
            'readability': readability}


async def capture(page, name):
    await page.screenshot(path=str(OUT / f'{name}.png'), full_page=True)


async def no_overflow(page):
    dimensions = await page.evaluate('''() => ({ viewport: innerWidth,
      document: document.documentElement.scrollWidth, body: document.body.scrollWidth })''')
    assert dimensions['document'] <= dimensions['viewport'] + 1, dimensions
    assert dimensions['body'] <= dimensions['viewport'] + 1, dimensions
    return dimensions


async def native_case(page, width):
    await start_plan(page)
    await capture(page, f'native-{width}-initial')
    await open_revision(page, keyboard=True)
    overflow = await no_overflow(page)
    await capture(page, f'native-{width}-editor')
    await page.keyboard.press('Enter')
    await assert_preview(page)
    assert actions(await snapshot(page)) == ['ask', 'cancel', 'cancel', 'ask']
    await no_overflow(page)
    readability = await comparison_readability(page, f'native-{width}-comparison')
    await capture(page, f'native-{width}-preview-zero-writes')
    first = card_list(page).nth(2)
    second = card_list(page).nth(3)
    await first.get_by_role('button', name='確認', exact=True).click()
    await expect(first.get_by_label('行程執行回執', exact=True)).to_contain_text('已核對並加入個人行事曆')
    state = await snapshot(page)
    assert len(state['writes']) == 1, state
    await expect(second.get_by_role('button', name='確認', exact=True)).to_be_enabled()
    await second.get_by_role('button', name='確認', exact=True).click()
    await expect(second.get_by_label('行程執行回執', exact=True)).to_contain_text('已核對並加入個人行事曆')
    state = await snapshot(page)
    assert actions(state) == ['ask', 'cancel', 'cancel', 'ask', 'confirm', 'confirm'], state
    assert len(state['writes']) == 2 and len({w['mutationId'] for w in state['writes']}) == 2, state
    for index, write in enumerate(state['writes']):
        expected = {**ORIGINAL[index], **({'startTime': '21:00', 'endTime': '21:30'} if index else {})}
        assert {key: write['record'][key] for key in expected} == expected, write
        assert write['mutationId'].startswith('qa-revised-'), write
    local = await page.evaluate('''() => JSON.parse(localStorage.getItem(
      'campus.personal-imports.v1:platform%3Aqa-agent:fixture-campus-a'))''')
    assert len(local['records']) == 2 and local['records'] == state['records'], local
    assert local['sync']['enabled'] is False, local
    journal = await page.evaluate('''() => sessionStorage.getItem(
      'campus.assistant-execution.v1:platform%3Aqa-agent:fixture-campus-a:' + 'a'.repeat(43))''')
    assert journal is None, journal
    await no_overflow(page)
    await capture(page, f'native-{width}-confirmed')
    return {'mode': 'native UI with fixed fake API', 'keyboard': 'Enter opens editor; focus moves to textarea; Tab/Enter submits',
            'overflow': overflow, 'readability': readability}


async def ask_error_case(page, fault):
    await start_plan(page)
    await open_revision(page)
    await page.evaluate('fault => window.__agentQA.configure({revisionAsk:fault})', fault)
    await page.get_by_role('button', name='重新預覽', exact=True).click()
    await expect(page.get_by_role('alert').first).to_be_visible()
    await idle(page)
    await expect(page.get_by_role('textbox', name='修改條件', exact=True)).to_have_value(CHANGE)
    await expect(card_list(page)).to_have_count(2)
    for index in range(2):
        await expect(card_list(page).nth(index)).to_contain_text('已撤銷未執行提議')
        await expect(card_list(page).nth(index).get_by_role('button', name='確認', exact=True)).to_have_count(0)
    await no_writes(page)
    await expect(comparison(page)).to_have_count(0)
    assert actions(await snapshot(page)) == ['ask', 'cancel', 'cancel', 'ask']
    await capture(page, f'controlled-{fault}-retained-draft')
    await page.get_by_role('button', name='重新預覽', exact=True).click()
    await assert_preview(page, expected_asks=3)
    state = await snapshot(page)
    assert actions(state) == ['ask', 'cancel', 'cancel', 'ask', 'ask'], state
    await no_writes(page)
    return {'mode': f'controlled fake API revision {fault}; successful retry does not recancel or confirm'}


async def unknown_case(page):
    await start_plan(page)
    await open_revision(page)
    await page.evaluate('window.__agentQA.configure({unknownCancellation:true})')
    await page.get_by_role('button', name='重新預覽', exact=True).click()
    await expect(card_list(page).nth(0).get_by_role('button', name='重新核對結果', exact=True)).to_be_enabled()
    await idle(page)
    state = await snapshot(page)
    assert actions(state) == ['ask', 'cancel', 'reconcile'], state
    await expect(page.get_by_role('button', name='重新預覽', exact=True)).to_be_disabled()
    await expect(page.get_by_role('textbox', name='修改條件', exact=True)).to_have_value(CHANGE)
    await no_writes(page)
    await capture(page, 'controlled-unknown-paused')
    await page.evaluate('window.__agentQA.configure({unknownCancellation:false})')
    await card_list(page).nth(0).get_by_role('button', name='重新核對結果', exact=True).click()
    await expect(card_list(page).nth(0)).to_contain_text('已撤銷未執行提議')
    assert actions(await snapshot(page)) == ['ask', 'cancel', 'reconcile', 'reconcile']
    await page.get_by_role('button', name='重新預覽', exact=True).click()
    await assert_preview(page)
    assert actions(await snapshot(page)) == ['ask', 'cancel', 'reconcile', 'reconcile', 'cancel', 'ask']
    await capture(page, 'controlled-unknown-recovered')
    return {'mode': 'controlled cancellation response loss + failed readback; explicit reconcile then resume'}


async def late_school_case(page):
    await start_plan(page)
    await open_revision(page)
    await page.evaluate('window.__agentQA.configure({holdAsk:true})')
    await page.get_by_role('button', name='重新預覽', exact=True).click()
    await page.wait_for_function('window.__agentQA.snapshot().waiting')
    await page.get_by_role('combobox', name='QA 校園', exact=True).select_option('fixture-campus-b')
    await expect(card_list(page)).to_have_count(0)
    await page.evaluate('window.__agentQA.release()')
    await page.wait_for_function("window.__agentQA.requests.filter(row=>row.action==='ask').every(row=>row.outcome)")
    await idle(page)
    await expect(card_list(page)).to_have_count(0)
    await expect(page.get_by_role('textbox', name='修改條件', exact=True)).to_have_count(0)
    await no_writes(page)
    state = await snapshot(page)
    assert actions(state) == ['ask', 'cancel', 'cancel', 'ask'], state
    assert state['school'] == 'fixture-campus-b', state
    await capture(page, 'controlled-late-preview-school-switch')
    return {'mode': 'controlled delayed preview ignores AbortSignal; old response must not enter new school UI'}


async def double_case(page):
    await start_plan(page)
    await open_revision(page)
    await page.evaluate('window.__agentQA.configure({holdCancel:true})')
    # Two native mouse clicks while the first cancellation remains unresolved.
    await page.get_by_role('button', name='重新預覽', exact=True).dblclick()
    await page.wait_for_function('window.__agentQA.snapshot().waiting')
    assert actions(await snapshot(page)) == ['ask', 'cancel']
    await expect(page.get_by_role('button', name='正在重新預覽…', exact=True)).to_be_disabled()
    await page.evaluate('window.__agentQA.release()')
    await assert_preview(page)
    assert actions(await snapshot(page)) == ['ask', 'cancel', 'cancel', 'ask']
    return {'mode': 'native double click with controlled delayed first cancellation; exactly one chain'}


def protection_checkbox(page, index):
    return page.get_by_role('form', name='修改安排再預覽', exact=True).get_by_role(
        'checkbox', name=re.compile(rf'^保留原樣\s+第\s+{index + 1}\s+項(?:\s|$)'))


async def select_protection(page, events, indices, keyboard=False):
    for index, event in enumerate(events):
        checkbox = protection_checkbox(page, index)
        await expect(checkbox).to_have_accessible_name(re.compile(
            re.escape(event['title']) + r'.*' + event['date'] + r'.*' + event['startTime'] + r'.*' + event['endTime']))
    if keyboard:
        # Native Space toggles the first checkbox; Tab visits the next checkbox and textarea.
        assert indices == [0] and len(events) == 2
        await protection_checkbox(page, 0).focus()
        await page.keyboard.press('Space')
        await expect(protection_checkbox(page, 0)).to_be_checked()
        await page.keyboard.press('Tab')
        await expect(protection_checkbox(page, 1)).to_be_focused()
        await page.keyboard.press('Tab')
        await expect(page.get_by_role('textbox', name='修改條件', exact=True)).to_be_focused()
    else:
        for index in indices:
            await protection_checkbox(page, index).check()
    for index in range(len(events)):
        await expect(protection_checkbox(page, index)).to_be_checked(checked=index in indices)


async def protected_preview(page, before, after, indices, instruction, expected_actions):
    await expect(card_list(page)).to_have_count(len(before) + len(after))
    await idle(page)
    for index in range(len(before)):
        old = card_list(page).nth(index)
        await expect(old).to_contain_text('已撤銷未執行提議')
        await expect(old.get_by_role('button', name='確認', exact=True)).to_have_count(0)
    for index, event in enumerate(after):
        card = card_list(page).nth(len(before) + index)
        await expect(card.get_by_role('heading', name=event['title'], exact=True)).to_be_visible()
        await expect(card).to_contain_text(event['startTime'] + '–' + event['endTime'])
        button = card.get_by_role('button', name='確認', exact=True)
        if index == 0:
            await expect(button).to_be_enabled()
        else:
            await expect(button).to_be_disabled()
    await expect(comparison(page)).to_be_visible()
    await no_writes(page)
    state = await snapshot(page)
    assert actions(state) == expected_actions, state
    asks = [row for row in state['requests'] if row['action'] == 'ask']
    body = asks[-1]['body']
    assert body['planProtection'] == {'originalEvents': before, 'protectedIndices': indices}, body
    assert body['history'] == [] and body['consent'] is True, body
    assert instruction in body['question'], body
    payload = body['question'].split('原安排：', 1)[1].split('\n修改條件：', 1)[0]
    assert json.loads(payload) == before, payload
    assert 'token' not in body['question'] and 'mutationId' not in body['question'], body
    for row in state['requests']:
        if row['action'] == 'cancel':
            assert row['body']['token'] not in body['question'], body
    assert state['revoked'] == [f'qa-original-{index + 1}' for index in range(len(before))], state
    fresh = state['previews'][-1]['cards']
    previous_ids = {card['mutationId'] for preview in state['previews'][:-1] for card in preview['cards']}
    previous_tokens = {card['token'] for preview in state['previews'][:-1] for card in preview['cards']}
    assert len({card['mutationId'] for card in fresh}) == len(after), fresh
    assert all(card['mutationId'] not in previous_ids and card['token'] not in previous_tokens for card in fresh), state
    assert [card['args'] for card in fresh] == after, fresh
    return state


async def confirm_protected_preview(page, before, after, request_prefix):
    for index in range(len(after)):
        card = card_list(page).nth(len(before) + index)
        await card.get_by_role('button', name='確認', exact=True).click()
        await expect(card.get_by_label('行程執行回執', exact=True)).to_contain_text('已核對並加入個人行事曆')
        assert len((await snapshot(page))['writes']) == index + 1
    state = await snapshot(page)
    assert actions(state) == request_prefix + ['confirm'] * len(after), state
    assert len({write['mutationId'] for write in state['writes']}) == len(after), state
    for write, event in zip(state['writes'], after):
        assert write['mutationId'].startswith('qa-revised-2-'), write
        assert {key: write['record'][key] for key in event} == event, write
    local = await page.evaluate("JSON.parse(localStorage.getItem('campus.personal-imports.v1:platform%3Aqa-agent:fixture-campus-a'))")
    assert local['records'] == state['records'] and local['sync']['enabled'] is False, local
    journal = await page.evaluate("sessionStorage.getItem('campus.assistant-execution.v1:platform%3Aqa-agent:fixture-campus-a:'+'a'.repeat(43))")
    assert journal is None, journal


async def protected_good_case(page, name):
    before = [dict(event) for event in ORIGINAL]
    indices, instruction = [0], CHANGE
    after = [dict(before[0]), {**before[1], 'startTime': '21:00', 'endTime': '21:30'}]
    if name == 'multiple-reordered':
        before.append({**before[1], 'title': '測試整理筆記', 'startTime': '22:00', 'endTime': '22:30'})
        indices = [0, 2]
        after = [dict(before[2]), after[1], dict(before[0])]
        instruction = '第一及第三筆保留原樣，第二筆改到21:00至21:30，新版順序為第三、第二、第一筆'
    await page.evaluate('value => window.__agentQA.configurePlan(value)', {'originalEvents': before, 'revisedEvents': after})
    await start_plan(page, before)
    await open_revision(page, keyboard=True, instruction=instruction)
    await select_protection(page, before, indices, keyboard=len(before) == 2)
    await no_overflow(page)
    await page.screenshot(path=str(OUT / f'protected-{name}-selection-viewport.png'), full_page=False)
    if len(before) == 2:
        await page.keyboard.press('Tab')
        await expect(page.get_by_role('button', name='重新預覽', exact=True)).to_be_focused()
        await page.keyboard.press('Enter')
    else:
        await page.get_by_role('button', name='重新預覽', exact=True).click()
    prefix = ['ask'] + ['cancel'] * len(before) + ['ask']
    await protected_preview(page, before, after, indices, instruction, prefix)
    readability = await comparison_readability(page, f'protected-{name}-comparison')
    await capture(page, f'protected-{name}-zero-writes')
    await confirm_protected_preview(page, before, after, prefix)
    await capture(page, f'protected-{name}-confirmed')
    return {'mode': 'native protection selection and manual confirmations against fixed fake API',
            'protectedIndices': indices, 'fixtureOriginal': before, 'fixtureRevised': after, 'readability': readability}


async def protected_all_case(page):
    await start_plan(page)
    await open_revision(page, keyboard=True)
    await protection_checkbox(page, 0).focus()
    await page.keyboard.press('Space')
    await page.keyboard.press('Tab')
    await expect(protection_checkbox(page, 1)).to_be_focused()
    await page.keyboard.press('Space')
    for index in range(2):
        await expect(protection_checkbox(page, index)).to_be_checked()
    await expect(page.get_by_role('button', name='重新預覽', exact=True)).to_be_disabled()
    await expect(page.get_by_text('全部項目已勾選保留原樣，不需重新預覽；原提議保持不變。', exact=True)).to_be_visible()
    await page.keyboard.press('Tab')
    await expect(page.get_by_role('textbox', name='修改條件', exact=True)).to_be_focused()
    await page.keyboard.press('Tab')
    await expect(page.get_by_role('button', name='回到原提議', exact=True)).to_be_focused()
    await page.keyboard.press('Enter')
    await expect(page.get_by_role('form', name='修改安排再預覽', exact=True)).to_have_count(0)
    await expect(page.get_by_role('button', name='修改時間或條件', exact=True)).to_be_focused()
    await expect(card_list(page).nth(0).get_by_role('button', name='確認', exact=True)).to_be_enabled()
    await expect(card_list(page).nth(1).get_by_role('button', name='確認', exact=True)).to_be_disabled()
    await no_writes(page)
    state = await snapshot(page)
    assert actions(state) == ['ask'] and state['revoked'] == [], state
    await expect(comparison(page)).to_have_count(0)
    await no_overflow(page)
    await capture(page, 'protected-all-original-cards-retained')
    return {'mode': 'native Tab/Space selects every item; disabled preview and Enter returns to original cards',
            'extraAsk': 0, 'cancel': 0, 'writes': 0}


async def protected_bad_case(page, fault):
    # Deliberately bypass the real server guard with valid fake card metadata.
    # This verifies client defense only; real server 422/retirement has separate tests.
    before = [dict(event) for event in ORIGINAL]
    good = [dict(before[0]), {**before[1], 'startTime': '21:00', 'endTime': '21:30'}]
    if fault == 'missing':
        bad = [dict(good[1])]
    elif fault == 'changed-time':
        bad = [{**before[0], 'startTime': '19:15', 'endTime': '19:45'}, dict(good[1])]
    elif fault == 'duplicate':
        bad = [dict(before[0]), dict(before[0]), dict(good[1])]
    else:
        assert fault == 'same-name-ambiguous', fault
        for event in before + good:
            event['title'] = '測試讀書'
        bad = [dict(event) for event in good]
        good = [dict(before[1]), dict(before[0])]  # Exact same-name events may be reordered.
    await page.evaluate('value => window.__agentQA.configurePlan(value)', {'originalEvents': before, 'revisedEvents': bad})
    await start_plan(page, before)
    await open_revision(page, instruction=CHANGE)
    await select_protection(page, before, [0])
    await page.get_by_role('button', name='重新預覽', exact=True).click()
    await expect(page.get_by_role('alert').first).to_contain_text('新預覽不符合保留條件')
    await idle(page)
    await expect(card_list(page)).to_have_count(2)
    for index in range(2):
        await expect(card_list(page).nth(index)).to_contain_text('已撤銷未執行提議')
        await expect(card_list(page).nth(index).get_by_role('button', name='確認', exact=True)).to_have_count(0)
    await expect(comparison(page)).to_have_count(0)
    await expect(page.get_by_role('textbox', name='修改條件', exact=True)).to_have_value(CHANGE)
    await expect(protection_checkbox(page, 0)).to_be_checked()
    await expect(protection_checkbox(page, 1)).not_to_be_checked()
    await no_writes(page)
    state = await snapshot(page)
    assert actions(state) == ['ask', 'cancel', 'cancel', 'ask'], state
    assert state['requests'][-1]['outcome'] == '200', 'This case must exercise the client, not a fake server 422'
    await capture(page, f'controlled-protection-{fault}-rejected')
    await page.evaluate('events => window.__agentQA.configurePlan({revisedEvents:events})', good)
    await page.get_by_role('button', name='重新預覽', exact=True).click()
    state = await protected_preview(page, before, good, [0], CHANGE, ['ask', 'cancel', 'cancel', 'ask', 'ask'])
    for row in state['requests']:
        if row['action'] == 'ask' and 'planProtection' in row['body']:
            assert row['body']['planProtection'] == {'originalEvents': before, 'protectedIndices': [0]}, row
    await no_overflow(page)
    await capture(page, f'controlled-protection-{fault}-fresh-retry')
    return {'mode': 'controlled bad API response bypasses server protection; client rejects whole candidate and keeps selections',
            'fault': fault, 'fixtureRejected': bad, 'fixtureRetry': good, 'protectedIndices': [0], 'writes': 0}


async def protected_partial_duplicate_case(page):
    before = [dict(ORIGINAL[0]), dict(ORIGINAL[0]), dict(ORIGINAL[1])]
    await page.evaluate('events => window.__agentQA.configurePlan({originalEvents:events})', before)
    await start_plan(page, before)
    instruction = '只修改第三項，保留第一項'
    await open_revision(page, instruction=instruction)
    await select_protection(page, before, [0])
    await page.get_by_role('button', name='重新預覽', exact=True).click()
    await expect(page.get_by_role('alert')).to_contain_text('完全相同的行程需一起標記保留')
    await expect(page.get_by_role('textbox', name='修改條件', exact=True)).to_have_value(instruction)
    await expect(protection_checkbox(page, 0)).to_be_checked()
    await expect(card_list(page)).to_have_count(3)
    await expect(card_list(page).nth(0).get_by_role('button', name='確認', exact=True)).to_be_enabled()
    await no_writes(page)
    state = await snapshot(page)
    assert actions(state) == ['ask'] and state['revoked'] == [], state
    await expect(comparison(page)).to_have_count(0)
    await capture(page, 'protected-partial-exact-duplicate-preflight')
    return {'mode': 'partial selection of exact duplicate group rejected before any cancellation or new ask', 'writes': 0}


async def protected_unknown_case(page):
    await start_plan(page)
    await open_revision(page)
    await select_protection(page, ORIGINAL, [0])
    await page.evaluate('window.__agentQA.configure({unknownCancellation:true})')
    await page.get_by_role('button', name='重新預覽', exact=True).click()
    await expect(card_list(page).nth(0).get_by_role('button', name='重新核對結果', exact=True)).to_be_enabled()
    await idle(page)
    assert actions(await snapshot(page)) == ['ask', 'cancel', 'reconcile']
    await expect(protection_checkbox(page, 0)).to_be_checked()
    await expect(page.get_by_role('textbox', name='修改條件', exact=True)).to_have_value(CHANGE)
    await expect(page.get_by_role('button', name='重新預覽', exact=True)).to_be_disabled()
    await no_writes(page)
    await capture(page, 'protected-unknown-cancel-paused')
    await page.evaluate('window.__agentQA.configure({unknownCancellation:false})')
    await card_list(page).nth(0).get_by_role('button', name='重新核對結果', exact=True).click()
    await expect(card_list(page).nth(0)).to_contain_text('已撤銷未執行提議')
    assert actions(await snapshot(page)) == ['ask', 'cancel', 'reconcile', 'reconcile']
    await page.get_by_role('button', name='重新預覽', exact=True).click()
    after = [dict(ORIGINAL[0]), {**ORIGINAL[1], 'startTime': '21:00', 'endTime': '21:30'}]
    await protected_preview(page, ORIGINAL, after, [0], CHANGE, ['ask', 'cancel', 'reconcile', 'reconcile', 'cancel', 'ask'])
    await capture(page, 'protected-unknown-cancel-recovered')
    return {'mode': 'controlled cancellation loss; protected choices survive explicit reconcile and resume', 'writes': 0}


async def protected_late_scope_case(page, scope):
    await start_plan(page)
    await open_revision(page)
    await select_protection(page, ORIGINAL, [0])
    await page.evaluate('window.__agentQA.configure({holdAsk:true})')
    await page.get_by_role('button', name='重新預覽', exact=True).click()
    await page.wait_for_function('window.__agentQA.snapshot().waiting')
    if scope == 'account':
        await page.get_by_role('combobox', name='QA 帳號', exact=True).select_option('qa-agent-b')
    else:
        assert scope == 'school', scope
        await page.get_by_role('combobox', name='QA 校園', exact=True).select_option('fixture-campus-b')
    await expect(card_list(page)).to_have_count(0)
    await page.evaluate('window.__agentQA.release()')
    await page.wait_for_function("window.__agentQA.requests.filter(row=>row.action==='ask').every(row=>row.outcome)")
    await idle(page)
    await expect(card_list(page)).to_have_count(0)
    await expect(comparison(page)).to_have_count(0)
    await expect(page.get_by_role('form', name='修改安排再預覽', exact=True)).to_have_count(0)
    await expect(page.get_by_role('checkbox', name=re.compile('保留原樣'))).to_have_count(0)
    await expect(page.get_by_role('checkbox', name=re.compile('同意在本次對話'))).not_to_be_checked()
    await no_writes(page)
    state = await snapshot(page)
    assert actions(state) == ['ask', 'cancel', 'cancel', 'ask'], state
    assert state['account'] == ('qa-agent-b' if scope == 'account' else 'qa-agent'), state
    assert state['school'] == ('fixture-campus-b' if scope == 'school' else 'fixture-campus-a'), state
    bound = [row for row in state['requests'] if row['action'] == 'ask'][-1]
    assert bound['account'] == 'qa-agent' and bound['body']['schoolId'] == 'fixture-campus-a', bound
    assert bound['body']['planProtection'] == {'originalEvents': ORIGINAL, 'protectedIndices': [0]}, bound
    for account in ['qa-agent', 'qa-agent-b']:
        for school in ['fixture-campus-a', 'fixture-campus-b']:
            assert await page.evaluate('key => localStorage.getItem(key)', f'campus.personal-imports.v1:platform%3A{account}:{school}') is None
    await capture(page, f'controlled-protected-late-{scope}')
    return {'mode': 'controlled delayed protected preview ignores AbortSignal; stale scope response must remain invisible',
            'scopeSwitch': scope, 'writes': 0}


def build_evidence():
    meta = json.loads((OUT / 'bundle-meta.json').read_text())
    paths = [name for name in meta['inputs'] if not name.startswith(('fixture:', '<')) and 'node_modules/' not in name]
    hashes = {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in paths}
    for required in ['Assistant.tsx', 'AssistantCards.tsx', 'AssistantPlanRevision.tsx', 'AssistantPlanComparison.tsx', 'planComparison.ts', 'assistantExecutionJournal.ts', 'assistantCalendarExecution.ts', 'assistantPlanProtection.ts']:
        assert any(name.endswith('/' + required) for name in hashes), f'Real implementation missing: {required}'
    return {'head': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(), 'sourceSha256': hashes}


async def main():
    report = {'scope': 'Production React UI in Chromium; fixed fake API/account/campus; no model or real backend',
              'modelLimitation': 'Fixture returns predefined revised cards; this does not test model interpretation or generation quality',
              'build': build_evidence(), 'cases': []}
    handler = functools.partial(QuietHandler, directory=str(OUT))
    server = ThreadingHTTPServer(('127.0.0.1', 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f'http://127.0.0.1:{server.server_port}'
    try:
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(executable_path=os.environ.get('ASSISTANT_QA_CHROMIUM_EXECUTABLE'))
            report['browser'] = {'version': browser.version, 'executableOverride': os.environ.get('ASSISTANT_QA_CHROMIUM_EXECUTABLE')}
            try:
                cases = [('native-1440', 1440, lambda p: native_case(p, 1440)),
                         ('native-320', 320, lambda p: native_case(p, 320)),
                         ('controlled-ask-error', 1440, lambda p: ask_error_case(p, 'error')),
                         ('controlled-empty-preview', 1440, lambda p: ask_error_case(p, 'empty')),
                         ('controlled-unknown-cancel', 1440, unknown_case),
                         ('controlled-late-school-switch', 1440, late_school_case),
                         ('controlled-double-preview', 1440, double_case),
                         ('controlled-malformed-preview', 1440, lambda p: ask_error_case(p, 'malformed'))]
                cases.extend((f'comparison-{name}', width, lambda p, value=name: comparison_case(p, value))
                             for name, width in [('cross-day-rename', 1440), ('cross-day-rename-320', 320),
                                                 ('reordered', 1440), ('added', 1440), ('removed', 1440),
                                                 ('same-name-ambiguous', 1440), ('unchanged', 1440)])
                cases.extend([
                    ('protected-single-1440', 1440, lambda p: protected_good_case(p, 'single-1440')),
                    ('protected-single-320', 320, lambda p: protected_good_case(p, 'single-320')),
                    ('protected-multiple-reordered', 1440, lambda p: protected_good_case(p, 'multiple-reordered')),
                    ('protected-all-320', 320, protected_all_case),
                    ('protected-partial-exact-duplicates', 1440, protected_partial_duplicate_case),
                    ('protected-unknown-cancel', 1440, protected_unknown_case),
                    ('controlled-protected-late-school', 1440, lambda p: protected_late_scope_case(p, 'school')),
                    ('controlled-protected-late-account', 1440, lambda p: protected_late_scope_case(p, 'account')),
                ])
                cases.extend((f'controlled-protected-{fault}', 1440, lambda p, value=fault: protected_bad_case(p, value))
                             for fault in ['missing', 'changed-time', 'duplicate', 'same-name-ambiguous'])
                for name, width, run in cases:
                    context = await browser.new_context(viewport={'width': width, 'height': 900 if width > 320 else 720},
                                                        reduced_motion='reduce', locale='zh-TW', timezone_id='Asia/Taipei', service_workers='block')
                    page = await context.new_page()
                    page.set_default_timeout(10_000)
                    errors, blocked = [], []
                    page.on('pageerror', lambda error: errors.append(str(error)))
                    async def route(request_route):
                        if urlparse(request_route.request.url).netloc == urlparse(base).netloc:
                            await request_route.continue_()
                        else:
                            blocked.append(request_route.request.url)
                            await request_route.abort()
                    await context.route('**/*', route)
                    result = {'name': name, 'viewport': width, 'status': 'failed'}
                    try:
                        await page.goto(base + '/index.html', wait_until='networkidle')
                        result.update(await run(page))
                        assert not errors, errors
                        assert not blocked, blocked
                        result['status'] = 'passed'
                    except Exception:
                        result['error'] = traceback.format_exc()
                        await capture(page, name + '-failure')
                        raise
                    finally:
                        result['pageErrors'], result['blockedNetwork'] = errors, blocked
                        try:
                            result['ledger'] = await snapshot(page)
                        except Exception as evidence_error:
                            result['ledgerUnavailable'] = str(evidence_error)
                        report['cases'].append(result)
                        (OUT / f'{name}-ledger.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
                        (OUT / 'results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
                        await context.close()
            finally:
                await browser.close()
    except Exception:
        report['failure'] = traceback.format_exc()
        raise
    finally:
        (OUT / 'results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        server.shutdown()
        server.server_close()
    print(json.dumps({'passed': len(report['cases']), 'artifacts': str(OUT)}, ensure_ascii=False))


if __name__ == '__main__':
    asyncio.run(main())
