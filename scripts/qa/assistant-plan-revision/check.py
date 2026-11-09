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


async def idle(page):
    await expect(page.get_by_role('log')).not_to_have_attribute('aria-busy', 'true')


async def start_plan(page, events=None):
    events = ORIGINAL if events is None else events
    await expect(page.get_by_role('checkbox')).to_be_enabled()
    await page.get_by_role('checkbox').check()
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
    await panel.screenshot(path=str(OUT / f'comparison-{name}-summary.png'))
    await capture(page, f'comparison-{name}-zero-writes')
    assert await snapshot(page) == ledger, 'Comparison rendering or reading caused another API call or write'
    assert await page.evaluate("localStorage.getItem('campus.personal-imports.v1:platform%3Aqa-agent:fixture-campus-a')") is None
    return {'mode': 'native UI with configured fixed comparison data; no model or backend',
            'fixtureOriginal': before, 'fixtureRevised': after, 'summaryText': await panel.inner_text(),
            'overflow': overflow, 'panelSize': panel_size, 'ledgerUnchangedWhileReading': True}


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
    await comparison(page).screenshot(path=str(OUT / f'native-{width}-comparison.png'))
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
    return {'mode': 'native UI with fixed fake API', 'keyboard': 'Enter opens editor; focus moves to textarea; Tab/Enter submits', 'overflow': overflow}


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


def build_evidence():
    meta = json.loads((OUT / 'bundle-meta.json').read_text())
    paths = [name for name in meta['inputs'] if not name.startswith(('fixture:', '<')) and 'node_modules/' not in name]
    hashes = {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in paths}
    for required in ['Assistant.tsx', 'AssistantCards.tsx', 'AssistantPlanRevision.tsx', 'AssistantPlanComparison.tsx', 'planComparison.ts', 'assistantExecutionJournal.ts', 'assistantCalendarExecution.ts']:
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
