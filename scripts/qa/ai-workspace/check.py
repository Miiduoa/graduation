"""Actual Web workspace UI with synthetic, network-isolated identity and replies."""
import asyncio
import functools
import hashlib
import http.server
import json
import os
import re
import threading
import time
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlparse

from playwright.async_api import async_playwright, expect

ROOT = Path(__file__).resolve().parents[3]
OUTPUT = ROOT / 'artifacts' / 'ai-workspace'
SCENARIOS = [
    {'name': 'desktop-light', 'width': 1440, 'height': 1000, 'theme': 'light'},
    {'name': 'phone-light', 'width': 390, 'height': 844, 'theme': 'light'},
    {'name': 'small-dark', 'width': 320, 'height': 740, 'theme': 'dark'},
    {'name': 'small-large-text', 'width': 320, 'height': 740, 'theme': 'light', 'text': '200'},
    {'name': 'phone-reduced-motion', 'width': 390, 'height': 844, 'theme': 'dark', 'motion': 'reduce'},
    {'name': 'phone-app-reduced-motion', 'width': 390, 'height': 844, 'theme': 'light', 'appMotion': 'reduce'},
    {'name': 'coursework-desktop', 'width': 1440, 'height': 1000, 'theme': 'light', 'coursework': 'normal'},
    {'name': 'coursework-phone-read-retry', 'width': 390, 'height': 844, 'theme': 'dark', 'coursework': 'read-failure'},
]


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_GET(self):
        if not Path(urlparse(self.path).path).suffix:
            self.path = '/index.html'
        super().do_GET()


def validate_sources():
    evidence = json.loads((OUTPUT / 'source-sha256.json').read_text())
    changed = [item['path'] for item in evidence['files']
               if hashlib.sha256((ROOT / item['path']).read_bytes()).hexdigest() != item['sha256']]
    assert not changed, f'Rebuild fixture after source changes: {changed}'
    for runtime in evidence['runtime']:
        manifest = (ROOT / runtime['manifestPath']).read_bytes()
        assert hashlib.sha256(manifest).hexdigest() == runtime['manifestSha256'], runtime
        assert json.loads(manifest)['version'] == runtime['expected'], runtime
    for product in ('AssistantWorkspaceProvider.tsx', 'AppHeader.tsx', 'TodayCampusEntry.tsx',
                    'StudentToday.tsx', 'Assistant.tsx', 'AssistantThread.tsx',
                    'QuickCampusEntry.tsx', 'AssistantWorkspace.module.css',
                    'TodayAgent.tsx', 'TodayAgentPanel.tsx', 'assistantCourseworkTracking.ts',
                    'todayAgentFollowups.ts', 'assistantExecutionJournal.ts', 'assistantCalendarExecution.ts'):
        assert any(item['path'].endswith('/' + product) for item in evidence['files']), product
    required_contracts = {
        'apps/web/src/features/nuni/assistant/types.ts',
        'apps/web/src/lib/nuni/assistantV2/actions.ts',
        'apps/web/src/lib/nuni/assistantV2/contracts.ts',
        '.github/workflows/ai-workspace-browser.yml',
    }
    assert set(evidence['contractSources']) == required_contracts, evidence['contractSources']
    assert required_contracts | {'apps/web/src/features/nuni/assistant/execution.ts'} <= {
        item['path'] for item in evidence['files']}, 'Missing execution or contract source fingerprint'
    return evidence


async def inspect_layout(page, report, stage):
    geometry = await page.locator('[data-product="ai-workspace"]').evaluate('''root => {
      const visible=node=>node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden';
      const panel=document.getElementById('campus-assistant-workspace');
      const p=panel&&visible(panel)?panel.getBoundingClientRect():null;
      const composer=root.querySelector('form[aria-label="開始校園任務"]');
      const motionStyle=node=>{
        if(!node||!visible(node))return null;
        const s=getComputedStyle(node);
        return {animationName:s.animationName,animationDuration:s.animationDuration,
          transitionProperty:s.transitionProperty,transitionDuration:s.transitionDuration};
      };
      const animations=[...root.querySelectorAll('*')].filter(visible).flatMap(node=>{
        const s=getComputedStyle(node);
        const seconds=Math.max(...s.animationDuration.split(',').map(v=>parseFloat(v)*(v.trim().endsWith('ms')?.001:1)));
        return s.animationName!=='none'&&seconds>.01?[{name:s.animationName,seconds}]:[];
      });
      return {width:innerWidth,pageWidth:document.documentElement.scrollWidth,
        panel:p?{left:p.left,right:p.right,top:p.top,bottom:p.bottom}:null,
        rootFontSize:getComputedStyle(document.documentElement).fontSize,animations,
        osReducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches,
        appReducedMotion:document.documentElement.dataset.reducedMotion==='true',
        panelMotion:motionStyle(panel),composerMotion:motionStyle(composer)};
    }''')
    assert geometry['pageWidth'] <= geometry['width'] + 1, (stage, geometry)
    if geometry['panel']:
        assert geometry['panel']['left'] >= -1 and geometry['panel']['right'] <= geometry['width'] + 1, geometry
    if report['config'].get('text') == '200':
        assert geometry['rootFontSize'] == '32px', geometry
    os_reduced = report['config'].get('motion') == 'reduce'
    app_reduced = report['config'].get('appMotion') == 'reduce'
    assert geometry['osReducedMotion'] is os_reduced, geometry
    assert geometry['appReducedMotion'] is app_reduced, geometry
    if os_reduced or app_reduced:
        assert not geometry['animations'], geometry
        # Assert the two product surfaces independently: the panel has an
        # entrance animation; the home composer has focus transitions.
        for surface in ('panelMotion', 'composerMotion'):
            motion = geometry[surface]
            if motion:
                assert motion['animationName'] == 'none', (surface, motion)
                # App/global CSS caps durations at 0.01ms with !important,
                # even when this surface's animation/transition is none.
                assert all(float(duration.strip().removesuffix('s')) <= 0.00001
                           for duration in motion['transitionDuration'].split(',')), (surface, motion)
        if geometry['composerMotion']:
            assert geometry['composerMotion']['transitionProperty'] == 'none', geometry
    name = report['config']['name'] + '-' + stage + '.png'
    await page.screenshot(path=str(OUTPUT / name), full_page=True)
    report['screenshots'].append(name)
    report['geometry'].append({'stage': stage, **geometry})


async def check_coursework(page, report):
    home = page.get_by_role('region', name='首頁安排工作', exact=True)
    await expect(home.get_by_role('button', name='確認', exact=True)).to_be_visible()
    await expect(home.get_by_role('list', name='代辦步驟', exact=True)).to_be_visible()
    # The initial Today proposal is real and remains unconfirmed. The chat's
    # different signed proposal must become the only durable arrangement.
    await page.evaluate('''() => {
      window.__courseworkMountedHome = document.querySelector('[data-coursework-home]').firstElementChild;
      window.__courseworkTimeOrigin = performance.timeOrigin;
    }''')
    report['courseworkStages'] = []

    async def snapshot(stage):
        value = await page.evaluate('window.__aiWorkspaceQA.snapshot()')
        report['courseworkStages'].append({'stage': stage, 'snapshot': value})
        return value

    def actions(value):
        return [row['path'].rsplit('/', 1)[-1] for row in value['requests']]

    before = await snapshot('mounted-home-preview')
    assert actions(before).count('plan') == 2, before
    assert not before['coursework']['writes'] and not before['coursework']['proofs'], before
    assert not before['coursework']['journal'] and before['coursework']['nativeLocks'], before
    report['checks'].append('Actual Today is already mounted with an unsent preview and native Web Locks')

    await page.get_by_role('textbox', name='想完成的事', exact=True).fill('幫我規劃資料模型的準備時間')
    await page.get_by_role('button', name='開啟任務', exact=True).click()
    panel = page.get_by_role('region', name='校園助理', exact=True)
    await expect(panel.get_by_role('textbox', name='問題', exact=True)).to_have_value('幫我規劃資料模型的準備時間')
    unconsented = await snapshot('draft-before-consent')
    assert actions(unconsented).count('ask') == 0 and not unconsented['coursework']['writes'], unconsented
    await panel.get_by_role('checkbox').check()
    await panel.get_by_role('button', name='送出', exact=True).click()
    confirm = panel.get_by_role('button', name='確認', exact=True)
    await expect(confirm).to_be_visible()
    preview = await snapshot('chat-preview')
    assert actions(preview).count('ask') == 2 and actions(preview).count('confirm') == 0, preview
    assert not preview['coursework']['writes'] and not preview['coursework']['proofs'], preview
    report['checks'].append('Home draft and explicit consent reach the actual chat; previews do not write records or tracking proofs')
    await confirm.click()

    failed = report['config']['coursework'] == 'read-failure'
    if failed:
        await expect(panel.get_by_text(re.compile('行程已核對，但安排追蹤尚未接續'))).to_be_visible()
        stalled = await snapshot('classification-read-failed')
        proof = stalled['coursework']
        assert len(proof['writes']) == len(proof['records']) == len(proof['imports']) == 1, stalled
        assert len(proof['journal']) == 1 and not proof['proofs'] and not proof['journalRemovals'], stalled
        assert actions(stalled).count('confirm') == 1 and actions(stalled).count('followup') == 1, stalled
        await expect(confirm).to_have_count(0)
        await inspect_layout(page, report, 'tracking-read-failed')
        report['checks'].append('A failed tracking read retains the verified event and recovery journal without claiming completion or offering confirmation again')
        await page.evaluate('window.__aiWorkspaceQA.setFollowupFailure(false)')
        await panel.get_by_role('button', name='重新核對結果', exact=True).click()

    tracked = home.get_by_role('group', name='「合成資料模型作業」的安排追蹤', exact=True)
    await expect(tracked).to_contain_text('已安排')
    expected_reads = 3 if failed else 2
    await page.wait_for_function('''expected => {
      const value = window.__aiWorkspaceQA.snapshot();
      return value.coursework.journal.length === 0 && value.coursework.proofs.length === 1 &&
        value.requests.filter(row => row.path.endsWith('/followup')).length >= expected;
    }''', arg=expected_reads)
    verified = await snapshot('chat-to-mounted-today')
    data = verified['coursework']
    assert actions(verified).count('confirm') == 1 and actions(verified).count('plan') == 2, verified
    assert actions(verified).count('ask') == 2 and actions(verified).count('followup') == expected_reads, verified
    assert actions(verified).count('reconcile') == int(failed), verified
    assert len(data['writes']) == len(data['records']) == len(data['imports']) == len(data['proofs']) == 1, verified
    assert data['writes'][0] == data['records'][0], verified
    assert data['records'][0]['id'] == data['imports'][0]['id'] == 'qa-chat-coursework-001', verified
    assert data['readbacks'] == 1 + int(failed) and not data['journal'], verified
    await expect(panel.get_by_text(re.compile('行程已核對，但安排追蹤尚未接續'))).to_have_count(0)
    assert not data['otherAccountProofs'] and not data['otherSchoolProofs'], verified
    proof = data['proofs'][0]
    assert proof['issuedContext'] == 'a' * 43 and proof['conversationId'] == 'qa-chat-coursework-conversation', proof
    assert proof['card']['mutationId'] == 'qa-chat-coursework-001', proof
    assert len(data['journalAtConfirm']) == 1 and data['journalAtConfirm'][0]['card']['coursework'] is True, data
    assert data['journalRemovals'] and all(row['proofs'] == data['proofs'] for row in data['journalRemovals']), data
    reads = [row for row in verified['requests'] if row['path'].endswith('/followup')]
    assert [row['proofPhase'] for row in reads] == (['journal', 'journal', 'durable'] if failed else ['journal', 'durable']), reads
    assert all(row['body']['issuedContext'] == 'a' * 43 and
               row['body']['token'] == proof['card']['token'] and
               row['body']['args'] == proof['card']['args'] and
               row['body']['conversationId'] == proof['conversationId'] for row in reads), reads
    assert await page.evaluate('''() => window.__courseworkMountedHome.isConnected &&
      document.querySelector('[data-coursework-home]').firstElementChild === window.__courseworkMountedHome &&
      performance.timeOrigin === window.__courseworkTimeOrigin'''), 'Today was remounted or the document reloaded'
    await expect(home.get_by_role('button', name='確認', exact=True)).to_have_count(0)
    await expect(home.get_by_role('button', name='替「合成資料模型作業」找 30 分鐘準備時間', exact=True)).to_have_count(0)
    await expect(home.get_by_role('list', name='代辦步驟', exact=True)).to_have_count(0)
    report['checks'].append('One explicit chat confirmation produces one verified record; a durable scoped proof precedes journal removal')
    report['checks'].append('The already mounted Today reads the same signed proof immediately and retires its unsent duplicate preview without reload')
    if failed:
        report['checks'].append('Chat recovery issues reconcile and followup reads only, with no second ask, plan or confirmation')

    await panel.get_by_role('button', name='收合', exact=True).click()
    await expect(panel).not_to_be_visible()
    await tracked.scroll_into_view_if_needed()
    await expect(tracked.get_by_role('link', name='查看「合成資料模型作業」的作業', exact=True)).to_have_attribute(
        'href', '/classroom/course/qa-course#assignment-qa-work')
    await expect(tracked.get_by_role('link', name='查看「合成資料模型作業」的行程', exact=True)).to_have_attribute(
        'href', '/calendar?schoolId=pu&eventId=qa-chat-coursework-001')
    await inspect_layout(page, report, 'today-tracking')
    report['checks'].append('Minimizing exposes the actual Today tracking card with source-bound coursework and calendar links')

    if failed:
        await page.evaluate('window.__aiWorkspaceQA.setFollowupFailure(true)')
        await home.get_by_role('button', name='更新安排狀態', exact=True).click()
        await expect(home.get_by_role('alert')).to_contain_text('原紀錄仍保留')
        await expect(home.get_by_role('button', name='重新確認資料', exact=True)).to_be_enabled()
        unavailable = await snapshot('today-read-failed')
        assert unavailable['coursework']['proofs'] == data['proofs'], unavailable
        await page.evaluate('window.__aiWorkspaceQA.setFollowupFailure(false)')
        await home.get_by_role('button', name='重新確認資料', exact=True).click()
        await expect(tracked).to_contain_text('已安排')
        await expect(home.get_by_role('alert')).to_have_count(0)
        retried = await snapshot('today-read-only-retry')
        assert [row for row in retried['requests'] if not row['path'].endswith('/followup')] == [
            row for row in verified['requests'] if not row['path'].endswith('/followup')], retried
        for key in ('records', 'writes', 'imports', 'proofs', 'journal', 'readbacks'):
            assert retried['coursework'][key] == data[key], (key, retried)
        assert actions(retried).count('followup') == expected_reads + 2, retried
        await inspect_layout(page, report, 'today-read-recovered')
        report['checks'].append('Today retry re-reads the original proof after failure while records, imports, proof and mutation counts remain unchanged')


async def check_explore_return(page, report):
    # Start at the real Explore component, with the existing guest/NTU scope.
    # Fixture navigation is setup, not a user step; the service itself remains
    # synthetic. Measure the same three explicit actions on both viewports.
    await page.evaluate("window.__aiWorkspaceQA.navigate('/explore?school=NTU&schoolId=ntu&campus=ntu')")
    search = page.get_by_role('searchbox', name='尋找想做的事', exact=True)
    await expect(search).to_be_visible()
    before = await page.evaluate('window.__aiWorkspaceQA.snapshot()')
    journey = {'id': 'guest-explore-map-return', 'measurement': 'fixture automation, not human task time',
               'steps': [], 'completed': False}
    report.setdefault('journeys', []).append(journey)
    started = time.perf_counter()

    await search.fill('地圖')
    card = page.locator('[data-experience-return="campus-map"]')
    await expect(card).to_be_visible()
    await expect(page.get_by_role('status').filter(has_text='1 個可以開始的起點')).to_be_visible()
    journey['steps'].append('filter experiences')

    await card.click()
    await expect(page.get_by_role('region', name='合成目的地頁面')).to_be_visible()
    await expect(page.get_by_test_id('fixture-route')).to_have_text('/map')
    destination = urlparse(page.url)
    assert dict(parse_qsl(destination.query)).get('schoolId') == 'ntu', destination
    journey['steps'].append('open public map')

    await page.get_by_role('link', name='返回探索', exact=True).click()
    await expect(search).to_have_value('地圖')
    await expect(card).to_be_focused()
    returned = urlparse(page.url)
    params = dict(parse_qsl(returned.query))
    assert returned.path == '/explore' and params.get('schoolId') == 'ntu' and params.get('q') == '地圖', returned
    journey['steps'].append('return to filtered card')
    after = await page.evaluate('window.__aiWorkspaceQA.snapshot()')
    assert after['requests'] == before['requests'], 'Public discovery must not send a model request'
    journey.update({'completed': True, 'stepCount': len(journey['steps']),
                    'elapsedMs': round((time.perf_counter() - started) * 1000, 1)})
    report['checks'].append('Guest Explore opens the public map and returns to the same filtered card, campus and keyboard focus without a model request')


async def run_scenario(browser, origin, config):
    report = {'config': config, 'status': 'running', 'checks': [], 'screenshots': [], 'geometry': []}
    context = await browser.new_context(viewport={'width': config['width'], 'height': config['height']},
                                        color_scheme=config['theme'], reduced_motion=config.get('motion', 'no-preference'))
    page = await context.new_page()
    errors, console_messages, external, unexpected_assets = [], [], [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('console', lambda message: console_messages.append({'type': message.type, 'text': message.text})
            if message.type in ('error', 'warning') else None)

    async def isolate(route):
        url = urlparse(route.request.url)
        if url.scheme not in ('http', 'https'):
            return await route.continue_()
        if not route.request.url.startswith(origin + '/'):
            external.append(route.request.url)
            return await route.abort()
        if url.path not in ('/', '/index.html', '/fixture.js', '/fixture.css', '/icons/mark.svg'):
            unexpected_assets.append(url.path)
            return await route.abort()
        await route.continue_()

    await context.route('**/*', isolate)
    try:
        query = urlencode({key: config[key] for key in ('theme', 'text', 'motion', 'appMotion', 'coursework') if key in config})
        await page.goto(origin + '/?' + query)
        if config.get('coursework'):
            await check_coursework(page, report)
            ledger = await page.evaluate('window.__aiWorkspaceQA.snapshot()')
            assert not ledger['unexpected'] and not ledger['navigations'], ledger
            assert not errors and not console_messages and not external and not unexpected_assets, (errors, console_messages, external, unexpected_assets)
            report.update({'status': 'passed', 'ledger': ledger})
            return report
        home_input = page.get_by_role('textbox', name='想完成的事', exact=True)
        await expect(home_input).to_be_visible()
        box = await home_input.bounding_box()
        # Large type may increase the header; the input must remain reachable
        # without horizontal scrolling. Default text has a strict first-screen check.
        if config.get('text') != '200':
            assert box['y'] + box['height'] <= config['height'], box
        report['checks'].append('Actual home composer is available before opening the assistant')
        await inspect_layout(page, report, 'home')

        prompt = '幫我整理讀書方法'
        await home_input.fill(prompt)
        await page.get_by_role('button', name='開啟任務', exact=True).click()
        panel = page.get_by_role('region', name='校園助理', exact=True)
        field = panel.get_by_role('textbox', name='問題', exact=True)
        await expect(field).to_have_value(prompt)
        await expect(panel.get_by_role('button', name='送出', exact=True)).to_be_disabled()
        ledger = await page.evaluate('window.__aiWorkspaceQA.snapshot()')
        assert not any(row['path'].endswith('/ask') for row in ledger['requests']), ledger
        report['checks'].append('Home handoff carries the draft without automatically asking or granting consent')
        await inspect_layout(page, report, 'draft')
        await panel.get_by_role('checkbox').check()
        await panel.get_by_role('button', name='送出', exact=True).click()
        answer = '合成回覆：已為 qa-alpha 整理「' + prompt + '」。'
        await expect(panel.get_by_text(answer, exact=True)).to_be_visible()
        await field.fill('接著保留這個草稿')
        await inspect_layout(page, report, 'answer')

        await panel.get_by_role('button', name='收合', exact=True).click()
        await expect(panel).not_to_be_visible()
        await expect(home_input).to_have_value('接著保留這個草稿')
        await page.get_by_role('link').filter(has_text='合成課務待辦').first.click()
        await expect(page.get_by_role('region', name='合成目的地頁面')).to_be_visible()
        await page.get_by_role('button', name='接續任務', exact=True).click()
        await expect(panel.get_by_text(answer, exact=True)).to_be_visible()
        await expect(field).to_have_value('接著保留這個草稿')
        await panel.get_by_role('button', name='收合', exact=True).click()
        await page.get_by_role('link', name='前往校園地圖', exact=True).click()
        await page.get_by_role('button', name='開啟校園助理', exact=True).click()
        await expect(panel.get_by_text(answer, exact=True)).to_be_visible()
        await expect(field).to_have_value('接著保留這個草稿')
        await inspect_layout(page, report, 'map-resume')
        await panel.get_by_role('button', name='收合', exact=True).click()
        await page.get_by_role('link', name='回到今天', exact=True).click()
        await expect(home_input).to_have_value('接著保留這個草稿')
        report['checks'].append('Minimize, coursework navigation, map header reopen and home return preserve one conversation and draft')

        await page.get_by_role('button', name='開啟校園助理', exact=True).click()
        await page.evaluate('window.__aiWorkspaceQA.setChecking(true)')
        await expect(panel.get_by_text('正在確認登入與校園狀態，完成後會接續原本的任務。', exact=True)).to_be_visible()
        await expect(field).not_to_be_visible()
        await page.evaluate('window.__aiWorkspaceQA.setChecking(false)')
        await expect(field).to_have_value('接著保留這個草稿')
        await expect(panel.get_by_text(answer, exact=True)).to_be_visible()
        report['checks'].append('Same-session verification hides private UI and restores the same confirmed conversation')

        await page.evaluate('window.__aiWorkspaceQA.switchAccount()')
        await expect(panel).to_have_count(0)
        await expect(home_input).to_have_value('')
        await page.get_by_role('button', name='開啟任務', exact=True).click()
        await expect(field).to_have_value('')
        await expect(panel.get_by_text(answer, exact=True)).to_have_count(0)
        await field.fill('第二個身分的私人草稿')
        await page.evaluate("window.__aiWorkspaceQA.selectCampus('ntu')")
        await expect(panel).to_have_count(0)
        await expect(home_input).to_have_value('')
        report['checks'].append('Account and campus changes synchronously discard private conversation and drafts')

        await page.evaluate('window.__aiWorkspaceQA.setGuest(true)')
        await home_input.fill('library catalog')
        await page.get_by_role('button', name='開啟任務', exact=True).click()
        search = panel.get_by_role('searchbox')
        await expect(search).to_have_value('library catalog')
        await expect(panel.get_by_role('link').filter(has_text='圖書館').first).to_be_visible()
        await inspect_layout(page, report, 'guest-search')
        await search.press('Escape')
        await expect(panel).not_to_be_visible()
        report['checks'].append('Guest handoff uses real local service search and Escape closes without a model call')

        if config['name'] in ('desktop-light', 'phone-light'):
            await check_explore_return(page, report)

        ledger = await page.evaluate('window.__aiWorkspaceQA.snapshot()')
        asks = [row for row in ledger['requests'] if row['path'].endswith('/ask')]
        assert len(asks) == 1 and asks[0]['body']['question'] == prompt and asks[0]['body']['consent'] is True, asks
        assert not ledger['unexpected'], ledger
        assert not errors and not console_messages and not external and not unexpected_assets, (errors, console_messages, external, unexpected_assets)
        report.update({'status': 'passed', 'ledger': ledger})
    except Exception as error:
        report.update({'status': 'failed', 'error': repr(error)})
        prefix = config['name'] + '-failure'
        await page.screenshot(path=str(OUTPUT / (prefix + '.png')), full_page=True)
        (OUTPUT / (prefix + '.html')).write_text(await page.content())
        (OUTPUT / (prefix + '-aria.yml')).write_text(await page.locator('body').aria_snapshot())
        report['failureArtifacts'] = [prefix + suffix for suffix in ('.png', '.html', '-aria.yml')]
        report['ledger'] = await page.evaluate('window.__aiWorkspaceQA?.snapshot()')
    finally:
        report.update({'pageErrors': errors, 'consoleMessages': console_messages, 'externalRequests': external, 'unexpectedAssets': unexpected_assets})
        await context.close()
    return report


async def main():
    evidence = validate_sources()
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(OUTPUT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f'http://127.0.0.1:{server.server_port}'
    reports = []
    try:
        async with async_playwright() as playwright:
            options = {'headless': True}
            if os.environ.get('PLAYWRIGHT_EXECUTABLE_PATH'):
                options['executable_path'] = os.environ['PLAYWRIGHT_EXECUTABLE_PATH']
            browser = await playwright.chromium.launch(**options)
            for config in SCENARIOS:
                report = await run_scenario(browser, origin, config)
                reports.append(report)
                print(config['name'] + ': ' + report['status'], flush=True)
                if report['status'] != 'passed':
                    break
            await browser.close()
        validate_sources()
    finally:
        server.shutdown()
        (OUTPUT / 'results.json').write_text(json.dumps({'sourceEvidence': evidence, 'reports': reports}, ensure_ascii=False, indent=2))
    assert len(reports) == len(SCENARIOS) and all(report['status'] == 'passed' for report in reports), 'See artifacts/ai-workspace/results.json'
    print(f'{len(reports)} scenarios passed; {sum(len(report["checks"]) for report in reports)} workflow checks.', flush=True)


if __name__ == '__main__':
    asyncio.run(main())
