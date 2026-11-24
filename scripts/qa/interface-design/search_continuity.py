from playwright.async_api import expect


async def assert_results_visible(page, target, report):
    await expect(target).to_be_focused()
    await expect(target).to_be_in_viewport()
    title = target.get_by_role('heading').first
    title = title if await title.count() else target
    await expect(title).to_be_in_viewport(ratio=1)
    # Browser history can begin a native smooth restoration after the product
    # first focuses its result. A single intersecting frame is not proof that
    # the settled result remains readable above the fixed mobile navigation.
    await title.evaluate('''async title => {
      await document.fonts.ready;
      await new Promise((resolve, reject) => {
        const started = performance.now();
        let previous = '', stableSince = started;
        const check = now => {
          if (!title.isConnected) return reject(new Error('Search result detached while settling'));
          const box = title.getBoundingClientRect();
          const nav = document.querySelector('nav[aria-label="主要導覽"]')?.getBoundingClientRect();
          const current = JSON.stringify([scrollX, scrollY, box.top, box.bottom, nav?.top, nav?.bottom]);
          if (current !== previous) { previous = current; stableSince = now; }
          if (now - stableSince >= 120) return resolve();
          if (now - started > 2000) return reject(new Error('Search result did not settle'));
          requestAnimationFrame(check);
        };
        requestAnimationFrame(check);
      });
    }''')
    await expect(target).to_be_focused()
    geometry = await title.evaluate('''title => {
      const nav = document.querySelector('nav[aria-label="主要導覽"]');
      const navBox = nav?.getBoundingClientRect();
      const viewport = window.visualViewport;
      const top = viewport?.offsetTop ?? 0;
      const bottom = top + (viewport?.height ?? innerHeight);
      const fixedNavigation = nav && getComputedStyle(nav).position === 'fixed'
        && navBox.bottom > top && navBox.top < bottom;
      const visibleBottom = fixedNavigation ? Math.min(bottom, navBox.top) : bottom;
      const range = document.createRange();
      range.selectNodeContents(title);
      const fragments = [...range.getClientRects()].filter(box => box.width && box.height);
      const hits = fragments.flatMap(box => [0.15, 0.5, 0.85].map(part => {
        const x = box.left + box.width * part, y = (box.top + box.bottom) / 2;
        const hit = document.elementFromPoint(x, y);
        return {x, y, clear: hit === title || title.contains(hit),
          hit: hit?.tagName, hitName: hit?.getAttribute('aria-label') || hit?.textContent?.trim().slice(0, 40)};
      }));
      return {name: title.textContent?.trim(), scrollY, viewportTop: top, visibleBottom,
        navigationTop: fixedNavigation ? navBox.top : null,
        fragments: fragments.map(box => ({top:box.top,bottom:box.bottom,left:box.left,right:box.right})),
        hits, titleReadable: fragments.length > 0 && fragments.every(box =>
          box.top >= top - 1 && box.bottom <= visibleBottom - 4
          && box.left >= -1 && box.right <= innerWidth + 1),
        unobscured: hits.length > 0 && hits.every(hit => hit.clear)};
    }''')
    report.setdefault('searchVisibility', []).append(geometry)
    await expect(title).to_be_in_viewport(ratio=1)
    assert geometry['titleReadable'], ('Settled search title is outside the usable viewport or behind fixed navigation', geometry)
    assert geometry['unobscured'], ('Settled search title is covered by another element', geometry)
    assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), 'Search flow overflowed the viewport'


async def check_directory_submit(page, config, report, capture):
    for destination, name, term in [('生活', '生活服務搜尋', '借書'), ('交流', '交流服務搜尋', '訊息')]:
        await page.get_by_role('navigation', name='主要導覽', exact=True).get_by_role('link', name=destination, exact=True).click()
        form = page.get_by_role('search', name=name, exact=True)
        field = form.get_by_role('searchbox', name='快速找服務', exact=True)
        results = page.locator('[id="' + await field.get_attribute('aria-controls') + '"]')
        heading = results.get_by_role('heading', level=2).first

        await field.fill(term)
        await expect(field).to_be_focused()
        await field.dispatch_event('compositionstart', {'data': ''})
        await field.press('Enter')
        await expect(field).to_be_focused()
        # Synthetic composition checks the DOM handler, not an OS input method.
        # A real Escape during a synthetic composition would instead invoke
        # Chromium's native search-input clear action; that is not an IME test.
        await field.dispatch_event('keydown', {'key': 'Escape', 'isComposing': True, 'keyCode': 229})
        await expect(field).to_have_value(term)
        await field.dispatch_event('compositionend', {'data': term})
        await field.press('Enter')
        await assert_results_visible(page, heading, report)
        await expect(results.get_by_role('link').first).to_be_visible()
        await capture('directory-' + destination + '-results', full_page=False)

        await field.fill('找不到的驗收服務123')
        await expect(field).to_be_focused()
        await form.get_by_role('button', name='查看結果', exact=True).click()
        await assert_results_visible(page, heading, report)
        await expect(results.get_by_role('heading', name='沒有找到符合的服務', exact=True)).to_be_visible()
        await results.get_by_role('button', name='顯示全部服務', exact=True).click()
        await expect(field).to_have_value('')
        await expect(field).to_be_focused()

        await page.get_by_role('checkbox', name='只看免登入服務', exact=True).check()
        await form.get_by_role('button', name='查看結果', exact=True).click()
        await assert_results_visible(page, heading, report)
        await expect(heading).to_have_text('免登入服務')
        await capture('directory-' + destination + '-public', full_page=False)
        await page.get_by_role('checkbox', name='只看免登入服務', exact=True).uncheck()
        await field.focus()
        await field.press('Enter')
        await assert_results_visible(page, heading, report)

        sizes = await form.locator('button').evaluate_all('''buttons => buttons.map(button => {
          const box=button.getBoundingClientRect();
          return {name:button.textContent,width:box.width,height:box.height};
        })''')
        assert all(row['width'] >= 43.5 and row['height'] >= 43.5 for row in sizes), sizes
        if config.get('motion') == 'reduce' or config.get('system_motion') == 'reduce':
            # The global reduced-motion rule retains a 0.01ms duration for
            # transition events; this control removes transition properties.
            await expect(form.get_by_role('button', name='查看結果', exact=True)).to_have_css('transition-property', 'none')
    report['checks'].append('Life and Connect: live filtering preserves input; IME Enter/Escape preserves composition; explicit search reaches visible named results for matches, empty, public-only and all services; reset returns to input; 44px controls and reduced motion stay intact')


async def check_search_return(page, config, report, capture):
    await page.get_by_role('button', name='返回今天', exact=True).click()
    trigger = page.locator('summary[aria-label="所有服務"]')
    if await trigger.locator('..').get_attribute('open') is None:
        await trigger.click()
    menu = page.locator('header details[name="campus-navigation-popover"][open]').filter(has=trigger)
    await menu.get_by_role('searchbox', name='搜尋服務', exact=True).fill('借書')
    await menu.get_by_role('button', name='查看結果', exact=True).click()
    form = page.get_by_role('search', name='尋找服務', exact=True)
    field = form.get_by_role('searchbox', name='想找什麼？', exact=True)
    await expect(field).to_have_value('借書')
    results = page.locator('#service-search-results')
    library = results.get_by_role('link').filter(has=page.get_by_role('heading', name='圖書館', exact=True))
    await expect(library).to_have_count(1)
    source_url = page.url
    target_url = await library.evaluate('link => link.href')
    await library.focus()
    await library.press('Enter')
    await page.wait_for_url(target_url)
    await expect(form).to_have_count(0)
    await page.go_back()
    assert page.url == source_url
    await expect(field).to_have_value('借書')
    await assert_results_visible(page, library, report)
    await capture('search-library-return', full_page=False)
    await page.go_forward()
    await page.wait_for_url(target_url)
    await expect(form).to_have_count(0)
    await page.go_back()
    await assert_results_visible(page, library, report)

    for shape in ('map', 'array'):
        replacement_url = await page.evaluate("""shape => {
          const previous = history.state;
          const url = new URL(location.href);
          if (shape === 'map') {
            url.searchParams.delete('q');
            url.hash = 'results';
          } else {
            url.searchParams.set('view', 'compact');
          }
          const payload = shape === 'map' ? new Map([['view', 'compact']]) : ['compact'];
          history.replaceState(payload, '', url);
          if (history.state.__campusSearchHistoryEntry !== previous.__campusSearchHistoryEntry ||
              history.state.__campusSearchResultReturn?.token !== previous.__campusSearchResultReturn.token) {
            throw new Error('Same-page replacement lost the search entry metadata');
          }
          return location.href;
        }""", shape)
        await page.go_forward()
        await page.wait_for_url(target_url)
        await expect(form).to_have_count(0)
        await page.go_back()
        assert page.url == replacement_url
        await expect(field).to_have_value('借書')
        await assert_results_visible(page, library, report)
    await page.evaluate("url => history.replaceState(history.state, '', url)", source_url)

    # New-tab activation must preserve the current source, not replay a return.
    async with page.context.expect_page() as opened:
        await library.click(modifiers=['Control'])
    other = await opened.value
    await other.wait_for_url(target_url)
    await other.close()
    await page.bring_to_front()
    assert page.url == source_url
    await expect(field).to_have_value('借書')

    # A normal new navigation may restore saved filters, but cannot claim the
    # browser history entry that owned the previous service result focus.
    await page.get_by_role('button', name='返回今天', exact=True).click()
    if await trigger.locator('..').get_attribute('open') is None:
        await trigger.click()
    menu = page.locator('header details[name="campus-navigation-popover"][open]').filter(has=trigger)
    await menu.get_by_role('searchbox', name='搜尋服務', exact=True).fill('借書')
    await menu.get_by_role('button', name='查看結果', exact=True).click()
    await expect(field).to_have_value('借書')
    await expect(library).not_to_be_focused()

    # Use a fresh entry: after a previous successful return, Forward only
    # restores its corrected position and misses this race. Focus followed by
    # immediate activation can leave native smooth scrolling in progress; after
    # time on the destination, Back initially has a visible result. nearest
    # then does nothing while the old history restoration moves it out of view.
    await library.focus()
    await library.press('Enter')
    await page.wait_for_url(target_url)
    await page.wait_for_timeout(600)
    await page.go_back()
    assert page.url == source_url
    await expect(field).to_have_value('借書')
    await assert_results_visible(page, library, report)
    await capture('search-library-settled-return', full_page=False)

    # Insert a native application push between the fixture's Router dispatch
    # and its marked commit. Back must land on the intervening search entry.
    for shape in ['record', 'array']:
        pushed_url = await page.evaluate("""shape => {
          const trackedPush = history.pushState;
          const routerPush = Symbol.for('nuni.app-router.history-push');
          const target = new URL(location.href);
          if (shape === 'array') target.searchParams.set('q', '公車');
          else target.hash = 'results';
          history.pushState = function (data, unused, url) {
            if (data?.[routerPush]) {
              history.pushState = trackedPush;
              const state = Object.assign(shape === 'array' ? ['compact'] : {}, {
                __NA: true,
                __PRIVATE_NEXTJS_INTERNALS_TREE: structuredClone(
                  history.state.__PRIVATE_NEXTJS_INTERNALS_TREE
                ),
              });
              trackedPush.call(this, state, '', target);
            }
            trackedPush.call(this, data, unused, url);
          };
          return target.href;
        }""", shape)
        await library.press('Enter')
        await page.wait_for_url(target_url)
        await expect(form).to_have_count(0)
        await page.go_back()
        assert page.url == pushed_url
        await expect(field).to_have_value('借書')
        await assert_results_visible(page, library, report)
        report['checks'].append(f'Search: Back from a committed result restores focus after an intervening application push with a {shape}')

    await form.get_by_role('button', name='清除搜尋', exact=True).click()
    await expect(field).to_be_focused()
    related = results.locator('details[data-directory-section="service:/classroom"]')
    # Browse a secondary service through its real disclosure. If its family is
    # inside a collapsed category, expand that parent through the visible UI.
    parent = related.locator('xpath=ancestor::details[1]')
    if await parent.count():
        await parent.locator(':scope > summary').click()
    await related.locator(':scope > summary').click()
    bookmark = related.get_by_role('link').filter(has=page.get_by_role('heading', name='教材收藏', exact=True))
    destination = await bookmark.evaluate('link => link.href')
    await bookmark.click()
    await page.wait_for_url(destination)
    await page.go_back()
    await expect(related).to_have_attribute('open', '')
    await assert_results_visible(page, bookmark, report)
    await capture('search-related-return', full_page=False)

    if config['role'] != 'guest':
        await field.fill('幫我整理今天的事情')
        assistant = form.get_by_role('link', name='交給校園助理', exact=True)
        destination = await assistant.evaluate('link => link.href')
        await assistant.click()
        await page.wait_for_url(destination)
        await page.go_back()
        await expect(field).to_have_value('幫我整理今天的事情')
        await assert_results_visible(page, assistant, report)
        await capture('search-assistant-return', full_page=False)

    ledger = await page.evaluate('window.__interfaceQA.snapshot()')
    assert not ledger['requests'], ledger
    report['checks'].append('Search: immediate Back/Forward and a fresh entry after time on its destination restore the original service, nested disclosure and assistant entry; after scroll settles each title remains above fixed navigation and passes text hit-testing; new-tab preserves query; fresh navigation does not steal result focus; return makes no network request')
    await page.get_by_role('button', name='返回今天', exact=True).click()
    # Returning to the source page can restore its saved service menu. Leave
    # this scenario with that disclosure closed for the next independent check.
    if await trigger.locator('..').get_attribute('open') is not None:
        await page.get_by_role('button', name='關閉所有服務', exact=True).click()


async def check_search_continuity(page, config, report, capture):
    await check_directory_submit(page, config, report, capture)
    await check_search_return(page, config, report, capture)
