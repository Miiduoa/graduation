"""Run against the local Next app: python3 scripts/qa/browser/search-history.py http://localhost:3000."""

import asyncio
import sys

from playwright.async_api import async_playwright, expect


async def check_search_history(origin):
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch()
        try:
            page = await browser.new_page()
            await page.route('**/api/schools', lambda route: route.fulfill(json={
                'schools': [
                    {'id': 'pu', 'name': '靜宜大學', 'status': 'open'},
                    {'id': 'nthu', 'name': '國立清華大學', 'status': 'open'},
                ],
            }))
            await page.goto(f'{origin}/search?campus=pu&q=借書&category=campus')
            campus = page.locator('summary[aria-label="切換校園：靜宜大學"]')
            await expect(campus).to_be_visible()
            field = page.get_by_role('searchbox', name='想找什麼？', exact=True)
            results = page.locator('#service-search-results')
            library = results.get_by_role('link').filter(
                has=page.get_by_role('heading', name='圖書館', exact=True),
            )
            await expect(field).to_have_value('借書')
            await library.click()
            await page.wait_for_url('**/library?*')
            await page.go_back()
            await expect(library).to_be_focused()

            metadata = """() => ({
              key: history.state.__campusSearchHistoryEntry,
              snapshot: history.state.__campusSearchResultReturn,
            })"""
            before = await page.evaluate(metadata)
            assert before['key'] and before['snapshot']['token'], before
            await page.evaluate("""() => {
              if (!history.state.__NA) throw new Error('Expected the real Next history marker');
              history.replaceState(history.state, '', '?campus=nthu&q=公車');
            }""")
            await expect(page.locator('summary[aria-label="切換校園：國立清華大學"]')).to_be_visible()
            await expect(field).to_have_value('')
            await expect(page.get_by_role('button', name='全部', exact=True)).to_have_attribute(
                'aria-pressed', 'true',
            )
            await expect(page).to_have_url(f'{origin}/search?campus=nthu')
            assert await page.evaluate(metadata) == before

            # A fresh document starts with a Next entry and no search return key.
            await page.goto(f'{origin}/search?campus=pu&q=借書&category=campus')
            await expect(campus).to_be_visible()
            await page.wait_for_function("""() =>
              history.state?.__NA === true && history.state.__PRIVATE_NEXTJS_INTERNALS_TREE
            """)
            await page.evaluate("""() => {
              window.__searchHistoryTestDocument = true;
              const payload = new Map([['view', { mode: 'compact' }]]);
              history.replaceState(payload, '');
              if (!(history.state instanceof Map) || history.state.__campusSearchHistoryEntry) {
                throw new Error('Expected an unkeyed Map in browser history');
              }
            }""")
            await library.click()
            await page.wait_for_url('**/library?*')
            await page.go_back()
            await expect(field).to_have_value('借書')
            await expect(page.get_by_role('button', name='校園生活', exact=True)).to_have_attribute(
                'aria-pressed', 'true',
            )
            await expect(library).to_be_focused()
            assert await page.evaluate("""() => window.__searchHistoryTestDocument === true""")
            assert await page.evaluate("""() =>
              history.state.__NA === true && !!history.state.__PRIVATE_NEXTJS_INTERNALS_TREE
            """)
            assert await page.evaluate("""() =>
              history.state.__campusSearchHistoryPayload?.get('view')
            """) == {'mode': 'compact'}

            # Keep the same campus scope when the push removes the campus query.
            await page.goto(f'{origin}/library?campus=all')
            await page.wait_for_function("() => history.state?.__NA === true")
            await page.evaluate("() => { window.__pushBeforeSearch = history.pushState; }")
            await page.get_by_role('link', name='搜尋服務與語音輸入').click()
            await page.wait_for_url('**/search?campus=all')
            await expect(field).to_be_visible()
            await page.wait_for_function("""() =>
              window.__pushBeforeSearch && history.pushState !== window.__pushBeforeSearch
            """)
            await page.evaluate("""() => {
              history.replaceState(new Map([['view', 'compact']]), '');
              if (!(history.state instanceof Map)) throw new Error('Expected a native Map entry');
              history.pushState({}, '', '?q=公車');
            }""")
            await expect(page).to_have_url(f'{origin}/search?q=%E5%85%AC%E8%BB%8A')
            await expect(field).to_have_value('公車')
            await expect(results.get_by_role('link').filter(
                has=page.get_by_role('heading', name='公車', exact=True),
            )).to_be_visible()

            # Keep the search observer installed while exercising an off-search query write.
            await page.evaluate("() => window.next.router.push('/library?campus=all')")
            await page.wait_for_url(f'{origin}/library?campus=all')
            requested = asyncio.Event()
            release = asyncio.Event()

            async def delay_search_navigation(route):
                if route.request.headers.get('rsc') == '1':
                    requested.set()
                    await release.wait()
                await route.continue_()

            destination = f'{origin}/search?campus=all&q=pending-navigation'
            pattern = '**/search?campus=all&q=pending-navigation*'
            await page.route(pattern, delay_search_navigation)
            try:
                await page.evaluate("(url) => window.next.router.push(url)", destination)
                await asyncio.wait_for(requested.wait(), timeout=15)
                await expect(page).to_have_url(f'{origin}/library?campus=all')
                # Match replaceStudyQuery: reuse Next's active state while changing the query.
                await page.evaluate("""() => {
                  if (!history.state?.__NA) throw new Error('Expected the real Next history marker');
                  history.replaceState(history.state, '', '?campus=all&q=edited');
                }""")
                await expect(page).to_have_url(f'{origin}/library?campus=all&q=edited')
            finally:
                release.set()
                await page.unroute(pattern, delay_search_navigation)
            await expect(page).to_have_url(destination)
        finally:
            await browser.close()


if __name__ == '__main__':
    asyncio.run(check_search_history(sys.argv[1].rstrip('/')))
