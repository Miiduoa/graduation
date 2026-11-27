import asyncio
import functools
import hashlib
import http.server
import json
import os
import re
import threading
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlparse

from playwright.async_api import async_playwright, expect

ROOT = Path(__file__).resolve().parents[3]
OUTPUT = ROOT / 'artifacts' / 'first-value'
SCENARIOS = [
    {'name': '320-light', 'width': 320, 'height': 740, 'theme': 'light'},
    {'name': '390-dark', 'width': 390, 'height': 844, 'theme': 'dark'},
    {'name': '1280-light', 'width': 1280, 'height': 1000, 'theme': 'light'},
    {'name': '320-light-200', 'width': 320, 'height': 740, 'theme': 'light', 'text': '200'},
    {'name': '390-dark-200-system-reduce', 'width': 390, 'height': 844, 'theme': 'dark', 'text': '200', 'system_motion': 'reduce'},
    {'name': '320-light-site-reduce', 'width': 320, 'height': 740, 'theme': 'light', 'motion': 'reduce'},
]


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_GET(self):
        if not Path(self.path.split('?', 1)[0]).suffix:
            self.path = '/index.html'
        super().do_GET()


def validate_sources():
    evidence = json.loads((OUTPUT / 'source-sha256.json').read_text())
    changed = [item['path'] for item in evidence['files']
               if hashlib.sha256((ROOT / item['path']).read_bytes()).hexdigest() != item['sha256']]
    assert not changed, f'Fixture must be rebuilt after source changes: {changed}'
    for product in ('StudentToday.tsx', 'TodayWelcome.tsx', 'TodayUnreadNotifications.tsx', 'StudentToday.module.css', 'TodayWelcome.module.css'):
        assert any(item['path'].endswith('/' + product) for item in evidence['files']), f'Missing actual product input: {product}'
    return evidence


async def geometry(page, report, stage):
    measurements = await page.locator('[data-product="first-value"]').evaluate('''root => {
      const rect = root.getBoundingClientRect();
      const visible = node => {const r=node.getBoundingClientRect();return r.width>0&&r.height>0;};
      const targets = [...root.querySelectorAll('a,button')].filter(visible).map(node => {
        const r=node.getBoundingClientRect();
        return {name:node.getAttribute('aria-label')||node.textContent.trim(),height:r.height,width:r.width};
      });
      const overflow = [...root.querySelectorAll('*')].filter(visible).flatMap(node => {
        const r=node.getBoundingClientRect();
        return r.left < -1 || r.right > innerWidth+1
          ? [{tag:node.tagName, className:String(node.className),left:r.left,right:r.right}] : [];
      });
      const activeAnimations = [...root.querySelectorAll('*')].filter(visible).flatMap(node => {
        const s=getComputedStyle(node);
        const seconds = value => Math.max(...value.split(',').map(v=>parseFloat(v)*(v.trim().endsWith('ms')?.001:1)));
        return s.animationName !== 'none' && seconds(s.animationDuration) > .01
          ? [{name:s.animationName,duration:s.animationDuration}] : [];
      });
      return {viewport:innerWidth,pageWidth:document.documentElement.scrollWidth,
        contentHeight:document.documentElement.scrollHeight,left:rect.left,right:rect.right,
        shortTargets:targets.filter(t=>t.height<43.5 || t.width<43.5),targets:targets.length,overflow,activeAnimations,
        rootFontSize:getComputedStyle(document.documentElement).fontSize};
    }''')
    assert measurements['pageWidth'] <= measurements['viewport'] + 1, (stage, measurements)
    assert measurements['contentHeight'] <= 16384, ('Page is taller than Chromium can capture', stage, measurements)
    assert not measurements['overflow'], (stage, measurements['overflow'])
    assert not measurements['shortTargets'], (stage, measurements['shortTargets'])
    if report['config'].get('system_motion') == 'reduce' or report['config'].get('motion') == 'reduce':
        assert not measurements['activeAnimations'], (stage, measurements['activeAnimations'])
    if report['config'].get('text') == '200':
        assert measurements['rootFontSize'] == '32px', measurements
    report['geometry'].append({'stage': stage, **measurements})


async def capture(page, path, full_page=True):
    async def paint_ready():
        await page.evaluate('''async () => {
          await document.fonts.ready;
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        }''')

    previous = await page.evaluate('''() => {
      const html = document.documentElement;
      const value = html.style.scrollBehavior;
      html.style.scrollBehavior = 'auto';
      return value;
    }''')
    try:
        await paint_ready()
        try:
            await page.screenshot(path=path, full_page=full_page, animations='disabled')
        except Exception as error:
            # Chromium can reject the first surface capture, especially at 200%
            # text with CJK fonts. Retry only that protocol error, once, with
            # the exact same capture extent; never substitute a smaller image.
            if 'Page.captureScreenshot' not in str(error) or 'Unable to capture screenshot' not in str(error):
                raise
            await paint_ready()
            await page.screenshot(path=path, full_page=full_page, animations='disabled')
    finally:
        await page.evaluate('(value) => { document.documentElement.style.scrollBehavior = value; }', previous)


async def shortcuts(page, campus, report):
    nav = page.get_by_role('navigation', name='常用校園服務', exact=True)
    await expect(nav).to_have_count(1)
    anchors = nav.get_by_role('link')
    await expect(anchors).to_have_count(4)
    observed = []
    for index, path in enumerate(('/map', '/bus', '/cafeteria', '/library')):
        href = await anchors.nth(index).get_attribute('href')
        destination = urlparse(href)
        query = parse_qs(destination.query)
        assert destination.path == path, href
        assert query.get('campus') == [campus], href
        if campus != 'all':
            assert query.get('schoolId') == [campus], href
            assert query.get('school') == [campus.upper()], href
        else:
            assert query == {'campus': ['all']}, href
        assert 'personal' not in href, href
        observed.append(href)
    report.setdefault('shortcutDestinations', []).append(observed)


async def scenario(page, name):
    await page.get_by_role('button', name=name, exact=True).click()


async def check_journey(page, config, report):
    product = page.locator('[data-product="first-value"]')
    welcome = product.get_by_role('heading', name='建立第一份課表', exact=True)
    starter = product.get_by_role('link', name='匯入我的課表', exact=True)
    await expect(welcome).to_be_visible()
    await expect(starter).to_have_count(1)
    await expect(starter).to_have_attribute('href', '/import?kind=timetable&campus=ntu')
    await expect(product.get_by_role('link', name='登入查看作業與通知')).to_have_count(0)
    await expect(page.get_by_test_id('today-classes')).to_have_count(0)
    await expect(page.get_by_test_id('today-work')).to_have_count(0)
    await expect(page.get_by_test_id('today-notifications')).to_contain_text('alpha 的 ntu 合成通知')
    await shortcuts(page, 'ntu', report)
    await geometry(page, report, 'signed-in-setup')
    await capture(page, str(OUTPUT / f"{config['name']}-setup.png"))
    report['checks'].append('Confirmed empty setup gives one primary action, hides duplicate empty sections and retains actual notification UI')

    # Native Tab movement verifies order and focus visibility without clicks.
    await starter.focus()
    keyboard_targets = [
        product.get_by_role('link', name='手動建立課表', exact=True),
        product.get_by_role('link', name='加入 nuni 課程', exact=True),
        product.get_by_role('link', name='查看行事曆', exact=True),
        product.get_by_role('link', name=re.compile(r'^找教室\s*校園地圖$')),
        product.get_by_role('link', name=re.compile(r'^查公車\s*路線與到站時間$')),
        product.get_by_role('link', name=re.compile(r'^找餐廳\s*菜單與營業資訊$')),
        product.get_by_role('link', name=re.compile(r'^查館藏\s*借閱與續借入口$')),
    ]
    for target in keyboard_targets:
        await page.keyboard.press('Tab')
        await expect(target).to_be_focused()
        handle = await target.element_handle()
        try:
            await expect(target).to_be_in_viewport(ratio=1)
            # Wait for native smooth scrolling, without moving the target in JS.
            await page.wait_for_function('''node => {
              const r=node.getBoundingClientRect(); const s=getComputedStyle(node);
              const ring=parseFloat(s.outlineWidth)+Math.max(0,parseFloat(s.outlineOffset));
              return r.left>=ring && r.top>=ring && r.right+ring<=innerWidth && r.bottom+ring<=innerHeight;
            }''', arg=handle, timeout=5000)
        finally:
            focus = await target.evaluate('''node => {
              const r=node.getBoundingClientRect(); const s=getComputedStyle(node);
              const ring=parseFloat(s.outlineWidth)+Math.max(0,parseFloat(s.outlineOffset));
              return {name:node.textContent.trim(),style:s.outlineStyle,width:parseFloat(s.outlineWidth),
                offset:s.outlineOffset,scrollMargin:s.scrollMargin,scrollY,
                ring,left:r.left,top:r.top,right:r.right,bottom:r.bottom,viewportWidth:innerWidth,viewportHeight:innerHeight};
            }''')
            report.setdefault('keyboardFocus', []).append(focus)
            await handle.dispose()
        assert focus['style'] != 'none' and focus['width'] >= 2, ('No visible keyboard focus', focus)
        assert focus['left'] >= focus['ring'] and focus['right'] + focus['ring'] <= focus['viewportWidth'], ('Focus ring clipped horizontally', focus)
        assert focus['top'] >= focus['ring'] and focus['bottom'] + focus['ring'] <= focus['viewportHeight'], ('Focus ring clipped vertically', focus)
    report['checks'].append('Native Tab reaches every setup action and shortcut with visible focus and browser scrolling')

    draft = page.get_by_label('合成助理草稿（僅驗證同範圍更新）', exact=True)
    await draft.fill('合成草稿：等等再整理明天的安排。')
    for focus_target in (
        product.get_by_role('link', name='查看行事曆', exact=True),
        product.get_by_role('link', name=re.compile(r'^查公車\s*路線與到站時間$')),
    ):
        await page.evaluate("window.__firstValueQA.selectScenario('setup')")
        await expect(welcome).to_be_visible()
        await focus_target.focus()
        original_node = await focus_target.element_handle()
        await page.evaluate('window.__firstValueQA.refreshSameScope()')
        await page.wait_for_function("window.__firstValueQA.snapshot().state.scenario === 'setup-refresh'")
        await expect(welcome).to_be_visible()
        await expect(focus_target).to_be_focused()
        assert await original_node.evaluate('node => node.isConnected && node === document.activeElement'), 'Background refresh replaced the focused product node'
        await original_node.dispose()
        await expect(page.get_by_test_id('today-work')).to_have_count(0)
        await expect(draft).to_have_value('合成草稿：等等再整理明天的安排。')
    await geometry(page, report, 'confirmed-empty-background-refresh')
    report['checks'].append('A complete empty snapshot survives background refresh without replacing focused calendar/bus nodes or the synthetic assistant draft')

    # Initial partial data is a separate state, with no previously confirmed
    # empty snapshot. It must never reuse the background-refresh empty result.
    await scenario(page, '作業讀取中')
    await expect(welcome).to_have_count(0)
    await expect(product.get_by_role('status').filter(has_text='正在確認作業與期限…')).to_be_visible()
    await expect(product.get_by_text('目前沒有今日或即將到期的作業。', exact=True)).to_have_count(0)
    await expect(product.get_by_text('今天沒有課，也沒有要交的作業。', exact=True)).to_have_count(0)
    await expect(draft).to_have_value('合成草稿：等等再整理明天的安排。')
    await geometry(page, report, 'partial-course-read')
    report['checks'].append('Initial incomplete coursework reads never claim no work; synthetic assistant slot remains mounted')

    await scenario(page, '有待繳作業')
    await expect(welcome).to_have_count(0)
    work = page.get_by_test_id('next-action')
    await expect(work).to_contain_text('alpha 的 ntu 合成作業')
    submit = work.get_by_role('link', name='去繳交', exact=True)
    await expect(submit).to_have_attribute('href', '/classroom/course/qa-alpha-ntu#assignment-qa-work')
    assert await page.get_by_test_id('today-unified-flow').evaluate("node => node.firstElementChild?.getAttribute('data-testid') === 'today-work'")
    await expect(draft).to_have_value('合成草稿：等等再整理明天的安排。')
    await shortcuts(page, 'ntu', report)
    await geometry(page, report, 'known-work-first')
    await capture(page, str(OUTPUT / f"{config['name']}-known-work.png"))
    report['checks'].append('Known assignment stays first with its actual submission destination and persistent public services')

    await scenario(page, '已有作業背景更新')
    await expect(welcome).to_have_count(0)
    await expect(page.get_by_test_id('next-action')).to_contain_text('alpha 的 ntu 合成作業')
    await expect(product.get_by_role('link', name='去繳交', exact=True)).to_be_visible()
    await expect(product.get_by_text('正在確認作業與期限…', exact=True)).to_have_count(0)
    await geometry(page, report, 'known-work-refresh')
    await scenario(page, '部分作業讀取失敗')
    await expect(welcome).to_have_count(0)
    await expect(page.get_by_test_id('today-work').get_by_role('alert')).to_be_visible()
    await expect(page.get_by_test_id('next-action')).to_contain_text('alpha 的 ntu 合成作業')
    await expect(product.get_by_role('link', name='去繳交', exact=True)).to_be_visible()
    await geometry(page, report, 'known-work-partial-error')
    report['checks'].append('Known work remains actionable during background refresh and partial errors')

    await scenario(page, '週末已有課表')
    await expect(welcome).to_have_count(0)
    await expect(product.get_by_text('今天沒有課，也沒有要交的作業。', exact=True)).to_be_visible()
    await expect(product.get_by_role('link', name='看這週', exact=True)).to_have_attribute('href', '/timetable?campus=ntu')
    await expect(starter).to_have_count(0)
    await shortcuts(page, 'ntu', report)
    await geometry(page, report, 'known-timetable-on-weekend')
    report['checks'].append('An existing timetable on an empty Sunday opens the week and does not restart setup')

    await scenario(page, '課表讀取中')
    await expect(welcome).to_have_count(0)
    await expect(product.get_by_role('status').filter(has_text='正在確認今天的課表…')).to_be_visible()
    await expect(product.get_by_text('今天沒有課，也沒有要交的作業。', exact=True)).to_have_count(0)
    await geometry(page, report, 'loading-timetable')

    await scenario(page, '課表讀取失敗')
    await expect(welcome).to_have_count(0)
    await expect(page.get_by_test_id('today-classes').get_by_role('alert')).to_have_text('暫時讀不到課表')
    await geometry(page, report, 'timetable-error')
    await page.get_by_test_id('today-classes').get_by_role('button', name='再試一次', exact=True).click()
    await expect(welcome).to_be_visible()
    assert (await page.evaluate('window.__firstValueQA.snapshot()'))['timetableRetries'] == 1

    await scenario(page, '作業讀取失敗')
    await expect(welcome).to_have_count(0)
    await expect(page.get_by_test_id('today-work').get_by_role('alert')).to_have_text('合成作業來源暫時讀不到，請重試。')
    await expect(product.get_by_text('目前沒有今日或即將到期的作業。', exact=True)).to_have_count(0)
    await geometry(page, report, 'coursework-error')
    await page.get_by_test_id('today-work').get_by_role('button', name='再試一次', exact=True).click()
    await expect(page.get_by_test_id('next-action')).to_contain_text('alpha 的 ntu 合成作業')
    assert (await page.evaluate('window.__firstValueQA.snapshot()'))['workRetries'] == 1
    report['checks'].append('Loading and failed reads stay distinct from empty data; timetable and work retry controls recover')

    await scenario(page, '帳號載入中')
    await expect(page.get_by_test_id('today-skeleton')).to_be_visible()
    await expect(welcome).to_have_count(0)
    await expect(product.get_by_role('navigation', name='常用校園服務')).to_have_count(0)
    await geometry(page, report, 'session-skeleton')

    await scenario(page, '已有 nuni 課程')
    await expect(welcome).to_be_visible()
    await expect(product.get_by_role('link', name='加入 nuni 課程', exact=True)).to_have_count(0)
    await expect(page.get_by_test_id('today-work')).to_be_visible()
    await expect(product.get_by_role('link', name='查看行事曆', exact=True)).to_be_visible()
    report['checks'].append('Existing-course users retain work/calendar access and are not told to join again')

    await scenario(page, '課表與瀏覽校園不同')
    await expect(starter).to_have_attribute('href', '/import?kind=timetable&campus=nchu')
    await expect(product.get_by_role('link', name='手動建立課表', exact=True)).to_have_attribute('href', '/timetable?campus=nchu')
    await shortcuts(page, 'ntu', report)
    report['checks'].append('Personal timetable destinations remain separate from the public browsing campus')

    await scenario(page, '有下一堂課')
    await expect(page.get_by_test_id('next-action')).to_contain_text('alpha 的 ntu 合成課程')
    await expect(welcome).to_have_count(0)
    await shortcuts(page, 'ntu', report)
    await geometry(page, report, 'known-next-class')
    await scenario(page, '切換中興')
    await expect(product.get_by_text('alpha 的 ntu 合成課程', exact=True)).to_have_count(0)
    await expect(starter).to_have_attribute('href', '/import?kind=timetable&campus=nchu')
    await expect(page.get_by_test_id('today-notifications')).to_contain_text('alpha 的 nchu 合成通知')
    await expect(product.get_by_text('alpha 的 ntu 合成通知', exact=True)).to_have_count(0)
    await shortcuts(page, 'nchu', report)
    await scenario(page, '有待繳作業')
    await expect(page.get_by_test_id('next-action')).to_contain_text('alpha 的 nchu 合成作業')
    await scenario(page, '切換帳號')
    await expect(product.get_by_text('alpha 的 nchu 合成作業', exact=True)).to_have_count(0)
    await expect(page.get_by_test_id('today-notifications')).to_contain_text('beta 的 nchu 合成通知')
    await expect(product.get_by_text('alpha 的 nchu 合成通知', exact=True)).to_have_count(0)
    await shortcuts(page, 'nchu', report)
    report['checks'].append('Product rows and destinations update after synthetic account/campus changes; old classes, work and notifications disappear')

    await scenario(page, '未選校園')
    await expect(product.get_by_role('heading', name='選擇課表所屬校園', exact=True)).to_be_visible()
    await expect(product.get_by_role('link', name='選校園、整理課表', exact=True)).to_have_attribute('href', '/timetable?campus=all')
    await expect(product.get_by_role('link', name='登入查看作業與通知')).to_have_count(0)
    await shortcuts(page, 'all', report)
    await geometry(page, report, 'all-campuses')

    await scenario(page, '切換臺大')
    await scenario(page, '訪客')
    await expect(starter).to_have_count(1)
    login = product.get_by_role('link', name='登入查看作業與通知', exact=True)
    await expect(login).to_have_count(1)
    login_href = await login.get_attribute('href')
    assert urlparse(login_href).path == '/login', login_href
    returned = parse_qs(urlparse(login_href).query)['returnUrl'][0]
    assert parse_qs(urlparse(returned).query)['campus'] == ['ntu'], login_href
    await expect(page.get_by_test_id('today-work')).to_have_count(0)
    await shortcuts(page, 'ntu', report)
    await geometry(page, report, 'guest-setup')
    report['checks'].append('Unselected users choose a campus; guests retain exactly one sign-in return link and public service access')

    # Exercise a real anchor using the explicit Next routing boundary, and
    # compare its href with the resulting browser URL and navigation ledger.
    bus = product.get_by_role('link', name=re.compile(r'^查公車\s*路線與到站時間$'))
    href = await bus.get_attribute('href')
    await bus.focus()
    await page.keyboard.press('Enter')
    await page.wait_for_url('**/bus?**')
    assert urlparse(page.url).path == '/bus', page.url
    state = await page.evaluate('window.__firstValueQA.snapshot()')
    assert state['navigations'][-1] == href, state
    assert not state['requests'], state
    report['checks'].append('Keyboard activation follows the rendered campus-scoped href without external data requests')


async def capture_failure(page, config, report, error):
    # Diagnostic captures must not mask the original failure or prevent the
    # second artifact from being attempted. Bound each independent capture.
    report['failure'] = repr(error)
    for suffix, full_page in (('failure-viewport', False), ('failure', True)):
        try:
            await page.screenshot(
                path=str(OUTPUT / f"{config['name']}-{suffix}.png"),
                full_page=full_page,
                animations='disabled',
                timeout=5000,
            )
        except Exception as capture_error:
            report.setdefault('screenshotFailure', repr(capture_error))
            report.setdefault('diagnosticErrors', []).append({
                'artifact': suffix,
                'error': repr(capture_error),
            })


async def run():
    evidence = validate_sources()
    handler = functools.partial(QuietHandler, directory=str(OUTPUT))
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f'http://127.0.0.1:{server.server_port}'
    reports = []
    failure = None
    try:
        async with async_playwright() as playwright:
            executable = os.environ.get('CHROMIUM_EXECUTABLE_PATH') or os.environ.get('CHROME_PATH')
            browser = await playwright.chromium.launch(headless=True, executable_path=executable)
            for config in SCENARIOS:
                report = {'config': config, 'checks': [], 'geometry': [], 'runtimeErrors': [], 'externalRequests': [], 'passed': False}
                reports.append(report)
                context = await browser.new_context(
                    viewport={'width': config['width'], 'height': config['height']},
                    color_scheme=config['theme'], reduced_motion=config.get('system_motion', 'no-preference'),
                    locale='zh-TW', timezone_id='Asia/Taipei',
                )
                page = await context.new_page()
                page.on('pageerror', lambda error: report['runtimeErrors'].append(str(error)))
                page.on('console', lambda message: report['runtimeErrors'].append(message.text) if message.type == 'error' else None)

                async def guard(route):
                    if route.request.url.startswith(base + '/'):
                        await route.continue_()
                    else:
                        report['externalRequests'].append(route.request.url)
                        await route.abort()

                await context.route('**/*', guard)
                try:
                    query = {key: config[key] for key in ('theme', 'text', 'motion') if key in config}
                    await page.goto(base + '/?' + urlencode(query), wait_until='networkidle')
                    await check_journey(page, config, report)
                    assert not report['runtimeErrors'], report['runtimeErrors']
                    assert not report['externalRequests'], report['externalRequests']
                    report['passed'] = True
                    print(f"PASS {config['name']}: {len(report['checks'])} journey checks, {len(report['geometry'])} geometry states", flush=True)
                except Exception as error:
                    failure = error
                    await capture_failure(page, config, report, error)
                    break
                finally:
                    await context.close()
            browser_version = browser.version
            await browser.close()
        if failure is None:
            validate_sources()
    except Exception as error:
        if failure is None:
            failure = error
    finally:
        server.shutdown()
        server.server_close()
        result = {
            'passed': failure is None and len(reports) == len(SCENARIOS),
            'gitHead': evidence['gitHead'], 'sourceHashes': len(evidence['files']),
            'browserVersion': locals().get('browser_version'), 'synthetic': True,
            'scope': evidence['scope'], 'scenarios': reports,
            'failure': repr(failure) if failure else None,
        }
        (OUTPUT / 'results.json').write_text(json.dumps(result, ensure_ascii=False, indent=2))
    if failure:
        raise failure
    print(f"PASS: {len(reports)} configurations, all bundled source hashes still match the checkout", flush=True)


if __name__ == '__main__':
    asyncio.run(run())
