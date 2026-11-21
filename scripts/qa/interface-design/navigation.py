from playwright.async_api import expect


async def check_navigation_geometry(page, config, report):
    await page.evaluate('''async () => {
      await document.fonts.ready;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }''')
    geometry = await page.get_by_role('navigation', name='主要導覽', exact=True).evaluate('''nav => {
      const box = node => {
        const r = node.getBoundingClientRect();
        return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};
      };
      return {nav:box(nav), fixed:getComputedStyle(nav).position === 'fixed',
        viewport:{width:innerWidth,height:innerHeight},
        contentPadding:parseFloat(getComputedStyle(document.body).paddingBottom),
        items:[...nav.children].map(link => {
          const label=link.querySelector('span'), icon=link.querySelector('svg');
          const range=document.createRange(); range.selectNodeContents(label);
          return {name:label.textContent,box:box(link),label:box(label),
            glyphs:[...range.getClientRects()].map(r=>({left:r.left,right:r.right,top:r.top,bottom:r.bottom})),
            icon:icon.checkVisibility()?box(icon):null,
            current:link.getAttribute('aria-current') === 'page'};
        })};
    }''')
    for item in geometry['items']:
        box = item['box']
        for part in [item['label'], item['icon'], *item['glyphs']]:
            if part is None:
                continue
            assert part['left'] >= box['left'] - 1 and part['right'] <= box['right'] + 1, item
            assert part['top'] >= box['top'] - 1 and part['bottom'] <= box['bottom'] + 1, item
        if geometry['fixed'] and item['current']:
            assert item['label']['bottom'] <= box['bottom'] - 5, ('Label overlaps current marker', item)
    if geometry['fixed']:
        nav = geometry['nav']
        assert nav['left'] >= 0 and nav['right'] <= geometry['viewport']['width'] + 1, geometry
        assert nav['bottom'] <= geometry['viewport']['height'] + 1, geometry
        assert abs(geometry['contentPadding'] - nav['height']) <= 1, geometry
    academic = page.get_by_role('navigation', name='課務導覽', exact=True)
    if await academic.count():
        sizes = await academic.locator('a').evaluate_all('''links => {
          const root=getComputedStyle(document.documentElement);
          const expected=parseFloat(root.getPropertyValue('--font-body-sm-size'))*parseFloat(root.fontSize);
          return links.map(link=>({name:link.textContent,size:parseFloat(getComputedStyle(link).fontSize),expected}));
        }''')
        assert all(abs(item['size'] - item['expected']) < .1 for item in sizes), sizes
    report.setdefault('navigationGeometry', []).append(geometry)
    report['checks'].append('Navigation labels and icons fit their targets; current marker stays clear; content clearance follows actual mobile bar height; academic text follows preferences')


async def check_today_reading_width(page, config, report):
    geometry = await page.get_by_test_id('student-today').evaluate('''screen => {
      const box = node => {
        const r=node.getBoundingClientRect();
        return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width};
      };
      const rows=(testId, schedule) => [...screen.querySelectorAll(`[data-testid="${testId}"] li > a:first-child`)].map(link => {
        const body=link.children[schedule ? 1 : 0];
        // CSS Modules are minified in this real production bundle. Locate the
        // synthetic work titles by their rendered text, not generated classes.
        const title=schedule ? body.firstElementChild.firstElementChild : [...body.children].find(node =>
          ['小組專題進度紀錄','資料處理練習'].includes(node.textContent.trim()));
        if (!title) throw new Error('Expected Today fixture title is missing from its content row');
        const action=link.nextElementSibling;
        return {text:title.textContent,body:box(body),fontSize:parseFloat(getComputedStyle(title).fontSize),
          time:schedule ? box(link.firstElementChild) : null,
          action:action ? box(action) : null};
      });
      return {classes:rows('today-classes',true),work:rows('today-work',false)};
    }''')
    if config['role'] == 'guest':
        assert not geometry['classes'] and not geometry['work'], geometry
        return
    assert geometry['classes'], 'The real Today course rows were not rendered'
    for item in [*geometry['classes'], *geometry['work']]:
        assert item['body']['width'] >= 5 * item['fontSize'], ('Reading text was squeezed by adjacent time or action', item)
        if config['name'] == 'compact-large-200':
            if item['time']:
                assert item['time']['bottom'] <= item['body']['top'] + 1, item
            if item['action']:
                assert item['action']['top'] >= item['body']['bottom'] - 1, item
    report['todayReadingGeometry'] = geometry
    report['checks'].append('Today course and task text keeps a readable width; very large text places time above and service actions below the content')


async def check_service_navigation(page, config, report, capture):
    await page.get_by_role('button', name='返回今天', exact=True).click()
    trigger = page.locator('summary[aria-label="所有服務"]')
    await trigger.click()
    menu = page.locator('header details[name="campus-navigation-popover"][open]').filter(has=trigger)
    field = menu.get_by_role('searchbox', name='搜尋服務', exact=True)
    submit = menu.get_by_role('button', name='查看完整搜尋結果', exact=True)
    await expect(submit).to_be_visible()
    panel = await field.evaluate('''input => {
      const panel=input.closest('[id$="-services"]');
      const contents=panel.querySelector('[id$="-results"]');
      return {columns:getComputedStyle(contents).gridTemplateColumns.split(' ').length,
        panelWidth:panel.getBoundingClientRect().width,
        textSize:parseFloat(getComputedStyle(panel).fontSize),
        fieldWidth:input.getBoundingClientRect().width,
        bodySize:parseFloat(getComputedStyle(input).fontSize)};
    }''')
    assert panel['columns'] == (1 if panel['panelWidth'] <= panel['textSize'] * 32 + 2 else 2), panel
    assert panel['fieldWidth'] >= max(80, panel['bodySize'] * 3), panel
    await capture('services-adaptive')

    await field.fill('圖書館')
    library = menu.get_by_role('link', name='圖書館', exact=True)
    await expect(library).to_be_visible()
    text = library.locator('span').first
    before = await text.bounding_box()
    await library.hover()
    await page.wait_for_timeout(180)
    after = await text.bounding_box()
    assert abs(before['x'] - after['x']) < .1, {'before': before, 'after': after}
    if config.get('motion') == 'reduce' or config.get('system_motion') == 'reduce':
        await expect(library.locator('span[aria-hidden="true"]')).to_have_css('transform', 'none')

    source_url = page.url
    # Genuine browser modifier activation; the product must leave the current
    # query and disclosure alone while the link opens in another tab.
    target_url = await library.evaluate('link => link.href')
    async with page.context.expect_page() as opened:
        await library.click(modifiers=['Control'])
    background = await opened.value
    await background.wait_for_url(target_url)
    await background.close()
    await page.bring_to_front()
    await expect(menu).to_have_attribute('open', '')
    await expect(field).to_have_value('圖書館')
    assert page.url == source_url
    await capture('services-new-tab-preserved')

    await library.click()
    await expect(trigger.locator('..')).not_to_have_attribute('open', '')
    if config['role'] == 'guest':
        await page.get_by_role('button', name='開啟校園助理', exact=True).click()
        assistant = page.get_by_role('dialog', name='校園助理', exact=True)
        assistant_search = assistant.get_by_role('searchbox', name='想做什麼？', exact=True)
        await assistant_search.fill('圖書館')
        await assistant_search.press('Enter')
        same_service = assistant.get_by_role('region', name='服務搜尋結果', exact=True).get_by_role('link', name='圖書館', exact=False)
        assert await same_service.evaluate('link => link.href') == page.url
        await same_service.click()
        await expect(assistant).to_have_count(0)
        report['checks'].append('Choosing the current library through the actual guest assistant closes its overlay even when the URL does not change')
    await page.go_back()
    await expect(trigger.locator('..')).to_have_attribute('open', '')
    await expect(field).to_have_value('圖書館')
    assert page.url == source_url
    await capture('services-back-restored')
    await field.focus()
    await page.keyboard.press('Escape')
    await expect(trigger).to_be_focused()
    await page.go_forward()
    await page.go_back()
    await expect(trigger.locator('..')).not_to_have_attribute('open', '')

    await trigger.click()
    await field.fill('借書')
    await field.dispatch_event('compositionstart', {'data': ''})
    await field.press('Enter')
    assert page.url == source_url, 'IME confirmation unexpectedly navigated'
    await field.dispatch_event('compositionend', {'data': '借書'})
    await field.press('Enter')
    state = await page.evaluate('window.__interfaceQA.snapshot().state')
    assert state['pathname'] == '/search', state
    query = await page.evaluate('Object.fromEntries(new URLSearchParams(location.search))')
    assert query.get('q') == '借書' and query.get('schoolId') == 'pu', query
    await page.go_back()
    await expect(trigger.locator('..')).to_have_attribute('open', '')
    await expect(field).to_have_value('借書')
    await field.focus()
    await page.keyboard.press('Escape')
    report['serviceNavigation'] = {'layout': panel, 'realBrowserHistory': True, 'realModifierTab': True}
    report['checks'].append('Services adapt to panel width and text size; hover keeps words still; new-tab click preserves the task; real Back restores once; Enter retains query and campus without submitting during IME composition')

    await page.get_by_role('navigation', name='主要導覽', exact=True).get_by_role('link', name='生活', exact=True).click()
    await expect(page.get_by_role('heading', name='生活', exact=True)).to_be_visible()
    card = page.locator('a[data-service-href="/library"]')
    await card.scroll_into_view_if_needed()
    await card.hover()
    before_press = await card.evaluate('node => ({background:getComputedStyle(node).backgroundColor,x:node.getBoundingClientRect().x,y:node.getBoundingClientRect().y})')
    await page.mouse.down()
    await page.wait_for_timeout(180)
    pressed = await card.evaluate('node => ({background:getComputedStyle(node).backgroundColor,x:node.getBoundingClientRect().x,y:node.getBoundingClientRect().y})')
    assert pressed['background'] != before_press['background'], {'before': before_press, 'pressed': pressed}
    assert pressed['x'] == before_press['x'] and pressed['y'] == before_press['y'], 'Pressed service card moved its text or layout'
    await page.mouse.move(1, 1)
    await page.mouse.up()
    assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
    await capture('life-service-directory')
    report['checks'].append('Life directory uses actual product components; pressing a service gives visible feedback without moving content or overflowing the viewport')
    await page.get_by_role('button', name='返回今天', exact=True).click()
