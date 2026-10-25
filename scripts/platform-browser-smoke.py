"""Exercise platform pages against a local production Web build.

Run from the repository root with the Playwright installation used by
campus-visual-smoke.py. PLATFORM_BROWSER_URL (or CAMPUS_VISUAL_URL) selects the
local server; PLATFORM_BROWSER_CHROMIUM (or CAMPUS_VISUAL_CHROMIUM) optionally
selects a Chromium executable. Screenshots and results go to artifacts/platform-browser.

All principals and writes are synthetic browser fixtures. Nonlocal requests are
aborted and unlisted private routes fail. DTOs follow Miiduoa/nuni-prod@9de47b4b;
the browser transport is Campus One /api/nuni and /api/platform-admin.
"""
import asyncio
import importlib.util
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlparse

from playwright.async_api import async_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
BASE = os.environ.get('PLATFORM_BROWSER_URL', os.environ.get('CAMPUS_VISUAL_URL', 'http://127.0.0.1:3100'))
if urlparse(BASE).hostname not in ('127.0.0.1', 'localhost'):
    raise RuntimeError('Platform checks must run against a local server')
os.environ['CAMPUS_VISUAL_URL'] = BASE
spec = importlib.util.spec_from_file_location('campus_visual', ROOT / 'scripts/campus-visual-smoke.py')
visual = importlib.util.module_from_spec(spec)
spec.loader.exec_module(visual)
OUT = ROOT / 'artifacts/platform-browser'
OUT.mkdir(parents=True, exist_ok=True)
CW = 'cw_11111111-1111-4111-8111-111111111111'
PA = 'pa_00000000-0000-4000-8000-000000000001'
PB = 'pa_00000000-0000-4000-8000-000000000002'
CWS = 'cws_22222222-2222-4222-8222-222222222222'
SOA = 'soa_33333333-3333-4333-8333-333333333333'
CWAA = 'cwaa_44444444-4444-4444-8444-444444444444'
MPI = 'mpi_55555555-5555-4555-8555-555555555555'
FMA = 'fma_66666666-6666-4666-8666-666666666666'
STAMP = '2026-10-25T00:00:00.000Z'
FIXTURES = []


def school(tenant, title):
    return dict(kind='tenant', applicationId=None, tenantId=tenant, displayName=title,
                emailDomain=None, lifecycle='open', description='本機測試學校',
                modules=dict(leave=False, identity=False, food=False), peopleCount=0, merchantCount=0)


class Fixture:
    def __init__(self, role='operator'):
        FIXTURES.append(self)
        self.authenticated = role != 'guest'
        self.operator = role == 'operator'
        self.account = PA
        self.context = 'a' * 43
        self.workspace_role = 'owner-teacher' if self.operator else 'student'
        self.session_hold = None
        self.class_hold = None
        self.deny_class = False
        self.deny_roster = False
        self.bind_hold = None
        self.bind_seen = asyncio.Event()
        self.people = {}
        self.writes = []
        self.unhandled = []
        self.contract_failures = []
        self.schools = [school('school-a', '甲校'), school('school-b', '乙校')]
        self.school_applications = [dict(id=SOA, state='pending', displayName='丙校接入申請',
            proposedTenantId='school-c', proposedEmailDomain='school-c.example.test',
            contactName='合成申請人', contactEmail='school-c@example.test',
            justification='合成學校接入申請供本機驗證', tenantId=None, tenantState=None,
            honestyBanner='核准只會建檔，開通仍須另外操作。', createdAt=STAMP, decidedAt=None)]
        self.affiliations = [dict(id=CWAA, workspaceId=CW, workspaceTitle='待掛靠合成課班',
            tenantId='school-a', sectionId=None, justification='申請掛靠合成課班供本機驗證',
            state='pending', honestyBanner='課班不等於正式選課。', createdAt=STAMP,
            decidedAt=None, decisionReason=None)]
        self.interest = [dict(id=MPI, brandName='合成店家意向', schoolName='甲校',
            contactName='合成店主', contactEmail='merchant@example.test', note=None,
            state='submitted', createdAt=STAMP, decidedAt=None)]
        self.merchant_applications = [dict(tenantId='school-a', tenantName='甲校',
            applicationId=FMA, brandName='合成店家進件', locationName='合成店面',
            contactName='合成店主', contactEmail='merchant@example.test',
            state='submitted', version=3, submittedAt=STAMP)]
        self.sessions = [dict(id=CWS, workspaceId=CW, title='第一堂課', state='open',
            startedAt=STAMP, endedAt=None, unitId=None, unitTitle=None,
            checkInCount=0, checkedInByMe=False,
            shortCode='246810' if self.workspace_role != 'student' else None,
            lateAfterMinutes=10, myCheckInPunctuality=None, makeupRequestState=None)]
        self.roster = dict(sessionId=CWS, present=[], late=[], absent=[
            dict(platformAccountId=PB if self.operator else PA,
                 displayName='合成缺席學生', punctuality=None, makeupRequestState=None)])

    async def route(self, route):
        try:
            await self.handle(route)
        except AssertionError as failure:
            self.contract_failures.append(dict(method=route.request.method,
                path=urlparse(route.request.url).path, message=str(failure)))
            await route.fulfill(status=599, json={'error': 'PINNED_CONTRACT_MISMATCH'})

    async def handle(self, route):
        request = route.request
        url = urlparse(request.url)
        path, method = url.path, request.method
        if url.hostname not in ('127.0.0.1', 'localhost'):
            return await route.abort()
        if path in ('/api/nuni/session', '/auth/session'):
            if self.session_hold:
                await self.session_hold.wait()
            value = dict(authenticated=self.authenticated)
            if self.authenticated:
                value.update(platformAccountId=self.account, isPlatformOperator=self.operator,
                             context=self.context)
            return await route.fulfill(json=value)
        if path == '/api/nuni/sign-in-options':
            return await route.fulfill(json={'google': True})
        if path.startswith(('/api/platform-admin/', '/api/nuni/class-workspaces')):
            if not self.authenticated:
                return await route.fulfill(status=401, json={'error': 'SIGN_IN_REQUIRED'})
            if request.headers.get('x-campus-session') != self.context:
                return await route.fulfill(status=409, json={'error': 'SESSION_CHANGED'})
            if path.startswith('/api/platform-admin/') and not self.operator:
                return await route.fulfill(status=403, json={'error': 'OPERATOR_REQUIRED'})
        if path == '/api/platform-admin/schools' and method == 'GET':
            assert set(parse_qs(url.query)) <= {'q'}
            return await route.fulfill(json={'schools': self.schools})
        if path == '/api/platform-admin/school-applications' and method == 'GET':
            assert parse_qs(url.query) == {'scope': ['pending']}
            return await route.fulfill(json=dict(applications=[x for x in self.school_applications if x['state'] == 'pending'],
                operatorHonesty='核准只會建檔，開通仍須另外操作。'))
        if path == '/api/platform-admin/school-applications/' + SOA + '/decision' and method == 'POST':
            body = request.post_data_json
            self.validate_decision(body)
            self.writes.append((path, body))
            item = self.school_applications[0]
            item.update(state='approved' if body['decision'] == 'approve' else 'rejected', decidedAt=STAMP)
            if body['decision'] == 'approve':
                item.update(tenantId='school-c', tenantState='provisioned')
                if not any(x['tenantId'] == 'school-c' for x in self.schools):
                    self.schools.append(dict(school('school-c', '丙校'), lifecycle='provisioned'))
            return await route.fulfill(json=item)
        if path == '/api/platform-admin/schools/school-c/open' and method == 'POST':
            body = request.post_data_json
            assert set(body) == {'reason', 'idempotencyKey'}, body
            assert 5 <= len(body['reason'].strip()) <= 1000, body
            assert 8 <= len(body['idempotencyKey']) <= 100, body
            self.writes.append((path, body))
            for item in self.schools:
                if item['tenantId'] == 'school-c':
                    item['lifecycle'] = 'open'
            return await route.fulfill(json=dict(tenantId='school-c', tenantState='open', honestyNote='學校已開通。'))
        if path == '/api/platform-admin/class-workspace-affiliation-applications' and method == 'GET':
            assert not url.query
            return await route.fulfill(json=dict(applications=[x for x in self.affiliations if x['state'] == 'pending'],
                operatorHonesty='掛靠不會改學生的正式選課。'))
        if path == '/api/platform-admin/class-workspace-affiliation-applications/' + CWAA + '/decision' and method == 'POST':
            body = request.post_data_json
            self.validate_decision(body)
            self.writes.append((path, body))
            item = self.affiliations[0]
            item.update(state='approved' if body['decision'] == 'approve' else 'rejected',
                decidedAt=STAMP, decisionReason=body['reason'])
            return await route.fulfill(json=item)
        if path == '/api/platform-admin/people' and method == 'GET':
            tenant = parse_qs(url.query).get('tenantId', [''])[0]
            assert tenant in ('school-a', 'school-b')
            return await route.fulfill(json=self.people.get(tenant) or dict(tenantId=tenant,
                displayName='甲校' if tenant == 'school-a' else '乙校', tenantState='open',
                hasRoleAdmin=False, roleAdmins=[], people=[], honesty='合成測試授權名單'))
        if path in ('/api/platform-admin/schools/school-a/proxy', '/api/platform-admin/schools/school-b/proxy') and method == 'GET':
            tenant = path.split('/')[-2]
            return await route.fulfill(json=dict(tenantId=tenant,
                expiresAt=(datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(),
                extended=False, ended=False))
        if path == '/api/platform-admin/merchants' and method == 'GET':
            return await route.fulfill(json=dict(interest=self.interest,
                applications=self.merchant_applications, catalog=[], honesty='合成測試'))
        if path == '/api/platform-admin/merchants/interest/' + MPI + '/decision' and method == 'POST':
            body = request.post_data_json
            self.validate_decision(body)
            self.writes.append((path, body))
            item = self.interest[0]
            item.update(state='approved' if body['decision'] == 'approve' else 'rejected', decidedAt=STAMP)
            return await route.fulfill(json=item)
        if path == '/api/platform-admin/merchants/applications/school-a/' + FMA + '/decision' and method == 'POST':
            body = request.post_data_json
            assert set(body) == {'decision', 'reason', 'expectedVersion'}, body
            assert body['decision'] in ('approve', 'reject'), body
            assert body['reason'].strip(), body
            assert body['expectedVersion'] == self.merchant_applications[0]['version'], body
            self.writes.append((path, body))
            item = self.merchant_applications[0]
            item.update(state='approved' if body['decision'] == 'approve' else 'rejected', version=item['version'] + 1)
            # Exact applicationProjection fields from food-merchant-onboarding-service.ts:542.
            receipt = dict(tenantId=item['tenantId'], applicationId=FMA,
                businessKind='campus-stall', legalName='合成店家', brandName=item['brandName'],
                businessRegistrationNumber=None, foodBusinessRegistrationNumber=None,
                contactName=item['contactName'], contactEmail=item['contactEmail'],
                contactPhone='0900000000', locationName=item['locationName'],
                operatingAddress='合成校區', campusLabel='甲校本部', campusId='campus-a',
                serviceModes=['pickup'], state=item['state'], version=item['version'],
                businessRegistryCheck='not-applicable', foodRegistryCheck='not-applicable',
                reasonCode='platform-operator-reviewed', reviewerNote=body['reason'],
                merchantId='merchant_77777777-7777-4777-8777-777777777777',
                locationId='food-location_88888888-8888-4888-8888-888888888888',
                submittedAt=STAMP, updatedAt=STAMP)
            return await route.fulfill(json=receipt)
        if path == '/api/platform-admin/audit' and method == 'GET':
            return await route.fulfill(json={'records': []})
        if path == '/api/platform-admin/people/bind' and method == 'POST':
            body = request.post_data_json
            assert set(body) <= {'tenantId', 'email', 'personId', 'role', 'idempotencyKey'}, body
            assert body.get('tenantId') in ('school-a', 'school-b'), body
            assert body.get('role') in ('school_admin', 'school_staff'), body
            assert bool(body.get('email')) != bool(body.get('personId')), body
            assert isinstance(body.get('idempotencyKey'), str) and body['idempotencyKey'], body
            self.writes.append((path, body))
            self.bind_seen.set()
            tenant = body['tenantId']
            value = dict(tenantId=tenant, displayName='甲校' if tenant == 'school-a' else '乙校',
                tenantState='open', hasRoleAdmin=True,
                roleAdmins=[dict(personId='person-a', displayName='合成教師')],
                people=[dict(personId='person-a', displayName='合成教師', email=body.get('email'),
                    role=body['role'], roleLabel='學校管理員', state='active', stateLabel='使用中')],
                honesty='合成測試授權名單')
            self.people[tenant] = value
            if self.bind_hold:
                await self.bind_hold.wait()
            return await route.fulfill(json=value)
        if path == '/api/nuni/class-workspaces/' + CW and method == 'GET':
            if self.class_hold:
                await self.class_hold.wait()
            if self.deny_class:
                return await route.fulfill(status=403, json={'error': 'CLASS_WORKSPACE_FORBIDDEN'})
            return await route.fulfill(json=dict(id=CW, title='合成課班資料', state='active', memberRole=self.workspace_role))
        if path == '/api/nuni/class-workspaces/' + CW + '/assignments' and method == 'GET':
            return await route.fulfill(json={'assignments': []})
        if path == '/api/nuni/class-workspaces/' + CW + '/units' and method == 'GET':
            return await route.fulfill(json={'units': []})
        if path == '/api/nuni/class-workspaces/' + CW + '/quizzes' and method == 'GET':
            return await route.fulfill(json={'quizzes': []})
        if path == '/api/nuni/class-workspaces/' + CW + '/materials' and method == 'GET':
            return await route.fulfill(json={'materials': [], 'nextCursor': None})
        workspace = '/api/nuni/class-workspaces/' + CW
        if path == workspace + '/members' and method == 'GET':
            return await route.fulfill(json={'members': [dict(platformAccountId=PA, displayName='甲帳號私人名單', memberRole='owner-teacher')]})
        if path == workspace + '/affiliation' and method == 'GET':
            return await route.fulfill(json={'affiliation': None})
        if path == workspace + '/affiliation-applications' and method == 'GET':
            return await route.fulfill(json={'applications': []})
        if path == workspace + '/classroom-sessions' and method == 'GET':
            return await route.fulfill(json={'sessions': self.sessions})
        if path == workspace + '/classroom-sessions/' + CWS + '/roster' and method == 'GET':
            if self.deny_roster:
                return await route.fulfill(status=403, json={'error': 'CLASS_WORKSPACE_FORBIDDEN'})
            return await route.fulfill(json=self.roster)
        if path == workspace + '/classroom-sessions/' + CWS + '/check-in' and method == 'POST':
            body = request.post_data_json
            assert set(body) <= {'code'} and self.sessions[0]['state'] == 'open', body
            assert self.workspace_role == 'student'
            self.writes.append((path, body))
            self.sessions[0].update(checkInCount=1, checkedInByMe=True,
                myCheckInPunctuality='on-time', makeupRequestState=None)
            return await route.fulfill(json=dict(self.sessions[0], checkInOutcome='on-time'))
        if path == workspace + '/classroom-sessions/' + CWS + '/end' and method == 'POST':
            body = request.post_data_json
            assert body == {} and self.sessions[0]['state'] == 'open', body
            assert self.workspace_role != 'student'
            self.writes.append((path, body))
            self.sessions[0].update(state='closed', endedAt='2026-10-25T00:30:00.000Z', shortCode=None)
            return await route.fulfill(json=self.sessions[0])
        if path == workspace + '/classroom-sessions/' + CWS + '/makeup-requests' and method == 'POST':
            body = request.post_data_json
            assert body == {} and self.sessions[0]['state'] == 'closed', body
            assert self.workspace_role == 'student' and not self.sessions[0]['checkedInByMe']
            self.writes.append((path, body))
            self.sessions[0]['makeupRequestState'] = 'pending'
            self.roster['absent'][0]['makeupRequestState'] = 'pending'
            return await route.fulfill(json=self.sessions[0])
        if path == workspace + '/classroom-sessions/' + CWS + '/makeup' and method == 'POST':
            body = request.post_data_json
            assert set(body) == {'platformAccountId', 'decision'}, body
            assert body['decision'] in ('accept', 'reject') and self.sessions[0]['state'] == 'closed', body
            assert self.workspace_role != 'student'
            person = next(row for row in self.roster['absent'] if row['platformAccountId'] == body['platformAccountId'])
            assert person['makeupRequestState'] == 'pending'
            self.writes.append((path, body))
            person['makeupRequestState'] = 'accepted' if body['decision'] == 'accept' else 'rejected'
            if body['decision'] == 'accept':
                self.roster['absent'].remove(person)
                person['punctuality'] = 'makeup'
                self.roster['present'].append(person)
                self.sessions[0]['checkInCount'] += 1
            return await route.fulfill(json=self.roster)
        private = ('/api/platform-admin/', '/api/nuni/', '/auth/platform/class-workspaces/',
                   '/auth/platform/ops-api/', '/auth/platform/school-applications',
                   '/auth/platform/class-workspace-affiliations')
        if path.startswith(private) or method not in ('GET', 'HEAD'):
            self.unhandled.append(f'{method} {path}')
            return await route.fulfill(status=501, json={'error': 'UNMOCKED_PINNED_API_ROUTE'})
        return await visual.session_fixtures(self.authenticated, self.operator)(route)

    @staticmethod
    def validate_decision(body):
        assert set(body) == {'decision', 'reason', 'idempotencyKey'}, body
        assert body['decision'] in ('approve', 'reject'), body
        assert 5 <= len(body['reason'].strip()) <= 1000, body
        assert 8 <= len(body['idempotencyKey']) <= 100, body


async def make_context(browser, fixture, width=320, theme='dark'):
    context = await browser.new_context(viewport={'width': width, 'height': 900}, color_scheme=theme,
                                        reduced_motion='reduce', service_workers='block')
    await context.route('**/*', fixture.route)
    page = await context.new_page()
    page.set_default_timeout(10000)
    return context, page


async def layout(page, name, dark=True):
    await page.evaluate('document.fonts.ready')
    await visual.no_overflow(page)
    if dark:
        await visual.check_oled(page)
    await page.screenshot(path=str(OUT / (name + '.png')), full_page=True, animations='disabled')


async def settled(page):
    await page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')


async def no_operation_error(page):
    # Next keeps an accessibility route announcer with role="alert" in every page.
    await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).to_have_count(0)


async def close_case(context, page, name):
    failure = sys.exc_info()[1]
    if failure is not None:
        try:
            await page.screenshot(path=str(OUT / (name + '-failure.png')), full_page=True)
            (OUT / (name + '-failure.txt')).write_text(
                str(failure) + '\n\n' + await page.locator('body').inner_text(), encoding='utf-8')
        except Exception as capture_failure:
            print(f'Could not capture {name}: {capture_failure}', file=sys.stderr)
    await context.close()


async def role_matrix(browser, checks, errors):
    for role in ('guest', 'member', 'operator'):
        fixture = Fixture(role)
        context, page = await make_context(browser, fixture)
        page.on('pageerror', lambda error: errors.append(str(error)))
        try:
            for path, heading, name in [
                ('/auth/platform/class-workspace/join', '加入課班', 'join'),
                ('/auth/platform/class-workspace/new', '開課班', 'create'),
            ]:
                await page.goto(BASE + path, wait_until='load')
                await expect(page.get_by_role('heading', name=heading, exact=True)).to_be_visible()
                await expect(page.get_by_role('heading', name='請先登入', exact=True)).to_have_count(1 if role == 'guest' else 0)
                await layout(page, f'{name}-{role}-oled320')
            for path, title, name in [('/admin/ops', '完整管理台', 'ops'), ('/admin/school-review', '接入審核', 'school-review')]:
                await page.goto(BASE + path, wait_until='load')
                if role == 'operator':
                    await expect(page.get_by_role('heading', name=title, exact=True)).to_be_visible()
                    if name == 'school-review':
                        await expect(page.get_by_text('丙校接入申請', exact=True)).to_be_visible()
                    else:
                        await expect(page.get_by_text('甲校', exact=True)).to_be_visible()
                elif role == 'guest':
                    await expect(page.get_by_role('heading', name='請先登入管理員帳號')).to_be_visible()
                elif name == 'ops':
                    await expect(page.get_by_role('heading', name='沒有管理權限')).to_be_visible()
                else:
                    await expect(page.get_by_text('這台帳號不是平台營運人員', exact=False)).to_be_visible()
                await layout(page, f'{name}-{role}-oled320')
            if role != 'guest':
                await page.goto(BASE + '/auth/platform/class-workspace/' + CW, wait_until='load')
                await expect(page.get_by_role('heading', name='合成課班資料', exact=True)).to_be_visible()
                await layout(page, f'workspace-{role}-oled320')
            assert not fixture.unhandled, fixture.unhandled
            checks.append(f'320px OLED platform gates and class entry: {role}')
        finally:
            await close_case(context, page, 'role-' + role)


async def admin_returns(browser, checks, errors):
    for role in ('guest', 'operator'):
        fixture = Fixture(role)
        context, page = await make_context(browser, fixture, width=390, theme='light')
        page.on('pageerror', lambda error: errors.append(str(error)))
        try:
            for path in ('/admin/ops', '/admin/school-review'):
                target = path + '?campus=nthu#people'
                await page.goto(BASE + '/auth/account?' + urlencode({'returnUrl': target}), wait_until='load')
                await page.wait_for_url(lambda value: urlparse(value).path == '/login')
                await expect(page.get_by_role('heading', name='用 Google 帳號登入', exact=True)).to_be_visible()
                if role == 'guest':
                    button = page.get_by_role('button', name='使用 Google 帳號繼續', exact=True)
                    await expect(button).to_be_visible()
                    action = await button.locator('..').get_attribute('action')
                    assert parse_qs(urlparse(action).query)['returnUrl'] == [target], action
                else:
                    action = page.get_by_role('link', name='繼續使用', exact=True)
                    await expect(action).to_have_attribute('href', target)
                    await action.click()
                    await page.wait_for_url(lambda value: urlparse(value).path == path)
                    assert parse_qs(urlparse(page.url).query)['campus'] == ['nthu']
                    assert urlparse(page.url).fragment == 'people'
                await visual.no_overflow(page)
            assert not fixture.unhandled, fixture.unhandled
            checks.append(f'both new admin return paths keep platform Google login and context: {role}')
        finally:
            await close_case(context, page, 'admin-return-' + role)


async def people_school_race(browser, checks, errors):
    fixture = Fixture('operator')
    context, page = await make_context(browser, fixture, width=390, theme='light')
    page.on('pageerror', lambda error: errors.append(str(error)))
    try:
        await page.goto(BASE + '/admin/ops#people', wait_until='load')
        school_select = page.get_by_label('選擇學校', exact=True)
        await expect(school_select).to_be_visible()
        await school_select.select_option('school-a')
        field = page.get_by_label('Google 登入信箱或人員代號', exact=True)
        await expect(field).to_be_visible()
        await field.fill('teacher-a@example.test')
        fixture.bind_hold = asyncio.Event()
        await page.get_by_role('button', name='加人', exact=True).click()
        await asyncio.wait_for(fixture.bind_seen.wait(), timeout=10)
        assert fixture.writes[0][1]['tenantId'] == 'school-a'
        await school_select.select_option('school-b')
        await expect(field).to_have_value('')
        await field.fill('teacher-b@example.test')
        async with page.expect_response(lambda response: urlparse(response.url).path == '/api/platform-admin/people/bind') as completed:
            fixture.bind_hold.set()
        response = await completed.value
        assert response.status == 200
        await response.body()
        await settled(page)
        await expect(field).to_have_value('teacher-b@example.test')
        await expect(page.get_by_text('已為甲校送出加人。', exact=True)).to_have_count(0)
        fixture.session_hold = asyncio.Event()
        await page.evaluate("window.dispatchEvent(new Event('pageshow'))")
        await expect(field).to_have_count(0)
        fixture.account, fixture.context = PB, 'b' * 43
        fixture.session_hold.set()
        await expect(school_select).to_be_visible()
        await school_select.select_option('school-b')
        await expect(field).to_have_value('')
        await layout(page, 'people-cross-school-session', dark=False)
        assert not fixture.unhandled, fixture.unhandled
        checks.append('people/bind validates pinned body, school change resets draft, late A reply cannot clear B, session revalidation hides form')
    finally:
        if fixture.bind_hold:
            fixture.bind_hold.set()
        if fixture.session_hold:
            fixture.session_hold.set()
        await close_case(context, page, 'people-race')


async def workspace_session_race(browser, checks, errors):
    fixture = Fixture('operator')
    context, page = await make_context(browser, fixture, width=390, theme='dark')
    page.on('pageerror', lambda error: errors.append(str(error)))
    try:
        await page.goto(BASE + '/auth/platform/class-workspace/' + CW, wait_until='load')
        await expect(page.get_by_role('heading', name='合成課班資料', exact=True)).to_be_visible()
        await page.get_by_role('tab', name='成員', exact=True).click()
        private = page.get_by_text('甲帳號私人名單', exact=True)
        await expect(private).to_be_visible()
        fixture.session_hold = asyncio.Event()
        await page.evaluate("window.dispatchEvent(new Event('pageshow'))")
        await expect(private).to_have_count(0)
        await expect(page.get_by_role('heading', name='合成課班資料', exact=True)).to_have_count(0)
        fixture.account, fixture.context = PB, 'b' * 43
        fixture.deny_class = True
        fixture.class_hold = asyncio.Event()
        fixture.session_hold.set()
        await expect(private).to_have_count(0)
        async with page.expect_response(lambda response: urlparse(response.url).path == '/api/nuni/class-workspaces/' + CW and response.status == 403) as denied:
            fixture.class_hold.set()
        await (await denied.value).body()
        await settled(page)
        await expect(page.get_by_role('heading', name='合成課班資料', exact=True)).to_have_count(0)
        await expect(page.get_by_role('tab', name='成員', exact=True)).to_have_count(0)
        await layout(page, 'workspace-revalidation-denied-oled')
        assert not fixture.unhandled, fixture.unhandled
        checks.append('class workspace hides A private membership during validation and never restores it after B access denial')
    finally:
        if fixture.session_hold:
            fixture.session_hold.set()
        if fixture.class_hold:
            fixture.class_hold.set()
        await close_case(context, page, 'workspace-race')


async def admin_mutation_contracts(browser, checks, errors):
    fixture = Fixture('operator')
    context, page = await make_context(browser, fixture, width=390, theme='dark')
    page.on('pageerror', lambda error: errors.append(str(error)))
    try:
        await page.goto(BASE + '/admin/school-review', wait_until='load')
        approve = page.get_by_role('button', name='核准申請', exact=True)
        await expect(approve).to_be_visible()
        await layout(page, 'school-review-pending-oled')
        async with page.expect_response(lambda response: urlparse(response.url).path.endswith('/' + SOA + '/decision')) as decided:
            await approve.click()
        assert (await decided.value).status == 200
        await expect(approve).to_have_count(0)
        open_school = page.get_by_role('button', name='一鍵開通', exact=True)
        await expect(open_school).to_be_visible()
        assert next(x for x in fixture.schools if x['tenantId'] == 'school-c')['lifecycle'] == 'provisioned'
        async with page.expect_response(lambda response: urlparse(response.url).path == '/api/platform-admin/schools/school-c/open') as opened:
            await open_school.click()
        assert (await opened.value).status == 200
        await expect(open_school).to_have_count(0)
        assert next(x for x in fixture.schools if x['tenantId'] == 'school-c')['lifecycle'] == 'open'
        await no_operation_error(page)

        await page.goto(BASE + '/admin/ops?tab=merchants', wait_until='load')
        approve_interest = page.get_by_role('button', name='核准意向', exact=True)
        approve_application = page.get_by_role('button', name='核准進件', exact=True)
        await expect(approve_interest).to_be_visible()
        await expect(approve_application).to_be_visible()
        await layout(page, 'merchant-decisions-pinned-schema-oled')
        async with page.expect_response(lambda response: urlparse(response.url).path == '/api/platform-admin/merchants/interest/' + MPI + '/decision') as interest:
            await approve_interest.click()
        assert (await interest.value).status == 200
        await expect(approve_interest).to_have_count(0)
        await expect(approve_application).to_be_visible()
        async with page.expect_response(lambda response: urlparse(response.url).path == '/api/platform-admin/merchants/applications/school-a/' + FMA + '/decision') as application:
            await approve_application.click()
        assert (await application.value).status == 200
        await expect(approve_application).to_have_count(0)
        assert fixture.merchant_applications[0]['version'] == 4
        await no_operation_error(page)

        await page.goto(BASE + '/admin/ops?tab=affiliation', wait_until='load')
        approve_affiliation = page.get_by_role('button', name='核准掛靠', exact=True)
        await expect(approve_affiliation).to_be_visible()
        await layout(page, 'affiliation-pinned-schema-oled')
        async with page.expect_response(lambda response: urlparse(response.url).path.endswith('/' + CWAA + '/decision')) as affiliation:
            await approve_affiliation.click()
        assert (await affiliation.value).status == 200
        await expect(approve_affiliation).to_have_count(0)
        await no_operation_error(page)
        assert len(fixture.writes) == 5, fixture.writes
        assert not fixture.unhandled, fixture.unhandled
        checks.append('five admin writes use canonical BFF method/path/body and reload real-shaped results: school approval/open, merchant interest/application, class affiliation')
    finally:
        await close_case(context, page, 'admin-contracts')


async def classroom_contracts(browser, checks, errors):
    fixture = Fixture('member')
    context, page = await make_context(browser, fixture)
    page.on('pageerror', lambda error: errors.append(str(error)))
    try:
        await page.goto(BASE + '/auth/platform/class-workspace/' + CW, wait_until='load')
        check_in = page.get_by_role('button', name='簽到', exact=True)
        await expect(check_in).to_be_enabled()
        await expect(page.get_by_label('課堂短碼', exact=True)).to_have_count(0)
        await expect(page.get_by_role('button', name='請老師補簽', exact=True)).to_have_count(0)
        async with page.expect_response(lambda response: urlparse(response.url).path.endswith('/' + CWS + '/check-in')) as checked:
            await check_in.click()
        assert (await checked.value).status == 200
        assert fixture.writes[-1][1] == {}
        await expect(check_in).to_have_count(0)
        assert fixture.sessions[0]['checkedInByMe'] is True
        await no_operation_error(page)
        await layout(page, 'student-checked-in-oled320')
        assert not fixture.unhandled, fixture.unhandled
        checks.append('open classroom student check-in sends POST {} and removes repeat action after server confirmation')
    finally:
        await close_case(context, page, 'classroom-student-open')

    fixture = Fixture('member')
    fixture.sessions[0].update(state='closed', endedAt='2026-10-25T00:30:00.000Z', shortCode=None)
    context, page = await make_context(browser, fixture)
    page.on('pageerror', lambda error: errors.append(str(error)))
    try:
        await page.goto(BASE + '/auth/platform/class-workspace/' + CW, wait_until='load')
        request_makeup = page.get_by_role('button', name='請老師補簽', exact=True)
        await expect(request_makeup).to_be_enabled()
        await expect(page.get_by_role('button', name='簽到', exact=True)).to_have_count(0)
        async with page.expect_response(lambda response: urlparse(response.url).path.endswith('/' + CWS + '/makeup-requests')) as requested:
            await request_makeup.click()
        assert (await requested.value).status == 200
        assert fixture.writes[-1][1] == {}
        assert fixture.sessions[0]['checkInCount'] == 0
        await expect(request_makeup).to_have_count(0)
        await expect(page.get_by_text('已請老師補簽，還在等處理。', exact=True).first).to_be_visible()
        await no_operation_error(page)
        await layout(page, 'student-closed-makeup-pending-oled320')
        assert not fixture.unhandled, fixture.unhandled
        checks.append('closed classroom student makeup sends POST {}, preserves attendance count, and shows pending state')
    finally:
        await close_case(context, page, 'classroom-student-closed')

    fixture = Fixture('operator')
    context, page = await make_context(browser, fixture)
    page.on('pageerror', lambda error: errors.append(str(error)))
    try:
        await page.goto(BASE + '/auth/platform/class-workspace/' + CW, wait_until='load')
        await expect(page.get_by_label('課堂短碼', exact=True)).to_have_text('246810')
        await expect(page.get_by_text('合成缺席學生', exact=True)).to_be_visible()
        accept_makeup = page.get_by_role('button', name='接受補簽', exact=True)
        await expect(accept_makeup).to_have_count(0)
        async with page.expect_response(lambda response: urlparse(response.url).path.endswith('/' + CWS + '/end')) as ended:
            await page.get_by_role('button', name='結束課堂', exact=True).click()
        assert (await ended.value).status == 200
        assert fixture.writes[-1][1] == {}
        await expect(page.get_by_role('button', name='結束課堂', exact=True)).to_have_count(0)
        await expect(page.get_by_label('課堂短碼', exact=True)).to_have_count(0)
        # A second, synthetic student's request arrives after the classroom closes.
        fixture.roster['absent'][0]['makeupRequestState'] = 'pending'
        await page.get_by_role('button', name='更新簽到', exact=True).click()
        await expect(accept_makeup).to_be_enabled()
        await layout(page, 'teacher-closed-makeup-review-oled320')
        async with page.expect_response(lambda response: urlparse(response.url).path.endswith('/' + CWS + '/makeup')) as accepted:
            await accept_makeup.click()
        assert (await accepted.value).status == 200
        assert fixture.writes[-1][1] == {'platformAccountId': PB, 'decision': 'accept'}
        await expect(accept_makeup).to_have_count(0)
        await expect(page.get_by_text('合成缺席學生 · 補簽', exact=True)).to_be_visible()
        fixture.deny_roster = True
        async with page.expect_response(lambda response: urlparse(response.url).path.endswith('/' + CWS + '/roster') and response.status == 403) as denied:
            await page.get_by_role('button', name='更新簽到', exact=True).click()
        await (await denied.value).body()
        await settled(page)
        await expect(page.get_by_label('課堂名冊', exact=True)).to_have_count(0)
        await expect(page.get_by_text('合成缺席學生 · 補簽', exact=True)).to_have_count(0)
        await expect(page.get_by_role('button', name='更新簽到', exact=True)).to_have_count(0)
        assert not fixture.unhandled, fixture.unhandled
        checks.append('teacher sees short code only while open, ends with POST {}, accepts only pending closed-class makeup, and clears roster after 403')
    finally:
        await close_case(context, page, 'classroom-teacher')


async def main():
    checks, errors = [], []
    success = False
    async with async_playwright() as playwright:
        launch = {'args': ['--no-sandbox']}
        executable = os.environ.get('PLATFORM_BROWSER_CHROMIUM', os.environ.get('CAMPUS_VISUAL_CHROMIUM'))
        if executable:
            launch['executable_path'] = executable
        browser = await playwright.chromium.launch(**launch)
        try:
            await role_matrix(browser, checks, errors)
            await admin_returns(browser, checks, errors)
            await people_school_race(browser, checks, errors)
            await workspace_session_race(browser, checks, errors)
            await admin_mutation_contracts(browser, checks, errors)
            await classroom_contracts(browser, checks, errors)
            assert not errors, errors
            assert not any(fixture.unhandled for fixture in FIXTURES)
            assert not any(fixture.contract_failures for fixture in FIXTURES)
            success = True
        finally:
            (OUT / 'results.json').write_text(json.dumps({
                'success': success, 'passed': len(checks), 'checks': checks, 'pageErrors': errors,
                'unhandledRequests': [item for fixture in FIXTURES for item in fixture.unhandled],
                'contractFailures': [item for fixture in FIXTURES for item in fixture.contract_failures],
                'syntheticWrites': [item for fixture in FIXTURES for item in fixture.writes],
                'buildCommit': os.environ.get('PLATFORM_BROWSER_BUILD_COMMIT'),
                'buildTree': os.environ.get('PLATFORM_BROWSER_BUILD_TREE'),
                'buildDescription': os.environ.get('PLATFORM_BROWSER_BUILD_DESCRIPTION'),
                'server': BASE,
            }, ensure_ascii=False, indent=2), encoding='utf-8')
            await browser.close()
    print(json.dumps({'passed': len(checks), 'checks': checks}, ensure_ascii=False))


if __name__ == '__main__':
    asyncio.run(main())
