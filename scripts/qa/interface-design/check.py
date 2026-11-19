import asyncio
import functools
import http.server
import json
import os
import threading
from pathlib import Path
from urllib.parse import urlencode

from playwright.async_api import async_playwright, expect
from quick_search import check_quick_search

OUTPUT = Path(__file__).resolve().parents[3] / 'artifacts' / 'interface-design'
SCENARIOS = [
    {'name': 'desktop-light', 'width': 1440, 'height': 1000, 'theme': 'light', 'role': 'student'},
    {'name': 'mobile-dark', 'width': 390, 'height': 844, 'theme': 'dark', 'role': 'student'},
    {'name': 'compact-operator', 'width': 320, 'height': 740, 'theme': 'light', 'role': 'operator'},
    {'name': 'large-text-system-motion', 'width': 390, 'height': 844, 'theme': 'light', 'role': 'student', 'text': '200', 'system_motion': 'reduce'},
    {'name': 'compact-dark-site-motion', 'width': 320, 'height': 740, 'theme': 'dark', 'role': 'operator', 'text': '200', 'motion': 'reduce'},
    {'name': 'guest-light', 'width': 390, 'height': 844, 'theme': 'light', 'role': 'guest'},
    {'name': 'large-preference', 'width': 390, 'height': 844, 'theme': 'light', 'role': 'student', 'font': 'large'},
]


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


async def assert_modal_tab_boundary(page, key, expected, report):
    # Native dialog traversal may visit browser chrome at a document boundary.
    # https://html.spec.whatwg.org/multipage/interaction.html#sequential-focus-navigation
    # A native scrollable region can also be a focusable area whose DOM anchor
    # is its element: https://html.spec.whatwg.org/multipage/interaction.html#focusable-area
    # Each exact intermediate state is allowed only once. Background page
    # controls, unrelated dialog controls and repeated boundaries always fail.
    seen = set()
    for step in (1, 2, 3):
        await page.keyboard.press(key)
        state = await expected.evaluate('''expected => {
          const active = document.activeElement;
          const dialog = expected.closest('dialog');
          return {
            documentFocused: document.hasFocus(),
            activeTag: active?.tagName ?? null,
            activeName: active?.getAttribute('aria-label') || active?.textContent?.trim().slice(0, 80),
            insideDialog: Boolean(dialog?.contains(active)),
            expectedActive: active === expected,
            nativeModal: Boolean(dialog?.matches(':modal')),
            dialogActive: active === dialog,
            dialogTabIndex: dialog?.getAttribute('tabindex'),
            dialogOverflowY: dialog ? getComputedStyle(dialog).overflowY : null,
            dialogScrollHeight: dialog?.scrollHeight,
            dialogClientHeight: dialog?.clientHeight,
          };
        }''')
        state.update({'key': key, 'step': step})
        report.setdefault('dialogFocusBoundaries', []).append(state)
        assert state['nativeModal'], f'Modal state lost at keyboard boundary: {state}'
        if state['documentFocused'] and state['expectedActive'] and state['insideDialog']:
            return
        kind = None
        if not state['documentFocused'] and state['activeTag'] == 'BODY':
            kind = 'browser-ui'
        elif (state['documentFocused'] and state['dialogActive'] and state['insideDialog']
              and state['dialogTabIndex'] is None
              and state['dialogOverflowY'] in ('auto', 'scroll')
              and state['dialogClientHeight'] > 0
              and state['dialogScrollHeight'] > state['dialogClientHeight'] + 1):
            kind = 'dialog-scroller'
        assert step < 3 and kind is not None and kind not in seen, (
            f'Focus escaped, repeated a boundary, or missed the expected control: {state}')
        seen.add(kind)


async def check_dialogs_and_fields(page, config, report, capture, suffix=''):
    opener = page.get_by_role('button', name='檢查輸入與對話視窗', exact=True)
    await opener.click()
    dialog = page.get_by_role('dialog', name='編輯課程提醒', exact=True)
    await expect(dialog).to_be_visible()
    await expect(dialog.get_by_role('heading', name='編輯課程提醒')).to_be_in_viewport(ratio=1)
    await expect(dialog.get_by_role('button', name='關閉視窗')).to_be_focused()
    assert await dialog.evaluate('''node => {
      const r=node.getBoundingClientRect();
      return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight;
    }'''), 'Dialog exceeded the available viewport'
    if config.get('motion') == 'reduce' or config.get('system_motion') == 'reduce':
        await expect(dialog).to_have_css('animation-name', 'none')

    root_size = await page.locator('html').evaluate('node => parseFloat(getComputedStyle(node).fontSize)')
    expected_body = root_size * (1.0625 if config.get('font') == 'large' else .9375)
    field_sizes = {
        '#fixture-task-title': expected_body,
        '#fixture-large-field': root_size * (1.1875 if config.get('font') == 'large' else 1.0625),
        '#fixture-small-field': root_size * (.9375 if config.get('font') == 'large' else .8125),
        '#fixture-password': expected_body,
        '#fixture-icon-field': expected_body,
        '#fixture-reminder-time': expected_body,
        '#fixture-note': expected_body,
    }
    for selector, desired in field_sizes.items():
        expected = max(16, desired) if page.viewport_size['width'] <= 760 else desired
        actual = await dialog.locator(selector).evaluate('node => parseFloat(getComputedStyle(node).fontSize)')
        assert abs(actual - expected) < .1, (selector, actual, expected)
    title = dialog.get_by_role('heading', name='編輯課程提醒')
    expected_title = root_size * (1.375 if config.get('font') == 'large' else 1.25)
    assert abs(await title.evaluate('node => parseFloat(getComputedStyle(node).fontSize)') - expected_title) < .1, 'Dialog heading lost the active text preference'
    await capture('form-start' + suffix, full_page=False)

    # Exercise native Tab order and scrolling. Single-line fields and actions
    # must be fully visible without test-driven scrolling. A textarea follows
    # its caret; check the readable region before separately exercising scroll.
    for selector in ('#fixture-task-title', '#fixture-large-field', '#fixture-small-field', '#fixture-password'):
        await page.keyboard.press('Tab')
        target = dialog.locator(selector)
        await expect(target).to_be_focused()
        await expect(target).to_be_in_viewport(ratio=1)
    await page.keyboard.press('Tab')
    reveal = dialog.get_by_role('button', name='顯示密碼', exact=True)
    await expect(reveal).to_be_focused()
    await expect(reveal).to_be_in_viewport(ratio=1)
    metrics = await dialog.locator('#fixture-password').evaluate('''node => {
      const style=getComputedStyle(node), field=node.getBoundingClientRect();
      const reveal=node.parentElement.querySelector('button');
      const button=reveal.getBoundingClientRect();
      return {padding:parseFloat(style.paddingRight), reserve:field.right-button.left,
        available:field.width-parseFloat(style.paddingRight)-parseFloat(style.paddingLeft),
        minimumText:2*parseFloat(style.fontSize),
        targetWidth:button.width,targetHeight:button.height,
        minimumHeight:parseFloat(getComputedStyle(reveal).minHeight)};
    }''')
    assert metrics['padding'] >= metrics['reserve'] - 1 and metrics['available'] >= metrics['minimumText'], metrics
    # Transformed layout coordinates may report 43.999969px for a 44px target.
    # Keep the actual CSS minimum strict; allow only 0.01px geometric rounding.
    assert metrics['minimumHeight'] >= 44, metrics
    assert metrics['targetWidth'] >= 43.99 and metrics['targetHeight'] >= 43.99, metrics
    await reveal.press('Enter')
    await expect(dialog.locator('#fixture-password')).to_have_attribute('type', 'text')
    for selector in ('#fixture-icon-field', '#fixture-reminder-time', '#fixture-note'):
        await page.keyboard.press('Tab')
        target = dialog.locator(selector)
        await expect(target).to_be_focused()
        if selector == '#fixture-note':
            visibility = await target.evaluate('''node => {
              const field = node.getBoundingClientRect();
              const dialog = node.closest('dialog');
              const panel = dialog.getBoundingClientRect();
              const style = getComputedStyle(node);
              const top = Math.max(0, panel.top + dialog.clientTop);
              const bottom = Math.min(innerHeight, panel.top + dialog.clientTop + dialog.clientHeight);
              const left = Math.max(0, panel.left + dialog.clientLeft);
              const right = Math.min(innerWidth, panel.left + dialog.clientLeft + dialog.clientWidth);
              return {
                height: field.height, availableHeight: bottom - top,
                visibleHeight: Math.max(0, Math.min(field.bottom, bottom) - Math.max(field.top, top)),
                requiredHeight: Math.min(field.height, 2 * parseFloat(style.lineHeight) + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth)),
                fullWidth: field.left >= left - 1 && field.right <= right + 1,
              };
            }''')
            report.setdefault('textareaVisibility', []).append({'viewport': page.viewport_size, **visibility})
            assert visibility['fullWidth'] and visibility['visibleHeight'] >= visibility['requiredHeight'] - 1, visibility
            assert visibility['height'] <= visibility['availableHeight'] + 1, visibility
            # Browser focus scrolls to the caret, not necessarily the whole
            # multiline box. Verify that scrolling can reveal its full extent.
            await target.scroll_into_view_if_needed()
            await expect(target).to_be_focused()
        await expect(target).to_be_in_viewport(ratio=1)
    icons = await dialog.locator('#fixture-icon-field').evaluate('''node => {
      const style=getComputedStyle(node), field=node.getBoundingClientRect();
      const [left,right]=[...node.parentElement.querySelectorAll('span')].map(icon=>icon.getBoundingClientRect());
      return {leftSpace:parseFloat(style.paddingLeft),rightSpace:parseFloat(style.paddingRight),
        leftUsed:left.right-field.left,rightUsed:field.right-right.left};
    }''')
    assert icons['leftSpace'] >= icons['leftUsed'] and icons['rightSpace'] >= icons['rightUsed'], icons
    await page.keyboard.press('Tab')
    await expect(dialog.get_by_role('button', name='取消編輯')).to_be_focused()
    await expect(dialog.get_by_role('button', name='取消編輯')).to_be_in_viewport(ratio=1)
    await page.keyboard.press('Tab')
    finish = dialog.get_by_role('button', name='完成編輯')
    await expect(finish).to_be_focused()
    await expect(finish).to_be_in_viewport(ratio=1)
    assert abs(await finish.evaluate('node => parseFloat(getComputedStyle(node).fontSize)') - expected_body) < .1, 'Shared button lost the active text preference'
    await capture('form-actions' + suffix, full_page=False)
    close = dialog.get_by_role('button', name='關閉視窗')
    await assert_modal_tab_boundary(page, 'Tab', close, report)
    await expect(close).to_be_in_viewport(ratio=1)
    await assert_modal_tab_boundary(page, 'Shift+Tab', finish, report)
    await expect(finish).to_be_in_viewport(ratio=1)
    await assert_modal_tab_boundary(page, 'Tab', close, report)
    await expect(close).to_be_in_viewport(ratio=1)
    await page.keyboard.press('Escape')
    await expect(dialog).to_have_count(0)
    await expect(opener).to_be_focused()
    report['checks'].append('Real dialog and fields respect text size; native Tab reaches every field and footer action, document boundaries return to exact dialog controls without focusing background content, textarea is readable and fully scrollable, and Escape restores the opener')

    confirm_opener = page.get_by_role('button', name='檢查長篇確認內容', exact=True)
    await confirm_opener.click()
    confirm = page.get_by_role('dialog', name='確認移除提醒')
    heading = confirm.get_by_role('heading', name='確認移除提醒')
    await expect(heading).to_be_in_viewport(ratio=1)
    await expect(heading).to_be_focused()
    assert await confirm.evaluate('node => node.scrollTop <= 1'), 'Long confirmation skipped its opening explanation'
    await capture('confirmation-start' + suffix, full_page=False)
    await page.keyboard.press('Tab')
    cancel = confirm.get_by_role('button', name='取消', exact=True)
    await expect(cancel).to_be_focused()
    await expect(cancel).to_be_in_viewport(ratio=1)
    await page.keyboard.press('Tab')
    await expect(confirm.get_by_role('button', name='移除提醒')).to_be_focused()
    await expect(confirm.get_by_role('button', name='移除提醒')).to_be_in_viewport(ratio=1)
    await page.keyboard.press('Escape')
    await expect(confirm).to_have_count(0)
    await expect(confirm_opener).to_be_focused()
    report['checks'].append('Long confirmation begins at the readable heading; keyboard reaches cancel before the destructive action and Escape restores its opener')


async def check_short_service_menu(page, report, capture):
    original = page.viewport_size
    try:
        for width, height in ((390, 320), (640, 360)):
            await page.set_viewport_size({'width': width, 'height': height})
            await page.evaluate('window.scrollTo({top:0,behavior:"instant"})')
            trigger = page.locator('summary[aria-label="所有服務"]')
            await trigger.click()
            close = page.get_by_role('button', name='關閉所有服務')
            await expect(close).to_be_in_viewport(ratio=1)
            assert await close.evaluate('''node => {
              const panel=node.parentElement.parentElement.getBoundingClientRect();
              const header=node.closest('header').getBoundingClientRect();
              const navigation=document.querySelector('nav[aria-label="主要導覽"]').getBoundingClientRect();
              return panel.top >= header.bottom-1 && panel.bottom <= navigation.top+1;
            }'''), 'Short-window service menu covered the header or bottom navigation'
            # The task-first menu discloses secondary services progressively.
            # Expand the real controls before checking keyboard reachability.
            for summary in await page.locator('details[data-directory-section] > summary').all():
                if not await summary.evaluate('node => node.parentElement.open'):
                    await summary.click()
            last = page.locator('[data-service-link]').last
            await last.focus()
            await expect(last).to_be_in_viewport(ratio=1)
            assert await last.evaluate('''node => {
              const link=node.getBoundingClientRect();
              const panel=node.closest('header').querySelector('[aria-label="關閉所有服務"]').parentElement.parentElement.getBoundingClientRect();
              return link.top >= panel.top-1 && link.bottom <= panel.bottom+1;
            }'''), 'Last service was clipped within its panel'
            await capture(f'services-short-{width}', full_page=False)
            await close.focus()
            await expect(close).to_be_in_viewport(ratio=1)
            await close.press('Enter')
            await expect(trigger).to_be_focused()
        report['checks'].append('390×320 and 640×360 service menus keep header and bottom navigation clear; last service and close action are reachable')
    finally:
        await page.set_viewport_size(original)


async def check_short_navigation_panels(page, report, capture):
    original = page.viewport_size
    original_font = await page.locator('html').evaluate('node => node.style.fontSize')

    async def contained_control(control, panel, name):
        await expect(control).to_be_focused()
        await expect(control).to_be_in_viewport(ratio=1)
        geometry = await control.evaluate('''node => {
          const bounds=node.getBoundingClientRect();
          const panel=document.getElementById(node.closest('details').querySelector('summary').getAttribute('aria-controls'));
          const region=panel.getBoundingClientRect();
          return {top:bounds.top,bottom:bounds.bottom,left:bounds.left,right:bounds.right,
            panelTop:region.top+panel.clientTop,panelBottom:region.top+panel.clientTop+panel.clientHeight,
            panelLeft:region.left+panel.clientLeft,panelRight:region.left+panel.clientLeft+panel.clientWidth};
        }''')
        assert (geometry['top'] >= geometry['panelTop'] - 1
                and geometry['bottom'] <= geometry['panelBottom'] + 1
                and geometry['left'] >= geometry['panelLeft'] - 1
                and geometry['right'] <= geometry['panelRight'] + 1), (name, geometry)
        await panel_bounds(panel, name)

    async def panel_bounds(panel, name):
        geometry = await panel.evaluate('''node => {
          const bounds=node.getBoundingClientRect();
          const header=node.closest('header').getBoundingClientRect();
          const navigation=document.querySelector('nav[aria-label="主要導覽"]').getBoundingClientRect();
          return {top:bounds.top,bottom:bounds.bottom,left:bounds.left,right:bounds.right,
            headerBottom:header.bottom,navigationTop:navigation.top,width:innerWidth,
            scrollHeight:node.scrollHeight,clientHeight:node.clientHeight};
        }''')
        assert (geometry['top'] >= geometry['headerBottom'] - 1
                and geometry['bottom'] <= geometry['navigationTop'] + 1
                and geometry['left'] >= 0 and geometry['right'] <= geometry['width']), (name, geometry)
        return geometry

    try:
        for width, height in ((390, 320), (640, 360)):
            await page.set_viewport_size({'width': width, 'height': height})
            # Use the real typography preference and layout, not mocked geometry.
            await page.locator('html').evaluate('node => { node.style.fontSize="200%"; }')
            await page.evaluate('window.scrollTo({top:0,behavior:"instant"})')
            school = page.locator('summary[aria-label="切換校園：靜宜大學"]')
            await school.click()
            school_panel = page.locator('[id="' + await school.get_attribute('aria-controls') + '"]')
            close = page.get_by_role('button', name='關閉校園選擇', exact=True)
            await page.keyboard.press('Tab')
            await contained_control(close, school_panel, 'school close')
            await page.keyboard.press('Tab')
            search = page.get_by_role('searchbox', name='搜尋校園', exact=True)
            await contained_control(search, school_panel, 'school search')
            await search.fill('不存在的校園')
            await expect(page.get_by_role('status', name='校園搜尋結果')).to_contain_text('找不到符合')
            await page.keyboard.press('Tab')
            clear = page.get_by_role('button', name='清除搜尋', exact=True)
            await contained_control(clear, school_panel, 'school clear')
            await page.keyboard.press('Tab')
            choice = page.get_by_role('combobox', name='瀏覽校園', exact=True)
            await contained_control(choice, school_panel, 'school selection')
            await expect(choice).to_have_value('pu')
            geometry = await panel_bounds(school_panel, 'school panel after traversal')
            assert geometry['scrollHeight'] > geometry['clientHeight'], ('Short-window overflow was not exercised', geometry)
            assert await school_panel.evaluate('node => node.scrollTop > 0'), 'Tab did not reach the lower part of the school panel'
            await capture(f'school-short-large-{width}', full_page=False)
            for control in (clear, search, close):
                await page.keyboard.press('Shift+Tab')
                await contained_control(control, school_panel, 'school reverse traversal')
            await close.press('Enter')
            await expect(school).to_be_focused()

            account = page.locator('summary[aria-label="帳號"]')
            if await account.count():
                await account.click()
                account_panel = page.locator('[id="' + await account.get_attribute('aria-controls') + '"]')
                account_close = page.get_by_role('button', name='關閉帳號選單', exact=True)
                await page.keyboard.press('Tab')
                await contained_control(account_close, account_panel, 'account close')
                account_links = account_panel.get_by_role('link')
                for link in await account_links.all():
                    await page.keyboard.press('Tab')
                    await contained_control(link, account_panel, 'account destination')
                await page.keyboard.press('Tab')
                logout = account_panel.get_by_role('button', name='登出', exact=True)
                await contained_control(logout, account_panel, 'account logout')
                await capture(f'account-short-large-{width}', full_page=False)
                # Reach the last action without executing a logout or navigation.
                await page.keyboard.press('Escape')
                await expect(account).to_be_focused()
            report.setdefault('shortPanelViewports', []).append({'width': width, 'height': height, 'rootText': '200%'})
        report['checks'].append('School and account disclosures clear the measured header and mobile navigation at 390×320 and 640×360 with 200% text; native Tab reaches search, clear, school choice and the last account action, reverse traversal reaches close, and closing restores the opener')
    finally:
        await page.locator('html').evaluate('(node,value) => { node.style.fontSize=value; }', original_font)
        await page.set_viewport_size(original)


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
        # Pixel evidence records the settled interface, not a random reveal
        # frame. Motion behavior is asserted separately before capture.
        await page.screenshot(path=str(OUTPUT / filename), full_page=full_page, animations='disabled')
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
        await expect(page.get_by_role('dialog', name='校園助理')).to_have_count(1 if voice else 0)

    try:
        params = {key: value for key, value in config.items() if key in ('theme', 'role', 'text', 'motion', 'font')}
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
        voice = page.get_by_role('button', name='開啟校園助理', exact=True)
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
            assert await page.get_by_role('dialog', name='校園助理').evaluate('''panel => {
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

        # Collect the independent new form/short-window checks even if one
        # fails. A failure stays a failure; reset the synthetic page afterward
        # so a stuck dialog cannot hide defects in the next viewport.
        section_failures = []

        async def check_section(name, operation):
            try:
                await operation()
            except Exception as failure:
                section_failures.append({'section': name, 'error': repr(failure)})
                report['sectionFailures'] = section_failures
                await capture(name + '-failure', full_page=False)
                (OUTPUT / (config['name'] + '-' + name + '-failure.html')).write_text(await page.content(), encoding='utf-8')
                report.setdefault('sectionLedgers', []).append(await page.evaluate('window.__interfaceQA.snapshot()'))
                await page.goto(origin + '/?' + urlencode(params))
                await expect(page.get_by_role('heading', name='今天', exact=True)).to_be_visible()

        await check_section('forms', lambda: check_dialogs_and_fields(page, config, report, capture))
        await check_section('quick-search', lambda: check_quick_search(page, config, report, capture))
        if config['name'] in ('desktop-light', 'compact-dark-site-motion'):
            await check_section('short-services', lambda: check_short_service_menu(page, report, capture))
            await check_section('short-navigation', lambda: check_short_navigation_panels(page, report, capture))
            # The same real modal must remain operable in a short window, too.
            await page.set_viewport_size({'width': config['width'] if config['width'] < 400 else 390, 'height': 360})
            await check_section('short-forms', lambda: check_dialogs_and_fields(page, config, report, capture, '-short'))
            await page.set_viewport_size({'width': config['width'], 'height': config['height']})

        ledger = await page.evaluate('window.__interfaceQA.snapshot()')
        report['ledger'] = ledger
        assert not ledger['requests'], ledger
        assert ledger['logouts'] == 0, ledger
        assert not errors, errors
        assert not external, external
        assert not section_failures, section_failures
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
