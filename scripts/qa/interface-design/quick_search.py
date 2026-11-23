from playwright.async_api import expect


async def check_quick_search(page, config, report, capture):
    # Replace only the browser's speech service. The real voice control renders
    # and handles the failure; no microphone prompt or speech network is used.
    await page.evaluate('''() => {
      window.SpeechRecognition = class {
        start() { queueMicrotask(() => this.onerror?.({error: 'network'})); }
        abort() { this.onend?.(); }
        stop() { this.onend?.(); }
      };
    }''')
    await page.get_by_role('button', name='檢查快速搜尋', exact=True).click()
    form = page.get_by_role('search', name='快速尋找服務', exact=True)
    field = form.get_by_role('searchbox', name='想做什麼？', exact=True)
    await expect(field).to_be_visible()
    root = await page.locator('html').evaluate('node => parseFloat(getComputedStyle(node).fontSize)')
    expected = max(16, root * (1.0625 if config.get('font') == 'large' else .9375))
    size = await field.evaluate('node => parseFloat(getComputedStyle(node).fontSize)')
    assert abs(size - expected) < .1, ('Quick search lost the active text preference', size, expected)
    await capture('quick-start')

    await field.fill('借書')
    await field.press('Enter')
    results = page.get_by_role('region', name='服務搜尋結果', exact=True)
    await expect(results).to_be_focused()
    await expect(results.get_by_role('link', name='圖書館', exact=False)).to_have_count(1)
    if config.get('motion') == 'reduce' or config.get('system_motion') == 'reduce':
        await expect(results).to_have_css('animation-name', 'none')
    ledger = await page.evaluate('window.__interfaceQA.snapshot()')
    assert ledger['navigations'][-1] == '/interface-quick', ledger
    assert not ledger['requests'], ledger

    await results.get_by_role('button', name='重新輸入', exact=True).click()
    await expect(field).to_have_value('')
    await expect(field).to_be_focused()
    # DOM composition verifies the browser event path, not an operating-system IME.
    await field.dispatch_event('compositionstart', {'data': ''})
    await field.fill('圖')
    await field.press('Enter')
    await expect(field).to_be_focused()
    await field.fill('圖書館')
    await field.dispatch_event('compositionend', {'data': '圖書館'})
    await field.press('Enter')
    await expect(results).to_be_focused()

    voice = form.get_by_role('button', name='使用語音輸入', exact=True)
    await voice.click()
    await expect(form.get_by_role('alert')).to_contain_text('語音辨識暫時無法連線')
    geometry = await form.evaluate('''form => {
      const input = form.querySelector('input');
      const row = input.parentElement.getBoundingClientRect();
      const field = input.getBoundingClientRect();
      const alert = form.querySelector('[role="alert"]').getBoundingClientRect();
      const buttons = [...form.querySelectorAll('button')].map(button => {
        const rect = button.getBoundingClientRect();
        return {label: button.textContent, width: rect.width, height: rect.height};
      });
      return {width: innerWidth, content: document.documentElement.scrollWidth,
        fieldWidth: field.width, rowBottom: row.bottom, alertTop: alert.top, buttons};
    }''')
    assert geometry['content'] <= geometry['width'] + 1, geometry
    assert geometry['fieldWidth'] >= 64, geometry
    assert geometry['alertTop'] >= geometry['rowBottom'], 'Voice error crowded the search field'
    assert all(button['width'] >= 43.5 and button['height'] >= 43.5 for button in geometry['buttons']), geometry
    await capture('quick-results-and-voice-error')

    details = form.locator('details')
    await details.locator('summary').click()
    await expect(details).to_have_attribute('open', '')
    await expect(details).to_contain_text('不會上傳本功能的錄音檔')
    assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
    await results.get_by_role('button', name='重新輸入', exact=True).click()
    await expect(field).to_have_value('')
    await expect(field).to_be_focused()
    report['checks'].append('Quick search: Enter moves to local results without a request or navigation; composition stays in the field; reset restores focus; large text, voice failure and disclosure stay within the viewport')
    report['quickSearch'] = {'fontSize': size, 'expectedFontSize': expected, 'geometry': geometry, 'syntheticSpeechError': True}
    await page.get_by_role('button', name='返回今天', exact=True).click()
    await expect(page.get_by_role('heading', name='今天', exact=True)).to_be_visible()
