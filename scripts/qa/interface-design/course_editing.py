from urllib.parse import urlencode, urlsplit

from playwright.async_api import expect


async def checkpoint_ledger(page, report, stage):
    ledger = await page.evaluate('window.__interfaceQA.snapshot()')
    report.setdefault('courseEditingLedgers', []).append({'stage': stage, **ledger})
    assert not ledger['requests'], (stage, ledger)
    assert ledger['logouts'] == 0, (stage, ledger)


async def check_course_editing(page, config, report, capture):
    origin = urlsplit(page.url)._replace(path='', query='', fragment='').geturl()
    params = {key: value for key, value in config.items() if key in ('theme', 'role', 'text', 'motion', 'font')}
    params['path'] = '/interface-course-editing'
    address = origin + '/?' + urlencode(params)
    # Reloading creates a new document and a fresh ledger. Preserve and verify
    # every phase before replacing it, including the preceding suite section.
    await checkpoint_ledger(page, report, 'before-course-editing')
    await page.goto(address)
    await expect(page.get_by_role('heading', name='課程編輯與接續')).to_be_visible()

    # Measure the real browser movement immediately inside the event handler.
    # This catches an explicit smooth scroll bypassing CSS reduced motion.
    await page.get_by_role('button', name='查看捲動結果').click()
    result = page.get_by_role('status', name='捲動位置紀錄')
    await expect(result).to_have_text('已記錄此次定位')
    before = float(await result.get_attribute('data-before'))
    after = float(await result.get_attribute('data-after'))
    reduced = config.get('motion') == 'reduce' or config.get('system_motion') == 'reduce'
    if reduced:
        assert before - after > 700 and 0 <= after < 300, (before, after)
    else:
        assert abs(before - after) < 5, (before, after)
        await _settle_scroll(page)
    report.setdefault('courseEditing', {})['scroll'] = {'before': before, 'after': after, 'reduced': reduced}

    opener = page.get_by_role('button', name='編輯範例課程')
    await opener.click()
    editor = page.get_by_role('dialog', name='編輯課程', exact=True)
    await expect(editor).to_be_visible()
    name = editor.get_by_role('textbox', name='課名', exact=True)
    await expect(name).to_be_focused()
    await name.fill('資料結構・尚未儲存的修改')

    geometry = await editor.evaluate('''dialog => {
      const box=dialog.getBoundingClientRect();
      const form=dialog.querySelector('form');
      const input=form.querySelector('input[name="name"]');
      const controls=[...form.querySelectorAll('a, button, input, select')];
      return {
        width: innerWidth, left: box.left, right: box.right,
        content: dialog.scrollWidth, viewport: dialog.clientWidth,
        bodyFont: parseFloat(getComputedStyle(form).fontSize),
        fieldFont: parseFloat(getComputedStyle(input).fontSize),
        labelFont: parseFloat(getComputedStyle(input.closest('label')).fontSize),
        small: controls.flatMap(node => {
          const r=node.getBoundingClientRect();
          return r.width < 43.5 || r.height < 43.5 ? [{name:node.textContent, width:r.width, height:r.height}] : [];
        }),
      };
    }''')
    assert geometry['left'] >= 0 and geometry['right'] <= geometry['width'], geometry
    assert geometry['content'] <= geometry['viewport'] + 1, geometry
    assert geometry['fieldFont'] >= max(16, geometry['bodyFont']) - 0.1, geometry
    assert abs(geometry['labelFont'] - geometry['bodyFont']) < 0.1, geometry
    assert not geometry['small'], geometry
    report['courseEditing']['geometry'] = geometry
    await capture('course-editor', full_page=False)

    link = editor.get_by_role('link', name='作業與教材', exact=True)
    await link.click()
    confirmation = page.get_by_role('dialog', name='放棄修改並開啟課業？', exact=True)
    await expect(confirmation).to_be_visible()
    assert await confirmation.evaluate('''dialog => {
      const active=document.activeElement;
      return dialog.contains(active) &&
        (active?.textContent === '繼續編輯' || active?.tagName === 'H2');
    }'''), 'Confirmation must start at its safe action or its readable title'
    await capture('course-editing-confirm', full_page=False)
    await confirmation.get_by_role('button', name='繼續編輯').click()
    await expect(confirmation).to_have_count(0)
    await expect(link).to_be_focused()
    await expect(name).to_have_value('資料結構・尚未儲存的修改')

    async with page.context.expect_page() as opened:
        await link.click(modifiers=['ControlOrMeta'])
    other = await opened.value
    try:
        await other.wait_for_url('**/course/interface-course*#assignment-work-a')
        await other.wait_for_load_state('domcontentloaded')
        destination = urlsplit(other.url)
        assert destination.path == '/course/interface-course' and destination.fragment == 'assignment-work-a', other.url
        await expect(other.get_by_role('heading', name='課務導覽', exact=True)).to_be_visible()
        await checkpoint_ledger(other, report, 'coursework-new-tab')
        await expect(editor).to_be_visible()
        await expect(name).to_have_value('資料結構・尚未儲存的修改')
        await expect(confirmation).to_have_count(0)
    finally:
        await other.close()
        await page.bring_to_front()

    await link.click()
    await expect(confirmation).to_be_visible()
    await page.keyboard.press('Escape')
    await expect(confirmation).to_have_count(0)
    await expect(link).to_be_focused()
    await expect(name).to_have_value('資料結構・尚未儲存的修改')

    # Native focus and all actions remain reachable with the keyboard open or
    # in a landscape-sized viewport; there is one scroll area per dialog.
    original = page.viewport_size
    await page.set_viewport_size({'width': min(config['width'], 390), 'height': 360})
    await page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    save = editor.get_by_role('button', name='儲存', exact=True)
    await link.focus()
    for _ in range(12):
        if await save.evaluate('node => node === document.activeElement'):
            break
        await page.keyboard.press('Tab')
    await expect(save).to_be_focused()
    await expect(save).to_be_in_viewport()
    await link.click()
    await expect(confirmation).to_be_visible()
    discard = confirmation.get_by_role('button', name='放棄修改並開啟', exact=True)
    await discard.focus()
    await expect(discard).to_be_in_viewport()
    await capture('course-editing-short', full_page=False)
    await discard.click()
    await page.wait_for_url('**/course/interface-course#assignment-work-a')
    await expect(page.locator('dialog')).to_have_count(0)
    await page.set_viewport_size(original)
    report['checks'].append('Course edits survive cancel, Escape and a real new tab; only explicit discard leaves the editor, including at a 360px viewport height')

    await checkpoint_ledger(page, report, 'after-draft-navigation')
    await page.goto(address)
    await opener.click()
    await editor.get_by_role('button', name='儲存', exact=True).click()
    await expect(name).to_be_disabled()
    await expect(link).to_have_attribute('aria-disabled', 'true')
    # aria-disabled does not stop native keyboard activation by itself.
    await link.focus()
    await page.keyboard.press('Enter')
    assert '/interface-course-editing' in page.url, page.url
    await expect(editor).to_be_visible()
    await expect(confirmation).to_have_count(0)
    await capture('course-editing-pending', full_page=False)
    report['checks'].append('An actual Enter on the coursework link cannot navigate the current tab while saving; form controls remain frozen')
    report['checks'].append('Course fields follow the chosen text size and retain 44px targets without horizontal clipping; reduced motion scrolls immediately')

    # This is a test reset after the intentionally unresolved synthetic save.
    # Explicitly accept the native beforeunload guard rather than bypassing it.
    await checkpoint_ledger(page, report, 'after-pending-navigation')
    async def accept_reset_guard(dialog):
        assert dialog.type == 'beforeunload', dialog.type
        await dialog.accept()
    page.on('dialog', accept_reset_guard)
    try:
        await page.goto(origin + '/?' + urlencode({key: value for key, value in params.items() if key != 'path'}))
    finally:
        page.remove_listener('dialog', accept_reset_guard)


async def _settle_scroll(page):
    await page.wait_for_function('window.scrollY > 500')
