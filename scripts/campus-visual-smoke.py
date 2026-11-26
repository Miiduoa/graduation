"""Check the campus entry pages against a local Web build with a guest session.

Run with the same Playwright installation as timetable-browser-smoke.py.
Screenshots use a local school-directory fixture, never a signed-in account.
"""

import asyncio
import json
import os
import re
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlparse

from playwright.async_api import async_playwright, expect

BASE = os.environ.get('CAMPUS_VISUAL_URL', 'http://127.0.0.1:3100')
if urlparse(BASE).hostname not in ('localhost', '127.0.0.1'):
    raise RuntimeError('Visual checks must run against a local server')
OUT = Path('artifacts/campus-visual')
OUT.mkdir(parents=True, exist_ok=True)


def session_fixtures(authenticated, operator=False):
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
                # Match the browser session parser with a synthetic principal,
                # unprivileged by default. These fixtures never authenticate a server request.
                **({
                    'platformAccountId': 'pa_00000000-0000-4000-8000-000000000001',
                    'isPlatformOperator': operator,
                    'context': 'a' * 43,
                } if authenticated else {}),
            })
        elif url.path == '/api/nuni/sign-in-options':
            await route.fulfill(json={'google': True, 'studentId': False})
        elif url.path == '/auth/platform/providers':
            await route.fulfill(json={'kinds': ['google-consumer']})
        elif url.path.startswith('/api/transit'):
            await route.fulfill(json={'status': 'unavailable', 'reason': 'not-configured'})
        elif url.path == '/career/data':
            # Match emptyCareerFeed() without contacting school or jobs websites.
            assert parse_qs(url.query) == {'school': ['pu']}, route.request.url
            await route.fulfill(json={
                'announcements': [], 'timeline': [], 'jobs': [],
                'announcementsUnavailable': True, 'jobsUnavailable': True,
                'supported': True,
            })
        elif url.path == '/api/platform-admin/school-applications':
            if not authenticated:
                await route.fulfill(status=401, json={'error': 'SIGN_IN_REQUIRED'})
            elif not operator:
                await route.fulfill(status=403, json={'error': 'OPERATOR_REQUIRED'})
            else:
                await route.fulfill(json={'applications': [{
                    'id': 'app-1',
                    'displayName': '待審學校',
                    'proposedTenantId': 'pending-school',
                    'proposedEmailDomain': 'pending.edu.tw',
                    'contactName': '王老師',
                    'contactEmail': 'wang@pending.edu.tw',
                    'justification': '請協助接入',
                    'state': 'pending',
                    'createdAt': '2026-11-06T08:00:00.000Z',
                    'decidedAt': None,
                    'tenantId': None,
                    'tenantState': None,
                }]})
        elif url.path == '/api/platform-admin/schools':
            if not authenticated:
                await route.fulfill(status=401, json={'error': 'SIGN_IN_REQUIRED'})
            elif not operator:
                await route.fulfill(status=403, json={'error': 'OPERATOR_REQUIRED'})
            else:
                await route.fulfill(json={'schools': [{
                    'kind': 'tenant',
                    'applicationId': None,
                    'tenantId': 'ready-school',
                    'displayName': '待開放學校',
                    'emailDomain': 'ready.edu.tw',
                    'lifecycle': 'provisioned',
                    'description': '',
                    'modules': {'leave': False, 'identity': False, 'food': False},
                    'peopleCount': 0,
                    'merchantCount': 0,
                }]})
        elif url.path.startswith('/api/platform-admin/'):
            if not authenticated:
                await route.fulfill(status=401, json={'error': 'SIGN_IN_REQUIRED'})
            elif not operator:
                await route.fulfill(status=403, json={'error': 'OPERATOR_REQUIRED'})
            else:
                if url.path == '/api/platform-admin/merchants':
                    await route.fulfill(json={
                        'interest': [], 'applications': [], 'catalog': [],
                        'honesty': '本次載入',
                    })
                elif url.path == '/api/platform-admin/class-workspace-affiliation-applications':
                    await route.fulfill(json={'applications': []})
                else:
                    await route.fulfill(json={'schools': [], 'records': [], 'items': []})
        else:
            await route.continue_()
    return fixtures


fixtures = session_fixtures(False)


async def no_overflow(page):
    assert await page.evaluate(
        'document.documentElement.scrollWidth <= window.innerWidth'
    ), 'Page overflows horizontally'


async def check_primary_navigation(page, active, campus='pu'):
    navigation = page.get_by_role('navigation', name='主要導覽')
    destinations = [
        ('今天', '/'), ('探索', '/explore'), ('課務', '/timetable'),
        ('交流', '/connect'), ('我的', '/profile'),
    ]
    await expect(navigation.get_by_role('link')).to_have_count(len(destinations))
    for label, path in destinations:
        link = navigation.get_by_role('link', name=label, exact=True)
        await expect(link).to_be_visible()
        destination = urlparse(await link.get_attribute('href'))
        assert destination.path == path, destination
        assert parse_qs(destination.query).get('campus') == [campus], destination
    await expect(navigation.locator('[aria-current="page"]')).to_have_count(0 if active is None else 1)
    if active is not None:
        await expect(navigation.get_by_role('link', name=active, exact=True)).to_have_attribute(
            'aria-current', 'page'
        )


async def check_mobile_navigation(page):
    navigation = page.get_by_role('navigation', name='主要導覽')
    assert await navigation.evaluate('''el => {
        const rect = el.getBoundingClientRect();
        return getComputedStyle(el).position === 'fixed'
            && Math.abs(rect.bottom - innerHeight) < 1;
    }'''), 'Mobile navigation is not docked to the viewport'
    # Today's footer is inside a disclosure; open it as a visitor would.
    information = page.locator('details').filter(
        has=page.get_by_role('navigation', name='網站資訊', include_hidden=True)
    )
    if await information.count() and not await information.evaluate('el => el.open'):
        await information.locator('summary').click()
    footer = page.get_by_role('navigation', name='網站資訊').get_by_role('link', name='設定')
    await footer.scroll_into_view_if_needed()
    assert await footer.evaluate('''el => {
        const navigation = document.querySelector('nav[aria-label="主要導覽"]');
        return el.getBoundingClientRect().bottom <= navigation.getBoundingClientRect().top;
    }'''), 'Bottom navigation covers the last footer action'


UNSIGNED_TODAY = '登入後，這裡會列出近期要處理的課程待辦。'
TODAY_FLOW_CLASS_TITLE = '今日課表'
TODAY_FLOW_WORK_TITLE = '課程待辦'
TODAY_NOTIFY_TITLE = '未讀通知'
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


async def wait_for_campus_header(page, school_id, school_name):
    # The load event does not mean React has finished adopting streamed content.
    # A raw CSS locator can briefly see both client and hidden server headers.
    # Wait for the whole DOM to contain one header with a resolved picker; never
    # choose the first/visible copy, which would hide a persistent duplicate.
    await page.wait_for_function('''({schoolId, schoolName}) => {
        const headers = document.querySelectorAll('header[data-campus-navigation="true"]');
        const campuses = document.querySelectorAll('header summary[aria-label^="切換校園："]');
        if (headers.length !== 1 || campuses.length !== 1) return false;
        const campus = campuses[0];
        const picker = campus.closest('details')?.querySelector('select');
        return headers[0].contains(campus)
            && campus.getAttribute('aria-label') === `切換校園：${schoolName}`
            && picker !== null && picker !== undefined && !picker.disabled
            && picker.value === schoolId;
    }''', arg={'schoolId': school_id, 'schoolName': school_name}, timeout=5000)
    await expect(page.locator('header[data-campus-navigation="true"]')).to_have_count(1)
    campus = page.locator('header summary[aria-label^="切換校園："]')
    await expect(campus).to_have_count(1)
    return campus


def assert_login_destination(href, return_path, school_context=None):
    context = school_context or {}
    assert set(context) <= {'school', 'schoolId', 'campus'}, context
    if context.get('campus') == 'all':
        assert context == {'campus': 'all'}, context
    assert 'personal' not in context.values(), context
    destination = urlparse(href)
    assert destination.path == '/login', href
    # Exact equality rejects token, session, nested redirects and other outer
    # parameters; expected campus values come from each scenario, not the href.
    assert parse_qs(destination.query, keep_blank_values=True) == {
        'returnUrl': [return_path],
        **{key: [value] for key, value in context.items()},
    }, href
    assert not destination.fragment, href


async def check_life_navigation_continuity(page, results):
    """Exercise the built Next routes and history, not a simulated router."""
    scope = {'school': 'PU', 'schoolId': 'pu', 'campus': 'pu', 'term': '115|2'}
    fragment = 'life-service-results'

    async def expect_address(query='', category='all'):
        expected = {key: [value] for key, value in scope.items()}
        if query:
            expected['q'] = [query]
        if category != 'all':
            expected['access'] = [category]

        def matches(value):
            address = urlparse(value)
            return (
                address.path == '/life'
                and parse_qs(address.query, keep_blank_values=True) == expected
                and address.fragment == fragment
            )

        await page.wait_for_url(matches)

    await page.set_viewport_size({'width': 390, 'height': 844})
    await goto_path(page, '/life?' + urlencode({
        **scope, 'q': '館藏', 'access': 'public',
    }) + '#' + fragment)
    search = page.get_by_role('searchbox', name='快速找服務')
    public = page.get_by_role('checkbox', name='只看免登入服務', exact=True)
    matches = page.locator('#life-service-results a')
    library = page.locator('#life-service-results a[href^="/library"]')
    await expect(search).to_have_value('館藏')
    await expect(public).to_be_checked()
    await expect(matches).to_have_count(1)
    await expect(library).to_be_visible()
    await expect_address('館藏', 'public')
    history_length = await page.evaluate('history.length')

    await search.fill('借')
    await expect_address('借', 'public')
    await search.press_sequentially('書')
    await expect(search).to_have_value('借書')
    await expect_address('借書', 'public')
    await page.get_by_role('button', name='全部', exact=True).click()
    await expect_address('借書', 'public')
    await public.check()
    await expect_address('借書', 'public')
    assert await page.evaluate('history.length') == history_length, (
        'Typing and category changes must replace the life entry, not add history entries'
    )
    await expect(matches).to_have_count(1)
    await no_overflow(page)
    results.append('life incoming filters preserve school, term and fragment without adding typing history')

    destination = urlparse(await library.get_attribute('href'))
    destination_query = parse_qs(destination.query, keep_blank_values=True)
    assert destination.path == '/library', destination
    assert destination_query.get('schoolId') == ['pu'], destination
    assert destination_query.get('campus') == ['pu'], destination
    assert 'q' not in destination_query and 'category' not in destination_query, destination
    assert not destination.fragment, destination
    await library.click()
    await page.wait_for_url(lambda value: urlparse(value).path == '/library')
    await expect(page.get_by_role('heading', name='圖書館', exact=True)).to_be_visible()
    assert parse_qs(urlparse(page.url).query, keep_blank_values=True) == destination_query

    await page.go_back()
    await expect_address('借書', 'public')
    await expect(search).to_have_value('借書')
    await expect(public).to_be_checked()
    await expect(matches).to_have_count(1)
    await expect(library).to_be_visible()
    await page.go_forward()
    await page.wait_for_url(lambda value: urlparse(value).path == '/library')
    await expect(page.get_by_role('heading', name='圖書館', exact=True)).to_be_visible()
    assert parse_qs(urlparse(page.url).query, keep_blank_values=True) == destination_query
    await page.go_back()
    await expect_address('借書', 'public')
    await expect(search).to_have_value('借書')
    await expect(public).to_be_checked()
    await page.reload(wait_until='load')
    await expect_address('借書', 'public')
    await expect(search).to_have_value('借書')
    await expect(public).to_be_checked()
    await expect(matches).to_have_count(1)
    await no_overflow(page)
    await page.screenshot(
        path=str(OUT / 'life-search-return-mobile.png'), full_page=True, animations='disabled',
    )
    results.append('life service links keep their own query; back, forward and reload preserve directory filters')

    await page.get_by_role('button', name='清除搜尋', exact=True).click()
    await expect(search).to_have_value('')
    await expect(search).to_be_focused()
    await expect(public).to_be_checked()
    await expect_address('', 'public')

    # DOM composition events test the controlled input's IME handlers. This is not
    # a claim that Chromium automation opens or operates an OS input method.
    history_length = await page.evaluate('history.length')
    await search.dispatch_event('compositionstart', {'data': ''})
    await search.fill('圖')
    await expect(search).to_have_value('圖')
    await expect_address('', 'public')
    await search.dispatch_event('keydown', {
        'key': 'Escape', 'code': 'Escape', 'isComposing': True,
    })
    await expect(search).to_have_value('圖')
    await expect_address('', 'public')
    await search.fill('圖書館')
    await search.dispatch_event('compositionend', {'data': '圖書館'})
    await expect_address('圖書館', 'public')
    await expect(matches).to_have_count(1)
    await expect(library).to_be_visible()
    await search.press('Escape')
    await expect(search).to_have_value('')
    await expect(search).to_be_focused()
    await expect_address('', 'public')

    await search.fill('ＢＯＯＫ')
    await expect_address('ＢＯＯＫ', 'public')
    await expect(search).to_have_value('ＢＯＯＫ')
    await expect(matches).to_have_count(1)
    await expect(library).to_be_visible()
    await search.press('Escape')
    await expect(search).to_have_value('')
    await expect_address('', 'public')
    await expect(public).to_be_checked()
    assert await page.evaluate('history.length') == history_length
    await page.get_by_role('button', name='顯示全部服務', exact=True).click()
    await expect(search).to_be_focused()
    await expect(page.get_by_role('button', name='全部', exact=True)).to_have_attribute(
        'aria-pressed', 'true',
    )
    await expect_address()
    await expect(page.get_by_role('heading', name='校園資源', exact=True)).to_be_visible()
    results.append('life clear and Escape retain category; composition and full-width search keep usable text and scoped URLs')


async def check_full_service_search_journey(page, results):
    """Check the built /search route with real Next history and local guest fixtures."""
    original_viewport = page.viewport_size
    previous_preferences = await page.evaluate(
        "localStorage.getItem('campus-web-preferences')"
    )
    search = page.get_by_role('searchbox', name='想找什麼？', exact=True)
    form = page.get_by_role('search', name='尋找服務', exact=True)
    library = page.locator('#service-search-results a[href^="/library"]')
    result_title = page.locator('#service-search-results').get_by_role(
        'heading', name='搜尋結果', exact=True,
    )

    async def expect_search(query='', category='all'):
        expected = {'campus': ['pu']}
        if query:
            expected['q'] = [query]
        if category != 'all':
            expected['category'] = [category]
        await page.wait_for_url(lambda value: (
            urlparse(value).path == '/search'
            and parse_qs(urlparse(value).query, keep_blank_values=True) == expected
            and not urlparse(value).fragment
        ))
        await expect(search).to_have_value(query)
        label = '全部' if category == 'all' else '校園生活'
        await expect(form.get_by_role('button', name=label, exact=True)).to_have_attribute(
            'aria-pressed', 'true',
        )

    try:
        await page.set_viewport_size({'width': 390, 'height': 844})
        await goto_path(page, '/search?campus=pu')
        await wait_for_campus_header(page, 'pu', '靜宜大學')
        await expect(page.get_by_role('heading', name='所有服務', exact=True)).to_be_visible()
        history_length = await page.evaluate('history.length')
        await search.fill('借')
        await search.press_sequentially('書')
        await form.get_by_role('button', name='校園生活', exact=True).click()
        await expect_search('借書', 'campus')
        assert await page.evaluate('history.length') == history_length, 'Typing added search history entries'
        await search.press('Enter')
        await expect(result_title).to_be_focused()
        await expect(library).to_have_count(1)
        destination = urlparse(await library.get_attribute('href'))
        destination_query = parse_qs(destination.query, keep_blank_values=True)
        assert destination.path == '/library' and destination_query.get('campus') == ['pu'], destination
        assert 'q' not in destination_query and 'category' not in destination_query, destination
        assert not destination.fragment, destination
        await library.click()
        await page.wait_for_url(lambda value: urlparse(value).path == '/library')
        await expect(page.get_by_role('heading', name='圖書館', exact=True)).to_be_visible()
        await page.go_back()
        await expect_search('借書', 'campus')
        await page.go_forward()
        await page.wait_for_url(lambda value: urlparse(value).path == '/library')
        await expect(page.get_by_role('heading', name='圖書館', exact=True)).to_be_visible()
        await page.go_back()
        await expect_search('借書', 'campus')
        await page.reload(wait_until='load')
        await wait_for_campus_header(page, 'pu', '靜宜大學')
        await expect_search('借書', 'campus')
        await no_overflow(page)
        await page.screenshot(path=str(OUT / 'full-service-search-history-mobile.png'), full_page=True, animations='disabled')

        await form.get_by_role('button', name='清除搜尋', exact=True).click()
        await expect(search).to_be_focused()
        await expect_search('', 'campus')
        # DOM composition events cover React's IME event path, not an OS keyboard.
        await search.dispatch_event('compositionstart', {'data': ''})
        await search.fill('圖')
        await expect(search).to_have_value('圖')
        assert parse_qs(urlparse(page.url).query).get('q') is None
        assert await search.evaluate("""node => {
            const event = new KeyboardEvent('keydown', {key:'Enter',isComposing:true,bubbles:true,cancelable:true});
            node.dispatchEvent(event);
            return event.defaultPrevented;
        }"""), 'IME Enter was not cancelled'
        await form.evaluate('node => node.requestSubmit()')
        await expect(search).to_be_focused()
        await search.dispatch_event('keydown', {'key': 'Escape', 'isComposing': True})
        await expect(search).to_have_value('圖')
        await search.fill('圖書館')
        await search.dispatch_event('compositionend', {'data': '圖書館'})
        await expect_search('圖書館', 'campus')
        assert await search.evaluate("""node => {
            const event = new KeyboardEvent('keydown', {key:'Enter',keyCode:229,bubbles:true,cancelable:true});
            node.dispatchEvent(event);
            return event.defaultPrevented;
        }"""), 'WebKit composition fallback was not cancelled'
        await search.press('Enter')
        await expect(result_title).to_be_focused()
        await expect(library).to_have_count(1)
        await page.get_by_role('button', name='清除篩選', exact=True).click()
        await expect_search()
        await expect(search).to_be_focused()

        # Create a second real native History entry, observed by Next. After a
        # service visit has saved the filtered draft, Back must still reach the
        # deliberately empty first entry, including after a reload.
        await page.evaluate("""() => {
            const url = new URL(location.href);
            url.searchParams.set('q', '借書');
            url.searchParams.set('category', 'campus');
            history.pushState(null, '', url.pathname + url.search);
        }""")
        await expect_search('借書', 'campus')
        await library.click()
        await page.wait_for_url(lambda value: urlparse(value).path == '/library')
        await page.go_back()
        await expect_search('借書', 'campus')
        await page.go_back()
        await expect_search()
        await page.reload(wait_until='load')
        await wait_for_campus_header(page, 'pu', '靜宜大學')
        await expect_search()
        await expect(page.locator('#service-search-results').get_by_role('heading', name='服務目錄', exact=True)).to_be_visible()
        results.append('full service search preserves campus and category through Enter, service visits, Back, Forward and reload; real empty history entries override saved drafts; composition stays local until completion')

        await goto_path(page, '/settings?campus=pu&section=appearance')
        await page.get_by_role('group', name='字級', exact=True).get_by_role('button', name='中', exact=True).click()
        await page.get_by_role('button', name='淺色', exact=True).click()
        # Visual cases start with an explicit query: session restoration may
        # already show the same text, so filling it again need not emit a change.
        await goto_path(page, '/search?campus=pu&q=借書')
        await wait_for_campus_header(page, 'pu', '靜宜大學')
        await expect_search('借書')
        normal_input_size = await search.evaluate('node => parseFloat(getComputedStyle(node).fontSize)')
        for width in (320, 390, 1440):
            await page.set_viewport_size({'width': width, 'height': 1000 if width > 760 else 844})
            await no_overflow(page)
            await search.press('Enter')
            await expect(result_title).to_be_focused()
            await expect(result_title).to_be_in_viewport(ratio=1)
            await library.focus()
            await expect(library).to_be_in_viewport(ratio=1)
            await page.screenshot(path=str(OUT / f'full-service-search-{width}.png'), full_page=True, animations='disabled')

        await goto_path(page, '/settings?campus=pu&section=appearance')
        await page.get_by_role('group', name='字級', exact=True).get_by_role('button', name='大', exact=True).click()
        await page.get_by_role('button', name='深色', exact=True).click()
        await goto_path(page, '/search?campus=pu&q=借書')
        await wait_for_campus_header(page, 'pu', '靜宜大學')
        await expect_search('借書')
        assert await search.evaluate('node => parseFloat(getComputedStyle(node).fontSize)') > normal_input_size, 'Search input ignored the large text preference'
        # A reduced-motion reflow must finish synchronously so Enter scrolls to
        # the final heading position, even in the same frame as a text resize.
        assert await result_title.evaluate("""heading => {
            const before = parseFloat(getComputedStyle(heading).fontSize);
            document.documentElement.style.fontSize = '200%';
            return parseFloat(getComputedStyle(heading).fontSize) === before * 2;
        }"""), 'Reduced motion delayed the new results heading size'
        for width in (320, 390):
            await page.set_viewport_size({'width': width, 'height': 844})
            await check_oled(page)
            await no_overflow(page)
            await search.press('Enter')
            await expect(result_title).to_be_focused()
            await expect(result_title).to_be_in_viewport(ratio=1)
            await page.screenshot(path=str(OUT / f'full-service-search-oled-large-{width}.png'), full_page=True, animations='disabled')
        results.append('full service search reflows at 320, 390 and 1440px; the input follows the saved large text preference and the 200% root text/OLED layouts remain readable without horizontal overflow')
    except Exception:
        await page.screenshot(path=str(OUT / 'full-service-search-failure.png'), full_page=True, animations='disabled')
        raise
    finally:
        await page.evaluate("""previous => {
            if (previous === null) localStorage.removeItem('campus-web-preferences');
            else localStorage.setItem('campus-web-preferences', previous);
            document.documentElement.style.fontSize = '';
        }""", previous_preferences)
        await page.set_viewport_size(original_viewport)


async def check_today_navigation_continuity(page, results):
    """A new Today visit must not consume another visit's global scroll cache."""
    await page.set_viewport_size({'width': 390, 'height': 844})
    # The preceding directory test covers the full school/schoolId/term deep link.
    await goto_path(page, '/life?campus=pu')
    await expect(page.get_by_role('heading', name='生活', exact=True)).to_be_visible()
    previous = await page.evaluate('''() => {
        const saved = sessionStorage.getItem('campus-today-scroll');
        sessionStorage.setItem('campus-today-scroll', '960');
        return saved;
    }''')
    try:
        await page.get_by_role('heading', name='校園資源', exact=True).scroll_into_view_if_needed()
        navigation = page.get_by_role('navigation', name='主要導覽')
        today = navigation.get_by_role('link', name='今天', exact=True)
        await today.click()
        await page.wait_for_url(lambda value: urlparse(value).path == '/')
        await expect(page.get_by_test_id('student-today')).to_be_visible()
        await expect(page.get_by_test_id('today-skeleton')).to_have_count(0)
        heading = page.get_by_test_id('student-today').get_by_role(
            'heading', name='今天', exact=True,
        )
        await expect(heading).to_be_in_viewport(ratio=1)
        await expect(today).to_have_attribute('aria-current', 'page')
        await page.screenshot(
            path=str(OUT / 'today-new-visit-mobile.png'), animations='disabled',
        )

        # Next and the browser own each history entry's position. Check the real
        # destinations and the newly visited Today header, without imposing an
        # unverified pixel-for-pixel restoration policy on the life page.
        await page.go_back()
        await page.wait_for_url(lambda value: urlparse(value).path == '/life')
        await expect(page.get_by_role('heading', name='生活', exact=True)).to_be_visible()
        assert parse_qs(urlparse(page.url).query).get('campus') == ['pu']
        await page.go_forward()
        await page.wait_for_url(lambda value: urlparse(value).path == '/')
        await expect(page.get_by_test_id('student-today')).to_be_visible()
        await expect(page.get_by_test_id('today-skeleton')).to_have_count(0)
        await expect(heading).to_be_in_viewport(ratio=1)
        assert await page.evaluate("sessionStorage.getItem('campus-today-scroll')") == '960', (
            'Today must not write a document position back to the legacy shared cache'
        )
        results.append('new Today navigation ignores legacy scroll; real back and forward retain the expected destinations')
    finally:
        await page.evaluate('''saved => {
            if (saved === null) sessionStorage.removeItem('campus-today-scroll');
            else sessionStorage.setItem('campus-today-scroll', saved);
        }''', previous)


async def follow_account_return(page, target, expected_target=None, school_context=None):
    destination = target if expected_target is None else expected_target
    expected = urlparse(destination)
    await page.goto(
        BASE + '/auth/account?' + urlencode({'returnUrl': target}),
        wait_until='domcontentloaded',
    )
    await page.wait_for_url(lambda value: urlparse(value).path == '/login')
    assert_login_destination(page.url, destination, school_context)
    await no_overflow(page)
    action = page.get_by_role('link', name='繼續使用', exact=True)
    await expect(action).to_have_attribute('href', destination)
    await action.click()
    await page.wait_for_url(lambda value: urlparse(value).path == expected.path)
    actual = urlparse(page.url)
    assert parse_qs(actual.query, keep_blank_values=True) == parse_qs(
        expected.query, keep_blank_values=True
    ), page.url
    assert actual.fragment == expected.fragment, page.url


async def open_account_role_links(page):
    disclosure = page.locator('details[aria-label="其他身分與工作入口"]')
    roles = disclosure.locator('nav[aria-label="身分與工作入口"]')
    summary = disclosure.locator(':scope > summary')
    await expect(disclosure).to_have_count(1)
    await expect(summary.locator('strong')).to_have_text('其他身分與工作入口')
    await expect(disclosure).to_have_js_property('open', False)
    await expect(roles).to_have_count(1)
    await expect(roles).not_to_be_visible()
    await summary.focus()
    await summary.press('Enter')
    await expect(disclosure).to_have_js_property('open', True)
    await expect(roles).to_be_visible()
    await summary.press('Tab')
    await expect(roles.get_by_role('link').first).to_be_focused()
    return roles, summary


async def check_unsigned_account_entry(page):
    await expect(page.get_by_role('heading', name='登入', exact=True)).to_be_visible()
    role_links, role_summary = await open_account_role_links(page)
    await expect(role_links.get_by_role('link', name='第一次申請店家進駐')).to_have_attribute('href', '/merchant/apply')
    await expect(role_links.get_by_role('link', name='查看申請或進入門市')).to_have_attribute('href', '/merchant/workspace')
    await expect(role_links.get_by_role('link', name='學生與教師進入課程')).to_have_attribute('href', '/classroom')
    await expect(role_links.get_by_role('link', name='平台管理員登入')).to_have_attribute('href', '/admin/login')
    await expect(role_links.get_by_role('link')).to_have_count(4)
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
    assert await footer.evaluate('''nav => {
        const rgb = value => value.match(/[\\d.]+/g).slice(0, 3).map(Number);
        const luminance = values => values.map(value => {
            const component = value / 255;
            return component <= 0.04045
                ? component / 12.92
                : ((component + 0.055) / 1.055) ** 2.4;
        }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
        const background = rgb(getComputedStyle(nav.closest('footer')).backgroundColor);
        const backgroundLight = luminance(background);
        return [...nav.querySelectorAll('a')].every(link => {
            const style = getComputedStyle(link);
            const opacity = Number(style.opacity);
            const foreground = rgb(style.color).map(
                (value, index) => value * opacity + background[index] * (1 - opacity)
            );
            const foregroundLight = luminance(foreground);
            return (Math.max(foregroundLight, backgroundLight) + 0.05)
                / (Math.min(foregroundLight, backgroundLight) + 0.05) >= 4.5;
        });
    }'''), 'Account footer links must remain readable in the current theme'
    for copy in OLD_ACCOUNT_COPY:
        await expect(page.get_by_text(copy, exact=True)).to_have_count(0)
    await expect(page.get_by_role('article')).to_have_count(0)
    await no_overflow(page)
    # After verifying the secondary tasks, capture the initial sign-in layout.
    await role_summary.focus()
    await role_summary.press('Space')
    await expect(role_links).not_to_be_visible()
    await expect(role_summary).to_be_focused()
    await page.evaluate('window.scrollTo(0, 0)')


async def open_login_role_links(page):
    return await open_account_role_links(page)


async def check_unsigned_login_entry(page):
    """The main login progressively reveals school and work-specific methods."""
    await expect(page.get_by_role('heading', name='登入', exact=True)).to_be_visible()
    google = page.get_by_role('button', name='使用 Google 帳號繼續', exact=True)
    await expect(google).to_be_enabled()
    action = urlparse(await google.evaluate('button => button.form.action'))
    assert action.path == '/auth/platform/start'
    assert parse_qs(action.query) == {'returnUrl': ['/']}
    await check_primary_navigation(page, None)

    school = page.locator('details[aria-label="學校帳號登入"]')
    school_summary = school.locator(':scope > summary')
    await expect(school).to_have_js_property('open', False)
    await expect(school.get_by_role('combobox', name='選擇學校', exact=True)).not_to_be_visible()
    await school_summary.focus()
    await school_summary.press('Enter')
    await expect(school).to_have_js_property('open', True)
    await expect(school.get_by_role('combobox', name='選擇學校', exact=True)).to_have_value('pu')
    await expect(school.get_by_role('status')).to_contain_text('此校園尚未開放學號直接登入。')
    # The fixture does not enable school authentication. Opening help must not
    # manufacture a usable credential form or suggest Google grants school access.
    await expect(school.get_by_role('button', name='連線學校帳號', exact=True)).to_have_count(0)
    await expect(school.get_by_label('學號', exact=True)).to_have_count(0)
    import_destination = urlparse(await school.get_by_role(
        'link', name='前往資料匯入'
    ).get_attribute('href'))
    assert import_destination.path == '/import'
    assert parse_qs(import_destination.query) == {
        'school': ['PU'], 'schoolId': ['pu'], 'campus': ['pu'],
    }
    await school_summary.press('Space')
    await expect(school).to_have_js_property('open', False)
    await expect(school_summary).to_be_focused()

    roles, summary = await open_login_role_links(page)
    for label, href in [
        ('第一次申請店家進駐', '/merchant/apply'),
        ('查看申請或進入門市', '/merchant/workspace'),
        ('學生與教師進入課程', '/classroom'),
        ('校方人員登入', '/auth/account?method=school'),
        ('平台管理員登入', '/admin/login'),
    ]:
        await expect(roles.get_by_role('link', name=label, exact=True)).to_have_attribute('href', href)
    await expect(roles.get_by_role('link')).to_have_count(5)
    await summary.focus()
    await summary.press('Space')
    await expect(roles).not_to_be_visible()
    await expect(summary).to_be_focused()
    guest = page.get_by_role('link', name='不登入，繼續瀏覽', exact=True)
    await expect(guest).to_be_visible()
    guest_destination = urlparse(await guest.get_attribute('href'))
    assert guest_destination.path == '/search'
    assert parse_qs(guest_destination.query).get('campus') == ['pu']
    await no_overflow(page)


async def check_merchant_entry_links(page):
    for entry, label, destination in [
        ('/login', '第一次申請店家進駐', '/merchant/apply'),
        ('/auth/account', '查看申請或進入門市', '/merchant/workspace'),
    ]:
        await goto_path(page, entry)
        if entry == '/login':
            roles, _ = await open_login_role_links(page)
        else:
            roles, _ = await open_account_role_links(page)
        await roles.get_by_role('link', name=label).click()
        await page.wait_for_url(BASE + destination)
        google = page.get_by_role('button', name='使用 Google 帳號繼續')
        await expect(google).to_be_visible()
        action = urlparse(await google.evaluate('button => button.form.action'))
        assert action.path == '/auth/platform/start'
        assert parse_qs(action.query) == {'returnUrl': [destination]}
        await no_overflow(page)


async def check_progressive_service_menu(page):
    """Keep every task reachable behind a compact first level and through Back."""
    menu = page.locator('header details:has(> summary[aria-label="所有服務"])')
    await expect(menu).to_have_js_property('open', True)
    primary = {
        '學習與課務': ['/timetable', '/classroom', '/calendar', '/import'],
        '校園生活': ['/map', '/bus', '/food', '/dormitory'],
        '消息與交流': ['/announcements', '/messages', '/dms', '/social'],
        '帳號與協助': ['/profile', '/settings', '/ai-assistant', '/support'],
    }
    # These are explicit fixture expectations, not counts computed from the UI.
    # Online ordering and the school-LMS reader stay disabled in this smoke build.
    all_destinations = {
        '/student-card', '/calendar', '/import', '/timetable', '/leave', '/leave/review',
        '/appeals', '/teacher', '/grades?tab=semester', '/grades?tab=feedback',
        '/classroom', '/classroom/material-bookmarks', '/school-courses', '/credit-planner',
        '/groups', '/announcements', '/events', '/clubs', '/messages', '/dms', '/social',
        '/community', '/friends', '/map', '/bus', '/food', '/cafeteria', '/dormitory',
        '/lost-found', '/merchant', '/library', '/career', '/school-info', '/ai-assistant',
        '/support', '/account-deletion', '/profile', '/settings', '/classroom/account', '/admin',
    }
    links = menu.locator('[data-service-link]')
    await expect(links).to_have_count(40)
    await expect(menu.locator('[data-service-link]:visible')).to_have_count(16)
    for name, expected in primary.items():
        section = menu.get_by_role('region', name=name, exact=True)
        visible = section.locator('[data-service-link]:visible')
        await expect(visible).to_have_count(4)
        actual = [urlparse(await link.get_attribute('href')).path for link in await visible.all()]
        assert actual == expected, (name, actual)
    actual_destinations = []
    for link in await links.all():
        href = urlparse(await link.get_attribute('href'))
        query = parse_qs(href.query)
        expected_scope = {'school': ['PU'], 'schoolId': ['pu'], 'campus': ['pu']}
        if href.path == '/grades':
            assert query.get('tab') in [['semester'], ['feedback']], href
            expected_scope['tab'] = query['tab']
        assert query == expected_scope, href
        assert not href.fragment, href
        actual_destinations.append(
            href.path + ('?tab=' + query['tab'][0] if href.path == '/grades' else '')
        )
    assert len(actual_destinations) == len(set(actual_destinations)), actual_destinations
    assert set(actual_destinations) == all_destinations, actual_destinations

    disclosures = menu.locator('details[data-directory-section]')
    await expect(disclosures).to_have_count(7)
    for disclosure in await disclosures.all():
        await expect(disclosure).to_have_js_property('open', False)
        summary = disclosure.locator(':scope > summary')
        await summary.focus()
        await summary.press('Enter')
        await expect(disclosure).to_have_js_property('open', True)
        await no_overflow(page)
    await expect(menu.locator('[data-service-link]:visible')).to_have_count(40)
    for disclosure in reversed(await disclosures.all()):
        summary = disclosure.locator(':scope > summary')
        await summary.focus()
        await summary.press('Space')
        await expect(disclosure).to_have_js_property('open', False)
    await expect(menu.locator('[data-service-link]:visible')).to_have_count(16)

    more = menu.locator('details[data-directory-section="group:campus"]')
    await more.locator(':scope > summary').click()
    career = more.get_by_role('link', name='職涯', exact=True)
    await expect(career).to_be_visible()
    origin = page.url
    await career.click()
    await page.wait_for_url(lambda value: urlparse(value).path == '/career')
    await page.go_back(wait_until='domcontentloaded')
    await page.wait_for_url(origin)
    await expect(menu).to_have_js_property('open', True)
    await expect(more).to_have_js_property('open', True)
    await expect(career).to_be_visible()
    await expect(menu.locator('[data-service-link]:visible')).to_have_count(22)
    await expect(menu.get_by_role('searchbox', name='搜尋服務', exact=True)).to_have_value('')
    await more.locator(':scope > summary').click()
    await expect(more).to_have_js_property('open', False)
    await expect(menu.locator('[data-service-link]:visible')).to_have_count(16)
    await no_overflow(page)


async def check_life_public_filter(page):
    """The three-group life directory keeps public child entries reachable."""
    await goto_path(page, '/life?campus=pu')
    public_only = page.get_by_role('checkbox', name='只看免登入服務', exact=True)
    await expect(public_only).not_to_be_checked()
    await public_only.check()
    results = page.locator('#life-service-results')
    links = results.locator('a[data-service-href]')
    public_services = {
        '/map', '/bus', '/cafeteria', '/dormitory', '/library', '/events', '/career', '/school-info',
    }
    await expect(links).to_have_count(8)
    assert set(await links.evaluate_all(
        "links => links.map(link => link.dataset.serviceHref)"
    )) == public_services
    for link in await links.all():
        href = urlparse(await link.get_attribute('href'))
        assert parse_qs(href.query) == {
            'school': ['PU'], 'schoolId': ['pu'], 'campus': ['pu'],
        }, href
    # Cafeteria is normally nested under signed-in ordering; the visitor filter
    # must retain the public child even though its parent is excluded.
    await expect(results.get_by_role('link', name='餐廳', exact=True)).to_be_visible()
    for path in ['/food', '/orders', '/clubs', '/lost-found']:
        await expect(results.locator(f'a[data-service-href="{path}"]')).to_have_count(0)
    await page.get_by_role('button', name='吃飯與住宿', exact=True).click()
    await expect(links).to_have_count(2)
    assert set(await links.evaluate_all(
        "links => links.map(link => link.dataset.serviceHref)"
    )) == {'/cafeteria', '/dormitory'}
    search = page.get_by_role('searchbox', name='快速找服務')
    await search.fill('餐廳')
    await expect(links).to_have_count(1)
    directory_url = page.url
    cafeteria = results.get_by_role('link', name='餐廳', exact=True)
    await cafeteria.focus()
    await cafeteria.press('Enter')
    await page.wait_for_url(lambda value: urlparse(value).path == '/cafeteria')
    await page.go_back(wait_until='domcontentloaded')
    await page.wait_for_url(directory_url)
    await expect(public_only).to_be_checked()
    await expect(search).to_have_value('餐廳')
    await expect(page.get_by_role('button', name='吃飯與住宿', exact=True)).to_have_attribute(
        'aria-pressed', 'true'
    )
    await expect(cafeteria).to_be_focused()
    await expect(links).to_have_count(1)
    assert parse_qs(urlparse(page.url).query) == {
        'campus': ['pu'], 'access': ['public'], 'group': ['daily'], 'q': ['餐廳'],
    }, page.url
    await page.get_by_role('button', name='顯示全部服務', exact=True).click()
    await expect(public_only).not_to_be_checked()
    await expect(search).to_have_value('')
    await expect(search).to_be_focused()
    await expect(page.get_by_role('button', name='全部', exact=True)).to_have_attribute(
        'aria-pressed', 'true'
    )
    assert parse_qs(urlparse(page.url).query) == {'campus': ['pu']}, page.url
    await no_overflow(page)


async def check_account_footer_contrast(page):
    footer = page.get_by_role('navigation', name='公開資訊')
    for link in await footer.get_by_role('link').all():
        await expect(link).to_be_visible()
        contrast = await link.evaluate('''link => {
            const channels = color => color.match(/[\\d.]+/g).map(Number);
            const background = channels(getComputedStyle(link.closest('footer')).backgroundColor);
            const style = getComputedStyle(link);
            const foreground = channels(style.color);
            const alpha = (foreground[3] ?? 1) * Number(style.opacity);
            const rendered = foreground.slice(0, 3).map((value, index) =>
                value * alpha + background[index] * (1 - alpha));
            const luminance = color => color.slice(0, 3).map(value => {
                const channel = value / 255;
                return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
            }).reduce((total, value, index) => total + value * [0.2126, 0.7152, 0.0722][index], 0);
            const a = luminance(rendered), b = luminance(background);
            return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        }''')
        assert contrast >= 4.5, f'Account footer link contrast is only {contrast:.2f}:1'


async def check_unsigned_today(page, campus='pu'):
    # The resolved browse context enriches known schools even when the visit
    # only supplied ?campus=. Keep explicit fixture expectations: neither the
    # login return path nor its outer scope may be inferred from the actual href.
    expected_contexts = {
        'pu': (
            '/?schoolId=pu&campus=pu&school=PU',
            {'schoolId': 'pu', 'campus': 'pu', 'school': 'PU'},
        ),
        'nthu': (
            '/?schoolId=nthu&campus=nthu&school=NTHU',
            {'schoolId': 'nthu', 'campus': 'nthu', 'school': 'NTHU'},
        ),
        'all': ('/?campus=all', {'campus': 'all'}),
    }
    assert campus in expected_contexts, f'Unspecified guest-home fixture campus: {campus}'
    expected_return, expected_context = expected_contexts[campus]
    today = page.get_by_test_id('student-today')
    await expect(today).to_be_visible()
    await expect(today.get_by_test_id('today-skeleton')).to_have_count(0)
    await expect(today.get_by_role('heading', name='今天', exact=True)).to_be_visible()
    await expect(today.locator('header p').first).to_have_text(TODAY_DATE)
    needs_school = campus == 'all'
    title = '選擇課表所屬校園' if needs_school else '建立第一份課表'
    welcome = today.get_by_role('region', name=title, exact=True)
    await expect(welcome).to_be_visible()
    if needs_school:
        await expect(welcome.get_by_role('link', name='選校園、整理課表', exact=True)).to_have_attribute(
            'href', '/timetable?campus=all'
        )
        await expect(welcome.get_by_role('link', name='先看生活服務', exact=True)).to_have_attribute(
            'href', '/life?campus=all'
        )
        await expect(welcome.get_by_role('link', name='匯入我的課表', exact=True)).to_have_count(0)
    else:
        await expect(welcome.get_by_role('link', name='匯入我的課表', exact=True)).to_have_attribute(
            'href', f'/import?kind=timetable&campus={campus}'
        )
        await expect(welcome.get_by_role('link', name='手動建立課表', exact=True)).to_have_attribute(
            'href', f'/timetable?campus={campus}'
        )
    sign_in = welcome.get_by_role('link', name='登入查看作業與通知', exact=True)
    await expect(sign_in).to_be_visible()
    assert_login_destination(
        await sign_in.get_attribute('href'), expected_return, expected_context
    )

    # First use has one setup action. Private placeholders and a second empty
    # timetable would turn the guest entry back into competing tasks.
    await expect(today.get_by_test_id('today-unified-flow')).to_have_count(0)
    for test_id in ['today-classes', 'today-work', 'today-notifications']:
        await expect(today.get_by_test_id(test_id)).to_have_count(0)
    for heading in [TODAY_FLOW_CLASS_TITLE, TODAY_FLOW_WORK_TITLE, TODAY_NOTIFY_TITLE]:
        await expect(today.get_by_role('heading', name=heading, exact=True)).to_have_count(0)
    await expect(today.get_by_text(UNSIGNED_TODAY)).to_have_count(0)
    await expect(today.get_by_text('還沒有課表。', exact=True)).to_have_count(0)
    await expect(today.get_by_role('link', name='匯入課表', exact=True)).to_have_count(0)
    quick_services = today.get_by_role('navigation', name='常用校園服務')
    await expect(quick_services.get_by_role('link')).to_have_count(4)
    for link, expected_path in zip(
        await quick_services.get_by_role('link').all(),
        ['/map', '/bus', '/cafeteria', '/library'],
        strict=True,
    ):
        destination = urlparse(await link.get_attribute('href'))
        assert destination.path == expected_path, destination
        assert parse_qs(destination.query, keep_blank_values=True) == {
            key: [value] for key, value in expected_context.items()
        }, destination
        assert not destination.fragment, destination
    await expect(page.get_by_role('link', name='登入', exact=True)).to_be_visible()
    await expect(today.get_by_role('button', name='設定首頁安排', exact=True)).to_be_visible()
    await expect(today.get_by_role('form', name='首頁安排偏好')).to_have_count(0)
    await check_primary_navigation(page, '今天', campus)
    await expect(page.get_by_role('heading', name='今天的校園日常')).to_have_count(0)
    await expect(page.get_by_role('link', name='用 Google 帳號登入')).to_have_count(0)
    await expect(page.locator('time[aria-current="date"]')).to_have_count(0)


async def check_deep_link_login_scope(page, preference, *, student_card=False):
    """The explicit campus survives Header login despite a different saved choice."""
    key = 'campus.browse-school.v1:guest'
    previous = await page.evaluate('key => localStorage.getItem(key)', key)
    saved_school = None if preference == 'all' else preference

    async def expect_saved_school(school_id):
        expected = json.dumps({'schoolId': school_id}, separators=(',', ':'))
        try:
            # wait_for_function can omit a nested Python None argument. Pass the
            # exact expected JSON as a string so explicit null is still required.
            await page.wait_for_function(
                '({key, expected}) => localStorage.getItem(key) === expected',
                arg={'key': key, 'expected': expected},
            )
            assert await page.evaluate('key => JSON.parse(localStorage.getItem(key))', key) == {
                'schoolId': school_id,
            }
        except Exception as error:
            # Capture only this fixture preference before finally restores it.
            state = await page.evaluate('''key => ({
                url: location.href,
                stored: localStorage.getItem(key),
                picker: document.querySelector('header select')?.value ?? null,
            })''', key)
            raise AssertionError(
                f'Expected saved campus {school_id!r}; actual state: '
                + json.dumps(state, ensure_ascii=False)
            ) from error

    try:
        await goto_path(page, '/?campus=pu')
        campus = await wait_for_campus_header(page, 'pu', '靜宜大學')
        await expect(campus).to_contain_text('靜宜大學')
        await campus.focus()
        await campus.press('Enter')
        picker = page.get_by_role('combobox', name='瀏覽校園', exact=True)
        await expect(picker).to_be_visible()
        await expect(picker).to_be_enabled()
        await expect(picker).to_have_value('pu')
        if preference == 'all':
            # Establish an actual saved campus before clearing it. A missing
            # preference must not stand in for the explicit {schoolId: null} case.
            await picker.select_option('nthu')
            await expect(picker).not_to_be_visible()
            await page.wait_for_url(
                lambda value: parse_qs(urlparse(value).query).get('campus') == ['nthu']
            )
            await expect_saved_school('nthu')
            await wait_for_campus_header(page, 'nthu', '國立清華大學')
            await expect(campus).to_contain_text('國立清華大學')
            await campus.focus()
            await campus.press('Enter')
            await expect(picker).to_be_visible()
            await expect(picker).to_be_enabled()
            await expect(picker).to_have_value('nthu')
        await picker.select_option('' if preference == 'all' else preference)
        await expect(picker).not_to_be_visible()
        await page.wait_for_url(
            lambda value: parse_qs(urlparse(value).query).get('campus') == [preference]
        )
        await expect_saved_school(saved_school)

        if student_card:
            await check_student_card_login_scope(page, preference, saved_school)
            return

        target = '/school-info?school=PU&schoolId=pu&campus=pu&token=discard-me#contact'
        await goto_path(page, target)
        await expect(page.get_by_role('heading', name='學校資訊', exact=True)).to_be_visible()
        await wait_for_campus_header(page, 'pu', '靜宜大學')
        await expect(campus).to_contain_text('靜宜大學')
        sign_in = page.locator('header[data-campus-navigation="true"]').get_by_role(
            'link', name='登入', exact=True
        )
        await expect(sign_in).to_be_visible()
        context = {'school': 'PU', 'schoolId': 'pu', 'campus': 'pu'}
        # The original task query and fragment remain inside returnUrl. Only the
        # three campus selectors may also appear on the login page itself.
        await expect(sign_in).to_have_attribute('href', re.compile(r'%23contact(?:&|$)'))
        assert_login_destination(await sign_in.get_attribute('href'), target, context)
        await sign_in.focus()
        await sign_in.press('Enter')
        await page.wait_for_url(lambda value: urlparse(value).path == '/login')
        await expect(page.get_by_role('heading', name='登入', exact=True)).to_be_visible()
        assert_login_destination(page.url, target, context)
        await check_primary_navigation(page, None, 'pu')

        school = page.locator('details[aria-label="學校帳號登入"]')
        await expect(school).to_have_js_property('open', False)
        await school.locator(':scope > summary').focus()
        await school.locator(':scope > summary').press('Enter')
        await expect(school.get_by_role('combobox', name='選擇學校', exact=True)).to_have_value('pu')
        await expect(school.get_by_role('status')).to_contain_text('此校園尚未開放學號直接登入。')
        await expect(school.get_by_label('學號', exact=True)).to_have_count(0)
        assert await page.evaluate('key => JSON.parse(localStorage.getItem(key))', key) == {
            'schoolId': saved_school,
        }
        await no_overflow(page)
        await page.screenshot(
            path=str(OUT / f'login-deep-link-from-{preference}-mobile.png'),
            full_page=True, animations='disabled',
        )
    finally:
        await page.evaluate('''({key, previous}) => {
            if (previous === null) localStorage.removeItem(key);
            else localStorage.setItem(key, previous);
        }''', {'key': key, 'previous': previous})


async def check_student_card_login_scope(page, preference, saved_school):
    """A school-only card keeps its PU task and school method through guest login."""
    target = '/student-card?campus=pu'
    expected = {
        'returnUrl': [target], 'campus': ['pu'], 'reconnect': ['school'],
    }
    await goto_path(page, target)
    await expect(page.get_by_role('heading', level=1, name='數位學生證', exact=True)).to_be_visible()
    await wait_for_campus_header(page, 'pu', '靜宜大學')
    await expect(page.locator('header summary[aria-label^="切換校園："]')).to_contain_text('靜宜大學')
    sign_in = page.get_by_role('link', name='登入學校帳號', exact=True)
    await expect(sign_in).to_be_visible()
    destination = urlparse(await sign_in.get_attribute('href'))
    assert destination.path == '/login'
    assert parse_qs(destination.query, keep_blank_values=True) == expected
    assert not destination.fragment
    await sign_in.focus()
    await sign_in.press('Enter')
    await page.wait_for_url(lambda value: urlparse(value).path == '/login')
    await expect(page.get_by_role('heading', level=1, name='連線學校帳號', exact=True)).to_be_visible()
    assert parse_qs(urlparse(page.url).query, keep_blank_values=True) == expected
    assert not urlparse(page.url).fragment
    school = page.locator('details[aria-label="學校帳號登入"]')
    await expect(school).to_have_js_property('open', True)
    await expect(school.get_by_role('combobox', name='選擇學校', exact=True)).to_have_value('pu')
    await expect(school.get_by_role('status')).to_have_text(
        '學校帳號登入目前未開放，暫時無法連線這項服務。你原本要開啟的頁面已保留。'
    )
    await expect(school.get_by_label('學號', exact=True)).to_have_count(0)
    assert await page.evaluate(
        'key => JSON.parse(localStorage.getItem(key))', 'campus.browse-school.v1:guest'
    ) == {'schoolId': saved_school}
    await no_overflow(page)
    await page.screenshot(
        path=str(OUT / f'student-card-login-from-{preference}-mobile.png'),
        full_page=True, animations='disabled',
    )


async def visit_fresh_directory(page, journey):
    navigation = page.get_by_role('navigation', name='主要導覽')
    await wait_for_campus_header(page, 'pu', '靜宜大學')
    document_start = await page.evaluate('performance.timeOrigin')
    if journey == 'life':
        # Explore owns the primary tab. The real desktop workspace still links
        # to the life directory: use that Next link so a fresh visit cannot pass
        # merely because a document reload cleared the directory's memory.
        viewport = page.viewport_size
        try:
            await page.set_viewport_size({'width': 1440, 'height': 1000})
            link = page.get_by_role('navigation', name='工作工具', exact=True).get_by_role(
                'link', name='校園生活', exact=True
            )
            await expect(link).to_be_visible()
            destination = urlparse(await link.get_attribute('href'))
            assert destination.path == '/life'
            assert parse_qs(destination.query).get('campus') == ['pu']
            await link.click()
            await page.wait_for_url(lambda value: urlparse(value).path == '/life')
        finally:
            await page.set_viewport_size(viewport)
    else:
        assert journey == 'connect', journey
        await navigation.get_by_role('link', name='交流', exact=True).click()
        await page.wait_for_url(lambda value: urlparse(value).path == '/connect')
    assert await page.evaluate('performance.timeOrigin') == document_start, \
        'A fresh directory visit must retain the document and its existing history state'


async def check_directory_keyboard_return(page, journey, group, query, service_path, title):
    """Real Next Back/Forward restores the selected result, not just its filters."""
    label = '生活' if journey == 'life' else '交流'
    await goto_path(page, '/?campus=pu')
    await visit_fresh_directory(page, journey)
    await expect(page.get_by_role('heading', level=1, name=label, exact=True)).to_be_visible()
    await page.get_by_role('button', name=group, exact=True).click()
    search = page.get_by_role('searchbox', name='快速找服務')
    await search.fill(query)
    link = page.locator(f'#{journey}-service-results a[href^="{service_path}?"]')
    await expect(link).to_have_count(1)
    directory_url = page.url
    await link.focus()
    await link.press('Enter')
    await page.wait_for_url(lambda value: urlparse(value).path == service_path)
    await expect(page.get_by_role('heading', level=1, name=title, exact=True)).to_be_visible()
    for attempt in range(2):
        await page.go_back(wait_until='domcontentloaded')
        await page.wait_for_url(directory_url)
        await expect(search).to_have_value(query)
        await expect(page.get_by_role('button', name=group, exact=True)).to_have_attribute('aria-pressed', 'true')
        await expect(link).to_be_focused()
        await check_primary_navigation(page, '探索' if journey == 'life' else label)
        if attempt == 0:
            await page.screenshot(
                path=str(OUT / f'{journey}-directory-history-mobile.png'),
                full_page=True, animations='disabled',
            )
        await page.keyboard.press('Tab')
        assert await page.evaluate('''() => Boolean(
            document.activeElement?.closest('main')
            && document.activeElement?.getAttribute('href') !== '#page-content'
        )'''), 'Returning keyboard navigation restarted at the page header'
        await page.go_forward(wait_until='domcontentloaded')
        await page.wait_for_url(lambda value: urlparse(value).path == service_path)
        await expect(page.get_by_role('heading', level=1, name=title, exact=True)).to_be_visible()
    # A fresh directory entry must not reuse another history entry's return.
    await visit_fresh_directory(page, journey)
    await expect(page.get_by_role('heading', level=1, name=label, exact=True)).to_be_visible()
    await expect(search).to_have_value('')
    await expect(page.get_by_role('button', name='全部', exact=True)).to_have_attribute('aria-pressed', 'true')
    await expect(link).not_to_be_focused()


async def check_directory_child_return(page):
    await goto_path(page, '/life?campus=pu')
    await page.get_by_role('button', name='吃飯與住宿', exact=True).click()
    summary = page.get_by_label('點餐與取餐的其他入口', exact=True)
    await summary.focus()
    await summary.press('Space')
    child = page.locator('#life-service-results a[href^="/cafeteria?"]')
    await expect(child).to_be_visible()
    await child.focus()
    await child.press('Enter')
    await page.wait_for_url(lambda value: urlparse(value).path == '/cafeteria')
    await expect(page.get_by_role('heading', level=1, name='餐廳', exact=True)).to_be_visible()
    await page.go_back(wait_until='domcontentloaded')
    await expect(page.get_by_role('heading', level=1, name='生活', exact=True)).to_be_visible()
    await expect(page.get_by_role('button', name='吃飯與住宿', exact=True)).to_have_attribute('aria-pressed', 'true')
    await expect(summary.locator('..')).to_have_js_property('open', True)
    await expect(child).to_be_visible()
    await expect(child).to_be_focused()
    await page.screenshot(
        path=str(OUT / 'life-directory-child-history-mobile.png'),
        full_page=True, animations='disabled',
    )
    await page.go_forward(wait_until='domcontentloaded')
    await page.wait_for_url(lambda value: urlparse(value).path == '/cafeteria')
    await visit_fresh_directory(page, 'life')
    await expect(page.get_by_role('heading', level=1, name='生活', exact=True)).to_be_visible()
    await expect(summary.locator('..')).to_have_js_property('open', False)
    await expect(child).not_to_be_focused()


async def check_career_directory_return(page):
    await goto_path(page, '/life?school=PU&schoolId=pu&campus=pu')
    resources = page.get_by_role('button', name='校園資源', exact=True)
    await resources.click()
    search = page.get_by_role('searchbox', name='快速找服務', exact=True)
    await search.fill('校內工讀')
    results = page.locator('#life-service-results')
    await expect(results.get_by_role('link')).to_have_count(1)
    career = results.get_by_role('link', name='職涯', exact=True)
    await expect(career).to_be_visible()
    scope = {'school': ['PU'], 'schoolId': ['pu'], 'campus': ['pu']}
    destination = urlparse(await career.get_attribute('href'))
    assert destination.path == '/career'
    assert parse_qs(destination.query) == scope
    await career.focus()
    await career.press('Enter')
    await page.wait_for_url(lambda value: urlparse(value).path == '/career')
    assert parse_qs(urlparse(page.url).query) == scope
    heading = page.get_by_role('heading', name='職涯', exact=True, level=1)
    await expect(heading).to_have_count(1)
    await expect(heading).to_be_visible()
    await check_primary_navigation(page, '探索')
    await expect(page.get_by_role(
        'navigation', name='課務導覽', exact=True, include_hidden=True
    )).to_have_count(0)
    breadcrumb = page.get_by_role('navigation', name='目前位置', exact=True)
    await expect(breadcrumb).to_have_count(1)
    filtered_scope = {**scope, 'group': ['resources'], 'q': ['校內工讀']}
    back = breadcrumb.get_by_role('link', name='返回生活目錄', exact=True)
    await expect(back).to_have_count(1)
    await expect(back).to_be_visible()
    await expect(page.get_by_role('navigation', name='麵包屑', exact=True)).to_have_count(0)
    await expect(page.locator('main a[href="/life"]')).to_have_count(0)
    back_destination = urlparse(await back.get_attribute('href'))
    assert back_destination.path == '/life'
    assert parse_qs(back_destination.query) == filtered_scope
    await no_overflow(page)
    await page.screenshot(
        path=str(OUT / 'career-from-life-mobile.png'), full_page=True, animations='disabled',
    )

    for action in ('breadcrumb', 'browser'):
        if action == 'breadcrumb':
            await back.focus()
            await back.press('Enter')
        else:
            await career.press('Enter')
            await expect(back).to_be_visible()
            await page.go_back(wait_until='load')
        await expect(search).to_have_value('校內工讀')
        await expect(resources).to_have_attribute('aria-pressed', 'true')
        restored = urlparse(page.url)
        assert restored.path == '/life'
        assert parse_qs(restored.query) == filtered_scope
        await expect(results.get_by_role('link')).to_have_count(1)
        await expect(career).to_be_focused()
        await check_primary_navigation(page, '探索')
        await no_overflow(page)

    # A shared career link belongs to the campus, without a previous visitor's filters.
    await goto_path(page, destination.geturl() + '&q=old-search&source=shared')
    direct = breadcrumb.get_by_role('link', name='探索', exact=True)
    await expect(direct).to_be_visible()
    direct_destination = urlparse(await direct.get_attribute('href'))
    assert direct_destination.path == '/explore'
    assert parse_qs(direct_destination.query) == scope


async def check_home_personalization(page):
    """Keep setup optional, keyboard reachable, and scoped to the chosen campus."""
    key = 'nuni.campus-preferences.v1:guest:pu'
    previous = await page.evaluate('key => localStorage.getItem(key)', key)
    try:
        await check_unsigned_today(page)
        setup = page.get_by_role('button', name='設定首頁安排', exact=True)
        await setup.focus()
        await setup.press('Enter')
        form = page.get_by_role('form', name='首頁安排偏好')
        stage = form.get_by_role('combobox', name='你目前的階段', exact=True)
        living = form.get_by_role('combobox', name='通勤或住宿方式', exact=True)
        await expect(stage).to_be_focused()
        await stage.select_option('year-4')
        await form.get_by_role('radio', name='生活優先', exact=True).check()
        more = form.locator('summary').filter(has_text='更多安排（選填）')
        await expect(living).not_to_be_visible()
        await more.focus()
        await more.press('Enter')
        await expect(living).to_be_visible()
        await living.select_option('commute')
        await more.press('Space')
        await expect(living).not_to_be_visible()
        await more.press('Enter')
        await expect(living).to_have_value('commute')
        await no_overflow(page)
        await page.screenshot(path=str(OUT / 'home-preferences-expanded-mobile.png'), full_page=True, animations='disabled')

        apply = form.get_by_role('button', name='套用首頁安排', exact=True)
        await apply.focus()
        await apply.press('Enter')
        await expect(form).to_have_count(0)
        await expect(page.get_by_role('heading', name='依偏好推薦的服務', exact=True)).to_be_visible()
        edit = page.get_by_role('button', name='調整安排', exact=True)
        await expect(edit).to_be_focused()
        recommendations = page.get_by_role('list', name='為你推薦的下一步')
        await expect(recommendations.get_by_role('link')).to_have_count(3)
        for link in await recommendations.get_by_role('link').all():
            assert parse_qs(urlparse(await link.get_attribute('href')).query).get('campus') == ['pu']
        await edit.press('Enter')
        await expect(stage).to_be_focused()
        await expect(stage).to_have_value('year-4')
        await stage.select_option('year-2')
        cancel = form.get_by_role('button', name='取消', exact=True)
        await cancel.focus()
        await cancel.press('Enter')
        await expect(edit).to_be_focused()
        await edit.press('Enter')
        await expect(stage).to_have_value('year-4')
        await cancel.click()
        await page.reload(wait_until='load')
        await expect(page.get_by_role('heading', name='依偏好推薦的服務', exact=True)).to_be_visible()
        await expect(form).to_have_count(0)
        await goto_path(page, '/?campus=nthu')
        await check_unsigned_today(page, 'nthu')
        await goto_path(page, '/?campus=pu')
        await expect(page.get_by_role('heading', name='依偏好推薦的服務', exact=True)).to_be_visible()
    finally:
        await page.evaluate('''({key, previous}) => {
            if (previous === null) localStorage.removeItem(key);
            else localStorage.setItem(key, previous);
        }''', {'key': key, 'previous': previous})
        await goto_path(page, '/?campus=pu')


async def check_oled(page):
    assert await page.evaluate('''() => {
        return getComputedStyle(document.body).backgroundColor === 'rgb(0, 0, 0)'
            && getComputedStyle(document.documentElement).backgroundColor === 'rgb(0, 0, 0)';
    }'''), 'Dark page background must be OLED black'
    assert await page.locator('meta[name="theme-color"]').evaluate_all(
        'metas => metas.length > 0 && metas.every(meta => meta.content === "#000000")'
    ), 'Browser chrome does not match the OLED theme'


async def check_home_font_preference(page):
    """Measure rendered content after changing text size through settings."""
    viewport = page.viewport_size
    sizes = {}
    try:
        for preference, label in [('medium', '中'), ('large', '大')]:
            await goto_path(page, '/settings?campus=pu&section=appearance')
            option = page.get_by_role('group', name='字級', exact=True).get_by_role(
                'button', name=label, exact=True
            )
            await option.click()
            await expect(option).to_have_attribute('aria-pressed', 'true')
            await page.wait_for_function('''preference => {
                const stored = JSON.parse(localStorage.getItem('campus-web-preferences') || '{}');
                return stored.appearance?.fontSize === preference;
            }''', arg=preference)
            await goto_path(page, '/?campus=pu')
            await check_unsigned_today(page)
            today = page.get_by_test_id('student-today')
            welcome = page.get_by_role('region', name='建立第一份課表', exact=True)
            elements = {
                'welcome title': welcome.get_by_role('heading', name='建立第一份課表', exact=True),
                'welcome body': welcome.locator('p').first,
                'welcome action': welcome.get_by_role('link', name='匯入我的課表', exact=True),
                'page title': today.get_by_role('heading', name='今天', exact=True),
                'services title': welcome.get_by_role('heading', name='校園服務', exact=True),
                'sign-in action': welcome.get_by_role('link', name='登入查看作業與通知', exact=True),
            }
            sizes[preference] = {}
            for width in [320, 768, 1440]:
                await page.set_viewport_size({'width': width, 'height': 844 if width <= 768 else 1000})
                await no_overflow(page)
                sizes[preference][width] = {
                    name: await element.evaluate('el => parseFloat(getComputedStyle(el).fontSize)')
                    for name, element in elements.items()
                }
        for width, normal_sizes in sizes['medium'].items():
            for name, normal_size in normal_sizes.items():
                large_size = sizes['large'][width][name]
                assert large_size > normal_size, (
                    f'{name} ignores the large-text preference at {width}px: '
                    f'{normal_size}px -> {large_size}px'
                )
    finally:
        await page.set_viewport_size(viewport)
    return sizes


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


async def check_assistant_return_journey(page):
    """A guest can resume the same assistant task without losing directory context."""
    await goto_path(page, '/life?' + urlencode({'campus': 'pu', 'group': 'resources', 'q': '借書'}))
    finder = page.get_by_role('searchbox', name='快速找服務', exact=True)
    await expect(finder).to_have_value('借書')
    original = page.url
    trigger = page.get_by_role('button', name='開啟校園助理', exact=True)
    await trigger.click()
    workspace = page.get_by_role('region', name='校園助理', exact=True)
    await expect(workspace).to_be_visible()
    await expect(page.get_by_role('dialog', name='校園助理', exact=True)).to_have_count(0)
    field = workspace.get_by_role('searchbox', name='想做什麼？', exact=True)
    await expect(field).to_be_focused()
    assert page.url == original, 'Opening the assistant must keep the current task URL'
    await field.fill('明天下課後想去圖書館')
    await field.press('Escape')
    await expect(workspace).not_to_be_visible()
    await expect(trigger).to_be_focused()
    await trigger.click()
    await expect(field).to_have_value('明天下課後想去圖書館')
    await expect(finder).to_have_value('借書')
    login = workspace.get_by_role('link', name='登入後，接著詢問校園助理', exact=True)
    login_href = await login.get_attribute('href')
    login_url = urlparse(login_href)
    login_query = parse_qs(login_url.query)
    target = urlparse(login_query['returnUrl'][0])
    assert target.path == '/life' and target.fragment == 'campus-assistant-entry', login_href
    task = parse_qs(target.query)
    assert task == {'q': ['借書'], 'group': ['resources'], 'schoolId': ['pu'], 'campus': ['pu'], 'school': ['PU']}, login_href
    assert login_query == {
        'returnUrl': [login_query['returnUrl'][0]], 'schoolId': ['pu'], 'campus': ['pu'], 'school': ['PU'],
    }, login_href
    assert '明天下課後' not in login_href, 'Typed draft must not be added to the login URL'
    await no_overflow(page)
    await page.screenshot(path=str(OUT / 'assistant-life-mobile.png'), full_page=True, animations='disabled')
    document_start = await page.evaluate('performance.timeOrigin')
    await login.click()
    await expect(page.get_by_role('heading', name='登入', exact=True)).to_be_visible()
    assert await page.evaluate('performance.timeOrigin') != document_start, 'Login intentionally reloads the document'
    await page.get_by_role('link', name='不登入，繼續瀏覽', exact=True).click()
    await expect(workspace).to_be_visible()
    # Drafts live only in this document's memory; the login reload must not
    # restore the previous private draft through storage or the return URL.
    await expect(field).to_have_value('')
    await expect(page.get_by_role('searchbox', name='快速找服務', exact=True)).to_have_value('借書')
    await workspace.get_by_role('button', name='收合', exact=True).click()
    await expect(workspace).not_to_be_visible()
    assert urlparse(page.url).fragment == '', 'Closing a restored panel must clear only its resume anchor'
    assert urlparse(page.url).path == '/life' and parse_qs(urlparse(page.url).query) == task
    # A fresh visit to the same task must not reopen the old panel.
    await page.reload(wait_until='load')
    await expect(workspace).to_have_count(0)
    await expect(finder).to_have_value('借書')
    await goto_path(page, '/?campus=pu')
    home_field = page.get_by_role('textbox', name='想完成的事', exact=True)
    await expect(home_field).to_be_visible()
    await expect(home_field).to_have_value('')
    await home_field.fill('查公車到站時間')
    await page.get_by_role('button', name='開啟校園助理', exact=True).click()
    await expect(workspace).to_be_visible()
    await expect(field).to_be_focused()
    await expect(field).to_have_value('查公車到站時間')
    await field.fill('查公車到站時間與圖書館')
    await workspace.get_by_role('button', name='收合', exact=True).click()
    await expect(workspace).not_to_be_visible()
    await expect(home_field).to_have_value('查公車到站時間與圖書館')
    await no_overflow(page)
    await page.screenshot(path=str(OUT / 'assistant-home-shared-draft-mobile.png'), full_page=True, animations='disabled')
    await page.get_by_role('form', name='開始校園任務', exact=True).get_by_role(
        'button', name='接續任務', exact=True,
    ).click()
    await expect(workspace).to_be_visible()
    await expect(field).to_be_focused()
    await expect(field).to_have_value('查公車到站時間與圖書館')
    assert urlparse(page.url).path == '/'


async def check_offline_recovery(browser):
    # This context uses the real service worker and only contacts the local server.
    context = await browser.new_context(
        viewport={'width': 320, 'height': 740}, color_scheme='dark', reduced_motion='reduce',
    )
    try:
        page = await context.new_page()
        await page.goto(BASE + '/offline.html')
        await expect(page.get_by_role('link', name='返回首頁')).to_have_attribute('href', '/')
        await page.evaluate("""async () => {
            localStorage.setItem('campus-web-preferences', JSON.stringify({
              appearance: {fontSize: 'large', animations: false}
            }));
            await navigator.serviceWorker.register('/sw.js');
            await navigator.serviceWorker.ready;
        }""")
        await page.wait_for_function('Boolean(navigator.serviceWorker.controller)')
        target = BASE + '/course/offline-check?campus=pu#assignment-book'
        await context.set_offline(True)
        await page.goto(target)
        status = page.get_by_role('status')
        retry = page.get_by_role('link', name='重新載入此頁')
        await expect(status).to_contain_text('目前沒有網路連線')
        await expect(retry).to_have_attribute('href', target)
        await expect(page.locator('#submission-note')).to_be_visible()
        await expect(page.locator('html')).to_have_attribute('data-font', 'large')
        await page.evaluate("document.documentElement.style.fontSize = '200%'")
        await no_overflow(page)
        await retry.focus()
        await context.set_offline(False)
        await expect(status).to_contain_text('已重新連上網路')
        await expect(retry).to_be_focused()
        async with page.expect_navigation(wait_until='domcontentloaded'):
            await retry.press('Enter')
        await expect(page.get_by_role('heading', name='暫時無法開啟頁面')).to_have_count(0)
        await expect(page).to_have_url(target)
    finally:
        await context.close()


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
        active_page = page
        page.set_default_timeout(10000)
        page.on('pageerror', lambda error: errors.append(str(error)))
        try:
            await check_offline_recovery(browser)
            results.append('Offline course navigation preserves the exact link through reconnection and manual retry')
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

                await goto_path(page, '/connect?campus=pu')
                await expect(page.get_by_role('heading', name='交流', exact=True)).to_be_visible()
                await expect(page.get_by_role('heading', name='找人與聊天', exact=True)).to_be_visible()
                await expect(page.locator('#connect-service-results').get_by_role(
                    'link', name='訊息', exact=True
                )).to_have_attribute('href', re.compile(r'^/dms\?'))
                await expect(page.locator('#connect-service-results').get_by_role(
                    'link', name='通知', exact=True
                )).to_have_attribute('href', re.compile(r'^/messages\?'))
                await check_primary_navigation(page, '交流')
                await no_overflow(page)
                await page.screenshot(path=str(OUT / f'connect-{label}.png'), full_page=True, animations='disabled')
                if width <= 760:
                    await check_mobile_navigation(page)
                results.append(f'connect directory separates notifications and conversations at {width}px')

                await goto_path(page, '/life?campus=pu')
                await expect(page.get_by_role('heading', name='生活', exact=True)).to_be_visible()
                await expect(page.get_by_role('heading', name='出門與交通', exact=True)).to_be_visible()
                await check_primary_navigation(page, '探索')
                await no_overflow(page)
                await page.screenshot(path=str(OUT / f'life-{label}.png'), full_page=True, animations='disabled')
                if width <= 760:
                    await check_mobile_navigation(page)
                results.append(f'life directory reflows at {width}px')
            results.append('mobile bottom navigation leaves footer actions reachable')
            await page.set_viewport_size({'width': 390, 'height': 844})
            await check_assistant_return_journey(page)
            results.append('nonmodal assistant retains drafts while minimized, restores the directory after login reload, and shares the home draft in both directions')
            await goto_path(page, '/life?campus=pu')

            search = page.get_by_role('searchbox', name='快速找服務')
            await search.fill('借書')
            await expect(page.locator('#life-service-results a')).to_have_count(1)
            await expect(page.locator('#life-service-results a')).to_contain_text('圖書館')
            await search.fill('找不到的服務')
            await expect(page.get_by_role('heading', name='沒有找到符合的服務')).to_be_visible()
            await page.get_by_role('button', name='顯示全部服務').click()
            await expect(search).to_be_focused()
            await expect(page.get_by_role('heading', name='出門與交通', exact=True)).to_be_visible()
            await page.get_by_role('button', name='吃飯與住宿', exact=True).click()
            # 食堂與訂單收在點餐主入口下；點餐關閉時沒有訂單。
            await expect(page.locator('#life-service-results').get_by_role('link')).to_have_count(2)
            await expect(page.locator('#life-service-results a[href^="/dormitory"]')).to_be_visible()
            await expect(page.locator('#life-service-results a[href^="/food"]')).to_be_visible()
            await expect(page.locator('#life-service-results a[href^="/orders"]')).to_have_count(0)
            await page.get_by_role('button', name='全部', exact=True).click()
            await search.fill('報修')
            await expect(page.locator('#life-service-results a')).to_have_count(1)
            await expect(page.locator('#life-service-results a[href^="/dormitory"]')).to_be_visible()
            await search.fill('')
            results.append('service search, empty recovery and category filtering work on mobile')
            await check_life_public_filter(page)
            results.append('life visitor filter retains public cafeteria, excludes gated tasks, and restores campus, category, search and keyboard focus on Back')

            await check_life_navigation_continuity(page, results)
            await check_full_service_search_journey(page, results)
            await check_today_navigation_continuity(page, results)

            await page.set_viewport_size({'width': 390, 'height': 844})
            await check_directory_keyboard_return(page, 'life', '校園資源', '借書', '/library', '圖書館')
            results.append('life directory Back and Forward restore the result and keyboard position without affecting a fresh visit')
            await check_directory_keyboard_return(page, 'connect', '找人與聊天', '好友', '/friends', '找人')
            results.append('connect directory Back and Forward restore the result and keyboard position without affecting a fresh visit')
            await check_directory_child_return(page)
            results.append('returning to a directory child restores its disclosure and focus only in the original history entry')
            await check_career_directory_return(page)
            results.append('career breadcrumb and browser Back restore the scoped work-study result and keyboard focus; a shared career link returns to its campus')
            for preference in ['nthu', 'all']:
                await check_deep_link_login_scope(page, preference)
                results.append(f'PU deep-link Header login overrides saved {preference} browsing preference without copying auth query to the outer URL')
                await check_deep_link_login_scope(page, preference, student_card=True)
                results.append(f'PU student-card school login preserves its task and campus despite saved {preference} browsing preference')

            club_path = '/groups/journey-club/club/overview'
            await goto_path(page, club_path + '?campus=pu&schoolId=pu')
            await expect(page.get_by_role('heading', name='社團', exact=True)).to_be_visible()
            await check_primary_navigation(page, '探索')
            club_breadcrumb = page.get_by_role('navigation', name='目前位置').get_by_role(
                'link', name='社團活動', exact=True
            )
            await expect(club_breadcrumb).to_be_visible()
            club_destination = urlparse(await club_breadcrumb.get_attribute('href'))
            assert club_destination.path == '/clubs'
            club_scope = parse_qs(club_destination.query)
            assert club_scope.get('campus') == ['pu']
            assert club_scope.get('schoolId') == ['pu']
            await expect(page.get_by_role(
                'navigation', name='課務導覽', exact=True, include_hidden=True
            )).to_have_count(0)
            club_login = page.get_by_role('link', name='登入後查看社團', exact=True)
            await expect(club_login).to_be_visible()
            assert_login_destination(
                await club_login.get_attribute('href'),
                club_path + '?schoolId=pu', {'schoolId': 'pu'},
            )
            assert urlparse(page.url).path == club_path
            # Correcting the navigation category must not expose the members-only profile.
            await expect(page.get_by_role(
                'region', name='社團頁', exact=True, include_hidden=True
            )).to_have_count(0)
            await expect(page.get_by_role('button', name='重新讀取社團資料', exact=True)).to_have_count(0)
            await expect(page.get_by_role('link', name='查看社團討論與更多公告', exact=True)).to_have_count(0)
            await no_overflow(page)
            await page.screenshot(
                path=str(OUT / 'club-overview-unsigned-mobile.png'),
                full_page=True,
                animations='disabled',
            )
            results.append('unsigned club overview stays in Explore with a campus-scoped clubs breadcrumb and keeps member data gated')

            await goto_path(page, '/?campus=all')
            await check_unsigned_today(page, 'all')
            await no_overflow(page)
            results.append('unselected-campus home starts with choosing a campus and keeps public services available')
            await goto_path(page, '/?campus=pu')
            await check_home_personalization(page)
            results.append('home preferences start collapsed, support keyboard editing and cancel, persist only in their campus scope')
            await wait_for_campus_header(page, 'pu', '靜宜大學')
            services = page.locator('header summary[aria-label="所有服務"]')
            await services.click()
            await check_progressive_service_menu(page)
            results.append('global menu keeps 16 everyday entries, expands all 40 available services and restores secondary work on Back')
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
                'link', name='探索', exact=True
            )).to_have_attribute('aria-current', 'page')
            back_to_explore = page.get_by_role('navigation', name='目前位置').get_by_role(
                'link', name='探索', exact=True
            )
            await expect(back_to_explore).to_be_visible()
            back_destination = urlparse(await back_to_explore.get_attribute('href'))
            assert back_destination.path == '/explore'
            assert parse_qs(back_destination.query).get('campus') == ['pu']
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
                'link', name='我的', exact=True
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
            campus = await wait_for_campus_header(page, 'pu', '靜宜大學')
            await campus.click()
            await expect(page.get_by_role('combobox', name='瀏覽校園', exact=True)).to_be_visible()
            await no_overflow(page)
            await page.get_by_role('combobox', name='瀏覽校園', exact=True).select_option('nthu')
            await wait_for_campus_header(page, 'nthu', '國立清華大學')
            await expect(campus).to_contain_text('國立清華大學')
            await expect(page.get_by_role('combobox', name='瀏覽校園', exact=True)).not_to_be_visible()
            timetable = page.get_by_role('navigation', name='主要導覽').get_by_role('link', name='課務')
            href = await timetable.get_attribute('href')
            assert parse_qs(urlparse(href).query).get('campus') == ['nthu']
            results.append('campus selection closes the picker and preserves navigation scope')

            for route, heading in [('/', '今天'), ('/life', '生活'), ('/connect', '交流')]:
                await page.emulate_media(color_scheme='dark', reduced_motion='reduce')
                await goto_path(page, route + '?campus=pu')
                if route == '/':
                    await check_unsigned_today(page)
                else:
                    await expect(page.get_by_role('heading', name=heading, exact=True)).to_be_visible()
                await check_oled(page)
                await no_overflow(page)
                name = 'home' if route == '/' else route.lstrip('/')
                await page.screenshot(path=str(OUT / f'{name}-dark.png'), full_page=True, animations='disabled')
                await page.screenshot(path=str(OUT / f'{name}-oled-mobile.png'), animations='disabled')
            results.append('home, life and connect use OLED black with matching browser chrome')

            await page.set_viewport_size({'width': 1440, 'height': 1000})
            await goto_path(page, '/?campus=pu')
            await check_oled(page)
            await page.screenshot(path=str(OUT / 'home-oled-desktop.png'), full_page=True, animations='disabled')
            await page.set_viewport_size({'width': 390, 'height': 844})
            await wait_for_campus_header(page, 'pu', '靜宜大學')
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
                appearance: {theme: 'light', fontSize: 'medium', animations: false}
            }))''')
            await page.set_viewport_size({'width': 320, 'height': 844})
            await goto_path(page, '/?campus=pu')
            await check_home_font_preference(page)
            results.append('home titles, copy and actions grow with the large-text preference at 320/768/1440px')
            await expect(page.locator('html')).to_have_attribute('data-reduced-motion', 'true')
            assert await page.locator('body').evaluate(
                'el => getComputedStyle(el).backgroundColor === "rgb(255, 255, 255)"'
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

            for width in [390, 1440]:
                await page.set_viewport_size({'width': width, 'height': 844})
                await goto_path(page, '/login?campus=pu')
                await check_unsigned_login_entry(page)
                await page.screenshot(
                    path=str(OUT / f'login-{width}.png'),
                    full_page=True,
                    animations='disabled',
                )
                results.append(f'login keeps Google primary and reveals school and work entries by keyboard at {width}px')
                await check_merchant_entry_links(page)
                results.append(f'merchant registration and returning sign-in preserve their destination at {width}px')
            await page.set_viewport_size({'width': 390, 'height': 844})
            await goto_path(page, '/auth/account')
            await check_account_footer_contrast(page)
            await page.emulate_media(color_scheme='dark')
            await goto_path(page, '/auth/account')
            await check_unsigned_account_entry(page)
            await check_oled(page)
            await check_account_footer_contrast(page)
            await no_overflow(page)
            await page.screenshot(
                path=str(OUT / 'auth-account-oled-mobile.png'),
                animations='disabled',
            )
            await page.emulate_media(color_scheme='light')
            await goto_path(page, '/auth/account')
            await check_unsigned_account_entry(page)
            results.append('account footer links remain readable in light and OLED themes')

            await page.set_viewport_size({'width': 390, 'height': 844})
            await page.get_by_role('button', name='尋找學校').click()
            await expect(page.get_by_label('學校配發的信箱或校名')).to_be_visible()
            results.append('find-school action stays on the account page')

            await page.get_by_role('link', name='課班／教學').click()
            await page.wait_for_load_state('load')
            assert urlparse(page.url).path == '/auth/platform/class-workspace/join'
            assert '校園都在這' not in await page.title()
            await expect(page.get_by_role('heading', name='登入', exact=True)).to_have_count(0)
            await expect(page.get_by_role('heading', name='加入課班')).to_be_visible()
            await page.screenshot(
                path=str(OUT / 'class-join-unsigned.png'),
                full_page=True,
                animations='disabled',
            )
            results.append('class-workspace join stays off the new login page')

            response = await page.goto(BASE + '/auth/find-school', wait_until='load')
            assert urlparse(page.url).path == '/auth/account'
            await check_unsigned_account_entry(page)
            results.append('old find-school URL still lands on the new entry')

            response = await page.goto(BASE + '/auth/platform', wait_until='load')
            body = await page.content()
            for copy in OLD_ACCOUNT_COPY:
                assert copy not in body, '/auth/platform still contains old copy'
            assert urlparse(page.url).path == '/auth/account'
            await check_unsigned_account_entry(page)
            results.append('old platform login URL lands on the account entry')

            response = await page.goto(BASE + '/privacy/deletion-status', wait_until='load')
            body = await page.content()
            for copy in OLD_ACCOUNT_COPY:
                assert copy not in body, '/privacy/deletion-status still contains old copy'
            assert urlparse(page.url).path == '/account-deletion/status'
            await expect(page.get_by_role('heading', name='刪除進度')).to_be_visible()
            await expect(page.get_by_label('查詢碼')).to_be_visible()
            await expect(page.get_by_role('button', name='查詢進度')).to_be_visible()
            await expect(page.get_by_role('button', name='用這個瀏覽器保存的查詢碼')).to_be_visible()
            await expect(page.get_by_role('heading', name='登入', exact=True)).to_have_count(0)
            await page.screenshot(
                path=str(OUT / 'deletion-status-unsigned.png'),
                full_page=True,
                animations='disabled',
            )
            results.append('old deletion-status URL lands on the account deletion status page')

            for path, expected in [
                ('/auth/platform/ops', '/admin/ops'),
                ('/auth/platform/ops/people', '/admin/ops'),
                ('/auth/platform/school-review', '/admin/school-review'),
            ]:
                response = await page.goto(BASE + path, wait_until='load')
                body = await page.content()
                for copy in OLD_ACCOUNT_COPY:
                    assert copy not in body, f'{path} still contains old copy'
                assert urlparse(page.url).path == expected, path
                if path == '/auth/platform/ops/people':
                    assert parse_qs(urlparse(page.url).query).get('tab') == ['people'], path
                assert urlparse(page.url).path != '/auth/account'
                await expect(page.get_by_role('heading', name='登入', exact=True)).to_have_count(0)
                if expected == '/admin/ops' and path == '/auth/platform/ops':
                    await expect(page.get_by_role('heading', name='請先登入管理員帳號')).to_be_visible()
                    await page.screenshot(
                        path=str(OUT / 'ops-unsigned.png'),
                        full_page=True,
                        animations='disabled',
                    )
                if path == '/auth/platform/ops/people':
                    await expect(page.get_by_role('heading', name='請先登入管理員帳號')).to_be_visible()
                if expected == '/admin/school-review':
                    await expect(page.get_by_role('heading', name='請先登入管理員帳號')).to_be_visible()
                    await page.screenshot(
                        path=str(OUT / 'school-review-unsigned.png'),
                        full_page=True,
                        animations='disabled',
                    )

            for path in ['/academics', '/staff', '/learning']:
                response = await page.goto(BASE + path, wait_until='load')
                body = await page.content()
                for copy in OLD_ACCOUNT_COPY:
                    assert copy not in body, f'{path} still contains old copy'
                assert '校園都在這' not in await page.title()
                assert response is not None and response.status == 404, path
                assert urlparse(page.url).path == path
            results.append('replaced shells redirect or 404; remaining admin screens stay off login')

            signed = await browser.new_context(
                viewport={'width': 390, 'height': 844},
                color_scheme='light',
                reduced_motion='reduce',
                service_workers='block',
            )
            await signed.route('**/*', session_fixtures(True))
            signed_page = await signed.new_page()
            active_page = signed_page
            signed_page.set_default_timeout(10000)
            signed_page.on('pageerror', lambda error: errors.append(str(error)))
            await signed_page.goto(BASE + '/auth/account?returnUrl=/life', wait_until='domcontentloaded')
            await signed_page.wait_for_url(re.compile(r'https?://[^/]+/life(?:\?.*)?$'))
            assert urlparse(signed_page.url).path == '/life'
            return_path = '/life?campus=pu#life-service-results'
            await follow_account_return(signed_page, return_path, school_context={'campus': 'pu'})
            assert parse_qs(urlparse(signed_page.url).query).get('campus') == ['pu']
            assert urlparse(signed_page.url).fragment == 'life-service-results'
            await signed_page.goto(BASE + '/auth/account?returnUrl=/staff', wait_until='domcontentloaded')
            await signed_page.wait_for_url(re.compile(r'https?://[^/]+/?(\?.*)?$'))
            assert urlparse(signed_page.url).path == '/'
            results.append('signed-in account visits preserve campus and anchor on allowed return paths')

            for target, school_context in [
                ('/grades?tab=feedback&schoolId=nthu&campus=nthu', {'schoolId': 'nthu', 'campus': 'nthu'}),
                ('/settings?section=appearance&campus=nthu#reading', {'campus': 'nthu'}),
                ('/school-info?campus=pu', {'campus': 'pu'}),
                ('/events?campus=nthu', {'campus': 'nthu'}),
                ('/life?campus=pu&group=resources&q=%E5%80%9F%E6%9B%B8#life-service-results', {'campus': 'pu'}),
                ('/connect?campus=pu&group=people&q=%E8%A8%8A%E6%81%AF#connect-service-results', {'campus': 'pu'}),
            ]:
                await follow_account_return(signed_page, target, school_context=school_context)
                await no_overflow(signed_page)
                returned = urlparse(target)
                if returned.path in ['/life', '/connect']:
                    query = parse_qs(returned.query)
                    await expect(signed_page.get_by_role('searchbox', name='快速找服務')).to_have_value(query['q'][0])
                    group = '校園資源' if returned.path == '/life' else '找人與聊天'
                    await expect(signed_page.get_by_role('button', name=group, exact=True)).to_have_attribute(
                        'aria-pressed', 'true'
                    )
            results.append('account return navigation preserves campus, tabs, directory search and category, and anchor position')
            await follow_account_return(
                signed_page,
                '/grades?tab=feedback&campus=nthu&token=discard-me&session=discard-me&next=%2Fstaff#recent',
                '/grades?tab=feedback&campus=nthu#recent',
                school_context={'campus': 'nthu'},
            )
            await no_overflow(signed_page)
            results.append('account return navigation drops auth payloads and nested redirects')
            results.append('signed-in account visits follow allowed return paths')

            # These are browser-only session fixtures, not a real school account.
            # Keep course reads local while checking the actual Next navigation.
            async def empty_workspaces(route):
                assert route.request.method == 'GET'
                await route.fulfill(json={'workspaces': []})

            await signed.route('**/api/nuni/class-workspaces', empty_workspaces)
            await goto_path(signed_page, '/?campus=pu')
            signed_campus = await wait_for_campus_header(signed_page, 'pu', '靜宜大學')
            await expect(signed_campus).to_contain_text('靜宜大學')
            await signed_campus.click()
            await signed_page.get_by_role('combobox', name='瀏覽校園', exact=True).select_option('nthu')
            await wait_for_campus_header(signed_page, 'nthu', '國立清華大學')
            await expect(signed_campus).to_contain_text('國立清華大學')
            preference_key = 'campus.browse-school.v1:account:%7Cpa_00000000-0000-4000-8000-000000000001'
            assert await signed_page.evaluate('key => JSON.parse(localStorage.getItem(key))', preference_key) == {
                'schoolId': 'nthu',
            }
            for scope in ['pu', 'all']:
                expected_scope = {'campus': ['all']} if scope == 'all' else {
                    'schoolId': ['pu'], 'campus': ['pu'], 'school': ['PU'],
                }
                for start, label, destination, section, extra in [
                    ('/', '查看行事曆', '/calendar', '課務', {}),
                    ('/', '加入 nuni 課程', '/classroom', '課務', {}),
                    ('/classroom', '課業成績與回饋', '/grades', '課務', {'tab': ['feedback']}),
                    ('/classroom/account', '前往我的課程', '/classroom', '課務', {}),
                    ('/classroom/course/invalid-id', '回到我的課程', '/classroom', '課務', {}),
                    ('/settings', '返回個人資料', '/profile', '我的', {}),
                ]:
                    if start == '/settings':
                        # This explicit sidebar link is desktop-only. Mobile
                        # returns through the existing breadcrumb below.
                        await signed_page.set_viewport_size({'width': 1440, 'height': 1000})
                    await goto_path(signed_page, f'{start}?campus={scope}&token=fixture-only&q=old-search#old-position')
                    link = signed_page.get_by_role('link', name=label, exact=True)
                    await expect(link).to_be_visible()
                    if scope == 'pu':
                        # The streamed link is visible before the campus catalog
                        # hydrates and enriches its explicit URL browsing scope.
                        await expect(link).to_have_attribute(
                            'href', re.compile(r'(?:\?|&)schoolId=pu(?:&|$)'),
                        )
                    target = urlparse(await link.get_attribute('href'))
                    assert target.path == destination, (start, label, target)
                    assert parse_qs(target.query) == {**extra, **expected_scope}, (start, label, target)
                    assert not target.fragment, (start, label, target)
                    await link.click()
                    await signed_page.wait_for_url(lambda value: urlparse(value).path == destination)
                    assert parse_qs(urlparse(signed_page.url).query) == {**extra, **expected_scope}
                    await check_primary_navigation(signed_page, section, scope)
                    assert await signed_page.evaluate('key => JSON.parse(localStorage.getItem(key))', preference_key) == {
                        'schoolId': 'nthu',
                    }
                    await no_overflow(signed_page)
                await signed_page.set_viewport_size({'width': 390, 'height': 844})
                await goto_path(signed_page, f'/settings?campus={scope}&token=fixture-only&q=old-search#old-position')
                breadcrumb = signed_page.get_by_role('navigation', name='目前位置').get_by_role(
                    'link', name='我的', exact=True,
                )
                await expect(breadcrumb).to_be_visible()
                await breadcrumb.click()
                await signed_page.wait_for_url(lambda value: urlparse(value).path == '/profile')
                assert parse_qs(urlparse(signed_page.url).query) == expected_scope
                assert not urlparse(signed_page.url).fragment
                await check_primary_navigation(signed_page, '我的', scope)
                assert await signed_page.evaluate('key => JSON.parse(localStorage.getItem(key))', preference_key) == {
                    'schoolId': 'nthu',
                }
                await no_overflow(signed_page)
                results.append(f'home, course and account service links preserve {scope} despite saved NTHU')
            await signed_page.screenshot(
                path=str(OUT / 'profile-return-all-mobile.png'), full_page=True, animations='disabled',
            )

            async def capture_platform(name, operator):
                nonlocal active_page
                context = await browser.new_context(
                    viewport={'width': 390, 'height': 844},
                    color_scheme='light',
                    reduced_motion='reduce',
                    service_workers='block',
                )
                await context.route('**/*', session_fixtures(True, operator))
                shot = await context.new_page()
                active_page = shot
                shot.set_default_timeout(10000)
                await shot.goto(BASE + '/auth/platform/class-workspace/join', wait_until='load')
                await expect(shot.get_by_role('heading', name='加入課班')).to_be_visible()
                await shot.screenshot(
                    path=str(OUT / f'class-join-{name}.png'),
                    full_page=True,
                    animations='disabled',
                )
                await shot.goto(BASE + '/admin/school-review', wait_until='load')
                if operator:
                    await expect(shot.get_by_role('heading', name='學校接入申請', exact=True)).to_be_visible()
                    await expect(shot.get_by_text('待審學校', exact=True)).to_be_visible()
                else:
                    # Both legacy admin URLs now use the unified AdminWorkspace gate.
                    await expect(shot.get_by_role('heading', name='沒有管理權限')).to_be_visible()
                    await expect(shot.get_by_text('目前帳號無法查看或修改平台管理資料。這與學校管理員身分不同。', exact=True)).to_be_visible()
                await shot.screenshot(
                    path=str(OUT / f'school-review-{name}.png'),
                    full_page=True,
                    animations='disabled',
                )
                await shot.goto(BASE + '/admin/ops', wait_until='load')
                if operator:
                    # The legacy ops entry defaults to schools; overview lives at /admin.
                    await expect(shot.get_by_role('heading', name='學校管理', exact=True)).to_be_visible()
                    await expect(shot).to_have_url(BASE + '/admin#schools')
                    await shot.get_by_role('button', name='回工作總覽', exact=True).click()
                    await expect(shot.get_by_role('heading', name='工作總覽', exact=True)).to_be_visible()
                    await expect(shot).to_have_url(BASE + '/admin#overview')
                    await expect(shot.get_by_role('button', name='查看學校申請：待審學校', exact=True)).to_be_visible()
                    await expect(shot.get_by_text('目前沒有待審核的店家申請。', exact=True)).to_be_visible()
                    await expect(shot.get_by_text('目前沒有待審核的掛靠申請。', exact=True)).to_be_visible()
                    await expect(shot.get_by_text('目前沒有待處理的社群檢舉。', exact=True)).to_be_visible()
                    await expect(shot.get_by_role('button', name='確認管理員：待開放學校', exact=True)).to_be_visible()
                else:
                    await expect(shot.get_by_role('heading', name='沒有管理權限')).to_be_visible()
                await shot.screenshot(
                    path=str(OUT / f'ops-{name}.png'),
                    full_page=True,
                    animations='disabled',
                )
                await context.close()

            await capture_platform('member', False)
            await capture_platform('operator', True)
            results.append('platform pages captured for unsigned, member and operator states')
            assert not errors, errors
            await signed.close()
        except Exception:
            diagnostic_page = page if active_page.is_closed() else active_page
            (OUT / 'failure-url.txt').write_text(diagnostic_page.url, encoding='utf-8')
            await diagnostic_page.screenshot(path=str(OUT / 'failure.png'), full_page=True, animations='disabled')
            (OUT / 'failure-dom.txt').write_text(await diagnostic_page.locator('body').aria_snapshot(), encoding='utf-8')
            raise
        finally:
            (OUT / 'results.json').write_text(json.dumps({
                'checks': results, 'pageErrors': errors,
            }, ensure_ascii=False, indent=2), encoding='utf-8')
            await browser.close()
    print(json.dumps({'passed': len(results), 'checks': results}, ensure_ascii=False))


if __name__ == '__main__':
    asyncio.run(main())
