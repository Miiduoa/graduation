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


async def start_plan(page):
    await expect(page.get_by_role('checkbox')).to_be_enabled()
    await page.get_by_role('checkbox').check()
    question = page.get_by_role('textbox', name='問題', exact=True)
    await question.fill('請幫我安排兩段讀書時間')
    await question.press('Enter')
    await expect(card_list(page)).to_have_count(2)
    await expect(card_list(page).nth(0)).to_contain_text('19:00–19:30')
    await expect(card_list(page).nth(1)).to_contain_text('20:00–20:30')
    await expect(card_list(page).nth(0).get_by_role('button', name='確認', exact=True)).to_be_enabled()
    await expect(card_list(page).nth(1).get_by_role('button', name='確認', exact=True)).to_be_disabled()
    await no_writes(page)


async def open_revision(page, keyboard=False):
    entry = page.get_by_role('button', name='修改時間或條件', exact=True).first
    if keyboard:
        await entry.focus()
        await page.keyboard.press('Enter')
    else:
        await entry.click()
    field = page.get_by_role('textbox', name='修改條件', exact=True)
    await expect(field).to_be_focused()
    await field.fill(CHANGE)
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
    for required in ['Assistant.tsx', 'AssistantCards.tsx', 'AssistantPlanRevision.tsx', 'assistantExecutionJournal.ts', 'assistantCalendarExecution.ts']:
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
                         ('controlled-double-preview', 1440, double_case)]
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
