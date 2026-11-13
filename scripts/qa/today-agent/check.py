"""Run build.mjs first. Requires the existing Python Playwright + Chromium."""
import asyncio
import functools
import http.server
import json
import os
import re
import shutil
import threading
from pathlib import Path

from playwright.async_api import async_playwright, expect

OUTPUT = Path(__file__).resolve().parents[3] / 'artifacts' / 'today-agent'
TASK = {'workspaceId': 'course-a', 'taskId': 'task-urgent', 'kind': 'assignment'}
MUTATION = 'qa-home-calendar-001'
ORIGINAL_CONTEXT = 'a' * 43
CALENDAR_HREF = '/calendar?schoolId=fixture-campus-a&eventId=' + MUTATION
TASK_HREF = '/classroom/course/course-a#assignment-task-urgent'


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


async def geometry(page):
    return await page.evaluate('''() => {
      const visible = node => { const r=node.getBoundingClientRect();return r.width>0 && r.height>0; };
      const buttons = [...document.querySelectorAll('button')].filter(visible).map(node => {
        const r=node.getBoundingClientRect();
        return {label:node.getAttribute('aria-label')||node.textContent.trim(),width:r.width,height:r.height};
      });
      const overflow = [...document.querySelectorAll('main,section,article,button,a,li')].filter(visible)
        .map(node=>({tag:node.tagName,text:node.textContent.trim().slice(0,60),left:node.getBoundingClientRect().left,right:node.getBoundingClientRect().right}))
        .filter(r=>r.left < -1 || r.right > innerWidth + 1);
      return {viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,buttons,overflow,
        smallButtons:buttons.filter(button=>button.width < 44 || button.height < 44)};
    }''')


async def snapshot(page):
    return await page.evaluate('window.__todayAgentQA.snapshot()')


def actions(value, include_reads=True):
    return [row['action'] for row in value['requests']
            if include_reads or row['action'] != 'followup']


def assert_targets(value):
    """Assert the exact task and original proposal, not just visible status text."""
    expected_event = {
        'title': '準備作業：資料結構作業', 'date': '2026-11-13',
        'allDay': False, 'startTime': '14:00', 'endTime': '14:30',
    }
    for row in value['requests']:
        body = row['body']
        assert row['accountId'] == 'qa-agent', row
        assert body['schoolId'] == 'fixture-campus-a', row
        assert 'question' not in body and 'history' not in body, row
        if row['action'] == 'plan':
            assert body['task'] == TASK, row
        else:
            assert body['conversationId'] == 'qa-home-conversation', row
            assert body['token'] == 'qa-signed-home-calendar-001', row
            assert body['args'] == expected_event, row
        if row['action'] == 'followup':
            assert body['issuedContext'] == ORIGINAL_CONTEXT, row
            assert set(body) == {'schoolId', 'conversationId', 'issuedContext', 'token', 'args'}, row
            if 'followup' in row:
                result = row['followup']
                assert result['version'] == 1 and result['operation'] == 'coursework.followup', row
                assert result['schoolId'] == 'fixture-campus-a' and result['mutationId'] == MUTATION, row
                assert result['task'] == TASK and result['event'] == expected_event, row
    assert not value['violations'], value['violations']


def assert_verified(value, mode):
    expected = ['plan', 'plan', 'confirm']
    if mode == 'lost-response':
        expected.append('reconcile')
    assert actions(value, include_reads=False) == expected, value
    assert len(value['writes']) == len(value['records']) == len(value['imports']) == 1, value
    assert value['imports'] == value['records'] == value['writes'], value
    assert value['records'][0]['id'] == MUTATION and value['records'][0]['source']['rawText'] == '', value
    assert not value['journal'] and value['readbacks'] == 1, value
    assert len(value['journalAtConfirm']) == 1, value
    assert value['journalAtConfirm'][0]['card']['mutationId'] == MUTATION, value
    assert len(value['proofs']) == 1 and value['proofs'] == value['primaryProofs'], value
    proof = value['proofs'][0]
    assert proof['issuedContext'] == ORIGINAL_CONTEXT, proof
    assert proof['conversationId'] == 'qa-home-conversation', proof
    assert proof['card']['mutationId'] == MUTATION, proof
    assert value['journalRemovals'], 'The real sessionStorage journal removal was not observed'
    for removal in value['journalRemovals']:
        assert removal['proofs'] == value['proofs'], removal
    assert not value['otherSchoolProofs'], value
    assert_targets(value)


def assert_read_only(before, after, mode='normal'):
    assert actions(after, include_reads=False) == actions(before, include_reads=False), after
    assert after['writes'] == before['writes'] and after['records'] == before['records'], after
    assert after['proofs'] == before['proofs'], after
    assert_verified(after, mode)


def tracked(page):
    return page.get_by_role('group', name=re.compile('的安排追蹤$'))


async def wait_for_followups(page, count):
    await page.wait_for_function(
        "(count) => window.__todayAgentQA.snapshot().requests.filter(r => r.action === 'followup').length === count",
        arg=count)
    await expect(page.get_by_role('button', name='更新安排狀態', exact=True)).to_be_enabled()


async def assert_tracking_links(page):
    group = tracked(page)
    await expect(group).to_have_count(1)
    await expect(group.get_by_role('link', name=re.compile('的行程$'))).to_have_attribute('href', CALENDAR_HREF)
    await expect(group.get_by_role('link', name=re.compile('的作業$'))).to_have_attribute('href', TASK_HREF)


async def track_lifecycle(page, result, label, baseline):
    result['tracking'] = []

    async def capture(phase):
        current = await snapshot(page)
        assert_read_only(baseline, current)
        await assert_tracking_links(page)
        result['tracking'].append({'phase': phase, 'snapshot': current})
        result['geometry'].append(await geometry(page))
        await page.screenshot(path=str(OUTPUT / f'{label}-{phase}.png'), full_page=True)
        return current

    # Leave only the already arranged task and remove the auto-preview cooldown.
    # A remount must be suppressed by the persisted proof, not by the cooldown.
    await page.evaluate("window.__todayAgentQA.setTasks('urgent')")
    await page.evaluate('window.__todayAgentQA.remount()')
    await wait_for_followups(page, 2)
    await expect(tracked(page)).to_contain_text('已安排')
    await expect(page.get_by_role('button', name='替「資料結構作業」找 30 分鐘準備時間')).to_have_count(0)
    await expect(page.get_by_role('button', name='確認', exact=True)).to_have_count(0)
    remounted = await capture('persisted-remount')
    assert remounted['generation'] == baseline['generation'] + 1, remounted

    # Reload the document, keeping real localStorage and the synthetic server's
    # separate ledger/counters. No fresh plan or confirmation may be dispatched.
    await page.evaluate('window.__todayAgentQA.clearAutomaticCooldown()')
    await page.reload(wait_until='networkidle')
    await wait_for_followups(page, 3)
    reloaded = await capture('persisted-reload')
    assert reloaded['loads'] == baseline['loads'] + 1, reloaded

    # A fresh login reads with its CURRENT session header and the ORIGINAL proof
    # context in the body; it must not turn the old proof into a new write.
    await page.evaluate('window.__todayAgentQA.relogin()')
    await wait_for_followups(page, 4)
    relogged = await capture('same-account-new-session')
    assert relogged['requests'][-1]['session'] == 'b' * 43, relogged
    assert relogged['requests'][-1]['body']['issuedContext'] == ORIGINAL_CONTEXT, relogged

    for count, status, message in [
        (5, 'source_changed', '作業內容或期限有變更'),
        (6, 'submitted', '作業已繳交'),
        (7, 'conflict', '準備時間與最新安排重疊'),
        (8, 'in_progress', '準備時間進行中'),
        (9, 'elapsed', '準備時間已結束'),
    ]:
        await page.evaluate('(status) => window.__todayAgentQA.setFollowupStatus(status)', status)
        await page.get_by_role('button', name='更新安排狀態', exact=True).click()
        await wait_for_followups(page, count)
        await expect(tracked(page)).to_contain_text(message)
        current = await capture(status)
        fresh = current['requests'][-1]['followup']
        assert fresh['status'] == status and fresh['calendar'] == 'matching', fresh
        assert fresh['source']['submitted'] == (status == 'submitted'), fresh
        if status == 'source_changed':
            assert fresh['source']['dueAt'] == '2026-11-13T13:45:00+08:00', fresh
            await expect(tracked(page)).to_contain_text('13:45')
        if status == 'in_progress':
            assert fresh['checkedAt'] == '2026-11-13T06:15:00.000Z', fresh
        if status == 'elapsed':
            assert fresh['checkedAt'] == '2026-11-13T07:00:00.000Z', fresh
            await expect(tracked(page)).to_contain_text('作業仍待繳交')
            await expect(page.get_by_text('作業已繳交', exact=True)).to_have_count(0)

    # A failed fresh read retains the proof/event, stops new planning, and cannot
    # continue displaying an earlier completion or conflict as a fresh success.
    await page.evaluate('window.__todayAgentQA.setFollowupFailure(true)')
    await page.get_by_role('button', name='更新安排狀態', exact=True).click()
    await wait_for_followups(page, 10)
    await expect(tracked(page)).to_contain_text('最新狀態尚未確認')
    await expect(page.get_by_role('alert')).to_contain_text('原紀錄仍保留')
    await page.evaluate("window.__todayAgentQA.setTasks('all')")
    await expect(page.get_by_role('button', name='替「英文測驗」找 30 分鐘準備時間')).to_be_disabled()
    unavailable = await capture('read-failure-retained')
    assert unavailable['requests'][-1]['outcome'] == 'synthetic-read-failed', unavailable
    assert 'followup' not in unavailable['requests'][-1], unavailable

    await page.evaluate("window.__todayAgentQA.setTasks('urgent')")
    await page.evaluate('window.__todayAgentQA.setFollowupFailure(false)')
    await page.get_by_role('button', name='更新安排狀態', exact=True).click()
    await wait_for_followups(page, 11)
    await expect(tracked(page)).to_contain_text('作業仍待繳交')
    await expect(page.get_by_role('alert')).to_have_count(0)
    await capture('read-recovered')

    # Foreground bursts inside the existing 60-second window are read-throttled.
    await page.evaluate("""() => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    }""")
    await page.evaluate('() => new Promise(resolve => requestAnimationFrame(() => resolve(true)))')
    throttled = await snapshot(page)
    assert len([r for r in throttled['requests'] if r['action'] == 'followup']) == 11, throttled
    assert_read_only(baseline, throttled)
    result['foregroundThrottle'] = {'followupRequests': 11, 'additionalWrites': 0}


async def track_account_scope(page, result, label, baseline):
    await page.evaluate('window.__todayAgentQA.switchAccount()')
    await expect(page.get_by_text('目前讀到的 nuni 課程沒有待安排的作業或測驗。', exact=True)).to_be_visible()
    await expect(tracked(page)).to_have_count(0)
    await expect(page.get_by_text('資料結構作業', exact=True)).to_have_count(0)
    other = await snapshot(page)
    assert other['activeAccount'] == 'qa-agent-other' and other['activeContext'] == 'c' * 43, other
    assert not other['proofs'] and not other['imports'] and not other['journal'], other
    assert other['primaryProofs'] == baseline['proofs'], other
    assert other['requests'] == baseline['requests'] and other['writes'] == baseline['writes'], other
    assert not other['otherSchoolProofs'] and not other['violations'], other
    result['otherAccount'] = other
    result['geometry'].append(await geometry(page))
    await page.screenshot(path=str(OUTPUT / f'{label}-other-account.png'), full_page=True)

    await page.evaluate('window.__todayAgentQA.returnAccount()')
    await wait_for_followups(page, 2)
    await expect(tracked(page)).to_contain_text('已安排')
    await assert_tracking_links(page)
    returned = await snapshot(page)
    assert_read_only(baseline, returned)
    assert returned['requests'][-1]['session'] == 'd' * 43, returned
    assert returned['requests'][-1]['body']['issuedContext'] == ORIGINAL_CONTEXT, returned
    assert not any(row['accountId'] == 'qa-agent-other' for row in returned['requests']), returned
    result['returnedAccount'] = returned
    result['geometry'].append(await geometry(page))
    await page.screenshot(path=str(OUTPUT / f'{label}-returned-account.png'), full_page=True)


async def scenario(browser, port, width, mode, theme, flow='baseline'):
    label = f'{width}-{mode if flow == "baseline" else flow}-{theme}'
    origin = f'http://127.0.0.1:{port}/'
    page = await browser.new_page(viewport={'width': width, 'height': 844},
                                  device_scale_factor=1, timezone_id='Asia/Taipei')
    page.set_default_timeout(10_000)
    errors, external, failures = [], [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('requestfailed', lambda request: failures.append({'url': request.url, 'failure': request.failure}))

    async def local_only(route):
        if route.request.url.startswith(origin):
            await route.continue_()
        else:
            external.append(route.request.url)
            await route.abort()

    await page.route('**/*', local_only)
    result = {'scenario': label, 'fixture': True, 'pageErrors': errors,
              'externalRequests': external, 'requestFailures': failures, 'geometry': []}
    try:
        await page.goto(f'{origin}?mode={mode}&theme={theme}', wait_until='networkidle')
        confirm = page.get_by_role('button', name='確認', exact=True)
        await expect(confirm).to_be_enabled()
        await expect(page.get_by_role('heading', name='替待辦安排時間')).to_be_visible()
        await expect(page.get_by_role('article', name='行程確認卡')).to_contain_text('14:00–14:30')
        before = await snapshot(page)
        assert [row['action'] for row in before['requests']] == ['plan', 'plan'], before
        assert not before['writes'] and not before['imports'] and not before['journal'] and not before['proofs'], before
        assert before['nativeLocks'] and not before['violations'], before
        assert await page.get_by_role('textbox').count() == 0
        result['before'] = before
        result['geometry'].append(await geometry(page))
        await page.screenshot(path=str(OUTPUT / f'{label}-preview.png'), full_page=True)

        if mode == 'normal':
            # Reach the real button through tab order instead of calling focus().
            visited = []
            for _ in range(12):
                await page.keyboard.press('Tab')
                visited.append(await page.evaluate('document.activeElement.textContent.trim()'))
                if await confirm.evaluate('(node) => document.activeElement === node'):
                    break
            await expect(confirm).to_be_focused()
            result['keyboard'] = {'tabOrder': visited, 'activatedBy': 'Enter'}
            await page.screenshot(path=str(OUTPUT / f'{label}-keyboard.png'), full_page=True)
            await page.keyboard.press('Enter')
        else:
            await confirm.click()
        await wait_for_followups(page, 1)
        await expect(tracked(page)).to_contain_text('已安排')
        await assert_tracking_links(page)
        await expect(page.get_by_text('已儲存並核對的 1 筆安排，最新狀態已列入追蹤。', exact=True)).to_be_visible()
        after = await snapshot(page)
        expected = ['plan', 'plan', 'confirm'] + (['reconcile'] if mode == 'lost-response' else []) + ['followup']
        assert [row['action'] for row in after['requests']] == expected, after
        assert_verified(after, mode)
        assert after['requests'][-1]['followup']['status'] == 'scheduled', after
        assert after['requests'][-1]['followup']['checkedAt'] == '2026-11-13T05:00:00.000Z', after
        if mode == 'lost-response':
            assert after['requests'][2]['body'] == after['requests'][3]['body'], after
            assert after['requests'][2]['outcome'] == 'committed-response-lost', after
        result['after'] = after
        result['geometry'].append(await geometry(page))
        await page.screenshot(path=str(OUTPUT / f'{label}-verified.png'), full_page=True)
        if flow == 'tracking-lifecycle':
            await track_lifecycle(page, result, label, after)
        elif flow == 'tracking-account-scope':
            await track_account_scope(page, result, label, after)
        for measured in result['geometry']:
            assert measured['documentWidth'] <= width, measured
            assert not measured['smallButtons'], measured['smallButtons']
            assert not measured['overflow'], measured['overflow']
        assert not errors and not external and not failures, result
        result['status'] = 'passed'
    except Exception as error:
        result.update(status='failed', error=str(error))
        await page.screenshot(path=str(OUTPUT / f'{label}-failed.png'), full_page=True)
    finally:
        await page.close()
    return result


async def main():
    if not (OUTPUT / 'index.html').exists():
        raise SystemExit('Run node scripts/qa/today-agent/build.mjs first.')
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0),
        functools.partial(QuietHandler, directory=str(OUTPUT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    results = []
    try:
        async with async_playwright() as playwright:
            installed = playwright.chromium.executable_path
            browser = await playwright.chromium.launch(headless=True,
                executable_path=os.environ.get('QA_CHROMIUM_EXECUTABLE') or
                    (installed if Path(installed).is_file() else shutil.which('chromium')))
            for width, mode, theme in [(390, 'normal', 'light'), (1280, 'normal', 'light'),
                                        (390, 'lost-response', 'dark'), (1280, 'lost-response', 'dark')]:
                results.append(await scenario(browser, server.server_address[1], width, mode, theme))
            results.append(await scenario(browser, server.server_address[1], 390, 'normal', 'light', 'tracking-lifecycle'))
            results.append(await scenario(browser, server.server_address[1], 390, 'normal', 'dark', 'tracking-account-scope'))
            await browser.close()
    except Exception as error:
        results.append({'scenario': 'browser-runtime', 'status': 'blocked', 'fixture': True, 'error': str(error)})
    finally:
        server.shutdown()
        server.server_close()
        (OUTPUT / 'browser-check.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
    print(json.dumps([{'scenario': row['scenario'], 'status': row['status'],
        **({'error': row['error']} if 'error' in row else {})} for row in results], ensure_ascii=False, indent=2))
    if not results or any(row['status'] != 'passed' for row in results):
        raise SystemExit(1)


asyncio.run(main())
