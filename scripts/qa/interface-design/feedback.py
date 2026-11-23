from urllib.parse import parse_qs, urlparse

from playwright.async_api import expect


ACTION_NAMES = {
    'feedback-plain': '儲存提醒',
    'feedback-left': '加入行程',
    'feedback-right': '繼續',
    'feedback-icon': '重新整理資料',
    'feedback-full': '同步課程與作業',
}
GEOMETRY_IDS = [*ACTION_NAMES, 'feedback-neighbor', 'feedback-unavailable']

KEYBOARD_TARGET_METRICS = '''node => {
  const rect=node.getBoundingClientRect(), style=getComputedStyle(node);
  const top=document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2);
  const describe=element => element ? {
    tag:element.tagName,id:element.id,role:element.getAttribute('role'),
    name:(element.getAttribute('aria-label') || element.textContent || '').trim().slice(0,80),
  } : null;
  return {target:describe(node),width:rect.width,height:rect.height,
    top:rect.top,bottom:rect.bottom,left:rect.left,right:rect.right,
    outline:parseFloat(style.outlineWidth),outlineStyle:style.outlineStyle,
    focused:document.activeElement===node,focusVisible:node.matches(':focus-visible'),
    unobscured:top===node || node.contains(top),hitTarget:describe(top),
    scrollY,viewportHeight:innerHeight,
    scrollPaddingBottom:getComputedStyle(document.documentElement).scrollPaddingBottom};
}'''

FORCED_COLOR_METRICS = '''() => {
  const node=document.getElementById('feedback-plain');
  const unavailableNode=document.getElementById('feedback-unavailable');
  if (!node || !unavailableNode) return null;
  const style=getComputedStyle(node), unavailable=getComputedStyle(unavailableNode);
  const rail=node.querySelector(':scope > span[aria-hidden="true"]');
  if (!rail) return null;
  const stroke=getComputedStyle(rail,'::after');
  return {active:matchMedia('(forced-colors: active)').matches,
    foreground:style.color,background:style.backgroundColor,border:style.borderTopColor,
    rail:stroke.backgroundColor,unavailable:unavailable.color,
    strokeColor:stroke.color,strokeAdjustment:stroke.forcedColorAdjust,
    buttonAdjustment:style.forcedColorAdjust,strokeImage:stroke.backgroundImage,
    strokeAnimation:stroke.animationName,strokeTransition:stroke.transitionDuration,
    colorScheme:style.colorScheme,systemReduced:matchMedia('(prefers-reduced-motion: reduce)').matches};
}'''

FORCED_COLOR_READABLE = '''value && value.active && value.foreground !== value.background
  && value.border !== value.background && value.rail !== value.background
  && value.foreground !== value.unavailable'''


async def measure_actions(page):
    # Document coordinates let native keyboard scrolling happen without
    # mistaking that scroll for a layout shift. No geometry is mocked.
    return await page.evaluate('''ids => Object.fromEntries(ids.map(id => {
      const node=document.getElementById(id), rect=node.getBoundingClientRect();
      return [id,{left:rect.left+scrollX,top:rect.top+scrollY,
        width:rect.width,height:rect.height,text:node.textContent,
        iconCount:node.querySelectorAll('svg').length}];
    }))''', GEOMETRY_IDS)


def same_geometry(before, after, label):
    for identity in GEOMETRY_IDS:
        for dimension in ('left', 'top', 'width', 'height'):
            assert abs(before[identity][dimension] - after[identity][dimension]) < .1, (
                label, identity, dimension, before[identity], after[identity])
        assert before[identity]['text'] == after[identity]['text'], (label, identity, 'label changed')
        assert before[identity]['iconCount'] == after[identity]['iconCount'], (label, identity, 'icon removed')


async def visible_keyboard_target(page, target, report):
    await expect(target).to_be_focused()
    await expect(target).to_be_in_viewport(ratio=1)
    initial = await target.evaluate(KEYBOARD_TARGET_METRICS)
    try:
        # Native smooth scrolling can put the target inside the viewport before
        # it clears the fixed navigation. Observe it settling; never scroll or
        # move focus on the product's behalf, and keep the same strict oracle.
        await page.wait_for_function(
            f'''node => {{ const value=({KEYBOARD_TARGET_METRICS})(node);
              return value.focused && value.focusVisible && value.unobscured
                && value.outline >= 2 && value.outlineStyle !== 'none'; }}''',
            arg=await target.element_handle(), timeout=2000)
    finally:
        metrics = await target.evaluate(KEYBOARD_TARGET_METRICS)
        if not initial['unobscured'] or not metrics['unobscured']:
            report.setdefault('keyboardTargetSettling', []).append({'initial': initial, 'settled': metrics})
    await expect(target).to_be_in_viewport(ratio=1)
    assert metrics['width'] >= 43.99 and metrics['height'] >= 43.99, metrics
    assert metrics['focusVisible'] and metrics['outline'] >= 2 and metrics['outlineStyle'] != 'none', metrics
    assert metrics['unobscured'], ('Focused control is obscured', metrics)


async def recovery_layout(page, region):
    metrics = await region.evaluate('''node => {
      const rect=node.getBoundingClientRect();
      return {left:rect.left,right:rect.right,width:innerWidth,
        contentWidth:document.documentElement.scrollWidth,
        clipped:[...node.querySelectorAll('h1,p,a,button')].flatMap(control => {
          const r=control.getBoundingClientRect();
          return r.left<rect.left-1 || r.right>rect.right+1 || control.scrollWidth>control.clientWidth+1
            ? [{tag:control.tagName,text:control.textContent,width:r.width,content:control.scrollWidth}]:[];
        })};
    }''')
    assert metrics['contentWidth'] <= metrics['width'] + 1, metrics
    assert metrics['left'] >= 0 and metrics['right'] <= metrics['width'] + 1, metrics
    assert not metrics['clipped'], metrics
    return metrics


async def campus_href(link, path):
    href = await link.get_attribute('href')
    parsed = urlparse(href)
    assert not parsed.scheme and not parsed.netloc and parsed.path == path, href
    assert parse_qs(parsed.query) == {'schoolId': ['pu'], 'campus': ['pu'], 'school': ['PU']}, href
    assert not parsed.fragment, href
    return href


async def check_action_feedback(page, config, report, capture):
    await page.get_by_role('button', name='檢查操作回饋', exact=True).click()
    panel = page.get_by_role('region', name='操作回饋驗收', exact=True)
    await expect(panel.get_by_role('heading', name='操作回饋', exact=True)).to_be_visible()
    assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
    reduced = config.get('motion') == 'reduce' or config.get('system_motion') == 'reduce'
    start = panel.get_by_role('button', name='開始處理', exact=True)
    await start.focus()
    for identity in ('feedback-plain', 'feedback-neighbor', 'feedback-left', 'feedback-right', 'feedback-icon', 'feedback-full'):
        await page.keyboard.press('Tab')
        await visible_keyboard_target(page, page.locator('#' + identity), report)
    before = await measure_actions(page)
    await capture('action-feedback-idle')

    await start.focus()
    await start.press('Enter')
    end = panel.get_by_role('button', name='結束處理', exact=True)
    await expect(end).to_be_focused()
    activity = []
    for identity, name in ACTION_NAMES.items():
        action = page.locator('#' + identity)
        await expect(action).to_have_accessible_name(name)
        await expect(action).to_be_disabled()
        await expect(action).to_have_attribute('aria-busy', 'true')
        await expect(action).to_have_css('opacity', '1')
        await expect(action).to_have_css('cursor', 'progress')
        metrics = await action.evaluate('''node => {
          const rail=node.querySelector(':scope > span[aria-hidden="true"]');
          if (!rail) return null;
          const button=node.getBoundingClientRect(), r=rail.getBoundingClientRect();
          const bar=getComputedStyle(rail,'::after');
          return {left:r.left-button.left,right:button.right-r.right,
            top:r.top-button.top,bottom:button.bottom-r.bottom,width:r.width,height:r.height,
            animation:bar.animationName,animationDuration:bar.animationDuration};
        }''')
        assert metrics and min(metrics[key] for key in ('left', 'right', 'top', 'bottom')) >= 0, (identity, metrics)
        assert metrics['width'] > 0 and metrics['height'] > 0, (identity, metrics)
        if reduced:
            assert metrics['animation'] == 'none', (identity, metrics)
        else:
            assert metrics['animation'] != 'none' and float(metrics['animationDuration'].rstrip('s')) > 0, (identity, metrics)
        activity.append({'id': identity, **metrics})
    unavailable = page.locator('#feedback-unavailable')
    await expect(unavailable).to_be_disabled()
    assert not await unavailable.get_attribute('aria-busy')
    assert float(await unavailable.evaluate('node=>getComputedStyle(node).opacity')) < 1
    pending = await measure_actions(page)
    same_geometry(before, pending, 'busy')
    await page.keyboard.press('Tab')
    await visible_keyboard_target(page, page.locator('#feedback-neighbor'), report)
    await page.keyboard.press('Tab')
    # Every remaining pending action and the unavailable action must be skipped.
    await visible_keyboard_target(page, page.get_by_role('button', name='顯示完成通知', exact=True), report)
    await capture('action-feedback-busy')

    try:
        await page.emulate_media(forced_colors='active')
        initial_forced = await page.evaluate(FORCED_COLOR_METRICS)
        try:
            # The protocol media change can precede the rendering update.
            # Wait for the existing contrast conditions, not for a guessed
            # delay; a persistently invisible stroke still fails this gate.
            await page.wait_for_function(
                f'''() => {{ const value=({FORCED_COLOR_METRICS})();
                  return {FORCED_COLOR_READABLE}; }}''', timeout=2000)
        finally:
            forced = await page.evaluate(FORCED_COLOR_METRICS)
            report['forcedColorSettling'] = {'initial': initial_forced, 'settled': forced}
        assert forced['active'] and forced['foreground'] != forced['background'], forced
        assert forced['border'] != forced['background'] and forced['rail'] != forced['background'], forced
        assert forced['foreground'] != forced['unavailable'], forced
        same_geometry(before, await measure_actions(page), 'forced colors while busy')
        await capture('action-feedback-forced-colors')
    finally:
        await page.emulate_media(forced_colors='none')

    await end.focus()
    await end.press('Enter')
    await expect(panel.get_by_role('button', name='開始處理', exact=True)).to_be_focused()
    for identity in ACTION_NAMES:
        await expect(page.locator('#' + identity)).to_be_enabled()
        assert not await page.locator('#' + identity).get_attribute('aria-busy')
    restored = await measure_actions(page)
    same_geometry(before, restored, 'completed')
    report['actionFeedback'] = {'before': before, 'pending': pending, 'restored': restored,
                                'activity': activity, 'forcedColors': forced}
    report['checks'].append('Plain, left/right-icon, icon-only and full-width actions retain their labels, icons and exact layout through pending/completed states; neighboring controls stay in place, native Tab skips disabled actions, and reduced motion/forced colors preserve readable feedback')

    await page.get_by_role('button', name='檢查失效連結', exact=True).click()
    missing = page.get_by_role('region', name='找不到這個頁面', exact=True)
    await expect(missing.get_by_role('heading', name='找不到這個頁面', exact=True)).to_have_count(1)
    await expect(missing.get_by_role('button', name='重新載入', exact=True)).to_have_count(0)
    return_life = missing.get_by_role('link', name='返回生活', exact=True)
    all_services = missing.get_by_role('link', name='查看全部校園服務', exact=True)
    life_href = await campus_href(return_life, '/life')
    await campus_href(all_services, '/search')
    missing_geometry = await recovery_layout(page, missing)
    await page.locator('#page-content').focus()
    for target in (return_life, all_services):
        await page.keyboard.press('Tab')
        await visible_keyboard_target(page, target, report)
    await capture('recovery-missing')
    await page.keyboard.press('Shift+Tab')
    await visible_keyboard_target(page, return_life, report)
    await return_life.press('Enter')
    ledger = await page.evaluate('window.__interfaceQA.snapshot()')
    assert ledger['navigations'][-1] == life_href and ledger['state']['pathname'] == '/life', ledger

    await page.get_by_role('button', name='檢查頁面重試', exact=True).click()
    failed = page.get_by_role('region', name='這個頁面暫時打不開', exact=True)
    await expect(failed.get_by_role('heading', name='這個頁面暫時打不開', exact=True)).to_have_count(1)
    retry = failed.get_by_role('button', name='重新載入', exact=True)
    return_connect = failed.get_by_role('link', name='返回交流', exact=True)
    all_services = failed.get_by_role('link', name='查看全部校園服務', exact=True)
    await campus_href(return_connect, '/connect')
    await campus_href(all_services, '/search')
    error_geometry = await recovery_layout(page, failed)
    ledger = await page.evaluate('window.__interfaceQA.snapshot()')
    assert ledger['state']['pathname'] == '/community/fixture-error', ledger
    await page.locator('#page-content').focus()
    for target in (retry, return_connect, all_services):
        await page.keyboard.press('Tab')
        await visible_keyboard_target(page, target, report)
    await capture('recovery-error')
    for target in (return_connect, retry):
        await page.keyboard.press('Shift+Tab')
        await visible_keyboard_target(page, target, report)
    await retry.press('Enter')
    await expect(page.get_by_role('heading', name='今天', exact=True)).to_be_visible()
    ledger = await page.evaluate('window.__interfaceQA.snapshot()')
    assert ledger['navigations'][-1] == '/' and ledger['state']['pathname'] == '/', ledger
    report['pageRecovery'] = {'missing': missing_geometry, 'error': error_geometry,
                              'retryBoundary': 'synthetic reset navigates to /; no real error or API request'}
    report['checks'].append('Real missing/error recovery components retain campus-only destinations, fit the active viewport/text size, expose keyboard-visible actions, and retry only after Enter; routing/reset boundaries are synthetic')
