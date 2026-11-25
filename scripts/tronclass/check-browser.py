"""Check the actual built TronClass UI with synthetic, locally fulfilled APIs.

Run after `pnpm --filter web build`. This never authenticates a real account,
contacts a school or enables the production writer. See README.md for setup.
"""
import asyncio
import hashlib
import json
import os
import shutil
import socket
import subprocess
import time
import urllib.request
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from playwright.async_api import async_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
RUNTIME = ROOT / 'apps/web/.next/standalone/apps/web'
OUT = Path(os.environ.get('TRONCLASS_BROWSER_OUTPUT', ROOT / 'artifacts/tronclass-browser')).resolve()
OUT.mkdir(parents=True, exist_ok=True)
NODE = os.environ.get('TRONCLASS_BROWSER_NODE') or shutil.which('node')
REVISION = 'a' * 32
STAMP = '2026-11-18T06:30:00.000Z'
CONNECTION = dict(schoolId='pu', connected=True, revision=REVISION, account='visual-only',
                  userName='合成驗收同學', expiresAt='2026-11-18T18:30:00.000Z', studentKey='d' * 64)
EMPTY = dict(schoolId='pu', connected=False, revision=None, account=None, userName=None, expiresAt=None)
COURSES = [dict(id=12, name='資訊管理專題：校園資料整合與服務設計', code='IM101', teachers=['合成教師'], semester='115-1',
                status='ongoing', href='https://tronclass.pu.edu.tw/course/12/content'),
           dict(id=13, name='資料庫系統', code='DB101', teachers=['合成教師'], semester='115-1',
                status='ongoing', href='https://tronclass.pu.edu.tw/course/13/content')]
HOMEWORK = [dict(id=51, courseId=12, courseName=COURSES[0]['name'], title='期末專題報告與設計反思',
                 deadline='2026-12-15T15:59:00.000Z', deadlineLabel='12/15 截止', submitted=False,
                 description='請提交專題報告，說明資料來源、使用流程與實作反思。這是合成介面驗收資料。',
                 href='https://tronclass.pu.edu.tw/course/12/learning-activity#/51'),
            dict(id=52, courseId=13, courseName=COURSES[1]['name'], title='資料庫正規化練習',
                 deadline=None, deadlineLabel='未提供截止時間', submitted=False, description='合成作業',
                 href='https://tronclass.pu.edu.tw/course/13/learning-activity#/52')]


class Fixture:
    def __init__(self, mode, origin):
        self.mode = mode
        self.origin = origin
        self.connected = mode != 'connect'
        self.actions = []
        self.blocked_external = []
        self.unhandled = []
        self.last_operation = None
        self.first_overview = True
        self.session_reads = []

    async def handle(self, route):
        req = route.request
        url = urlparse(req.url)
        if f'{url.scheme}://{url.netloc}' != self.origin:
            self.blocked_external.append(url.hostname)
            await route.abort()
            return
        if url.path == '/api/nuni/session':
            self.session_reads.append(dict(at=time.monotonic(), method=req.method))
            await route.fulfill(json=dict(authenticated=self.mode != 'guest',
                **({} if self.mode == 'guest' else dict(platformAccountId='pa_00000000-0000-4000-8000-000000000001',
                    isPlatformOperator=False, context='b' * 43))))
        elif url.path == '/api/schools':
            await route.fulfill(json={'schools': [dict(id='pu', name='靜宜大學', status='open')]})
        elif url.path == '/api/tronclass/agent-permissions':
            await route.fulfill(json=dict(revision=REVISION, version=None, updatedAt=None,
                permissions=dict(readCourseData=False, downloadMaterials=False, prepareHomework=False)))
        elif url.path == '/api/tronclass/material-download':
            self.actions.append({'action': 'downloadMaterial'})
            data = b'%PDF-1.4\nsynthetic visual material\n%%EOF\n'
            await route.fulfill(body=data, headers={'Content-Type': 'application/pdf', 'Content-Length': str(len(data)),
                'Content-Disposition': "attachment; filename*=UTF-8''synthetic-material.pdf"})
        elif url.path == '/api/tronclass':
            if req.method == 'PUT':
                q = {k: v[0] for k, v in parse_qs(url.query).items()}
                data = req.post_data_buffer or b''
                self.actions.append(dict(action='upload', operationId=q['operationId'], fileId=q['fileId']))
                await route.fulfill(json=dict(status='uploaded', fileId=q['fileId'], name=q['name'],
                    size=len(data), contentType=req.headers['content-type'], sha256=hashlib.sha256(data).hexdigest()))
                return
            body = req.post_data_json
            action = body.get('action')
            self.actions.append({k: body[k] for k in ('action', 'courseId', 'homeworkId', 'operationId') if k in body})
            if action == 'status':
                result = CONNECTION if self.connected else EMPTY
            elif action == 'connect':
                self.connected = True
                result = CONNECTION
            elif action == 'disconnect':
                self.connected = False
                result = EMPTY
            elif action == 'courses':
                result = dict(kind='course-index', revision=REVISION, fetchedAt=STAMP,
                    courses=COURSES, errors=[], partial=False)
            elif action == 'sync':
                course = body.get('courseId')
                if self.mode == 'blocked' and course is None and self.first_overview:
                    self.first_overview = False
                    await route.fulfill(status=504, json=dict(error='TRONCLASS_SOURCE_TIMEOUT',
                        message='全部課程同步逾時，請選一門課程重試。'))
                    return
                result = dict(revision=REVISION, fetchedAt=STAMP, courses=COURSES,
                    homework=[row for row in HOMEWORK if course is None or row['courseId'] == course],
                    announcements=[] if course != 12 else [dict(id=61, courseId=12, courseName=COURSES[0]['name'],
                        title='專題進度說明', content='請在下次課堂分享實作進度。合成公告。', publishedAt=STAMP,
                        source='tronclass', href='https://tronclass.pu.edu.tw/course/12')],
                    materials=[] if course != 12 else [dict(id=71, courseId=12, courseName=COURSES[0]['name'],
                        title='專題報告範本', type='material', href='https://tronclass.pu.edu.tw/course/12/learning-activity#/71',
                        files=[dict(name='synthetic-material.pdf', allowDownload=True,
                            downloadHref='https://tronclass.pu.edu.tw/api/uploads/301/blob')])],
                    errors=[], partial=False)
            elif action == 'prepare':
                row = next(item for item in HOMEWORK if item['id'] == body['homeworkId'])
                result = dict(source='tronclass', schoolId='pu', courseId=row['courseId'], homeworkId=row['id'],
                    revision=REVISION, title=row['title'], description=row['description'], deadline=row['deadline'],
                    canSubmit=self.mode == 'flow', blockedReason=None if self.mode == 'flow' else '此學校目前尚未開放在 nuni 繳交，請使用 TronClass 作業頁。',
                    maxFiles=4, maxFileBytes=10485760, allowedContentTypes=['application/pdf', 'text/plain'],
                    rules=dict(status='confirmed', allowsText=True, allowsAttachments=True, maxTotalBytes=20971520), receipt=None)
            elif action == 'submit':
                self.last_operation = body['operationId']
                result = dict(status='unknown', operationId=self.last_operation, receipt=None)
            elif action == 'reconcile':
                assert body['operationId'] == self.last_operation, 'must reconcile the original operation'
                result = dict(status='confirmed', operationId=self.last_operation, receipt=None,
                    confirmation=dict(kind='acknowledged-readback', source='tronclass', schoolId='pu',
                        operationId=self.last_operation, submissionId=901, courseId=12, homeworkId=51,
                        confirmedAt=STAMP, sourceRecordedAt=None))
            else:
                self.unhandled.append(url.path + ':' + str(action))
                await route.fulfill(status=501, json={'error': 'UNHANDLED_SYNTHETIC_REQUEST'})
                return
            await route.fulfill(json=result)
        elif url.path.startswith('/api/') or url.path.startswith('/auth/'):
            # Ancillary site chrome is isolated from real services as well.
            await route.fulfill(status=503, json={'error': 'VISUAL_FIXTURE_NOT_CONFIGURED'})
        else:
            await route.continue_()


async def capture(page, name, report, theme):
    await page.evaluate('document.fonts.ready')
    metrics = await page.evaluate('''() => ({
        width:innerWidth, scrollWidth:document.documentElement.scrollWidth,
        theme:document.documentElement.getAttribute('data-theme'),
        horizontalOverflow:document.documentElement.scrollWidth > innerWidth + 1,
        overflowingElements:[...document.querySelectorAll('main input,main textarea,main button,main select,main article')]
          .filter(e=>{const b=e.getBoundingClientRect(); return b.width>0 && (b.left < -1 || b.right > innerWidth+1)})
          .map(e=>e.tagName+':'+(e.getAttribute('aria-label')||e.textContent||'').slice(0,80))
    })''')
    await page.screenshot(path=str(OUT / f'{name}.png'), full_page=True)
    report['captures'].append(dict(name=name, **metrics))
    assert metrics['theme'] == theme, f'{name}: theme was not applied'
    assert not metrics['horizontalOverflow'], f'{name}: horizontal overflow {metrics}'
    assert not metrics['overflowingElements'], f'{name}: clipped controls {metrics}'


async def expect_recovered_draft(page, prefix, report):
    try:
        await expect(page.get_by_label('作業內容', exact=True)).to_have_value(
            '合成介面驗收：校園課程整合與個人學習反思。')
    except Exception as error:
        # These pages and API responses are entirely synthetic. Preserve the
        # failing state before Playwright closes the context, so a remount is
        # distinguishable from a slow or rejected assignment read.
        failure = dict(scenario=prefix, originalError=str(error), captureErrors=[])
        report['failedDraftRecovery'] = failure
        try:
            failure['url'] = page.url
        except Exception as capture_error:
            failure['captureErrors'].append('url: ' + str(capture_error))
        for key, read in [
            ('visibleText', lambda: page.locator('body').inner_text()),
            ('lifecycle', lambda: page.evaluate('window.__tronclassFixtureLifecycle || []')),
            ('domFile', page.content),
        ]:
            try:
                value = await asyncio.wait_for(read(), timeout=3)
                if key == 'domFile':
                    name = f'{prefix}-failed-draft.html'
                    (OUT / name).write_text(value, encoding='utf-8')
                    failure[key] = name
                else:
                    failure[key] = value
            except Exception as capture_error:
                failure['captureErrors'].append(key + ': ' + str(capture_error))
        try:
            name = f'{prefix}-failed-draft.png'
            await page.screenshot(path=str(OUT / name), full_page=True, timeout=3000)
            failure['screenshot'] = name
        except Exception as capture_error:
            failure['captureErrors'].append('screenshot: ' + str(capture_error))
        raise


async def run_browser(origin):
    report = dict(sourceHead=subprocess.check_output(['git','rev-parse','HEAD'], cwd=ROOT, text=True).strip(),
        sourceTree=subprocess.check_output(['git','rev-parse','HEAD^{tree}'], cwd=ROOT, text=True).strip(),
        sourceParents=subprocess.check_output(['git','show','-s','--format=%P','HEAD'], cwd=ROOT, text=True).strip().split(),
        prHead=os.environ.get('TRONCLASS_PR_HEAD_SHA'),
        buildId=(ROOT/'apps/web/.next/BUILD_ID').read_text().strip(), kind='actual Next standalone; synthetic intercepted API responses',
        realSchoolRequests=False, captures=[], scenarios=[], pageErrors=[], consoleErrors=[], passed=False)
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(**({'executable_path': os.environ['TRONCLASS_BROWSER_CHROMIUM']}
                if os.environ.get('TRONCLASS_BROWSER_CHROMIUM') else {}))
            report['browserVersion'] = browser.version
            for width, theme in [(1440, 'light'), (1440, 'dark'), (390, 'light'), (390, 'dark')]:
                for mode in ['guest', 'connect', 'blocked', 'flow']:
                    context = await browser.new_context(viewport=dict(width=width, height=1000 if width>500 else 844),
                        color_scheme=theme, reduced_motion='reduce', service_workers='block', locale='zh-TW', timezone_id='Asia/Taipei')
                    await context.add_init_script('localStorage.setItem("campus-web-preferences", JSON.stringify({appearance:{theme:'+json.dumps(theme)+',animations:false}}));')
                    await context.add_init_script('''(() => {
                        const events = [];
                        window.__tronclassFixtureLifecycle = events;
                        const record = event => events.push({type:event.type,
                            at:performance.now(), visibility:document.visibilityState,
                            persisted:event.persisted === true});
                        window.addEventListener('pageshow', record);
                        window.addEventListener('pagehide', record);
                        document.addEventListener('visibilitychange', record);
                    })();''')
                    fixture = Fixture(mode, origin)
                    await context.route('**/*', fixture.handle)
                    page = await context.new_page()
                    page.on('pageerror', lambda error: report['pageErrors'].append(str(error)))
                    page.on('console', lambda message: report['consoleErrors'].append(message.text)
                        if message.type == 'error' else None)
                    await page.goto(origin+'/tronclass', wait_until='networkidle')
                    prefix = f'{width}-{theme}-{mode}'
                    report['activeScenario'] = dict(name=prefix, actions=fixture.actions,
                        sessionReads=fixture.session_reads, unhandled=fixture.unhandled)
                    if mode == 'guest':
                        await expect(page.get_by_role('heading', name='連接你的學校課程')).to_be_visible()
                        await capture(page, prefix, report, theme)
                    else:
                        if mode == 'connect':
                            await expect(page.get_by_label('學校密碼')).to_be_visible()
                            await capture(page, prefix+'-form', report, theme)
                            await page.get_by_label('學校帳號').fill('synthetic-visual-user')
                            await page.get_by_label('學校密碼').fill('synthetic-not-a-real-password')
                            await page.get_by_role('button', name='連接 TronClass', exact=True).click()
                        await expect(page.get_by_role('heading', name='我的課程', exact=True)).to_be_visible()
                        await expect(page.locator('#tronclass-course')).to_be_visible()
                        await capture(page, prefix+'-workspace', report, theme)
                        await page.locator('#tronclass-course').select_option('12')
                        await expect(page.get_by_role('heading', name='資料庫正規化練習')).to_have_count(0)
                        await page.get_by_role('button', name='公告', exact=True).click()
                        await expect(page.get_by_role('heading', name='專題進度說明')).to_be_visible()
                        await page.get_by_role('button', name='教材', exact=True).click()
                        await expect(page.get_by_role('heading', name='專題報告範本')).to_be_visible()
                        await capture(page, prefix+'-materials', report, theme)
                        async with page.expect_download() as pending_download:
                            await page.get_by_role('button', name='下載 synthetic-material.pdf', exact=True).click()
                        download = await pending_download.value
                        assert download.suggested_filename == 'synthetic-material.pdf'
                        assert await download.failure() is None
                        await page.get_by_role('button', name='作業', exact=True).click()
                        await page.locator('#tronclass-homework-12-51').click()
                        await expect(page.get_by_label('作業內容', exact=True)).to_be_visible()
                        await page.get_by_label('作業內容', exact=True).fill('合成介面驗收：校園課程整合與個人學習反思。')
                        await page.get_by_label('作業附件', exact=True).set_input_files(dict(name='synthetic-report.txt', mimeType='text/plain', buffer=b'synthetic visual verification only'))
                        await page.get_by_role('button', name='返回作業清單', exact=True).click()
                        await expect(page.get_by_role('heading', name='本頁保留的作業草稿')).to_be_visible()
                        await page.get_by_role('button', name='繼續編輯保留的草稿', exact=True).click()
                        await expect_recovered_draft(page, prefix, report)
                        await expect(page.get_by_text('synthetic-report.txt', exact=True)).to_be_visible()
                        await capture(page, prefix+'-editing', report, theme)
                        await page.get_by_role('button', name='預覽繳交內容', exact=True).click()
                        await expect(page.get_by_role('heading', name='確認繳交內容', exact=True)).to_be_visible()
                        await capture(page, prefix+'-preview', report, theme)
                        if mode != 'flow':
                            await page.get_by_label('我已確認課程、作業內容與附件正確').check()
                            assert not any(item['action'] in ('upload', 'submit') for item in fixture.actions)
                            await expect(page.get_by_role('button', name='確認送出到 TronClass', exact=True)).to_be_disabled()
                        else:
                            await page.get_by_label('我已確認課程、作業內容與附件正確').check()
                            await page.get_by_role('button', name='確認送出到 TronClass', exact=True).click()
                            await expect(page.get_by_role('heading', name='繳交結果待確認', exact=True)).to_be_visible()
                            await capture(page, prefix+'-unknown', report, theme)
                            retained = await page.evaluate('Object.entries(sessionStorage).filter(([key])=>key.startsWith("nuni.tronclass.pending:"))')
                            assert len(retained) == 1 and retained[0][1] == fixture.last_operation
                            assert [item['action'] for item in fixture.actions].count('submit') == 1
                            await page.get_by_role('button', name='查證繳交結果', exact=True).click()
                            await expect(page.get_by_role('heading', name='已確認校方版本', exact=True)).to_be_visible()
                            await capture(page, prefix+'-confirmed', report, theme)
                            assert [item['action'] for item in fixture.actions].count('submit') == 1
                            assert not await page.evaluate('Object.keys(sessionStorage).some(key=>key.startsWith("nuni.tronclass.pending:"))')
                    assert not fixture.unhandled, fixture.unhandled
                    report['scenarios'].append(dict(name=prefix, actions=fixture.actions,
                        sessionReads=fixture.session_reads,
                        externalRequestAttemptsBlocked=sorted(set(fixture.blocked_external)), passed=True))
                    await context.close()
                    report.pop('activeScenario', None)
            await browser.close()
        assert not report['pageErrors'], report['pageErrors']
        report['passed'] = True
        return report
    except Exception as error:
        report['failure'] = str(error)
        raise
    finally:
        (OUT/'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')


def main():
    if not NODE or not (RUNTIME/'server.js').is_file():
        raise RuntimeError('Build the Web standalone artifact before running this check')
    # Match the deployment recipe: standalone omits public and static assets.
    shutil.copytree(ROOT/'apps/web/public', RUNTIME/'public', dirs_exist_ok=True)
    shutil.copytree(ROOT/'apps/web/.next/static', RUNTIME/'.next/static', dirs_exist_ok=True)
    with socket.socket() as sock:
        sock.bind(('127.0.0.1',0))
        port = sock.getsockname()[1]
    origin = f'http://127.0.0.1:{port}'
    env = {'PATH':os.environ['PATH'], 'NODE_ENV':'production', 'PORT':str(port), 'HOSTNAME':'127.0.0.1',
           'NEXT_TELEMETRY_DISABLED':'1'}
    with (OUT/'runtime.log').open('w') as log:
        server = subprocess.Popen([NODE,'server.js'],cwd=RUNTIME,env=env,stdout=log,stderr=subprocess.STDOUT)
        try:
            deadline = time.monotonic()+30
            while time.monotonic()<deadline:
                try:
                    with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(origin+'/health/live',timeout=2) as response:
                        if response.status==200: break
                except Exception: time.sleep(.2)
            else: raise RuntimeError('Standalone did not become ready')
            report = asyncio.run(run_browser(origin))
            print(json.dumps(dict(passed=report['passed'], scenarios=len(report['scenarios']),
                captures=len(report['captures']), pageErrors=report['pageErrors'], report=str(OUT/'report.json'))))
        finally:
            server.terminate()
            try: server.wait(timeout=8)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait()


if __name__=='__main__': main()
