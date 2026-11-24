"""Actual Web workspace UI with synthetic, network-isolated identity and replies."""
import asyncio
import functools
import hashlib
import http.server
import json
import os
import threading
from pathlib import Path
from urllib.parse import urlencode, urlparse

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
                    'QuickCampusEntry.tsx', 'AssistantWorkspace.module.css'):
        assert any(item['path'].endswith('/' + product) for item in evidence['files']), product
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
        query = urlencode({key: config[key] for key in ('theme', 'text', 'motion', 'appMotion') if key in config})
        await page.goto(origin + '/?' + query)
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
