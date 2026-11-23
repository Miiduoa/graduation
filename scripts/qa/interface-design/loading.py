from playwright.async_api import expect


async def check_loading_feedback(page, config, report, capture):
    await page.get_by_role('button', name='檢查載入狀態', exact=True).click()
    samples = page.locator('#interface-loading-samples')
    await expect(samples.get_by_role('status')).to_have_count(3)
    await expect(samples.get_by_role('status').filter(has_text='正在讀取課程內容…')).to_be_visible()
    await expect(samples.get_by_role('status').filter(has_text='正在確認登入狀態…')).to_be_visible()

    metrics = await samples.get_by_role('status').evaluate_all('''nodes => nodes.map(node => {
      const box = node.getBoundingClientRect();
      const text = node.querySelector('p');
      const label = text.getBoundingClientRect();
      const track = node.querySelector('span[aria-hidden="true"]');
      const stroke = getComputedStyle(track.firstElementChild);
      return {
        message: text.textContent, left: box.left, right: box.right, width: innerWidth,
        textLeft: label.left, textRight: label.right,
        clientWidth: text.clientWidth, scrollWidth: text.scrollWidth,
        clientHeight: text.clientHeight, scrollHeight: text.scrollHeight,
        fontSize: parseFloat(getComputedStyle(text).fontSize),
        animation: stroke.animationName, live: node.getAttribute('aria-live'),
        atomic: node.getAttribute('aria-atomic'), trackHidden: track.getAttribute('aria-hidden'),
      };
    })''')
    reduced = config.get('motion') == 'reduce' or config.get('system_motion') == 'reduce'
    for metric in metrics:
        assert metric['left'] >= -1 and metric['right'] <= metric['width'] + 1, metric
        assert metric['textLeft'] >= metric['left'] - 1 and metric['textRight'] <= metric['right'] + 1, metric
        assert metric['scrollWidth'] <= metric['clientWidth'] + 1, metric
        assert metric['scrollHeight'] <= metric['clientHeight'] + 1, metric
        assert metric['live'] == 'polite' and metric['atomic'] == 'true', metric
        assert metric['trackHidden'] == 'true', metric
        assert (metric['animation'] == 'none') == reduced, metric
        assert metric['fontSize'] >= (29 if config.get('text') == '200' else 14), metric

    # An indeterminate activity cue must not announce an invented completion percentage.
    await expect(samples.get_by_role('progressbar')).to_have_count(0)
    report.setdefault('loadingFeedback', []).extend(metrics)
    report['checks'].append('Contextual loading labels remain readable without clipping, announce one polite status and honor the current motion preference')
    await samples.scroll_into_view_if_needed()
    await capture('loading-feedback', full_page=False)

    original = await page.locator('html').get_attribute('data-reduced-motion')
    try:
        await page.locator('html').evaluate("node => { node.dataset.reducedMotion = 'true'; }")
        assert await samples.get_by_role('status').evaluate_all('''nodes => nodes.every(node =>
          getComputedStyle(node.querySelector('span[aria-hidden="true"]').firstElementChild).animationName === 'none')''')
        report['checks'].append('Changing the motion preference while loading stops every decorative activity animation without removing the status')
    finally:
        await page.locator('html').evaluate('''(node, value) => {
          if (value === null) delete node.dataset.reducedMotion;
          else node.dataset.reducedMotion = value;
        }''', original)
