import asyncio
import functools
import hashlib
import http.server
import json
import threading
from pathlib import Path
from urllib.parse import urlencode, urlsplit

from playwright.async_api import async_playwright, expect


ROOT = Path(__file__).resolve().parents[3]
OUTPUT = ROOT / 'artifacts' / 'calendar-workspace'
SCENARIOS = [
    {'name': 'desktop-light', 'width': 1440, 'height': 1000, 'theme': 'light'},
    {'name': 'mobile-dark', 'width': 390, 'height': 844, 'theme': 'dark'},
    {'name': 'compact-large-reduced', 'width': 320, 'height': 740, 'theme': 'dark',
     'text': '200', 'motion': 'reduce', 'system_motion': 'reduce'},
]


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def verify_source_hashes():
    manifest = json.loads((OUTPUT / 'source-sha256.json').read_text())
    for row in manifest['files']:
        actual = hashlib.sha256((ROOT / row['path']).read_bytes()).hexdigest()
        if actual != row['sha256']:
            raise AssertionError(f'Source changed after bundling: {row["path"]}')
    return {'gitHead': manifest['gitHead'], 'verifiedFiles': len(manifest['files'])}


async def set_month(page, month):
    await page.get_by_label('查看月份', exact=True).fill(month)
    await expect(page.get_by_label('查看月份', exact=True)).to_have_value(month)


async def choose_date(page, date):
    await page.get_by_role('button', name='月格', exact=True).click()
    await set_month(page, date[:7])
    button = page.get_by_role('button', name=date, exact=True)
    await button.click()
    await expect(button).to_have_attribute('aria-pressed', 'true')


def day_heading(page, date):
    return page.get_by_role('heading').filter(has_text=date)


async def assert_complete_field_value(page, label, value, text, report):
    field = page.get_by_label(label, exact=True)
    await expect(field).to_have_value(value)
    state = await field.evaluate('''field => {
      const ids = (field.getAttribute('aria-describedby') || '').split(/\\s+/).filter(Boolean);
      const time = ids.map(id => document.getElementById(id)).find(node => node?.tagName === 'TIME');
      if (!time) return { found: false, describedBy: ids };
      const rect = time.getBoundingClientRect();
      const style = getComputedStyle(time);
      const range = document.createRange();
      range.selectNodeContents(time);
      const textRects = [...range.getClientRects()].filter(r => r.width && r.height)
        .map(r => ({left: r.left, right: r.right, top: r.top, bottom: r.bottom}));
      const clips = [];
      for (let ancestor = time.parentElement; ancestor; ancestor = ancestor.parentElement) {
        const css = getComputedStyle(ancestor);
        const box = ancestor.getBoundingClientRect();
        if (['hidden', 'clip', 'auto', 'scroll'].includes(css.overflowX) ||
            ['hidden', 'clip', 'auto', 'scroll'].includes(css.overflowY)) {
          clips.push({left: box.left + ancestor.clientLeft, top: box.top + ancestor.clientTop,
            right: box.left + ancestor.clientLeft + ancestor.clientWidth,
            bottom: box.top + ancestor.clientTop + ancestor.clientHeight,
            x: ['hidden', 'clip', 'auto', 'scroll'].includes(css.overflowX),
            y: ['hidden', 'clip', 'auto', 'scroll'].includes(css.overflowY)});
        }
      }
      return {found: true, describedBy: ids, machineValue: time.getAttribute('datetime'),
        text: time.textContent.replace(/\\s+/g, ' ').trim(), viewport: innerWidth,
        display: style.display, visibility: style.visibility, opacity: style.opacity,
        clipPath: style.clipPath, lineClamp: style.webkitLineClamp,
        rect: {left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
          width: rect.width, height: rect.height}, textRects, clips};
    }''')
    report.setdefault('readableFieldValues', []).append({'label': label, 'expected': value, **state})
    assert state['found'], f'{label} is missing its associated visible full-value time element: {state}'
    assert state['machineValue'] == value and state['text'] == text, f'{label} full value does not match the input: {state}'
    assert state['display'] != 'none' and state['visibility'] == 'visible' and float(state['opacity']) > 0, (
        f'{label} full value is hidden: {state}')
    assert state['clipPath'] == 'none' and state['lineClamp'] in ('none', '', '0'), (
        f'{label} full value is clipped or line-clamped: {state}')
    box = state['rect']
    assert box['width'] > 0 and box['height'] > 0 and state['textRects'], f'{label} has no rendered complete value: {state}'
    for rect in state['textRects']:
        assert rect['left'] >= -1 and rect['right'] <= state['viewport'] + 1, f'{label} text extends outside the viewport: {state}'
        assert rect['left'] >= box['left'] - 1 and rect['right'] <= box['right'] + 1, f'{label} text is horizontally clipped: {state}'
        assert rect['top'] >= box['top'] - 1 and rect['bottom'] <= box['bottom'] + 1, f'{label} text is vertically clipped: {state}'
        for clip in state['clips']:
            assert not clip['x'] or (rect['left'] >= clip['left'] - 1 and rect['right'] <= clip['right'] + 1), (
                f'{label} text is clipped by an ancestor horizontally: {state}')
            assert not clip['y'] or (rect['top'] >= clip['top'] - 1 and rect['bottom'] <= clip['bottom'] + 1), (
                f'{label} text is clipped by an ancestor vertically: {state}')


async def assert_selected_day_revealed(page, date, previous_scroll_y, report):
    button = page.get_by_role('button', name=date, exact=True)
    state = await button.evaluate('''button => {
      const viewport = button.closest('[role="region"]');
      const outer = viewport.getBoundingClientRect();
      const rect = button.getBoundingClientRect();
      return {date: button.getAttribute('aria-label'),
        left: rect.left, right: rect.right, width: rect.width,
        visibleLeft: outer.left + viewport.clientLeft,
        visibleRight: outer.left + viewport.clientLeft + viewport.clientWidth,
        scrollLeft: viewport.scrollLeft, clientWidth: viewport.clientWidth,
        scrollWidth: viewport.scrollWidth, windowScrollY: window.scrollY};
    }''')
    report.setdefault('selectedDayVisibility', []).append(state)
    assert state['width'] > 0, f'Selected day is not rendered: {state}'
    assert state['left'] >= state['visibleLeft'] - 1 and state['right'] <= state['visibleRight'] + 1, (
        f'Selected day is only partly visible after returning to month view: {state}')
    assert abs(state['windowScrollY'] - previous_scroll_y) <= 1, (
        f'Revealing the selected day unexpectedly scrolled the whole page: {previous_scroll_y} -> {state}')
    await expect(page.get_by_role('button', name='月格', exact=True)).to_be_focused()


async def assert_month_controls_fit(page, report):
    controls = page.get_by_role('group', name='切換月份', exact=True)
    for label in ('上一月', '回今天', '下一月'):
        button = controls.get_by_role('button', name=label, exact=True)
        await expect(button).to_be_visible()
        state = await button.evaluate('''button => {
          const group = button.closest('[role="group"]');
          const box = button.getBoundingClientRect();
          const container = group.getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(button);
          const textRects = [...range.getClientRects()].filter(r => r.width && r.height)
            .map(r => ({left: r.left, right: r.right, top: r.top, bottom: r.bottom}));
          return {label: button.textContent.trim(), viewport: innerWidth,
            button: {left: box.left, right: box.right, top: box.top, bottom: box.bottom},
            container: {left: container.left, right: container.right,
              top: container.top, bottom: container.bottom}, textRects};
        }''')
        report.setdefault('monthControlLayouts', []).append(state)
        rects = state['textRects']
        assert rects and max(rect['top'] for rect in rects) - min(rect['top'] for rect in rects) <= 1, (
            f'Short month-control label wraps into multiple lines: {state}')
        box, container = state['button'], state['container']
        assert box['left'] >= -1 and box['right'] <= state['viewport'] + 1, (
            f'Month control leaves the viewport: {state}')
        assert box['left'] >= container['left'] - 1 and box['right'] <= container['right'] + 1, (
            f'Month control leaves its container horizontally: {state}')
        assert box['top'] >= container['top'] - 1 and box['bottom'] <= container['bottom'] + 1, (
            f'Month control leaves its container vertically: {state}')
        for rect in rects:
            assert rect['left'] >= box['left'] - 1 and rect['right'] <= box['right'] + 1, (
                f'Month label is horizontally clipped inside its button: {state}')
            assert rect['top'] >= box['top'] - 1 and rect['bottom'] <= box['bottom'] + 1, (
                f'Month label is vertically clipped inside its button: {state}')
    report['checks'].append('Month navigation keeps each short label on one line, wrapping whole buttons within the available container and viewport')


async def inspect_layout(page, stage, report):
    layout = await page.evaluate('''() => ({
      viewport: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      fontSize: getComputedStyle(document.documentElement).fontSize,
      focus: document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent?.trim().slice(0, 100),
      fields: [...document.querySelectorAll('input')].filter(node => node.getClientRects().length).map(node => {
        const rect = node.getBoundingClientRect();
        return { type: node.type, width: rect.width, left: rect.left, right: rect.right };
      }),
    })''')
    layout['stage'] = stage
    report['layouts'].append(layout)
    assert layout['documentWidth'] <= layout['viewport'] + 1, f'Page overflow at {stage}: {layout}'
    assert layout['bodyWidth'] <= layout['viewport'] + 1, f'Body overflow at {stage}: {layout}'
    for field in layout['fields']:
        assert field['width'] > 0 and field['left'] >= -1 and field['right'] <= layout['viewport'] + 1, (
            f'Field outside viewport at {stage}: {field}')


async def run_scenario(browser, server_url, config):
    context = await browser.new_context(
        viewport={'width': config['width'], 'height': config['height']},
        device_scale_factor=1,
        color_scheme=config['theme'],
        reduced_motion=config.get('system_motion', 'no-preference'),
        locale='zh-TW', timezone_id='Asia/Taipei',
    )
    page = await context.new_page()
    report = {'scenario': config, 'checks': [], 'screenshots': [], 'layouts': [],
              'pageErrors': [], 'consoleErrors': [], 'blockedRequests': []}
    page.on('pageerror', lambda error: report['pageErrors'].append(str(error)))
    page.on('console', lambda message: report['consoleErrors'].append(message.text) if message.type == 'error' else None)

    async def route_request(route):
        url = route.request.url
        if urlsplit(url).netloc == urlsplit(server_url).netloc:
            await route.continue_()
        else:
            report['blockedRequests'].append(url)
            await route.abort()

    await context.route('**/*', route_request)
    async def capture(name):
        filename = f'{config["name"]}-{name}.png'
        await inspect_layout(page, name, report)
        await page.screenshot(path=str(OUTPUT / filename), full_page=True, animations='disabled')
        report['screenshots'].append(filename)

    async def confirm_once(accept):
        seen = []
        async def respond(dialog):
            seen.append({'type': dialog.type, 'message': dialog.message, 'accepted': accept})
            assert dialog.type == 'confirm', f'Unexpected dialog: {dialog.type}'
            if accept:
                await dialog.accept()
            else:
                await dialog.dismiss()
        page.once('dialog', respond)
        return seen

    try:
        query = urlencode({key: config[key] for key in ('theme', 'text', 'motion') if key in config})
        await page.goto(server_url + '/?' + query)
        await expect(page.get_by_role('button', name='新增行程', exact=True)).to_be_enabled()
        await set_month(page, '2028-01')
        await assert_month_controls_fit(page, report)
        await capture('month')

        await page.get_by_role('button', name='新增行程', exact=True).click()
        await expect(page.get_by_label('日期', exact=True)).to_have_value('2028-01-01')
        await page.get_by_role('button', name='取消', exact=True).click()
        report['checks'].append('Creating without a selected day in another month defaults to that month, not today')

        await choose_date(page, '2028-01-18')
        await expect(day_heading(page, '2028-01-18')).to_be_visible()
        await expect(page.get_by_role('heading', name='小組討論與專題進度整理', exact=True)).to_be_visible()
        await expect(page.get_by_role('heading', name='實作報告繳交', exact=True)).to_be_visible()
        await page.get_by_role('button', name='列表', exact=True).click()
        await expect(day_heading(page, '2028-01-18')).to_be_visible()
        await expect(page.get_by_role('heading', name='月底整理', exact=True)).to_have_count(0)
        month_control = page.get_by_role('button', name='月格', exact=True)
        await month_control.scroll_into_view_if_needed()
        await month_control.focus()
        scroll_before_month = await page.evaluate('window.scrollY')
        await month_control.click()
        await expect(page.get_by_role('button', name='2028-01-18', exact=True)).to_have_attribute('aria-pressed', 'true')
        report['checks'].append('Switching month/list preserves the chosen day and its personal events plus course deadlines')
        # Do not click or focus the selected date first: that would let the
        # browser repair the product's horizontal position and hide a regression.
        await assert_selected_day_revealed(page, '2028-01-18', scroll_before_month, report)
        report['checks'].append('Returning to month view fully reveals the selected day inside the horizontal viewport without taking focus from the view control')
        await capture('day')

        await page.get_by_role('button', name='新增行程', exact=True).click()
        await expect(page.get_by_label('標題', exact=True)).to_be_focused()
        await expect(page.get_by_label('日期', exact=True)).to_have_value('2028-01-18')
        await page.get_by_label('標題', exact=True).fill('驗收新增行程')
        await page.get_by_label('地點（選填）', exact=True).fill('校園討論室')
        if config['width'] <= 540:
            await assert_complete_field_value(page, '查看月份', '2028-01', '2028 年 1 月', report)
            await assert_complete_field_value(page, '日期', '2028-01-18', '2028 年 1 月 18 日', report)
            await assert_complete_field_value(page, '開始時間', '09:00', '09:00', report)
            await assert_complete_field_value(page, '結束時間', '10:00', '10:00', report)
        await capture('create')
        before = await page.evaluate('window.__calendarQA.snapshot()')
        await page.get_by_role('button', name='儲存行程', exact=True).click()
        await expect(page.get_by_role('region', name='新增行程', exact=True)).to_have_count(0)
        await expect(page.get_by_role('heading', name='驗收新增行程', exact=True)).to_be_visible()
        await expect(day_heading(page, '2028-01-18')).to_be_focused()
        saved = await page.evaluate('window.__calendarQA.snapshot()')
        created = [row for row in saved['records'] if row['title'] == '驗收新增行程']
        assert len(created) == 1 and created[0]['date'] == '2028-01-18', 'Create must retain the selected date exactly'
        assert len(saved['writeAttempts']) == len(before['writeAttempts']) + 1, 'Create must write exactly once'
        report['checks'].append('Create uses the selected date, focuses the title, persists once through the real ledger and returns to the day heading')
        await capture('saved')

        # An untouched form cancels back to the original trigger without a prompt.
        await page.get_by_role('button', name='新增行程', exact=True).click()
        await expect(page.get_by_label('標題', exact=True)).to_be_focused()
        await page.get_by_role('button', name='取消', exact=True).click()
        await expect(page.get_by_role('button', name='新增行程', exact=True)).to_be_focused()
        report['checks'].append('Cancelling an untouched form restores its trigger without losing the selected day')

        await page.get_by_role('button', name='新增行程', exact=True).click()
        await page.get_by_label('標題', exact=True).fill('尚未儲存的內容')
        writes_before_cancel = len((await page.evaluate('window.__calendarQA.snapshot()'))['writeAttempts'])
        rejected = await confirm_once(False)
        await page.get_by_role('button', name='取消', exact=True).click()
        await expect(page.get_by_label('標題', exact=True)).to_have_value('尚未儲存的內容')
        assert len(rejected) == 1, 'Dirty cancel must request a decision'
        accepted = await confirm_once(True)
        await page.get_by_role('button', name='取消', exact=True).click()
        await expect(page.get_by_label('標題', exact=True)).to_have_count(0)
        assert len(accepted) == 1, 'Confirmed discard must close the form'
        cancelled = await page.evaluate('window.__calendarQA.snapshot()')
        assert not any(row['title'] == '尚未儲存的內容' for row in cancelled['records'])
        assert len(cancelled['writeAttempts']) == writes_before_cancel, 'Cancelling must not write storage'
        report['checks'].append('Dirty cancellation keeps the draft when declined and only discards after confirmation, with no storage write')

        # Use real storage and product error handling; inject only the external
        # Storage failure, rather than replacing the mutation function.
        await page.get_by_role('button', name='下次儲存模擬失敗', exact=True).click()
        await page.get_by_role('button', name='新增行程', exact=True).click()
        await page.get_by_label('標題', exact=True).fill('儲存失敗後保留的草稿')
        await page.get_by_role('button', name='儲存行程', exact=True).click()
        await expect(page.get_by_role('alert').filter(has_text='這次沒有存成')).to_be_visible()
        await expect(page.get_by_label('標題', exact=True)).to_have_value('儲存失敗後保留的草稿')
        failed = await page.evaluate('window.__calendarQA.snapshot()')
        assert failed['writeAttempts'][-1]['outcome'] == 'failed'
        assert not any(row['title'] == '儲存失敗後保留的草稿' for row in failed['records'])
        await capture('save-error')
        await page.get_by_role('button', name='儲存行程', exact=True).click()
        await expect(page.get_by_role('heading', name='儲存失敗後保留的草稿', exact=True)).to_be_visible()
        recovered = await page.evaluate('window.__calendarQA.snapshot()')
        assert len([row for row in recovered['records'] if row['title'] == '儲存失敗後保留的草稿']) == 1
        report['checks'].append('A real storage failure retains the complete draft and one retry creates exactly one event')

        # Edit through the list row to avoid duplicate desktop month buttons.
        row = page.get_by_role('listitem').filter(has=page.get_by_role('heading', name='驗收新增行程', exact=True))
        await row.get_by_role('button', name='編輯', exact=True).click()
        await expect(page.get_by_label('標題', exact=True)).to_be_focused()
        await page.get_by_label('日期', exact=True).fill('2028-02-09')
        if config['width'] <= 540:
            await assert_complete_field_value(page, '日期', '2028-02-09', '2028 年 2 月 9 日', report)
            report['checks'].append('Full month, date and time values are visibly associated with mobile inputs, fit without clipped text and update immediately when rescheduling')
        await page.get_by_role('button', name='儲存修改', exact=True).click()
        await expect(page.get_by_label('查看月份', exact=True)).to_have_value('2028-02')
        await expect(day_heading(page, '2028-02-09')).to_be_focused()
        changed = [row for row in (await page.evaluate('window.__calendarQA.snapshot()'))['records'] if row['id'] == created[0]['id']]
        assert len(changed) == 1 and changed[0]['date'] == '2028-02-09', 'Edit must preserve identity and show the new date'
        report['checks'].append('Rescheduling an event across months preserves its identity and reveals the new day after save')

        await choose_date(page, '2028-01-31')
        await page.get_by_role('button', name='2028-01-31', exact=True).focus()
        await page.keyboard.press('PageDown')
        await expect(page.get_by_label('查看月份', exact=True)).to_have_value('2028-02')
        await expect(page.get_by_role('button', name='2028-02-29', exact=True)).to_be_focused()
        await expect(page.get_by_role('button', name='2028-02-29', exact=True)).to_have_attribute('aria-pressed', 'false')
        await page.keyboard.press('Enter')
        await expect(page.get_by_role('button', name='2028-02-29', exact=True)).to_have_attribute('aria-pressed', 'true')
        await page.keyboard.press('ArrowRight')
        await expect(page.get_by_label('查看月份', exact=True)).to_have_value('2028-03')
        await expect(page.get_by_role('button', name='2028-03-01', exact=True)).to_be_focused()
        await page.keyboard.press('Home')
        await expect(page.get_by_label('查看月份', exact=True)).to_have_value('2028-02')
        await expect(page.get_by_role('button', name='2028-02-27', exact=True)).to_be_focused()
        report['checks'].append('Date keyboard navigation crosses leap-month boundaries, clamps short months and separates focus from selection')

        if config.get('motion') == 'reduce':
            calendar = page.get_by_role('region', name='每月行程', exact=True)
            animation = await calendar.evaluate('''node => [...node.querySelectorAll('*'), node]
              .map(el => ({name: getComputedStyle(el).animationName, duration: getComputedStyle(el).animationDuration}))
              .filter(row => row.name !== 'none' && row.duration !== '0s')''')
            assert animation == [], f'Reduced-motion calendar contains animations: {animation}'
            report['checks'].append('Reduced-motion preference removes decorative calendar animation')

        await choose_date(page, '2028-01-18')
        await page.get_by_role('button', name='切換合成校園', exact=True).click()
        await choose_date(page, '2028-01-18')
        await expect(page.get_by_role('heading', name='中興校園行程', exact=True)).to_be_visible()
        await expect(page.get_by_role('heading', name='小組討論與專題進度整理', exact=True)).to_have_count(0)
        await expect(page.get_by_role('heading', name='實作報告繳交', exact=True)).to_have_count(0)
        await page.get_by_role('button', name='切換合成校園', exact=True).click()
        await choose_date(page, '2028-01-18')
        await expect(page.get_by_role('heading', name='小組討論與專題進度整理', exact=True)).to_be_visible()
        await page.get_by_role('button', name='切換合成帳號', exact=True).click()
        await choose_date(page, '2028-01-18')
        await expect(page.get_by_role('heading', name='另一個帳號的安排', exact=True)).to_be_visible()
        await expect(page.get_by_role('heading', name='小組討論與專題進度整理', exact=True)).to_have_count(0)
        report['checks'].append('School and account changes isolate records and course deadlines, while returning restores only the matching ledger')
        await capture('account-isolation')

        report['ledger'] = await page.evaluate('window.__calendarQA.snapshot()')
        assert report['ledger']['requests'] == [], 'Unexpected network boundary call'
        assert report['blockedRequests'] == [], 'Unexpected external request'
        assert report['pageErrors'] == [], f'Browser page errors: {report["pageErrors"]}'
        assert report['consoleErrors'] == [], f'Browser console errors: {report["consoleErrors"]}'
        report['success'] = True
    except Exception as error:
        report['success'] = False
        report['error'] = str(error)
        try:
            await page.screenshot(path=str(OUTPUT / f'{config["name"]}-failure.png'), full_page=True)
            report['ledger'] = await page.evaluate('window.__calendarQA?.snapshot()')
        except Exception:
            pass
        raise
    finally:
        (OUTPUT / f'{config["name"]}-results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
        await context.close()
    return report


async def main():
    provenance = verify_source_hashes()
    server = http.server.ThreadingHTTPServer(
        ('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(OUTPUT)))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    reports = []
    try:
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch()
            try:
                for config in SCENARIOS:
                    reports.append(await run_scenario(browser, f'http://127.0.0.1:{server.server_port}', config))
            finally:
                await browser.close()
    finally:
        server.shutdown()
        summary = {
            **provenance,
            'synthetic': True,
            'scenariosCompleted': len(reports),
            'expectedScenarios': len(SCENARIOS),
            'checksPassed': sum(len(report['checks']) for report in reports),
            'screenshots': sum(len(report['screenshots']) for report in reports),
            'results': [{key: report[key] for key in ('scenario', 'checks', 'success')} for report in reports],
        }
        (OUTPUT / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2))
        print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    asyncio.run(main())
