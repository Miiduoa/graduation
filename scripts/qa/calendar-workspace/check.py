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
        await page.get_by_role('button', name='月格', exact=True).click()
        await expect(page.get_by_role('button', name='2028-01-18', exact=True)).to_have_attribute('aria-pressed', 'true')
        report['checks'].append('Switching month/list preserves the chosen day and its personal events plus course deadlines')
        await capture('day')

        await page.get_by_role('button', name='新增行程', exact=True).click()
        await expect(page.get_by_label('標題', exact=True)).to_be_focused()
        await expect(page.get_by_label('日期', exact=True)).to_have_value('2028-01-18')
        await page.get_by_label('標題', exact=True).fill('驗收新增行程')
        await page.get_by_label('地點（選填）', exact=True).fill('校園討論室')
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
