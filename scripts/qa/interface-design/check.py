import asyncio
import functools
import http.server
import json
import os
import threading
from pathlib import Path
from urllib.parse import urlencode

from playwright.async_api import async_playwright, expect

OUTPUT = Path(__file__).resolve().parents[3] / 'artifacts' / 'interface-design'
SCENARIOS = [
    {'name': 'desktop-light', 'width': 1440, 'height': 1000, 'theme': 'light', 'role': 'student'},
    {'name': 'mobile-dark', 'width': 390, 'height': 844, 'theme': 'dark', 'role': 'student'},
    {'name': 'compact-operator', 'width': 320, 'height': 740, 'theme': 'light', 'role': 'operator'},
    {'name': 'large-text-system-motion', 'width': 390, 'height': 844, 'theme': 'light', 'role': 'student', 'text': '200', 'system_motion': 'reduce'},
    {'name': 'compact-dark-site-motion', 'width': 320, 'height': 740, 'theme': 'dark', 'role': 'operator', 'text': '200', 'motion': 'reduce'},
    {'name': 'guest-light', 'width': 390, 'height': 844, 'theme': 'light', 'role': 'guest'},
]


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


async def font_evidence(context, page):
    await page.evaluate('document.fonts.ready.then(() => true)')
    session = await context.new_cdp_session(page)
    try:
        await session.send('DOM.enable')
        await session.send('CSS.enable')
        document = await session.send('DOM.getDocument')
        evidence = {}
        for selector in ('body', 'h1', 'time'):
            node = await session.send('DOM.querySelector', {
                'nodeId': document['root']['nodeId'], 'selector': selector})
            if not node['nodeId']:
                continue
            computed = await page.locator(selector).first.evaluate('''node => {
              const style=getComputedStyle(node);
              return {fontFamily:style.fontFamily, font:style.font, fontWeight:style.fontWeight};
            }''')
            platform = await session.send('CSS.getPlatformFontsForNode', {'nodeId': node['nodeId']})
            evidence[selector] = {'computed': computed, 'platformFonts': platform['fonts']}
        return evidence
    finally:
        await session.detach()


async def scenario(browser, origin, config, reports):
    context = await browser.new_context(
        viewport={'width': config['width'], 'height': config['height']},
        device_scale_factor=1, reduced_motion=config.get('system_motion', 'no-preference'),
        locale='zh-TW', timezone_id='Asia/Taipei')
    page = await context.new_page()
    page.set_default_timeout(8000)
    errors, external = [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    report = {**config, 'status': 'running', 'checks': [], 'screenshots': []}
    reports.append(report)

    async def local_only(route):
        if route.request.url.startswith(origin + '/') and route.request.method == 'GET':
            await route.continue_()
        else:
            external.append({'url': route.request.url, 'method': route.request.method})
            await route.abort()

    await page.route('**/*', local_only)

    async def capture(name, full_page=True):
        filename = config['name'] + '-' + name + '.png'
        await page.screenshot(path=str(OUTPUT / filename), full_page=full_page)
        report['screenshots'].append(filename)

    async def layout(name):
        result = await page.evaluate('''() => {
          const targets = [...document.querySelectorAll('button, header[data-campus-navigation] summary, nav[aria-label="主要導覽"] > a')]
            .filter(node => node.checkVisibility());
          return { width: innerWidth, content: document.documentElement.scrollWidth,
            small: targets.flatMap(node => { const r=node.getBoundingClientRect();
              return r.height < 43.5 || r.width < 43.5 ? [{name:node.textContent, width:r.width, height:r.height}] : []; }) };
        }''')
        assert result['content'] <= result['width'] + 1, (name, result)
        assert not result['small'], (name, result['small'])
        report['checks'].append(name + ': no page overflow; visible buttons and primary navigation meet 44px targets')

    async def expect_one_popover(voice=False):
        details = page.locator('header[data-campus-navigation] details[name="campus-navigation-popover"][open]')
        await expect(details).to_have_count(0 if voice else 1)
        await expect(page.get_by_role('dialog', name='校園語音與 AI 快速操作')).to_have_count(1 if voice else 0)

    try:
        params = {key: value for key, value in config.items() if key in ('theme', 'role', 'text', 'motion')}
        await page.goto(origin + '/?' + urlencode(params))
        await expect(page.get_by_role('heading', name='今天', exact=True)).to_be_visible()
        try:
            report['fontEvidence'] = await font_evidence(context, page)
        except Exception as error:
            # Font provenance is diagnostic; the existing interaction gates remain unchanged.
            report['fontEvidence'] = {'error': repr(error)}
        await layout('today')
        await capture('today')
        if config['role'] == 'guest':
            await expect(page.get_by_role('link', name='匯入我的課表', exact=True)).to_be_visible()
            await expect(page.locator('summary[aria-label="帳號"]')).to_have_count(0)
            report['checks'].append('Guest starts with timetable import and does not receive an account menu')

        account = page.locator('summary[aria-label="帳號"]')
        voice = page.get_by_role('button', name='開啟校園語音 AI', exact=True)
        school = page.locator('summary[aria-label="切換校園：靜宜大學"]')
        services = page.locator('summary[aria-label="所有服務"]')
        if config['role'] != 'guest':
            await account.click()
            await expect_one_popover()
            await expect(page.get_by_role('link', name='我的帳號', exact=True)).to_be_visible()
            if config['role'] == 'operator':
                await expect(page.get_by_role('link', name='平台管理', exact=True)).to_be_visible()
            else:
                await expect(page.get_by_role('link', name='平台管理', exact=True)).to_have_count(0)
            await layout('account')
            await capture('account')
        await voice.click()
        await expect_one_popover(voice=True)
        if config['width'] <= 760:
            assert await page.get_by_role('dialog', name='校園語音與 AI 快速操作').evaluate('''panel => {
              const bounds=panel.getBoundingClientRect();
              const header=document.querySelector('header[data-campus-navigation]').getBoundingClientRect();
              const nav=document.querySelector('nav[aria-label="主要導覽"]').getBoundingClientRect();
              return bounds.top >= header.bottom && bounds.bottom <= nav.top;
            }'''), 'Nonmodal voice panel obscured the header destinations or bottom navigation'
        await capture('voice', full_page=False)
        await school.click()
        await expect_one_popover()
        await expect(page.get_by_role('heading', name='瀏覽校園', exact=True)).to_be_visible()
        await services.click()
        await expect_one_popover()
        await expect(page.locator('header details[name="campus-navigation-popover"][open]').get_by_role('heading', name='校園服務', exact=True)).to_be_visible()
        await layout('services')
        await capture('services')
        await page.keyboard.press('Escape')
        await expect(services).to_be_focused()
        await expect(page.locator('header details[open]')).to_have_count(0)
        await school.click()
        await page.get_by_role('searchbox', name='搜尋校園', exact=True).fill('靜宜')
        await page.keyboard.press('Escape')
        await expect(school).to_be_focused()
        await voice.click()
        await page.keyboard.press('Escape')
        await expect(voice).to_be_focused()
        if config['role'] != 'guest':
            await account.click()
            await page.keyboard.press('Escape')
            await expect(account).to_be_focused()
        await page.keyboard.press('Control+k')
        await expect(page.get_by_role('searchbox', name='搜尋服務', exact=True)).to_be_focused()
        await page.keyboard.press('Escape')
        await expect(services).to_be_focused()
        report['checks'].append('Account, voice, campus and services remain exclusive; Escape restores each trigger; Control+K focuses service search')

        await page.get_by_role('button', name='查看課務分頁', exact=True).click()
        academic = page.get_by_role('navigation', name='課務導覽')
        current = academic.get_by_role('link', name='校方作業與教材', exact=True)
        await expect(current).to_have_attribute('aria-current', 'page')
        assert await current.evaluate('''link => {
          const list=link.closest('ul'), row=list.getBoundingClientRect(), item=link.getBoundingClientRect();
          return item.left >= row.left && item.right <= row.right + 1;
        }'''), 'Directly opened current section was not visible'
        # Force the current link out of view, then exercise the real resize hook
        # at an established reading position. No helper or geometry is mocked.
        before = await page.evaluate('''() => {
          window.scrollTo({top:84,behavior:'instant'});
          const list=document.querySelector('nav[aria-label="課務導覽"] ul');
          list.scrollLeft=0; return {y:scrollY,focus:document.activeElement?.outerHTML};
        }''')
        await page.evaluate("window.dispatchEvent(new Event('resize'))")
        after = await page.evaluate('({y:scrollY,focus:document.activeElement?.outerHTML})')
        assert after == before, {'before': before, 'after': after}
        assert await current.evaluate('''link => {
          const r=link.closest('ul').getBoundingClientRect(), b=link.getBoundingClientRect();
          return b.left >= r.left && b.right <= r.right+1;
        }'''), 'Resize failed to reveal the current section'
        first = academic.get_by_role('link', name='課表', exact=True)
        await first.focus()
        await page.keyboard.press('Tab')
        focused = academic.locator('a:focus')
        await expect(focused).to_have_count(1)
        assert await focused.evaluate('''link => {
          const r=link.closest('ul').getBoundingClientRect(), b=link.getBoundingClientRect(), s=getComputedStyle(link);
          const ring=parseFloat(s.outlineWidth)+parseFloat(s.outlineOffset);
          return b.left-ring >= r.left-1 && b.right+ring <= r.right+1 && b.top-ring >= r.top-1 && b.bottom+ring <= r.bottom+1;
        }'''), 'Focused link or its focus ring was clipped'
        await layout('academic')
        await current.focus()
        await capture('academic', full_page=False)
        report['checks'].append('Current academic section and keyboard focus are visible; local resize adjustment preserves page scroll and focus')

        trigger = page.get_by_role('button', name='顯示完成通知', exact=True)
        await trigger.scroll_into_view_if_needed()
        box = await trigger.bounding_box()
        await page.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2)
        await page.mouse.down()
        reduced = config.get('motion') == 'reduce' or config.get('system_motion') == 'reduce'
        if reduced:
            assert await trigger.evaluate("node => getComputedStyle(node).transform === 'none'"), 'Reduced motion did not suppress press displacement'
            assert await trigger.evaluate("node => getComputedStyle(node).transitionDuration.split(',').every(value => parseFloat(value) <= .001)"), 'Reduced motion transition remained active'
        else:
            await expect(trigger).to_have_css('transform', 'matrix(0.98, 0, 0, 0.98, 0, 0)')
        await page.mouse.up()
        notification = page.get_by_role('status').filter(has_text='已儲存安排')
        close = page.get_by_role('button', name='關閉通知：已儲存安排', exact=True)
        await expect(notification).to_be_visible()
        await close.focus()
        await page.mouse.move(1, 1)
        await page.wait_for_timeout(1800)
        await expect(notification).to_be_visible()
        await expect(close).to_be_focused()
        await layout('toast')
        if config['width'] <= 760:
            assert await close.evaluate('''button => {
              const toast=button.parentElement.getBoundingClientRect();
              const nav=document.querySelector('nav[aria-label="主要導覽"]').getBoundingClientRect();
              return toast.bottom <= nav.top && toast.left >= 0 && toast.right <= innerWidth;
            }'''), 'Toast overlapped mobile navigation or viewport'
        await capture('toast', full_page=False)
        await trigger.focus()
        await expect(notification).to_have_count(0, timeout=5000)
        report['checks'].append('Pressed feedback respects motion preferences; completion toast fits, announces status, pauses during focus and resumes afterward')

        ledger = await page.evaluate('window.__interfaceQA.snapshot()')
        report['ledger'] = ledger
        assert not ledger['requests'], ledger
        assert ledger['logouts'] == 0, ledger
        assert not errors, errors
        assert not external, external
        report['checks'].append('No application HTTP calls, real logouts, external requests or browser errors')
        report['status'] = 'passed'
    except Exception as failure:
        report.update({'status': 'failed', 'error': repr(failure)})
        try:
            await capture('failure', full_page=False)
            (OUTPUT / (config['name'] + '-failure.html')).write_text(await page.content(), encoding='utf-8')
        except Exception as capture_error:
            report['captureError'] = repr(capture_error)
    finally:
        report.update({'pageErrors': errors, 'externalRequests': external})
        await context.close()


async def main():
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(OUTPUT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    reports = []
    try:
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(executable_path=os.environ.get('CHROME_PATH'))
            try:
                for config in SCENARIOS:
                    await scenario(browser, f'http://127.0.0.1:{server.server_port}', config, reports)
            finally:
                await browser.close()
        assert len(reports) == len(SCENARIOS) and all(row['status'] == 'passed' for row in reports), 'Interface browser checks failed; see checks.json and failure screenshots'
        print(json.dumps({'scenarios': len(reports), 'checks': sum(len(row['checks']) for row in reports)}))
    finally:
        server.shutdown()
        (OUTPUT / 'checks.json').write_text(json.dumps(reports, ensure_ascii=False, indent=2), encoding='utf-8')


if __name__ == '__main__':
    asyncio.run(main())
