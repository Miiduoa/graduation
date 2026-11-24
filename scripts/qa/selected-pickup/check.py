"""Chromium → real FoodWorkspace/Agent → real HTTP handler → synthetic database.

Only external identity/order/database boundaries are fixtures. Real request
validation, source guards, signed confirmations, receipts and local recovery run.
Never connects a real account, model, school service or payment system.
"""
import asyncio
import base64
import hashlib
import json
import os
import subprocess
import traceback
from pathlib import Path

from playwright.async_api import async_playwright, expect

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'artifacts/selected-pickup'
SECRET = 'synthetic-preview-only-never-a-real-secret'


def build_evidence():
    meta = json.loads((OUT / 'bundle-meta.json').read_text())
    sources = set()
    for bundle in meta.values():
        sources.update(name for name in bundle['inputs']
                       if not name.startswith(('fixture:', '<', '(disabled):')) and 'node_modules/' not in name)
    hashes = {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in sorted(sources)}
    built = json.loads((OUT / 'build-source-hashes.json').read_text())
    assert hashes == built, 'Source changed after the browser/server bundle; rebuild before verification'
    for required in ['FoodWorkspace.tsx', 'FoodOrders.tsx', 'FoodPickupAgent.tsx', 'NuniNextStep.tsx', 'foodPickupEvidence.ts',
                     'AssistantCards.tsx', 'assistantExecutionJournal.ts', 'assistantCalendarExecution.ts',
                     'assistantV2/handler.ts', 'assistantV2/actions.ts', 'assistantV2/foodPickup.ts',
                     'assistantV2/foodPickupRequest.ts']:
        assert any(name.endswith('/' + required) for name in hashes), f'Missing real implementation: {required}'
    return {'head': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
            'sourceSha256': hashes, 'sourceCount': len(hashes)}


async def snapshot(page):
    result = await page.request.get('/qa/snapshot')
    assert result.ok
    return await result.json()


def assistant_requests(state, action=None):
    return [row for row in state['requests'] if row['channel'] == 'assistant'
            and (action is None or row['action'] == action)]


async def local_rows(page):
    return await page.evaluate('''() => {
      const c=window.__pickupQA;
      const key='campus.personal-imports.v1:'+encodeURIComponent('platform:'+c.accountId)+':'+encodeURIComponent(c.schoolId);
      const value=localStorage.getItem(key); return value ? JSON.parse(value).records : [];
    }''')


async def ensure_no_write(page):
    state = await snapshot(page)
    assert state['writes'] == [], state
    assert not assistant_requests(state, 'confirm'), state
    assert await local_rows(page) == []
    assert state['modelCalls'] == 0 and state['externalFetches'] == [], state


async def open_preview(page, name, minutes='20'):
    await page.goto('/food?tenant=selected-realm')
    await expect(page.get_by_role('combobox', name='選擇訂單校園')).to_have_value('selected-realm')
    await page.get_by_role('button', name='查看訂單：selected-order', exact=True).click()
    detail = page.get_by_role('region', name='訂單詳情', exact=True)
    await expect(detail).to_be_visible()
    suggestion = detail.get_by_role('region', name='nuni 建議', exact=True)
    await expect(suggestion).to_be_visible()
    await expect(suggestion).to_contain_text('合成午餐店')
    await expect(suggestion).to_contain_text('12:00')
    await ensure_no_write(page)
    await suggestion.get_by_role('combobox', name='取餐預留時間').select_option(minutes)
    preview = suggestion.get_by_role('button', name='預覽這筆取餐安排', exact=True)
    await expect(preview).to_be_enabled()
    await suggestion.scroll_into_view_if_needed()
    await page.screenshot(path=str(OUT / f'{name}-suggestion.png'), full_page=True)
    await preview.click()
    card = detail.get_by_role('article', name='行程確認卡', exact=True)
    await expect(card).to_contain_text('取餐：合成午餐店')
    await expect(card).to_contain_text('12:00–12:' + minutes)
    await expect(card.get_by_role('button', name='確認', exact=True)).to_be_enabled()
    await ensure_no_write(page)
    state = await snapshot(page)
    requests = assistant_requests(state, 'pickup-plan')
    assert len(requests) == 2, requests
    assert requests[0]['response']['bootstrap'] is True, requests
    result = requests[1]['response']
    assert result['modelCalls'] == 0 and result['dataRead'] is True, result
    assert result['pickupTarget'] == {'tenantId': 'selected-realm', 'orderId': 'selected-order', 'durationMinutes': int(minutes)}, result
    signed = result['cards'][0]
    body = signed['token'].split('.')[0]
    proof = json.loads(base64.urlsafe_b64decode(body + '=' * (-len(body) % 4)))
    assert proof['pickupGuard']['tenantId'] == 'selected-realm'
    assert proof['pickupGuard']['orderId'] == 'selected-order'
    assert proof['pickupGuard']['durationMinutes'] == int(minutes)
    assert [row for row in state['operations'] if row['operation'] == 'order'] == [
        {'operation': 'order', 'tenantId': 'selected-realm', 'orderId': 'selected-order'}]
    await card.scroll_into_view_if_needed()
    assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Horizontal overflow'
    await page.screenshot(path=str(OUT / f'{name}-preview.png'), full_page=True)
    return card, signed


async def confirm_case(page, name):
    card, signed = await open_preview(page, name)
    await card.get_by_role('button', name='確認', exact=True).click()
    await expect(card).to_contain_text('已核對並加入個人行事曆')
    state = await snapshot(page)
    assert len(state['writes']) == 1, state
    assert len(assistant_requests(state, 'confirm')) == 1
    receipt = assistant_requests(state, 'confirm')[0]['response']
    assert receipt['status'] == 'verified' and receipt['replay'] is False
    assert receipt['mutationId'] == signed['mutationId'] and receipt['record']['title'] == signed['args']['title']
    assert receipt['record']['startTime'] == '12:00' and receipt['record']['endTime'] == '12:20'
    rows = await local_rows(page)
    assert len(rows) == 1 and rows[0]['id'] == signed['mutationId'], rows
    # Wait for this read-back, not a button that can still be enabled before
    # React commits its pending state on a busy CI runner.
    async with page.expect_response(lambda response: response.url.endswith('/api/nuni/assistant/reconcile')
                                    and response.request.method == 'POST') as received:
        await card.get_by_role('button', name='重新核對結果', exact=True).click()
    response = await received.value
    assert response.ok
    assert (await response.json())['status'] == 'verified'
    await expect(card.get_by_role('button', name='重新核對結果', exact=True)).to_be_enabled()
    state = await snapshot(page)
    assert len(state['writes']) == 1
    assert assistant_requests(state, 'reconcile')[-1]['response']['status'] == 'verified'
    assert state['modelCalls'] == 0 and state['externalFetches'] == []
    await page.screenshot(path=str(OUT / f'{name}-verified.png'), full_page=True)
    return state


async def recovery_case(page, name):
    card, signed = await open_preview(page, name, '30')
    response = await page.request.post('/qa/configure', data={'holdNextConfirmation': True})
    assert response.ok
    await card.get_by_role('button', name='確認', exact=True).click()
    # Stay below the product's 15-second confirmation deadline so the original
    # pending operation is recovered by reload, rather than timeout fallback.
    async with asyncio.timeout(10):
        while True:
            state = await snapshot(page)
            if state['held']:
                break
            await asyncio.sleep(0.05)
    assert state['held'] and len(state['writes']) == 1, state
    assert len(assistant_requests(state, 'confirm')) == 1
    journal = await page.evaluate('''() => Object.keys(sessionStorage)
      .filter(key=>key.startsWith('campus.assistant-execution.v1:')).map(key=>JSON.parse(sessionStorage.getItem(key)))''')
    assert len(journal) == 1 and len(journal[0]['entries']) == 1, journal
    assert journal[0]['entries'][0]['card']['mutationId'] == signed['mutationId']
    before = len(state['requests'])
    await page.reload()
    recovered = page.get_by_role('article', name='行程確認卡', exact=True)
    await expect(recovered).to_contain_text('已核對並加入個人行事曆')
    await expect(recovered).to_contain_text('12:00–12:30')
    state = await snapshot(page)
    following = state['requests'][before:]
    assert any(row.get('action') == 'reconcile' for row in following), following
    assert not any(row.get('action') in ['confirm', 'pickup-plan', 'ask'] for row in following), following
    assert len(state['writes']) == 1 and len(assistant_requests(state, 'confirm')) == 1, state
    rows = await local_rows(page)
    assert len(rows) == 1 and rows[0]['id'] == signed['mutationId'], rows
    assert state['modelCalls'] == 0 and state['externalFetches'] == []
    await page.screenshot(path=str(OUT / f'{name}-recovered.png'), full_page=True)
    return state


async def main():
    report = {'scope': 'Actual FoodWorkspace → actual HTTP handleV2 → synthetic account/order/database; no model or production data',
              'build': build_evidence(), 'cases': []}
    environment = {**os.environ, 'NODE_ENV': 'development', 'TZ': 'Asia/Taipei', 'BFF_SESSION_SECRET': SECRET,
                   'CAMPUS_BACKEND': 'nuni', 'CAMPUS_ASSISTANT_ENABLED': 'true',
                   'CAMPUS_ASSISTANT_V2_ENABLED': 'true', 'CAMPUS_ASSISTANT_V2_WRITES_ENABLED': 'true',
                   'GROQ_API_KEY': '', 'CAMPUS_ASSISTANT_V2_FALLBACK_ACCOUNT_ID': '',
                   'CAMPUS_ASSISTANT_V2_FALLBACK_API_TOKEN': '', 'FLY_MACHINE_ID': ''}
    log = open(OUT / 'server.log', 'w', encoding='utf-8')
    server = subprocess.Popen([os.environ.get('SELECTED_PICKUP_QA_NODE', 'node'), str(OUT / 'server.cjs'), str(OUT)],
                              cwd=ROOT, env=environment, stdout=subprocess.PIPE, stderr=log, text=True)
    try:
        startup = await asyncio.wait_for(asyncio.to_thread(server.stdout.readline), 15)
        ready = json.loads(startup)
        assert ready.get('ready') is True, startup
        base = ready['origin']
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(executable_path=os.environ.get('ASSISTANT_QA_CHROMIUM_EXECUTABLE'))
            report['browser'] = {'version': browser.version}
            try:
                for name, width, operation in [('selected-1440', 1440, confirm_case),
                                               ('selected-390', 390, confirm_case),
                                               ('reload-after-write-390', 390, recovery_case)]:
                    context = await browser.new_context(base_url=base, viewport={'width': width, 'height': 1000},
                                                        locale='zh-TW', timezone_id='Asia/Taipei')
                    context.set_default_timeout(15_000)
                    expect.set_options(timeout=15_000)
                    page = await context.new_page()
                    errors = []
                    page.on('pageerror', lambda error: errors.append(str(error)))
                    await context.route('**/*', lambda route: route.continue_() if route.request.url.startswith(base + '/') else route.abort())
                    reset = await page.request.post('/qa/reset', data={})
                    assert reset.ok
                    result = {'name': name, 'width': width}
                    try:
                        state = await operation(page, name)
                        assert not errors, errors
                        result.update({'passed': True, 'evidence': state})
                    except Exception:
                        result.update({'passed': False, 'error': traceback.format_exc(), 'pageErrors': errors,
                                       'evidence': await snapshot(page)})
                        await page.screenshot(path=str(OUT / f'{name}-failed.png'), full_page=True)
                    finally:
                        report['cases'].append(result)
                        await context.close()
                        (OUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
                        print(f"{name}: {'PASS' if result['passed'] else 'FAIL'}", flush=True)
            finally:
                await browser.close()
        failed = [case for case in report['cases'] if not case['passed']]
        if failed:
            raise AssertionError('\n'.join(case['error'] for case in failed))
        print(f"{len(report['cases'])}/{len(report['cases'])} browser cases passed", flush=True)
    finally:
        (OUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        server.terminate()
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()
        remaining = server.stdout.read()
        log.write(remaining)
        log.close()


if __name__ == '__main__':
    asyncio.run(main())
