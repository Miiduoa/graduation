"""Run against the local Next app: python3 scripts/qa/browser/search-history.py http://localhost:3000."""

import asyncio
import sys

from playwright.async_api import async_playwright, expect


async def check_search_history(origin, fragment):
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
            # Development hydration can install the wrappers in either order.
            # Give the observer the native method and Next a forwarding reference
            # so this first document exercises Next wrapping the real observer.
            await page.add_init_script("""(() => {
              if (location.pathname !== '/search' || sessionStorage.searchHistoryOuterNext) return;
              sessionStorage.searchHistoryOuterNext = '1';
              const nativeReplace = history.replaceState.bind(history);
              let push = history.pushState;
              let searchReplace;
              let nextReplace;
              let installingSearch = false;
              const forwardReplace = (...args) => (searchReplace ?? nativeReplace)(...args);
              window.__searchHistoryOptIns = [];
              Object.defineProperties(history, {
                pushState: {
                  configurable: true,
                  get: () => push,
                  set(wrapper) {
                    push = wrapper;
                    installingSearch = wrapper.name === '';
                  },
                },
                replaceState: {
                  configurable: true,
                  get: () => installingSearch
                    ? nativeReplace : (searchReplace && nextReplace) || forwardReplace,
                  set(wrapper) {
                    if (installingSearch) {
                      searchReplace = wrapper.bind(history);
                      installingSearch = false;
                      window.__searchHistoryOuterNext = Boolean(nextReplace);
                    } else {
                      nextReplace = wrapper.name === 'replaceState' ? function (state, title, url) {
                        if (state?.__NA && state[Symbol.for('nuni.app-router.sync-history-query')]) {
                          window.__searchHistoryOptIns.push(url);
                        }
                        return wrapper.call(this, state, title, url);
                      } : undefined;
                      window.__searchHistoryOuterNext = Boolean(searchReplace && nextReplace);
                    }
                  },
                },
              });
            })()""")
            await page.goto(f'{origin}/search?campus=pu')
            campus = page.locator('summary[aria-label="切換校園：靜宜大學"]')
            await expect(campus).to_be_visible(timeout=15_000)
            field = page.get_by_role('searchbox', name='想找什麼？', exact=True)
            results = page.locator('#service-search-results')
            library = results.get_by_role('link').filter(
                has=page.get_by_role('heading', name='圖書館', exact=True),
            )
            await expect(field).to_have_value('')
            bus = results.get_by_role('link').filter(
                has=page.get_by_role('heading', name='公車', exact=True),
            )

            async def wait_for_history_commit():
                # React can update the field before Next writes the URL from
                # HistoryUpdater. Let that write settle before simulating drift.
                await page.evaluate("""() => new Promise(resolve =>
                  requestAnimationFrame(() => requestAnimationFrame(resolve))
                )""")

            async def check_clear_without_snapshot():
                await field.fill('借書')
                await expect(library).to_be_visible()
                await wait_for_history_commit()
                await page.evaluate("""() => {
                  const state = history.state;
                  if (!state?.__NA || state.__campusSearchResultReturn) {
                    throw new Error('Expected a Next entry without a result snapshot');
                  }
                  const draft = JSON.parse(sessionStorage.getItem('campus.directory.search.v1'));
                  if (draft?.search?.query !== '借書') throw new Error('Expected a session draft');
                  const url = new URL(location.href);
                  url.searchParams.delete('q');
                  history.replaceState(state, '', url);
                }""")
                await expect(field).to_have_value('借書')
                await page.evaluate("""() => {
                  const state = Object.defineProperty({ ...history.state },
                    Symbol.for('nuni.app-router.sync-history-query'), { value: true });
                  history.replaceState(state, '', location.href);
                }""")
                await expect(field).to_have_value('')
                await expect(page.get_by_role('button', name='全部', exact=True)).to_have_attribute(
                    'aria-pressed', 'true',
                )
                assert await page.evaluate("""() =>
                  !JSON.parse(sessionStorage.getItem('campus.directory.search.v1'))?.search?.query
                """)

            async def check_sync_after_native_replace():
                await expect(field).to_have_value('借書')
                await wait_for_history_commit()
                await page.evaluate("""() => {
                  if (!history.state?.__NA) throw new Error('Expected the real Next history marker');
                  const url = new URL(location.href);
                  url.searchParams.set('q', '公車');
                  url.searchParams.delete('category');
                  history.replaceState(history.state, '', url);
                }""")
                await page.wait_for_function("() => new URL(location.href).searchParams.get('q') === '公車'")
                await expect(field).to_have_value('借書')
                await page.evaluate("""(fragment) => {
                  const state = Object.defineProperty({ ...history.state },
                    Symbol.for('nuni.app-router.sync-history-query'), { value: true });
                  const url = new URL(location.href);
                  url.hash = fragment;
                  history.replaceState(state, '', url);
                }""", fragment)
                await expect(field).to_have_value('公車')
                await expect(bus).to_be_visible()
                assert await page.evaluate('location.hash') == fragment
                assert await page.evaluate("""() =>
                  JSON.parse(sessionStorage.getItem('campus.directory.search.v1'))?.search?.query
                """) == '公車'

            await page.wait_for_function("() => window.__searchHistoryOuterNext === true")
            await check_clear_without_snapshot()
            await page.evaluate("""() =>
              history.replaceState(null, '', '?campus=pu&q=借書&category=campus')
            """)
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
            await check_sync_after_native_replace()
            assert await page.evaluate(metadata) == before
            await page.evaluate("""() => {
              if (!history.state.__NA) throw new Error('Expected the real Next history marker');
              const state = Object.defineProperty({ ...history.state },
                Symbol.for('nuni.app-router.sync-history-query'), { value: true });
              history.replaceState(state, '', '?campus=nthu&q=公車');
            }""")
            await expect(page.locator('summary[aria-label="切換校園：國立清華大學"]')).to_be_visible()
            await expect(field).to_have_value('')
            await expect(page.get_by_role('button', name='全部', exact=True)).to_have_attribute(
                'aria-pressed', 'true',
            )
            await expect(page).to_have_url(f'{origin}/search?campus=nthu')
            assert await page.evaluate(metadata) == before
            # The page's own filter cleanup must opt in before entering Next too.
            assert '/search?campus=nthu' in await page.evaluate('window.__searchHistoryOptIns')

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
            await check_clear_without_snapshot()
            await page.evaluate("""() => {
              history.replaceState(new Map([['view', 'compact']]), '');
              if (!(history.state instanceof Map)) throw new Error('Expected a native Map entry');
              history.pushState({}, '', '?q=公車');
            }""")
            await expect(page).to_have_url(f'{origin}/search?q=%E5%85%AC%E8%BB%8A')
            await expect(field).to_have_value('公車')
            await expect(bus).to_be_visible()

            # With the observer outside Next, its copy must forward explicit intent.
            replace_search_query = """(query) => {
              const state = Object.defineProperty({ ...history.state },
                Symbol.for('nuni.app-router.sync-history-query'), { value: true });
              history.replaceState(state, '', '?q=' + encodeURIComponent(query));
            }"""
            await page.evaluate(replace_search_query, '借書')
            await expect(field).to_have_value('借書')
            await library.click()
            await page.wait_for_url('**/library?*')
            await page.go_back()
            await expect(library).to_be_focused()
            before = await page.evaluate(metadata)
            assert before['key'] and before['snapshot']['token'], before
            href = page.url
            await field.dispatch_event('compositionstart')
            await field.fill('公')
            await expect(page).to_have_url(href)
            await page.evaluate("""() => history.replaceState(null, '', location.href)""")
            await expect(field).to_have_value('公')
            await expect(page).to_have_url(href)
            assert await page.evaluate(metadata) == before
            await field.fill('借書')
            await field.dispatch_event('compositionend')
            await check_sync_after_native_replace()
            assert await page.evaluate(metadata) == before

            async def check_pending_navigation(source, target):
                requested = asyncio.Event()
                release = asyncio.Event()

                async def delay_navigation(route):
                    if route.request.headers.get('rsc') == '1':
                        requested.set()
                        await release.wait()
                    await route.continue_()

                destination = f'{target}?campus=all&q=pending-navigation'
                pattern = f'**{destination}*'
                await page.route(pattern, delay_navigation)
                try:
                    await page.evaluate("(url) => window.next.router.push(url)", destination)
                    await asyncio.wait_for(requested.wait(), timeout=15)
                    await expect(page).to_have_url(f'{origin}{source}')
                    # Match unmarked writes such as replaceStudyQuery.
                    await page.evaluate("""() => {
                      if (!history.state?.__NA) {
                        throw new Error('Expected the real Next history marker');
                      }
                      history.replaceState(history.state, '', '?campus=all&q=edited');
                    }""")
                    source_path = source.split('?', 1)[0]
                    await expect(page).to_have_url(f'{origin}{source_path}?campus=all&q=edited')
                    if source_path == '/search':
                        await expect(field).to_have_value('公車')
                        await page.evaluate("""() => {
                          const state = Object.defineProperty({ ...history.state },
                            Symbol.for('nuni.app-router.sync-history-query'), { value: true });
                          history.replaceState(state, '', '?campus=all&q=opted-in');
                        }""")
                        await expect(page).to_have_url(f'{origin}/search?campus=all&q=opted-in')
                finally:
                    release.set()
                    await page.unroute(pattern, delay_navigation)
                await expect(page).to_have_url(f'{origin}{destination}')

            # Next was installed first on this document. Keep the search observer
            # active while both ordinary and opted-in writes race a navigation.
            await check_pending_navigation(f'/search?q=%E5%85%AC%E8%BB%8A{fragment}', '/library')

            # Keep the search observer installed while exercising an off-search query write.
            await page.evaluate("() => window.next.router.push('/library?campus=all')")
            await page.wait_for_url(f'{origin}/library?campus=all')
            await check_pending_navigation('/library?campus=all', '/search')
        finally:
            await browser.close()


async def main(origin):
    for fragment in ('', '#results'):
        await check_search_history(origin, fragment)


if __name__ == '__main__':
    asyncio.run(main(sys.argv[1].rstrip('/')))
