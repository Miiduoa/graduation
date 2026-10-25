"""Check the campus entry pages against a local Web build with a guest session.

Run with the same Playwright installation as timetable-browser-smoke.py.
Screenshots use a local school-directory fixture, never a signed-in account.
"""

import asyncio
import json
import os
import re
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from playwright.async_api import async_playwright, expect

BASE = os.environ.get('CAMPUS_VISUAL_URL', 'http://127.0.0.1:3100')
if urlparse(BASE).hostname not in ('localhost', '127.0.0.1'):
    raise RuntimeError('Visual checks must run against a local server')
OUT = Path('artifacts/campus-visual')
OUT.mkdir(parents=True, exist_ok=True)


def session_fixtures(authenticated):
    async def fixtures(route):
        url = urlparse(route.request.url)
        if url.hostname not in ('localhost', '127.0.0.1'):
            await route.abort()
        elif url.path == '/api/schools':
            await route.fulfill(json={'schools': [
                {'id': 'pu', 'name': '靜宜大學', 'status': 'not-open'},
                {'id': 'nthu', 'name': '國立清華大學', 'status': 'not-open'},
            ]})
        elif url.path in ('/api/nuni/session', '/auth/session'):
            await route.fulfill(json={
                'authenticated': authenticated,
                **({'platformAccountId': 'pa_1'} if authenticated else {}),
            })
        elif url.path == '/auth/platform/providers':
            await route.fulfill(json={'kinds': ['google-consumer']})
        elif url.path.startswith('/api/transit'):
            await route.fulfill(json={'status': 'unavailable', 'reason': 'not-configured'})
        else:
            await route.continue_()
    return fixtures


fixtures = session_fixtures(False)


async def no_overflow(page):
    assert await page.evaluate(
        'document.documentElement.scrollWidth <= window.innerWidth'
    ), 'Page overflows horizontally'


async def check_mobile_navigation(page):
    navigation = page.get_by_role('navigation', name='主要導覽')
    assert await navigation.evaluate('''el => {
        const rect = el.getBoundingClientRect();
        return getComputedStyle(el).position === 'fixed'
            && Math.abs(rect.bottom - innerHeight) < 1;
    }'''), 'Mobile navigation is not docked to the viewport'
    footer = page.get_by_role('navigation', name='網站資訊').get_by_role('link', name='設定')
    await footer.scroll_into_view_if_needed()
    assert await footer.evaluate('''el => {
        const navigation = document.querySelector('nav[aria-label="主要導覽"]');
        return el.getBoundingClientRect().bottom <= navigation.getBoundingClientRect().top;
    }'''), 'Bottom navigation covers the last footer action'


UNSIGNED_TODAY = '登入後，這裡會列出近期要處理的課程待辦。'
TODAY_DATE = re.compile(r'^\d{1,2}月\d{1,2}日 週[日一二三四五六]$')
OLD_ACCOUNT_COPY = [
    '示意',
    '資料庫系統',
    '商院 305 · 第 3 節',
    '課表、請假、點餐，先看今天。',
    '學生、教職員與合作店家都要核發後的身分才能登入。學生與教職員由學校核發；店家須受邀。沒有帳號請用下方尋找學校，不提供公開註冊。',
    '學校還沒開通時，仍可用課班上課；正式請假與證件要等學校開通。',
]


async def goto_path(page, path):
    # Home/life keep session and transit probes alive, so networkidle can hang
    # after the page is already interactive.
    await page.goto(BASE + path, wait_until='load')


async def check_unsigned_account_entry(page):
    await expect(page.get_by_role('heading', name='登入', exact=True)).to_be_visible()
    await expect(page.get_by_text('請用學校核發的帳號登入。', exact=True)).to_be_visible()
    await expect(page.get_by_role('button', name='登入校園帳號')).to_be_visible()
    await expect(page.get_by_role('button', name='用 Google 繼續')).to_be_visible()
    await expect(page.get_by_role('button', name='尋找學校')).to_be_visible()
    await expect(page.get_by_role('link', name='尋找學校')).to_have_count(0)
    await expect(page.get_by_role('link', name='課班／教學')).to_have_attribute(
        'href', '/auth/platform/class-workspace/join'
    )
    footer = page.get_by_role('navigation', name='公開資訊')
    await expect(footer.get_by_role('link', name='隱私資訊')).to_have_attribute('href', '/privacy')
    await expect(footer.get_by_role('link', name='服務條款')).to_have_attribute('href', '/terms')
    await expect(footer.get_by_role('link', name='使用支援')).to_have_attribute('href', '/support')
    await expect(footer.get_by_role('link', name='帳號刪除／停用')).to_have_attribute(
        'href', '/account-deletion'
    )
    for copy in OLD_ACCOUNT_COPY:
        await expect(page.get_by_text(copy, exact=True)).to_have_count(0)
    await expect(page.get_by_role('article')).to_have_count(0)


async def check_unsigned_today(page):
    today = page.get_by_test_id('student-today')
    await expect(today).to_be_visible()
    await expect(today.get_by_test_id('today-skeleton')).to_have_count(0)
    await expect(today.get_by_role('heading', name='今天', exact=True)).to_be_visible()
    await expect(today.locator('header p').first).to_have_text(TODAY_DATE)
    await expect(page.get_by_text(UNSIGNED_TODAY, exact=True)).to_have_count(2)
    await expect(page.get_by_role('link', name='登入', exact=True)).to_be_visible()
    await expect(today.get_by_role('heading', name='今天課表', exact=True)).to_be_visible()
    await expect(today.get_by_text('還沒有課表。', exact=True)).to_be_visible()
    await expect(today.get_by_role('link', name='匯入課表', exact=True)).to_be_visible()
    await expect(today.get_by_role('heading', name='待處理', exact=True)).to_be_visible()
    await expect(page.get_by_role('heading', name='今天的校園日常')).to_have_count(0)
    await expect(page.get_by_role('link', name='用 Google 帳號登入')).to_have_count(0)
    await expect(page.locator('time[aria-current="date"]')).to_have_count(0)


async def check_oled(page):
    assert await page.evaluate('''() => {
        return getComputedStyle(document.body).backgroundColor === 'rgb(0, 0, 0)'
            && getComputedStyle(document.documentElement).backgroundColor === 'rgb(0, 0, 0)';
    }'''), 'Dark page background must be OLED black'
    assert await page.locator('meta[name="theme-color"]').evaluate_all(
        'metas => metas.length > 0 && metas.every(meta => meta.content === "#000000")'
    ), 'Browser chrome does not match the OLED theme'


async def check_task_text_scaling(page):
    """Exercise signed-in task markup with the built CSS, without an account."""
    previous = await page.evaluate('''() => ({
        fontSize: document.documentElement.style.fontSize,
        theme: document.documentElement.getAttribute('data-theme')
    })''')
    viewport = page.viewport_size
    await page.evaluate(r'''() => {
        const css = [...document.styleSheets]
            .flatMap(sheet => [...sheet.cssRules].map(rule => rule.cssText)).join('\n');
        const names = [...new Set([...css.matchAll(/\.([-_a-zA-Z][-_a-zA-Z0-9]*)/g)]
            .map(match => match[1]))];
        const main = document.querySelector('#today-content');
        const namespaces = [...(main?.classList ?? [])]
            .map(value => value.match(/^(.+)_main(?:__[-_a-zA-Z0-9]+)?$/)?.[1])
            .filter(Boolean);
        if (namespaces.length !== 1) throw new Error('Missing unique rendered home namespace');
        const c = name => {
            const expected = namespaces[0] + '_' + name;
            const matches = names.filter(value => value === expected || value.startsWith(expected + '__'));
            if (matches.length !== 1) throw new Error('Missing unique built home class: ' + name);
            return matches[0];
        };
        const fixture = document.createElement('div');
        fixture.dataset.taskTypographyFixture = 'true';
        fixture.className = c('page');
        fixture.innerHTML = `<main class="${c('main')}">
          <div class="${c('columns')}"><div class="${c('dayContent')}">
            <section class="${c('workPanel')}"><ul class="${c('list')}"><li>
              <a href="#" class="${c('task')}">
                <span class="${c('taskMarker')}" aria-hidden="true">□</span>
                <span class="${c('taskContent')}" data-task-title>
                  <strong>資料結構期末報告</strong><span>資料結構 · 作業</span>
                </span>
                <span class="${c('overdue')}" data-task-deadline>
                  <time datetime="2026-10-22T15:59:00Z">10/22 23:59</time>
                  <small>已過參考期限・仍可繳交</small>
                </span>
                <span class="${c('arrow')}" aria-hidden="true">→</span>
              </a>
            </li></ul></section>
          </div></div>
        </main>`;
        document.body.append(fixture);
    }''')
    try:
        for theme in ['light', 'dark']:
            await page.locator('html').evaluate('(el, theme) => el.dataset.theme = theme', theme)
            for width in [320, 360, 390, 768]:
                await page.set_viewport_size({'width': width, 'height': 844})
                for root_size in [16, 32]:
                    await page.locator('html').evaluate(
                        '(el, size) => el.style.fontSize = size + "px"', root_size
                    )
                    await page.evaluate('''() => new Promise(resolve =>
                        requestAnimationFrame(() => requestAnimationFrame(resolve)))''')
                    measurements = await page.locator('[data-task-typography-fixture]').evaluate('''el => {
                        const title = el.querySelector('[data-task-title]');
                        const deadline = el.querySelector('[data-task-deadline]');
                        return {
                            titleWidth: title.getBoundingClientRect().width,
                            titleSize: parseFloat(getComputedStyle(title.querySelector('strong')).fontSize),
                            deadlineWidth: deadline.clientWidth,
                            deadlineScrollWidth: deadline.scrollWidth,
                        };
                    }''')
                    scenario = f'{theme}, {width}px viewport, {root_size}px root: {measurements}'
                    await no_overflow(page)
                    assert measurements['titleWidth'] >= 2 * measurements['titleSize'], scenario
                    assert measurements['deadlineScrollWidth'] <= measurements['deadlineWidth'] + 1, scenario
                    if theme == 'dark':
                        assert await page.locator('body').evaluate(
                            'el => getComputedStyle(el).backgroundColor === "rgb(0, 0, 0)"'
                        ), scenario
    finally:
        await page.evaluate('''previous => {
            document.querySelector('[data-task-typography-fixture]')?.remove();
            document.documentElement.style.fontSize = previous.fontSize;
            if (previous.theme === null) document.documentElement.removeAttribute('data-theme');
            else document.documentElement.setAttribute('data-theme', previous.theme);
        }''', previous)
        await page.set_viewport_size(viewport)


async def main():
    results = []
    errors = []
    async with async_playwright() as playwright:
        launch = {}
        if os.environ.get('CAMPUS_VISUAL_CHROMIUM'):
            launch['executable_path'] = os.environ['CAMPUS_VISUAL_CHROMIUM']
        browser = await playwright.chromium.launch(**launch)
        context = await browser.new_context(
            viewport={'width': 1440, 'height': 1000},
            color_scheme='light',
            reduced_motion='reduce',
            service_workers='block',
        )
        await context.route('**/*', fixtures)
        page = await context.new_page()
        page.set_default_timeout(10000)
        page.on('pageerror', lambda error: errors.append(str(error)))
        try:
            for width, label in [(1440, 'desktop'), (768, 'tablet'), (390, 'mobile'), (320, 'small')]:
                await page.set_viewport_size({'width': width, 'height': 1000 if width > 768 else 844})
                await goto_path(page, '/?campus=pu')
                await check_unsigned_today(page)
                await no_overflow(page)
                await page.screenshot(path=str(OUT / f'home-{label}.png'), full_page=True, animations='disabled')
                if width == 390:
                    await page.screenshot(path=str(OUT / 'home-mobile-viewport.png'), animations='disabled')
                if width <= 760:
                    await check_mobile_navigation(page)
                results.append(f'home reflows at {width}px')

                await goto_path(page, '/life?campus=pu')
                await expect(page.get_by_role('heading', name='生活', exact=True)).to_be_visible()
                await expect(page.get_by_role('heading', name='常用查詢', exact=True)).to_be_visible()
                await no_overflow(page)
                await page.screenshot(path=str(OUT / f'life-{label}.png'), full_page=True, animations='disabled')
                if width <= 760:
                    await check_mobile_navigation(page)
                results.append(f'life directory reflows at {width}px')
            results.append('mobile bottom navigation leaves footer actions reachable')

            search = page.get_by_role('searchbox', name='快速找服務')
            await search.fill('借書')
            await expect(page.locator('#life-service-results a')).to_have_count(1)
            await expect(page.locator('#life-service-results a')).to_contain_text('圖書館')
            await search.fill('找不到的服務')
            await expect(page.get_by_role('heading', name='沒有找到符合的服務')).to_be_visible()
            await page.get_by_role('button', name='顯示全部服務').click()
            await expect(search).to_be_focused()
            await expect(page.get_by_role('heading', name='常用查詢', exact=True)).to_be_visible()
            await page.get_by_role('button', name='個人安排', exact=True).click()
            await expect(page.locator('#life-service-results a')).to_have_count(1)
            await expect(page.get_by_role('heading', name='報修 尚未開放')).to_be_visible()
            await page.get_by_role('button', name='全部', exact=True).click()
            results.append('service search, empty recovery and category filtering work on mobile')

            await page.set_viewport_size({'width': 390, 'height': 844})
            await goto_path(page, '/?campus=pu')
            services = page.locator('header summary[aria-label="所有服務"]')
            await services.click()
            await expect(page.get_by_role('link', name='尋找校園服務')).to_be_visible()
            await expect(page.get_by_role('button', name='關閉所有服務')).to_be_in_viewport()
            await no_overflow(page)
            await page.screenshot(path=str(OUT / 'mobile-services.png'), animations='disabled')
            await page.keyboard.press('Escape')
            await expect(services).to_be_focused()
            await expect(page.get_by_role('link', name='尋找校園服務')).not_to_be_visible()
            results.append('service menu opens within viewport and Escape restores focus')

            await page.keyboard.press('Control+k')
            menu_search = page.get_by_role('searchbox', name='搜尋服務', exact=True)
            await expect(menu_search).to_be_focused()
            await menu_search.fill('借書')
            menu_result = page.locator('[data-service-link]')
            await expect(menu_result).to_have_count(1)
            await expect(menu_result).to_have_attribute('aria-label', '圖書館')
            await menu_search.press('ArrowDown')
            await expect(menu_result).to_be_focused()
            await page.screenshot(path=str(OUT / 'service-search-mobile.png'), animations='disabled')
            await page.keyboard.press('Enter')
            await expect(page).to_have_url(re.compile(r'/library\?'))
            library_scope = parse_qs(urlparse(page.url).query)
            assert library_scope.get('campus') == ['pu']
            assert library_scope.get('schoolId') == ['pu']
            await expect(page.get_by_role('navigation', name='主要導覽').get_by_role(
                'link', name='生活', exact=True
            )).to_have_attribute('aria-current', 'page')
            await page.keyboard.press('Control+k')
            await expect(menu_search).to_be_focused()
            await menu_search.fill('找不到的服務')
            await expect(page.get_by_role('heading', name='沒有符合的服務')).to_be_visible()
            await page.get_by_role('button', name='查看全部服務', exact=True).click()
            await expect(menu_search).to_have_value('')
            await expect(menu_search).to_be_focused()
            await page.keyboard.press('Escape')
            results.append('menu search supports keyboard navigation, campus-scoped links and empty recovery')

            await goto_path(page, '/settings?campus=pu&section=appearance#reading')
            settings_nav = page.get_by_role('navigation', name='設定分類')
            await expect(page.get_by_role('heading', name='外觀設定', exact=True)).to_be_visible()
            await expect(settings_nav.get_by_role('button', name='外觀', exact=True)).to_have_attribute(
                'aria-current', 'page'
            )
            await expect(page.get_by_role('navigation', name='主要導覽').get_by_role(
                'link', name='我', exact=True
            )).to_have_attribute('aria-current', 'page')
            await no_overflow(page)
            await page.screenshot(path=str(OUT / 'settings-mobile.png'), full_page=True, animations='disabled')
            await settings_nav.get_by_role('button', name='隱私', exact=True).click()
            assert parse_qs(urlparse(page.url).query) == {'campus': ['pu'], 'section': ['privacy']}
            assert urlparse(page.url).fragment == 'reading'
            await page.go_back()
            await expect(page.get_by_role('heading', name='外觀設定', exact=True)).to_be_visible()
            await page.go_forward()
            await expect(settings_nav.get_by_role('button', name='隱私', exact=True)).to_have_attribute(
                'aria-current', 'page'
            )
            await settings_nav.get_by_role('button', name='隱私', exact=True).press('Home')
            await expect(settings_nav.get_by_role('button', name='一般', exact=True)).to_be_focused()
            assert parse_qs(urlparse(page.url).query) == {'campus': ['pu']}
            await page.keyboard.press('End')
            await expect(settings_nav.get_by_role('button', name='隱私', exact=True)).to_be_focused()
            await no_overflow(page)
            results.append('settings deep links, history and keyboard sections preserve campus and fragment')

            await goto_path(page, '/?campus=pu')
            campus = page.locator('header summary[aria-label^="切換校園："]')
            await campus.click()
            await expect(page.get_by_role('combobox', name='瀏覽校園', exact=True)).to_be_visible()
            await no_overflow(page)
            await page.get_by_role('combobox', name='瀏覽校園', exact=True).select_option('nthu')
            await expect(campus).to_contain_text('國立清華大學')
            await expect(page.get_by_role('combobox', name='瀏覽校園', exact=True)).not_to_be_visible()
            timetable = page.get_by_role('navigation', name='主要導覽').get_by_role('link', name='課務')
            href = await timetable.get_attribute('href')
            assert parse_qs(urlparse(href).query).get('campus') == ['nthu']
            results.append('campus selection closes the picker and preserves navigation scope')

            for route, heading in [('/', '今天'), ('/life', '生活')]:
                await page.emulate_media(color_scheme='dark', reduced_motion='reduce')
                await goto_path(page, route + '?campus=pu')
                if route == '/':
                    await check_unsigned_today(page)
                else:
                    await expect(page.get_by_role('heading', name=heading, exact=True)).to_be_visible()
                await check_oled(page)
                await no_overflow(page)
                name = 'home' if route == '/' else 'life'
                await page.screenshot(path=str(OUT / f'{name}-dark.png'), full_page=True, animations='disabled')
                await page.screenshot(path=str(OUT / f'{name}-oled-mobile.png'), animations='disabled')
            results.append('home and life use OLED black with matching browser chrome')

            await page.set_viewport_size({'width': 1440, 'height': 1000})
            await goto_path(page, '/?campus=pu')
            await check_oled(page)
            await page.screenshot(path=str(OUT / 'home-oled-desktop.png'), full_page=True, animations='disabled')
            await page.set_viewport_size({'width': 390, 'height': 844})
            await page.locator('header summary[aria-label="所有服務"]').click()
            await page.screenshot(path=str(OUT / 'services-oled-mobile.png'), animations='disabled')
            await page.get_by_role('button', name='關閉所有服務').click()

            await page.emulate_media(color_scheme='light')
            await page.evaluate('''() => localStorage.setItem('campus-web-preferences', JSON.stringify({
                appearance: {theme: 'dark'}
            }))''')
            await goto_path(page, '/?campus=pu')
            await check_oled(page)
            for route in ['/bus?campus=pu', '/offline.html']:
                await page.goto(BASE + route, wait_until='load')
                assert await page.locator('body').evaluate(
                    'el => getComputedStyle(el).backgroundColor === "rgb(0, 0, 0)"'
                ), f'{route} does not preserve the OLED background'
                await no_overflow(page)
            results.append('explicit dark preference stays black in light system mode, transit and offline pages')

            await page.emulate_media(color_scheme='dark')
            await page.evaluate('''() => localStorage.setItem('campus-web-preferences', JSON.stringify({
                appearance: {theme: 'light', fontSize: 'large', animations: false}
            }))''')
            await page.set_viewport_size({'width': 320, 'height': 844})
            await goto_path(page, '/?campus=pu')
            await expect(page.locator('html')).to_have_attribute('data-reduced-motion', 'true')
            assert await page.locator('body').evaluate(
                'el => getComputedStyle(el).backgroundColor === "rgb(248, 247, 243)"'
            ), 'Explicit light theme must remain light'
            await no_overflow(page)
            await page.screenshot(path=str(OUT / 'home-large-text.png'), full_page=True, animations='disabled')
            await check_mobile_navigation(page)
            await check_task_text_scaling(page)
            results.append('course task titles and long deadlines reflow at 200% text size in both themes')
            await goto_path(page, '/life?campus=pu')
            await no_overflow(page)
            await check_mobile_navigation(page)
            results.append('320px large-text preference has no overflow')

            await page.emulate_media(color_scheme='light')
            await page.evaluate('''() => localStorage.removeItem('campus-web-preferences')''')
            await page.set_viewport_size({'width': 1440, 'height': 1000})
            await goto_path(page, '/auth/account')
            await check_unsigned_account_entry(page)
            await no_overflow(page)
            await page.screenshot(
                path=str(OUT / 'auth-account-desktop.png'),
                full_page=True,
                animations='disabled',
            )
            await page.set_viewport_size({'width': 390, 'height': 844})
            await goto_path(page, '/auth/account')
            await check_unsigned_account_entry(page)
            await no_overflow(page)
            await page.screenshot(
                path=str(OUT / 'auth-account-mobile.png'),
                animations='disabled',
            )
            results.append('unsigned account entry keeps existing actions without demo copy')

            await page.set_viewport_size({'width': 390, 'height': 844})
            await page.get_by_role('button', name='尋找學校').click()
            await expect(page.get_by_label('學校配發的信箱或校名')).to_be_visible()
            results.append('find-school action stays on the account page')

            await page.get_by_role('link', name='課班／教學').click()
            await page.wait_for_load_state('load')
            assert urlparse(page.url).path == '/auth/platform/class-workspace/join'
            assert '校園都在這' not in await page.title()
            await expect(page.get_by_role('heading', name='登入', exact=True)).to_have_count(0)
            results.append('class-workspace join stays off the new login page')

            response = await page.goto(BASE + '/auth/find-school', wait_until='load')
            assert urlparse(page.url).path == '/auth/account'
            await check_unsigned_account_entry(page)
            results.append('old find-school URL still lands on the new entry')

            for path in [
                '/auth/platform',
                '/auth/platform/ops',
                '/auth/platform/school-review',
                '/privacy/deletion-status',
            ]:
                response = await page.goto(BASE + path, wait_until='load')
                body = await page.content()
                for copy in OLD_ACCOUNT_COPY:
                    assert copy not in body, f'{path} still contains old copy'
                assert urlparse(page.url).path == path, path
                assert urlparse(page.url).path != '/auth/account'
                await expect(page.get_by_role('heading', name='登入', exact=True)).to_have_count(0)

            for path in ['/academics', '/staff', '/learning']:
                response = await page.goto(BASE + path, wait_until='load')
                body = await page.content()
                for copy in OLD_ACCOUNT_COPY:
                    assert copy not in body, f'{path} still contains old copy'
                assert '校園都在這' not in await page.title()
                assert response is not None and response.status == 404, path
                assert urlparse(page.url).path == path
            results.append('live old screens stay reachable; replaced shells 404 or redirect')

            signed = await browser.new_context(
                viewport={'width': 390, 'height': 844},
                color_scheme='light',
                reduced_motion='reduce',
                service_workers='block',
            )
            await signed.route('**/*', session_fixtures(True))
            signed_page = await signed.new_page()
            signed_page.set_default_timeout(10000)
            await signed_page.goto(BASE + '/auth/account?returnUrl=/life', wait_until='domcontentloaded')
            await signed_page.wait_for_url(re.compile(r'https?://[^/]+/life(?:\?.*)?$'))
            assert urlparse(signed_page.url).path == '/life'
            await signed_page.goto(BASE + '/auth/account?returnUrl=/staff', wait_until='domcontentloaded')
            await signed_page.wait_for_url(re.compile(r'https?://[^/]+/?(\?.*)?$'))
            assert urlparse(signed_page.url).path == '/'
            await signed.close()
            results.append('signed-in account visits follow allowed return paths')
            assert not errors, errors
        except Exception:
            await page.screenshot(path=str(OUT / 'failure.png'), full_page=True, animations='disabled')
            (OUT / 'failure-dom.txt').write_text(await page.locator('body').aria_snapshot(), encoding='utf-8')
            raise
        finally:
            (OUT / 'results.json').write_text(json.dumps({
                'checks': results, 'pageErrors': errors,
            }, ensure_ascii=False, indent=2), encoding='utf-8')
            await browser.close()
    print(json.dumps({'passed': len(results), 'checks': results}, ensure_ascii=False))


if __name__ == '__main__':
    asyncio.run(main())
