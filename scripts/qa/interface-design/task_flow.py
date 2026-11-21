"""Exercise actual task components with synthetic data and deferred SDK writes."""
import asyncio
import base64
import functools
import http.server
import json
import os
import threading
from pathlib import Path
from urllib.parse import urlencode

from playwright.async_api import async_playwright, expect

OUTPUT = Path(__file__).resolve().parents[3] / 'artifacts' / 'interface-design'
SCENARIOS = [
    {'name': 'desktop-light', 'width': 1440, 'height': 1000, 'theme': 'light'},
    {'name': 'mobile-dark', 'width': 390, 'height': 844, 'theme': 'dark'},
    {'name': 'compact-large-reduced', 'width': 320, 'height': 740,
     'theme': 'dark', 'text': '200', 'motion': 'reduce'},
]
ONE_PIXEL_PNG = base64.b64decode(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGOwqUj4DwAEHAIUKh8FtgAAAABJRU5ErkJggg==')


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


async def assert_layout(page, report, label, dialog=None):
    metrics = await page.evaluate('''() => ({
      width: innerWidth,
      documentWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      textSize: getComputedStyle(document.documentElement).fontSize
    })''')
    assert metrics['scrollWidth'] <= metrics['documentWidth'] + 1, (label, metrics)
    if dialog is not None:
        metrics['dialog'] = await dialog.evaluate('''node => {
          const rect = node.getBoundingClientRect();
          return {modal: node.matches(':modal'), left:rect.left, top:rect.top,
            right:rect.right, bottom:rect.bottom, viewportHeight:innerHeight,
            scrollWidth:node.scrollWidth, clientWidth:node.clientWidth,
            animation:getComputedStyle(node).animationName};
        }''')
        item = metrics['dialog']
        assert item['modal'], (label, item)
        assert item['left'] >= -1 and item['right'] <= metrics['width'] + 1, (label, item)
        assert item['top'] >= -1 and item['bottom'] <= item['viewportHeight'] + 1, (label, item)
        assert item['scrollWidth'] <= item['clientWidth'] + 1, (label, item)
    report.setdefault('layout', []).append({'stage': label, **metrics})


async def assert_native_focus(page, dialog, report, label):
    traces = []
    for key in ('Tab', 'Shift+Tab'):
        for step in range(16):
            await page.keyboard.press(key)
            state = await dialog.evaluate('''node => ({
              nativeModal: node.matches(':modal'), documentFocused: document.hasFocus(),
              activeTag: document.activeElement?.tagName,
              inside: node.contains(document.activeElement),
              name: document.activeElement?.getAttribute('aria-label') ||
                document.activeElement?.getAttribute('name') ||
                document.activeElement?.textContent?.trim().slice(0, 60)
            })''')
            traces.append({'key': key, 'step': step, **state})
            # Native modal traversal may visit browser chrome at a document
            # boundary, but may never focus a background page control.
            assert state['nativeModal'], (label, state)
            assert state['inside'] or (
                not state['documentFocused'] and state['activeTag'] == 'BODY'
            ), (label, state)
    report.setdefault('focusTraces', []).append({'stage': label, 'steps': traces})


async def teacher_and_offline(page, context, report, capture):
    timetable = page.get_by_role('region', name='今日課表', exact=True)
    courses = page.get_by_role('region', name='授課課程', exact=True)
    await expect(timetable.get_by_text('正在確認今天的課表…', exact=True)).to_be_visible()
    await expect(timetable.get_by_text('今天沒有排課。', exact=False)).to_have_count(0)
    await capture('teacher-loading')
    for status, expected_text in (
        ('error', '暫時讀不到課表'),
        ('empty', '還沒有課表'),
        ('unsigned-scope', '先選擇校園'),
    ):
        await page.evaluate('(value) => window.__taskFlowQA.setTimetableStatus(value)', status)
        await expect(timetable.get_by_text(expected_text, exact=False)).to_be_visible()
        await expect(timetable.get_by_text('今天沒有排課。', exact=False)).to_have_count(0)
        if status == 'error':
            await timetable.get_by_role('button', name='重新讀取課表', exact=True).click()
            await page.wait_for_function('window.__taskFlowQA.snapshot().timetableRetries === 1')
        await assert_layout(page, report, 'teacher-' + status)
        await capture('teacher-' + status)
    await page.evaluate("window.__taskFlowQA.setTimetableStatus('ready')")
    await expect(timetable.get_by_role('link', name='找教室：任垣樓 101')).to_be_visible()
    href = await timetable.get_by_role('link', name='找教室：任垣樓 101').get_attribute('href')
    assert 'schoolId=pu' in href, href
    await expect(courses.get_by_role('link', name='資訊系統設計與實作', exact=False)).to_be_visible()
    await expect(page.get_by_text('目前沒有即將到期的學生作業。', exact=True)).to_have_count(0)
    await page.evaluate("window.__taskFlowQA.setCourseState('error')")
    await expect(courses.get_by_role('alert')).to_contain_text('部分課程資料尚未讀到')
    await courses.get_by_role('button', name='重新讀取授課課程', exact=True).click()
    await page.wait_for_function('window.__taskFlowQA.snapshot().courseRetries === 1')
    await expect(courses.get_by_role('link', name='資訊系統設計與實作', exact=False)).to_be_visible()
    await capture('teacher-partial-failure')
    await page.evaluate("window.__taskFlowQA.setCourseState('empty')")
    await expect(courses.get_by_text('目前沒有已確認的授課課程', exact=False)).to_be_visible()
    await expect(courses.get_by_text('目前沒有待批改項目', exact=False)).to_have_count(0)
    await page.evaluate("window.__taskFlowQA.setCourseState('ready')")
    await context.set_offline(True)
    await expect(page.get_by_role('status').filter(has_text='目前沒有網路連線')).to_be_visible()
    await expect(courses.get_by_role('link', name='資訊系統設計與實作', exact=False)).to_be_visible()
    await assert_layout(page, report, 'offline-home')
    await capture('offline-home')
    await context.set_offline(False)
    await expect(page.get_by_role('status').filter(has_text='目前沒有網路連線')).to_have_count(0)
    report['checks'].append('Actual AppFrame reports offline without replacing the task; teacher loading, failure, absent timetable and unselected school never claim no classes; independent retries and available teaching links remain usable')


async def attachments(page, config, report, capture):
    picker = page.get_by_role('region', name='附件選擇驗收')
    documents = [
        {'name': ('課程報告' * 12 if index == 0 else f'課程文件{index + 1}') + '.pdf',
         'mimeType': 'application/pdf', 'buffer': b'%PDF-1.4 synthetic fixture'}
        for index in range(3)
    ]
    async with page.expect_file_chooser() as chooser_info:
        await picker.get_by_role('button', name='檔案', exact=True).click()
    await (await chooser_info.value).set_files(documents)
    await expect(picker.get_by_role('status')).to_contain_text('已加入 2 個檔案。')
    await expect(picker.get_by_role('list', name='未加入的檔案')).to_contain_text('文件最多 2 個')
    await expect(picker.get_by_role('list', name='即將繳交的檔案').locator(':scope > li')).to_have_count(2)
    async with page.expect_file_chooser() as chooser_info:
        await picker.get_by_role('button', name='相簿', exact=True).click()
    await (await chooser_info.value).set_files([
        {'name': f'合成照片{index + 1}.png', 'mimeType': 'image/png', 'buffer': ONE_PIXEL_PNG}
        for index in range(9)
    ])
    await expect(picker.get_by_role('status')).to_contain_text('已加入 8 個檔案。')
    await expect(picker.get_by_role('list', name='未加入的檔案')).to_contain_text('照片最多 8 張')
    await expect(picker.get_by_role('list', name='即將繳交的檔案').locator(':scope > li')).to_have_count(10)
    await assert_layout(page, report, 'attachment-limits')
    await capture('attachment-limits')

    opener = page.get_by_role('button', name='放大預覽 課程筆記長圖.png', exact=True)
    await opener.click()
    dialog = page.get_by_role('dialog', name='課程筆記長圖.png', exact=True)
    await expect(dialog).to_be_visible()
    await expect(dialog.get_by_role('button', name='關閉視窗', exact=True)).to_be_focused()
    await expect(dialog.get_by_role('img', name='課程筆記長圖.png', exact=True)).to_be_visible()
    await assert_layout(page, report, 'long-image-modal', dialog)
    if config.get('motion') == 'reduce':
        await expect(dialog).to_have_css('animation-name', 'none')
    assert await dialog.evaluate('node => node.scrollHeight > node.clientHeight + 100'), 'Long preview did not exercise dialog scrolling'
    await capture('long-image-start', full_page=False)
    await page.keyboard.press('Tab')
    await expect(dialog.get_by_role('button', name='關閉預覽', exact=True)).to_be_focused()
    await expect(dialog.get_by_role('button', name='關閉預覽', exact=True)).to_be_in_viewport(ratio=1)
    await capture('long-image-footer', full_page=False)
    await assert_native_focus(page, dialog, report, 'long-image')
    await page.keyboard.press('Escape')
    await expect(dialog).to_have_count(0)
    await expect(opener).to_be_focused()
    report['checks'].append('Real file pickers accept the allowed files and announce each quota rejection; long image uses a native modal, fits the viewport, scrolls to its close action, contains keyboard traversal and restores its opener on Escape')


async def assert_pending(page, dialog, kind, fields, report, capture):
    await page.wait_for_function(
        '(kind) => window.__taskFlowQA.snapshot().writes.some(row => row.kind === kind && row.status === "pending")', arg=kind)
    for field in fields:
        await expect(field).to_be_disabled()
    await expect(dialog.get_by_role('button', name='取消', exact=True)).to_be_disabled()
    await expect(dialog.get_by_role('button', name='關閉視窗', exact=True)).to_have_count(0)
    await page.keyboard.press('Escape')
    await expect(dialog).to_be_visible()
    await page.mouse.click(1, 1)
    await expect(dialog).to_be_visible()
    assert await dialog.evaluate('node => node.matches(":modal")')
    await assert_layout(page, report, kind + '-pending', dialog)
    await capture(kind + '-pending', full_page=False)
    snapshot = await page.evaluate('window.__taskFlowQA.snapshot()')
    assert len([row for row in snapshot['writes'] if row['kind'] == kind]) == 1, snapshot


async def review_form(page, config, report, capture):
    opener = page.get_by_role('region', name='社群表單驗收').get_by_role('button', name='寫課程評價', exact=True)
    await opener.click()
    dialog = page.get_by_role('dialog', name='寫課程評價', exact=True)
    course = dialog.get_by_role('textbox', name='課程名稱', exact=False)
    await expect(course).to_be_focused()
    submit = dialog.get_by_role('button', name='送出評價', exact=True)
    await submit.click()
    await expect(course).to_be_focused()
    await expect(course).to_have_attribute('aria-invalid', 'true')
    await course.fill('資訊系統設計與實作')
    await submit.click()
    rating = dialog.get_by_role('radiogroup', name='整體評分（必填）', exact=True)
    await expect(rating.get_by_role('radio', name='1 顆星', exact=True)).to_be_focused()
    await page.keyboard.press('Space')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await expect(rating.get_by_role('radio', name='3 顆星', exact=True)).to_be_checked()
    await page.keyboard.press('ArrowLeft')
    await expect(rating.get_by_role('radio', name='2 顆星', exact=True)).to_be_checked()
    comment = dialog.get_by_role('textbox', name='評論（選填）', exact=True)
    await comment.fill('合成驗收：送出失敗後仍要保留這段評論。')
    await assert_layout(page, report, 'review-form', dialog)
    if config.get('motion') == 'reduce':
        await expect(dialog).to_have_css('animation-name', 'none')
    await assert_native_focus(page, dialog, report, 'review')
    await capture('review-form', full_page=False)
    await submit.click()
    await assert_pending(page, dialog, 'review', [course, comment, rating.get_by_role('radio', name='2 顆星', exact=True)], report, capture)
    await page.evaluate("window.__taskFlowQA.settle('review', false)")
    await expect(dialog.get_by_role('alert').filter(has_text='內容已保留')).to_be_visible()
    await expect(course).to_have_value('資訊系統設計與實作')
    await expect(comment).to_have_value('合成驗收：送出失敗後仍要保留這段評論。')
    await expect(rating.get_by_role('radio', name='2 顆星', exact=True)).to_be_checked()
    await capture('review-retained', full_page=False)
    await dialog.get_by_role('button', name='送出評價', exact=True).click()
    await page.wait_for_function('window.__taskFlowQA.snapshot().writes.filter(row => row.kind === "review").length === 2')
    await page.evaluate("window.__taskFlowQA.settle('review', true)")
    await expect(dialog).to_have_count(0)
    await expect(opener).to_be_focused()
    writes = (await page.evaluate('window.__taskFlowQA.snapshot()'))['writes']
    reviews = [row for row in writes if row['kind'] == 'review']
    assert [row['status'] for row in reviews] == ['failed', 'succeeded'], reviews
    assert reviews[0]['data'] == reviews[1]['data'], reviews
    assert reviews[1]['data']['rating'] == 2, reviews
    await opener.click()
    await page.keyboard.press('Escape')
    await expect(dialog).to_have_count(0)
    await expect(opener).to_be_focused()
    report['checks'].append('Actual review form validates and focuses required inputs, native radio arrows select the rating, pending writes block dismissal and editing, failure retains the complete draft, and one explicit retry submits the same payload')


async def group_form(page, config, report, capture):
    opener = page.get_by_role('region', name='社群表單驗收').get_by_role('button', name='建立讀書會', exact=True)
    await opener.click()
    dialog = page.get_by_role('dialog', name='建立讀書會', exact=True)
    name = dialog.get_by_role('textbox', name='讀書會名稱', exact=False)
    course = dialog.get_by_role('textbox', name='課程名稱', exact=False)
    start = dialog.get_by_role('combobox', name='開始時間', exact=True)
    end = dialog.get_by_role('combobox', name='結束時間', exact=True)
    await expect(name).to_be_focused()
    await name.fill('週末課程複習')
    await course.fill('資訊系統設計與實作')
    await start.select_option('18')
    await end.select_option('17')
    await dialog.get_by_role('button', name='建立讀書會', exact=True).click()
    await expect(end).to_be_focused()
    await expect(end).to_have_attribute('aria-invalid', 'true')
    await expect(dialog.get_by_role('alert')).to_contain_text('結束時間要晚於開始時間')
    await end.select_option('19')
    await dialog.get_by_role('combobox', name='每週見面日', exact=True).select_option('6')
    await dialog.get_by_role('combobox', name='讀書方式', exact=True).select_option('discussion')
    await assert_layout(page, report, 'group-form', dialog)
    if config.get('motion') == 'reduce':
        await expect(dialog).to_have_css('animation-name', 'none')
    await assert_native_focus(page, dialog, report, 'study-group')
    await capture('group-form', full_page=False)
    await dialog.get_by_role('button', name='建立讀書會', exact=True).click()
    await assert_pending(page, dialog, 'group', [name, course, start, end], report, capture)
    await page.evaluate("window.__taskFlowQA.settle('group', false)")
    await expect(dialog.get_by_role('alert').filter(has_text='內容已保留')).to_be_visible()
    await expect(name).to_have_value('週末課程複習')
    await expect(course).to_have_value('資訊系統設計與實作')
    await expect(start).to_have_value('18')
    await expect(end).to_have_value('19')
    await capture('group-retained', full_page=False)
    await dialog.get_by_role('button', name='建立讀書會', exact=True).click()
    await page.wait_for_function('window.__taskFlowQA.snapshot().writes.filter(row => row.kind === "group").length === 2')
    await page.evaluate("window.__taskFlowQA.settle('group', true)")
    await expect(dialog).to_have_count(0)
    await expect(opener).to_be_focused()
    groups = [row for row in (await page.evaluate('window.__taskFlowQA.snapshot()'))['writes'] if row['kind'] == 'group']
    assert [row['status'] for row in groups] == ['failed', 'succeeded'], groups
    assert groups[0]['data'] == groups[1]['data'], groups
    assert groups[1]['data']['dayOfWeek'] == 6 and groups[1]['data']['style'] == 'discussion', groups
    await opener.click()
    await page.keyboard.press('Escape')
    await expect(dialog).to_have_count(0)
    await expect(opener).to_be_focused()
    report['checks'].append('Actual study-group form associates time labels, focuses invalid end time, keeps all draft values after failure, locks pending operations, sends the preserved payload once on retry and restores focus after closing')


async def scenario(browser, origin, config, reports):
    report = {'name': config['name'], 'config': config, 'status': 'running', 'checks': [], 'screenshots': []}
    reports.append(report)
    context = await browser.new_context(
        viewport={'width': config['width'], 'height': config['height']},
        color_scheme=config['theme'], reduced_motion='reduce' if config.get('motion') else 'no-preference',
    )
    page = await context.new_page()
    errors, external = [], []
    page.on('pageerror', lambda error: errors.append(str(error)))

    async def local_only(route):
        url = route.request.url
        if not (url.startswith(origin + '/') or url.startswith(('data:', 'blob:'))):
            external.append(url)
            await route.abort()
        else:
            await route.continue_()

    await context.route('**/*', local_only)

    async def capture(name, full_page=True):
        filename = f"task-flow-{config['name']}-{name}.png"
        # Preserve the real opening animation; record its settled frame rather
        # than a translucent intermediate frame. Infinite child spinners are
        # intentionally outside this capture-only wait.
        await page.evaluate('''async () => {
          const animations = [...document.querySelectorAll('dialog:modal')]
            .flatMap(dialog => dialog.getAnimations())
            .filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime));
          await Promise.allSettled(animations.map(animation => animation.finished));
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        }''')
        await page.screenshot(path=str(OUTPUT / filename), full_page=full_page)
        report['screenshots'].append(filename)

    try:
        await page.goto(origin + '/task-flow.html?' + urlencode(config))
        await page.wait_for_function('Boolean(window.__taskFlowQA)')
        await expect(page.get_by_role('heading', name='今天', exact=True)).to_be_visible()
        await assert_layout(page, report, 'initial')
        await teacher_and_offline(page, context, report, capture)
        await attachments(page, config, report, capture)
        await review_form(page, config, report, capture)
        await group_form(page, config, report, capture)
        await assert_layout(page, report, 'completed')
        report['ledger'] = await page.evaluate('window.__interfaceQA.snapshot()')
        report['taskFlow'] = await page.evaluate('window.__taskFlowQA.snapshot()')
        assert not report['ledger']['requests'] and not report['ledger']['logouts'], report['ledger']
        assert not errors and not external, {'errors': errors, 'external': external}
        assert all(row['status'] != 'pending' for row in report['taskFlow']['writes']), report['taskFlow']
        report['checks'].append('No application HTTP calls, production writes, external requests, unresolved synthetic writes or browser errors')
        report['status'] = 'passed'
    except Exception as failure:
        report.update({'status': 'failed', 'error': repr(failure)})
        print(json.dumps({'scenario': config['name'], 'status': 'failed', 'error': repr(failure)}, ensure_ascii=False), flush=True)
        try:
            await capture('failure', full_page=False)
            (OUTPUT / f"task-flow-{config['name']}-failure.html").write_text(await page.content(), encoding='utf-8')
            report['taskFlow'] = await page.evaluate('window.__taskFlowQA?.snapshot()')
        except Exception as capture_error:
            report['captureError'] = repr(capture_error)
    finally:
        report.update({'pageErrors': errors, 'externalRequests': external})
        await context.close()


async def main():
    source = json.loads((OUTPUT / 'source-sha256.json').read_text())
    required = {
        'apps/web/src/components/AppFrame.tsx',
        'apps/web/src/components/today/TeacherToday.tsx',
        'apps/web/src/features/nuni/AssignmentFileFields.tsx',
        'apps/web/src/app/community/_components/StudyBuddyTab.tsx',
        'apps/web/src/lib/community/firestore.ts',
        'apps/web/src/components/ui/Modal.tsx',
        'apps/web/src/components/ui/modalSession.ts',
    }
    assert required.issubset({item['path'] for item in source['files']}), 'A product component was not included in the hashed bundle'
    reports = []
    server = None
    infrastructure_error = None
    try:
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(OUTPUT)))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(executable_path=os.environ.get('CHROME_PATH'))
            try:
                for config in SCENARIOS:
                    await scenario(browser, f'http://127.0.0.1:{server.server_port}', config, reports)
            finally:
                await browser.close()
        assert len(reports) == len(SCENARIOS) and all(row['status'] == 'passed' for row in reports), 'Task-flow browser checks failed; inspect task-flow-checks.json and screenshots'
        print(json.dumps({'taskFlowScenarios': len(reports), 'checks': sum(len(row['checks']) for row in reports)}))
    except Exception as failure:
        if not reports:
            infrastructure_error = repr(failure)
        raise
    finally:
        if server is not None:
            server.shutdown()
        (OUTPUT / 'task-flow-checks.json').write_text(json.dumps({
            'sourceManifest': 'source-sha256.json', 'gitHead': source['gitHead'],
            'syntheticWritesOnly': True,
            'status': 'passed' if len(reports) == len(SCENARIOS) and all(row['status'] == 'passed' for row in reports) else 'failed',
            'infrastructureError': infrastructure_error,
            'scenarios': reports,
        }, ensure_ascii=False, indent=2), encoding='utf-8')


if __name__ == '__main__':
    asyncio.run(main())
