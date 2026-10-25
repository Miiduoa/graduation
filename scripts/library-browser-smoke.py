"""Check library keyboard handoff against a local production Web build.

School/session responses and external catalog landing pages are synthetic
fixtures. External requests are fulfilled locally or blocked; no library login,
real catalog query, or borrowing action is sent. Production CSP stays enabled.
"""

import asyncio
import json
import os
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from playwright.async_api import async_playwright, expect


BASE = os.environ.get('CAMPUS_SERVICE_URL', 'http://127.0.0.1:3105')
if urlparse(BASE).hostname not in ('localhost', '127.0.0.1'):
    raise RuntimeError('Library checks must run against a local server')
OUT = Path('artifacts/campus-services/library')
OUT.mkdir(parents=True, exist_ok=True)

SCHOOLS = [
    {'id': 'pu', 'name': '靜宜大學', 'status': 'not-open'},
    {'id': 'nthu', 'name': '國立清華大學', 'status': 'not-open'},
    {'id': 'ncue', 'name': '國立彰化師範大學', 'status': 'not-open'},
    {'id': 'cgu', 'name': '長庚大學', 'status': 'not-open'},
]
CATALOG_HOSTS = {
    'webpacx.lib.pu.edu.tw', 'nthu.primo.exlibrisgroup.com',
    'webpacx.ncue.edu.tw', 'web20.lib.cgu.edu.tw',
}


async def no_overflow(page):
    assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth'), \
        'Library page overflows horizontally'


async def main():
    checks = []
    errors = []
    csp_violations = []
    catalog_requests = []
    blocked_requests = []

    async def fixtures(route):
        request = route.request
        url = urlparse(request.url)
        if url.hostname not in ('localhost', '127.0.0.1'):
            if (url.scheme == 'https' and url.hostname in CATALOG_HOSTS
                    and request.is_navigation_request() and request.resource_type == 'document'):
                catalog_requests.append({'url': request.url, 'method': request.method})
                await route.fulfill(
                    status=200, content_type='text/html; charset=utf-8',
                    body='<!doctype html><html lang="zh-Hant"><meta charset="utf-8">'
                         '<title>館藏交接驗證</title><body><h1>本機館藏導航驗證</h1>'
                         '<p>此頁由瀏覽器測試攔截產生，沒有連線到學校館藏。</p></body></html>',
                )
            else:
                blocked_requests.append(request.url)
                await route.abort()
        elif url.path == '/api/schools':
            await route.fulfill(json={'schools': SCHOOLS})
        elif url.path in ('/api/nuni/session', '/auth/session'):
            await route.fulfill(json={'authenticated': False})
        elif url.path == '/auth/platform/providers':
            await route.fulfill(json={'kinds': ['google-consumer']})
        else:
            await route.continue_()

    async with async_playwright() as playwright:
        launch = {}
        executable = os.environ.get('CAMPUS_SERVICE_CHROMIUM')
        if executable:
            launch['executable_path'] = executable
        browser = await playwright.chromium.launch(**launch)
        context = await browser.new_context(
            viewport={'width': 1440, 'height': 1000}, locale='zh-TW',
            timezone_id='Asia/Taipei', color_scheme='light', reduced_motion='reduce',
            service_workers='block',
        )
        await context.route('**/*', fixtures)
        await context.expose_binding('reportLibraryCspViolation', lambda _source, event: csp_violations.append(event))
        await context.add_init_script('''document.addEventListener('securitypolicyviolation', event => {
            window.reportLibraryCspViolation({
                directive: event.effectiveDirective,
                blockedURI: event.blockedURI,
                disposition: event.disposition,
            });
        });''')
        context.on('page', lambda current: current.on('pageerror', lambda error: errors.append(str(error))))
        page = await context.new_page()
        page.set_default_timeout(15000)

        async def goto_school(school):
            response = await page.goto(BASE + f'/library?schoolId={school}&campus={school}', wait_until='load')
            assert response and response.ok
            policy = response.headers.get('content-security-policy', '')
            assert "form-action 'self' https://accounts.google.com" in policy
            await expect(page.get_by_role('heading', name='找一本書', exact=True)).to_be_visible()

        async def capture_catalog(action, expected_host, expected_path, expected_query):
            before = len(catalog_requests)
            async with context.expect_page() as opening:
                await action()
            popup = await opening.value
            await popup.wait_for_load_state('domcontentloaded')
            await expect(popup.get_by_role('heading', name='本機館藏導航驗證')).to_be_visible()
            assert len(catalog_requests) == before + 1, catalog_requests[before:]
            request = catalog_requests[-1]
            destination = urlparse(request['url'])
            assert request['method'] == 'GET', request
            assert destination.scheme == 'https' and destination.hostname == expected_host, request
            assert destination.path == expected_path, request
            assert parse_qs(destination.query) == expected_query, request
            assert await popup.evaluate('window.opener === null'), 'External catalog has access to its opener'
            await popup.close()

        try:
            await goto_school('nthu')
            search = page.get_by_label('想找的書或關鍵字', exact=True)
            await search.fill('  資料庫 & SQL  ')
            await capture_catalog(lambda: search.press('Enter'), 'nthu.primo.exlibrisgroup.com', '/discovery/search', {
                'vid': ['886UST_NTHU:886UST_NTHU'], 'query': ['any,contains,資料庫 & SQL'],
            })
            await no_overflow(page)
            await page.screenshot(path=str(OUT / 'library-desktop.png'), animations='disabled')
            checks.append('NTHU Enter submits native GET to its own Primo view with trimmed text and a literal ampersand')

            await goto_school('ncue')
            search = page.get_by_label('想找的書或關鍵字', exact=True)
            await search.fill('資料庫 & SQL')
            await page.get_by_label('搜尋範圍').select_option('Title')
            await capture_catalog(lambda: search.press('Enter'), 'webpacx.ncue.edu.tw', '/search', {
                'searchInput': ['資料庫 & SQL'], 'searchField': ['TI'],
            })
            checks.append('NCUE Enter preserves the translated title field and complete query text')

            await goto_school('pu')
            search = page.get_by_label('關鍵字', exact=True)
            await search.fill('資料庫 & SQL')
            await page.get_by_label('搜尋範圍').select_option('Title')
            await capture_catalog(lambda: search.press('Enter'), 'webpacx.lib.pu.edu.tw', '/search', {
                'searchInput': ['資料庫 & SQL'], 'searchField': ['Title'],
            })
            checks.append('existing Providence form also submits with production CSP enabled')

            await goto_school('cgu')
            search = page.get_by_label('想找的書或關鍵字', exact=True)
            await search.fill('護理 & 健康')
            before = len(catalog_requests)
            await search.press('Enter')
            await expect(page.get_by_role('form', name='搜尋本校館藏')).to_have_count(0)
            await expect(page.get_by_role('button', name='直接搜尋本校館藏 ↗')).to_have_count(0)
            await expect(page.get_by_text('請前往校方館藏網站搜尋。可先在這裡輸入並複製關鍵字，開啟後再貼上。')).to_be_visible()
            await expect(search).to_have_value('護理 & 健康')
            assert len(catalog_requests) == before and len(context.pages) == 1
            await capture_catalog(
                lambda: page.get_by_role('link', name='前往官方館藏入口 ↗', exact=True).click(),
                'web20.lib.cgu.edu.tw', '/', {},
            )
            checks.append('CGU offers its official catalog and copy handoff without pretending an unverified keyword search works')

            await goto_school('nthu')
            await page.get_by_label('想找的書或關鍵字', exact=True).fill('僅清華的搜尋內容')
            await page.locator('header summary[aria-label^="切換校園："]').click()
            await page.get_by_role('combobox', name='瀏覽校園', exact=True).select_option('ncue')
            await expect(page.get_by_text('國立彰化師範大學圖書與資訊處', exact=True)).to_be_visible()
            await expect(page.get_by_label('想找的書或關鍵字', exact=True)).to_have_value('')
            await expect(page.get_by_role('button', name='直接搜尋本校館藏 ↗')).to_be_disabled()
            await expect(page.get_by_role('link', name='前往官方館藏入口 ↗', exact=True)).to_have_attribute('href', 'https://webpacx.ncue.edu.tw/')
            assert await page.locator('form[aria-label="搜尋本校館藏"] input[type="hidden"]').count() == 0
            checks.append('changing the campus through the real header control clears the previous query and search payload')

            for theme in ['light', 'dark']:
                await page.emulate_media(color_scheme=theme)
                for width in [390, 320]:
                    await page.set_viewport_size({'width': width, 'height': 844})
                    await goto_school('ncue')
                    await page.get_by_label('想找的書或關鍵字', exact=True).fill('設計與資訊科技 & 跨領域學習')
                    await no_overflow(page)
                    if theme == 'dark':
                        assert await page.evaluate('getComputedStyle(document.body).backgroundColor') == 'rgb(0, 0, 0)'
                        assert await page.evaluate('getComputedStyle(document.documentElement).backgroundColor') == 'rgb(0, 0, 0)'
                    await page.screenshot(path=str(OUT / f'library-{theme}-{width}.png'), full_page=True, animations='disabled')
                checks.append(f'library search and external-service actions fit 320px and 390px in {theme} mode')

            assert not [item for item in csp_violations if item['directive'] == 'form-action'], csp_violations
            assert not errors, errors
            checks.append('all catalog popups are isolated from their opener and trigger no form-action CSP violations or page errors')
        finally:
            result = {
                'checks': checks, 'pageErrors': errors, 'cspViolations': csp_violations,
                'interceptedCatalogRequests': catalog_requests, 'blockedExternalRequests': blocked_requests,
                'fixtureNote': 'Synthetic directory/session and locally fulfilled catalog pages; no external catalog requests were sent.',
            }
            (OUT / 'results.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
            await context.close()
            await browser.close()
        print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    asyncio.run(main())
