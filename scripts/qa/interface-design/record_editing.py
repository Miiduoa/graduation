from pathlib import Path
from urllib.parse import urlencode, urlsplit

from playwright.async_api import expect


async def _checkpoint(page, report, stage):
    ledger = await page.evaluate('window.__interfaceQA.snapshot()')
    record = await page.evaluate('window.__recordEditingQA?.snapshot() ?? null')
    report.setdefault('recordEditingLedgers', []).append({'stage': stage, 'interface': ledger, 'records': record})
    assert not ledger['requests'] and ledger['logouts'] == 0, (stage, ledger)
    return record


async def check_record_editing(page, config, report, capture):
    origin = urlsplit(page.url)._replace(path='', query='', fragment='').geturl()
    appearance = {key: value for key, value in config.items() if key in ('theme', 'text', 'motion', 'font')}
    # The record workflow uses a real local guest store; account isolation is
    # covered by component tests. Other suite sections retain their own roles.
    params = {**appearance, 'role': 'guest', 'kind': 'grades', 'path': '/interface-record-editing'}
    original_viewport = page.viewport_size
    await _checkpoint(page, report, 'before-record-editing')
    await page.goto(origin + '/?' + urlencode(params))
    try:
        await expect(page.get_by_role('heading', name='個人紀錄編輯驗收', exact=True)).to_be_visible()
        saved = page.get_by_role('region', name='已匯入的個人資料', exact=True)
        await expect(saved.get_by_role('button', name='編輯 ', exact=False)).to_have_count(40)
        initial = await _checkpoint(page, report, 'seeded')
        assert initial['attempts'] == 0 and initial['writes'] == 0 and len(initial['records']) == 40, initial

        original_title = '資料結構與演算法'
        opener = saved.get_by_role('button', name='編輯 ' + original_title, exact=True)
        await opener.click()
        editor = page.get_by_role('dialog', name='編輯 ' + original_title, exact=True)
        await expect(editor).to_be_visible()
        assert await editor.evaluate("dialog => dialog.matches(':modal')"), 'Record editor must be a native modal'
        name = editor.get_by_role('textbox', name='名稱', exact=True)
        await expect(name).to_be_focused()
        await name.fill('尚未儲存的課名')

        # Native inert prevents an enabled background control stealing focus. Programmatic
        # click() is deliberately not used: it bypasses normal user hit testing.
        background_search = page.locator('section[aria-label="已匯入的個人資料"] input[type="search"]')
        assert not await background_search.evaluate('input => input.disabled')
        await background_search.evaluate('input => input.focus()')
        assert await editor.evaluate('dialog => dialog.contains(document.activeElement)'), 'Background search stole focus through the modal'
        await expect(name).to_have_value('尚未儲存的課名')

        geometry = await editor.evaluate('''dialog => {
          const form=dialog.querySelector('form');
          const input=form.querySelector('input');
          const box=dialog.getBoundingClientRect();
          const controls=[...form.querySelectorAll('button, input:not([type="checkbox"]), select, summary')].filter(node=>node.checkVisibility());
          return {left:box.left,right:box.right,width:innerWidth,
            content:dialog.scrollWidth,viewport:dialog.clientWidth,
            bodyFont:parseFloat(getComputedStyle(form).fontSize),
            fieldFont:parseFloat(getComputedStyle(input).fontSize),
            labelFont:parseFloat(getComputedStyle(input.closest('label')).fontSize),
            animation:getComputedStyle(dialog).animationName,
            small:controls.flatMap(node=>{const r=node.getBoundingClientRect();
              return r.width<43.5||r.height<43.5?[{name:node.textContent,width:r.width,height:r.height}]:[];})};
        }''')
        assert geometry['left'] >= 0 and geometry['right'] <= geometry['width'] + 1, geometry
        assert geometry['content'] <= geometry['viewport'] + 1, geometry
        assert geometry['fieldFont'] >= max(16, geometry['bodyFont']) - .1, geometry
        assert abs(geometry['labelFont'] - geometry['bodyFont']) < .1, geometry
        assert not geometry['small'], geometry
        if config.get('motion') == 'reduce' or config.get('system_motion') == 'reduce':
            assert geometry['animation'] == 'none', geometry
        report.setdefault('recordEditing', {})['geometry'] = geometry
        await capture('record-editor', full_page=False)

        cancel = editor.get_by_role('button', name='取消編輯', exact=True)
        await cancel.click()
        confirmation = page.get_by_role('dialog', name='放棄這筆修改？', exact=True)
        await expect(confirmation).to_be_visible()
        await confirmation.get_by_role('button', name='繼續編輯', exact=True).click()
        await expect(cancel).to_be_focused()
        await expect(name).to_have_value('尚未儲存的課名')
        await page.keyboard.press('Escape')
        await expect(confirmation).to_be_visible()
        await page.keyboard.press('Escape')
        await expect(confirmation).to_have_count(0)
        await expect(name).to_have_value('尚未儲存的課名')

        # Provider revalidation must hide portals as well as the old workspace.
        await page.evaluate('window.__recordEditingQA.pauseIdentity(true)')
        await expect(page.locator('dialog[open]')).to_have_count(0)
        await expect(saved).not_to_be_visible()
        await page.evaluate('window.__recordEditingQA.pauseIdentity(false)')
        await expect(editor).to_be_visible()
        await expect(name).to_have_value('尚未儲存的課名')
        await expect(name).to_be_focused()

        # A user can collapse a details section even when its controlled open
        # prop remains true. Submission must reveal the invalid field first.
        term = editor.locator('summary').filter(has_text='學期與課程資料')
        await term.click()
        academic_year = editor.get_by_role('textbox', name='學年度', exact=True)
        await academic_year.fill('')
        await term.click()
        await expect(academic_year).not_to_be_visible()
        await editor.get_by_role('button', name='儲存修改', exact=True).click()
        await expect(academic_year).to_be_visible()
        await expect(academic_year).to_be_focused()
        await academic_year.fill('115')

        # Enter reaches validation, rather than silently doing nothing behind a
        # disabled submit button. No records are changed by invalid input.
        await name.fill('')
        await name.press('Enter')
        await expect(name).to_be_focused()
        await expect(name).to_have_attribute('aria-invalid', 'true')
        assert (await page.evaluate('window.__recordEditingQA.snapshot()'))['writes'] == 0
        await name.fill('儲存後的新課名')

        await page.set_viewport_size({'width': min(config['width'], 390), 'height': 360})
        await name.focus()
        save = editor.get_by_role('button', name='儲存修改', exact=True)
        for _ in range(24):
            if await save.evaluate('node => node === document.activeElement'):
                break
            await page.keyboard.press('Tab')
            assert await editor.evaluate('dialog => dialog.contains(document.activeElement)'), 'Tab left the editing dialog'
        await expect(save).to_be_focused()
        await expect(save).to_be_in_viewport()
        await capture('record-editor-short', full_page=False)
        await page.set_viewport_size(original_viewport)

        # Hold the genuine storage lock, then fail its eventual local write.
        # This exercises product pending, retry and duplicate prevention paths.
        await page.evaluate('window.__recordEditingQA.failStorage(true)')
        await page.evaluate('window.__recordEditingQA.holdWrites()')
        await save.click()
        await expect(name).to_be_disabled()
        await expect(cancel).to_be_disabled()
        await page.keyboard.press('Enter')
        await page.keyboard.press('Escape')
        await expect(editor).to_be_visible()
        assert (await page.evaluate('window.__recordEditingQA.snapshot()'))['attempts'] == 0
        await capture('record-editor-pending', full_page=False)
        await page.evaluate('window.__recordEditingQA.releaseWrites()')
        await expect(editor.get_by_role('alert')).to_contain_text('這次沒有存成')
        await expect(name).to_be_enabled()
        await expect(name).to_have_value('儲存後的新課名')
        failed = await _checkpoint(page, report, 'failed-write')
        assert failed['attempts'] == 1 and failed['writes'] == 0, failed
        assert next(row for row in failed['records'] if row['id'] == 'record-fixture-0')['title'] == original_title
        await capture('record-editor-error', full_page=False)
        await page.evaluate('window.__recordEditingQA.failStorage(false)')
        await save.click()
        await expect(editor).to_have_count(0)
        updated = saved.get_by_role('button', name='編輯 儲存後的新課名', exact=True)
        await expect(updated).to_be_focused()
        assert (await page.evaluate('window.__recordEditingQA.snapshot()'))['writes'] == 1
        report['checks'].append('The native record editor contains focus, preserves dirty input through cancel and identity revalidation, and retains input after a real storage failure')

        # Renaming the only search result removes its opener from the DOM.
        search = saved.get_by_role('searchbox', name='搜尋個人紀錄', exact=True)
        await search.fill('儲存後的新課名')
        await updated.click()
        editor = page.get_by_role('dialog', name='編輯 儲存後的新課名', exact=True)
        await editor.get_by_role('textbox', name='名稱', exact=True).fill('重新命名的課程')
        await editor.get_by_role('button', name='儲存修改', exact=True).click()
        await expect(editor).to_have_count(0)
        await expect(search).to_be_focused()
        await expect(saved.get_by_role('button', name='編輯 ', exact=False)).to_have_count(0)
        await search.fill('')
        await saved.get_by_role('button', name='編輯 重新命名的課程', exact=True).click()
        editor = page.get_by_role('dialog', name='編輯 重新命名的課程', exact=True)
        remove = editor.get_by_role('button', name='移除這筆', exact=True)
        await remove.click()
        deletion = page.get_by_role('dialog', name='移除「重新命名的課程」？', exact=True)
        await expect(deletion).to_be_visible()
        await deletion.get_by_role('button', name='保留紀錄', exact=True).click()
        await expect(remove).to_be_focused()
        assert (await page.evaluate('window.__recordEditingQA.snapshot()'))['writes'] == 2
        await remove.click()
        await deletion.get_by_role('button', name='確認移除', exact=True).click()
        await expect(page.locator('dialog[open]')).to_have_count(0)
        await expect(search).to_be_focused()
        removed = await _checkpoint(page, report, 'removed-record')
        assert removed['writes'] == 3 and len(removed['records']) == 39, removed
        assert all(row['id'] != 'record-fixture-0' for row in removed['records'])
        report['checks'].append('Renaming out of a search result and removing a record restore focus to record search; deletion requires explicit confirmation')

        # A genuine second write changes the saved version while this editor is
        # open. Its stale original must never be silently rebased or overwritten.
        await saved.get_by_role('button', name='編輯 合成課程 2', exact=True).click()
        editor = page.get_by_role('dialog', name='編輯 合成課程 2', exact=True)
        name = editor.get_by_role('textbox', name='名稱', exact=True)
        await name.fill('仍在編輯的本頁版本')
        await page.evaluate("window.__recordEditingQA.replaceTitle('record-fixture-1', '另一分頁已儲存的版本')")
        await editor.get_by_role('button', name='儲存修改', exact=True).click()
        await expect(editor.get_by_role('alert')).to_contain_text('另一個頁面變更')
        await expect(name).to_have_value('仍在編輯的本頁版本')
        conflict = await _checkpoint(page, report, 'stale-record-rejected')
        assert conflict['writes'] == 4 and conflict['attempts'] == 5, conflict
        assert next(row for row in conflict['records'] if row['id'] == 'record-fixture-1')['title'] == '另一分頁已儲存的版本'
        await editor.get_by_role('button', name='取消編輯', exact=True).click()
        await page.get_by_role('dialog', name='放棄這筆修改？', exact=True).get_by_role('button', name='放棄修改', exact=True).click()
        await expect(page.locator('dialog[open]')).to_have_count(0)
        await expect(saved.get_by_role('button', name='編輯 另一分頁已儲存的版本', exact=True)).to_be_focused()
        report['checks'].append('A changed saved record rejects the stale edit, retains the local draft and preserves the other page’s committed version')

        # Open the last row of a long list in a short viewport. A long original
        # title must not leave the focused first field outside the scrollport.
        long_title = next(row for row in initial['records'] if row['id'] == 'record-fixture-39')['title']
        await page.set_viewport_size({'width': min(config['width'], 390), 'height': 360})
        await saved.get_by_role('button', name='編輯 ' + long_title, exact=True).click()
        editor = page.get_by_role('dialog', name='編輯 ' + long_title, exact=True)
        name = editor.get_by_role('textbox', name='名稱', exact=True)
        await expect(name).to_be_focused()
        await expect(name).to_be_in_viewport(ratio=1)
        await capture('record-editor-long-title', full_page=False)
        await editor.get_by_role('button', name='移除這筆', exact=True).click()
        deletion = page.get_by_role('dialog', name='移除「' + long_title + '」？', exact=True)
        await deletion.get_by_role('button', name='確認移除', exact=True).click()
        await expect(page.locator('dialog[open]')).to_have_count(0)
        await expect(search).to_be_focused()
        await expect(search).to_be_in_viewport(ratio=1)
        final = await _checkpoint(page, report, 'removed-last-record')
        assert final['writes'] == 5 and final['attempts'] == 6 and len(final['records']) == 38, final
        await page.set_viewport_size(original_viewport)
        report['checks'].append('A long title opens with its first field visible; removing the last item reveals the fallback search instead of leaving focus offscreen')
        report['checks'].append('Record controls follow text preferences and remain reachable at 320px, 200% text and a 360px viewport height')
        await _checkpoint(page, report, 'completed-record-editing')
    except Exception:
        # Preserve the failure before releasing a synthetic pending storage lock.
        await capture('record-editing-before-cleanup-failure', full_page=False)
        output = Path(__file__).resolve().parents[3] / 'artifacts' / 'interface-design'
        html = config['name'] + '-record-editing-before-cleanup-failure.html'
        (output / html).write_text(await page.content(), encoding='utf-8')
        report['recordEditingFailure'] = {
            'records': await page.evaluate('window.__recordEditingQA?.snapshot() ?? null'),
            'interface': await page.evaluate('window.__interfaceQA.snapshot()'),
            'html': html,
        }
        raise
    finally:
        await page.evaluate('''async () => {
          const fixture=window.__recordEditingQA;
          if (!fixture) return;
          fixture.failStorage(false);
          fixture.pauseIdentity(false);
          await fixture.releaseWrites();
        }''')
        await page.set_viewport_size(original_viewport)

    # Return the shared suite to its own account and route after preserving all
    # local write and network evidence; each page reload creates a fresh ledger.
    reset = {key: value for key, value in config.items() if key in ('theme', 'role', 'text', 'motion', 'font')}
    await page.goto(origin + '/?' + urlencode(reset))
