"""Browser checks of real role components with isolated, synthetic API responses."""
import asyncio
import functools
import http.server
import json
import os
import threading
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from playwright.async_api import async_playwright, expect


OUTPUT = Path(__file__).resolve().parents[3] / 'artifacts' / 'role-workflows'
APPLICATION = {
    'tenantId': 'qa-campus', 'applicationId': 'qa-application',
    'brandName': '山城餐坊', 'locationName': '第二校區的新門市',
    'state': 'needs-information', 'reviewerNote': '請補充營業登記資料與實際營運地點。',
    'submittedAt': '2026-11-16T03:00:00Z',
}
PREPARING = {
    'tenantId': 'qa-campus', 'tenantName': '校園生活服務合作場域',
    'merchantName': '山城餐坊', 'locationId': 'qa-preparing',
    'locationName': '北區準備門市', 'campusName': '北校區學生餐廳',
    'merchantStatus': 'suspended', 'locationStatus': 'suspended',
    'publicAccess': False, 'activated': False, 'missingRequirements': ['settings', 'menu'],
    'applicationId': 'qa-preparing-application', 'merchantId': 'qa-merchant',
    'campusId': 'north', 'serviceModes': ['pickup'], 'paymentMode': 'counter-only',
    'onlinePaymentAvailable': False, 'paymentCapabilityState': 'not-requested',
    'managerConfirmed': False, 'termsVersion': None, 'readinessVersion': 1,
    'publishedMenuItems': 0, 'merchantMode': 'info_only', 'merchantModeLabel': '資訊展示',
    'sourceLabel': '', 'sourceUpdatedAt': None, 'sourceLine': None,
}
OPERATING = {
    **PREPARING, 'locationId': 'qa-operating', 'locationName': '東區營運門市',
    'campusName': '東校區學生餐廳', 'merchantStatus': 'active', 'locationStatus': 'open',
    'publicAccess': True, 'activated': True, 'missingRequirements': [],
    'managerConfirmed': True, 'termsVersion': 'merchant-terms-v1',
    'publishedMenuItems': 4, 'merchantMode': 'full', 'merchantModeLabel': '完整點餐',
}
COURSES = [
    {'id': 'cw_11111111-1111-4111-8111-111111111111',
     'title': '資訊管理專題與跨領域服務設計實作', 'state': 'active', 'memberRole': 'owner-teacher'},
    {'id': 'cw_22222222-2222-4222-8222-222222222222',
     'title': '校園應用與人機互動', 'state': 'active', 'memberRole': 'co-teacher'},
    {'id': 'cw_33333333-3333-4333-8333-333333333333',
     'title': '服務設計工作坊', 'state': 'active', 'memberRole': 'owner-teacher'},
    {'id': 'cw_44444444-4444-4444-8444-444444444444',
     'title': '學生身分的課程', 'state': 'active', 'memberRole': 'student'},
]
PROGRAMS = [{
    'tenantId': 'qa-campus', 'name': '校園生活服務合作場域',
    'note': '請填寫實際營運位置。', 'campuses': [{'id': 'north', 'name': '北校區'}],
}]


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_GET(self):
        # Standalone component fixture only: preserve real anchor URLs and browser Back.
        if urlparse(self.path).path.startswith('/merchant'):
            self.path = '/index.html'
        super().do_GET()


class Scenario:
    def __init__(self, page, origin, width, theme, name, reports):
        self.page, self.origin = page, origin
        self.errors, self.external, self.writes, self.unexpected = [], [], [], []
        self.report = {
            'name': name, 'width': width, 'theme': theme, 'status': 'running',
            'checks': [], 'screenshots': [],
        }
        reports.append(self.report)
        page.on('pageerror', lambda error: self.errors.append(str(error)))

    def checked(self, detail):
        self.report['checks'].append(detail)

    async def capture(self, filename):
        async def paint_ready():
            await self.page.evaluate('''async () => {
              await document.fonts.ready;
              await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            }''')

        await paint_ready()
        try:
            await self.page.screenshot(path=str(OUTPUT / filename), full_page=True, animations='disabled')
        except Exception as error:
            # Chromium can reject the first surface capture while a headed
            # window is settling. Retry only that protocol error, once, with
            # the exact same capture extent; never substitute a smaller image.
            if 'Page.captureScreenshot' not in str(error) or 'Unable to capture screenshot' not in str(error):
                raise
            await paint_ready()
            await self.page.screenshot(path=str(OUTPUT / filename), full_page=True, animations='disabled')

    async def layout(self, name):
        metrics = await self.page.evaluate('''() => ({
          viewport: innerWidth, document: document.documentElement.scrollWidth,
          smallButtons: [...document.querySelectorAll('button')].filter(node =>
            node.getClientRects().length && node.getBoundingClientRect().height < 43.5
          ).map(node => node.textContent)
        })''')
        assert metrics['document'] <= metrics['viewport'] + 1, metrics
        assert not metrics['smallButtons'], metrics
        filename = f"{self.report['width']}-{self.report['theme']}-{self.report['name']}-{name}.png"
        await self.capture(filename)
        self.report['screenshots'].append(filename)
        self.checked(name + ': no horizontal overflow; all visible buttons at least 44px')

    async def install_api(self, callback):
        async def route_request(route):
            request = route.request
            if not request.url.startswith(self.origin):
                self.external.append(request.url)
                await route.abort()
                return
            pathname = urlparse(request.url).path
            if not pathname.startswith('/fixture-api/'):
                await route.continue_()
                return
            api_path = pathname.removeprefix('/fixture-api/')
            if request.method != 'GET':
                self.writes.append({'path': api_path, 'method': request.method})
                await route.fulfill(status=405, json={'error': 'FIXTURE_WRITE_NOT_ALLOWED'})
                return
            status, body = await callback(api_path)
            if status == 501:
                self.unexpected.append(api_path)
            await route.fulfill(status=status, json=body)
        await self.page.route('**/*', route_request)

    async def keyboard_to(self, locator):
        for _ in range(30):
            if await locator.evaluate('node => node === document.activeElement'):
                return
            await self.page.keyboard.press('Tab')
        raise AssertionError('Keyboard could not reach the requested control')

    async def finish(self):
        assert not self.errors, self.errors
        assert not self.external, self.external
        assert not self.writes, self.writes
        assert not self.unexpected, self.unexpected
        self.checked('No page errors, external traffic, unexpected APIs or write requests')
        self.report['status'] = 'passed'

    async def close(self, failure=None):
        self.report.update({
            'pageErrors': self.errors, 'externalRequests': self.external,
            'writes': self.writes, 'unexpectedApiPaths': self.unexpected,
        })
        if failure:
            self.report.update({'status': 'failed', 'error': repr(failure)})
            prefix = f"{self.report['width']}-{self.report['theme']}-{self.report['name']}-failure"
            await self.capture(prefix + '.png')
            (OUTPUT / (prefix + '.html')).write_text(await self.page.content(), encoding='utf-8')
            (OUTPUT / (prefix + '-aria.yml')).write_text(
                await self.page.locator('body').aria_snapshot(), encoding='utf-8')
            self.report['failureArtifacts'] = [prefix + suffix for suffix in ['.png', '.html', '-aria.yml']]
        await self.page.close()


async def account_scenario(browser, origin, width, theme, reports, empty=False):
    page = await browser.new_page(viewport={'width': width, 'height': 920}, color_scheme=theme)
    scenario = Scenario(page, origin, width, theme, 'account-empty' if empty else 'account', reports)
    lookup_count = 0
    retry_gate = asyncio.Event()

    async def api(path):
        nonlocal lookup_count
        if path == 'account-demo':
            return 200, {'demo': None}
        if path == 'class-workspaces':
            lookup_count += 1
            if lookup_count == 1:
                return 503, {'error': 'FIXTURE_UNAVAILABLE'}
            await retry_gate.wait()
            return 200, {'workspaces': [] if empty else COURSES}
        if path == 'merchant-workspaces':
            return 200, {'workspaces': [] if empty else [PREPARING, OPERATING]}
        if path == 'merchant-applications':
            return 200, {'applications': [] if empty else [APPLICATION]}
        return 501, {'error': 'FIXTURE_UNEXPECTED_PATH'}

    failure = None
    try:
        await scenario.install_api(api)
        await page.goto(origin + '/?theme=' + theme + ('&operator=1' if not empty else ''))
        retry = page.get_by_role('button', name='再試一次', exact=True)
        await expect(retry).to_be_visible()
        await scenario.keyboard_to(retry)
        await expect(retry).to_be_focused()
        await scenario.layout('lookup-error')
        await page.keyboard.press('Enter')
        await expect(page.get_by_role('button', name='確認中…', exact=True)).to_be_disabled()
        await expect(page.locator('[inert]')).to_have_count(1)
        scenario.checked('Keyboard retry disables stale work links while identity is being confirmed')
        retry_gate.set()
        await expect(page.get_by_role('heading', name='我的工作', exact=True)).to_be_focused()
        await expect(page.get_by_role('alert')).to_have_count(0)
        scenario.checked('Successful retry restores focus to the work heading after removing retry')
        if empty:
            await expect(page.get_by_role('status')).to_have_text('工作身分已確認，請繼續查看下方今天的安排。')
            await expect(page.get_by_role('link', name='申請店家進駐')).to_have_count(0)
            await expect(page.get_by_role('region', name='門市工作')).to_have_count(0)
            scenario.checked('Confirmed student with no extra role returns to daily work without a merchant application pitch')
        else:
            teaching = page.get_by_role('region', name='教學工作', exact=True)
            await expect(teaching.get_by_role('link')).to_have_count(2)
            await expect(teaching.get_by_role('link', name='資訊管理專題與跨領域服務設計實作 負責老師')).to_have_attribute(
                'href', '/classroom/course/cw_11111111-1111-4111-8111-111111111111')
            more_courses = teaching.get_by_text('其他授課課程（1）', exact=True)
            await scenario.keyboard_to(more_courses)
            await page.keyboard.press('Enter')
            await expect(teaching.get_by_role('link')).to_have_count(3)
            await expect(teaching.get_by_role('link', name='服務設計工作坊 負責老師', exact=True)).to_have_attribute(
                'href', '/classroom/course/cw_33333333-3333-4333-8333-333333333333')
            scenario.checked('Only two teaching links start visible; keyboard disclosure reveals the remaining exact course destination')
            await expect(page.get_by_text('學生身分的課程', exact=True)).to_have_count(0)
            await expect(page.get_by_role('link', name='1 筆申請需要補件 →', exact=True)).to_have_attribute(
                'href', '/merchant/workspace')
            merchant = page.get_by_role('region', name='門市工作', exact=True)
            await expect(merchant.get_by_role('link').filter(has_text='山城餐坊／北區準備門市')).to_have_attribute(
                'href', '/merchant/workspace?tenant=qa-campus&location=qa-preparing')
            await expect(merchant.get_by_role('link').filter(has_text='山城餐坊／東區營運門市')).to_have_attribute(
                'href', '/merchant/workspace?tenant=qa-campus&location=qa-operating')
            await expect(merchant.get_by_role('link', name='查看申請進度（1）', exact=True)).to_have_attribute(
                'href', '/merchant/workspace?view=applications#merchant-applications-title')
            await expect(page.get_by_role('link', name='進入平台工作台 →', exact=True)).to_have_attribute('href', '/admin')
            scenario.checked('Teaching/merchant/platform destinations match confirmed synthetic roles and retain exact course IDs')
        await scenario.layout('recovered')
        await scenario.finish()
    except Exception as error:
        failure = error
        raise
    finally:
        retry_gate.set()
        await scenario.close(failure)


async def merchant_scenario(browser, origin, width, theme, reports):
    page = await browser.new_page(viewport={'width': width, 'height': 920}, color_scheme=theme)
    scenario = Scenario(page, origin, width, theme, 'merchant', reports)

    account_demo_calls = 0

    async def api(path):
        nonlocal account_demo_calls
        if path == 'account-demo':
            account_demo_calls += 1
            if account_demo_calls == 1:
                return 503, {'error': 'FIXTURE_UNAVAILABLE'}
            return 200, {'demo': None}
        if path == 'merchant-workspaces':
            return 200, {'workspaces': [PREPARING, OPERATING]}
        if path == 'merchant-applications':
            return 200, {'applications': [APPLICATION]}
        if path == 'merchant-onboarding-programs':
            return 200, {'programs': PROGRAMS}
        if path == 'merchant-workspaces/qa-campus/qa-preparing':
            return 200, PREPARING
        if path == 'merchant-workspaces/qa-campus/qa-operating':
            return 200, OPERATING
        if path == 'merchant-workspaces/qa-campus/qa-operating/orders':
            return 200, {'orders': []}
        if path == 'merchant-workspaces/qa-campus/qa-operating/shift':
            return 404, {'error': 'FOOD_SHIFT_NOT_FOUND'}
        return 501, {'error': 'FIXTURE_UNEXPECTED_PATH'}

    failure = None
    try:
        await scenario.install_api(api)
        await page.goto(origin + '/merchant?theme=' + theme)
        await expect(page.get_by_role('heading', name='1 筆申請需要補件')).to_be_visible()
        await expect(page.get_by_text('暫時無法確認帳號資料，請重新讀取後再操作。', exact=True)).to_be_visible()
        await page.get_by_role('button', name='重新讀取帳號資料', exact=True).click()
        await expect(page.get_by_text('暫時無法確認帳號資料，請重新讀取後再操作。', exact=True)).to_have_count(0)
        await expect(page.get_by_role('heading', name='1 筆申請需要補件')).to_be_visible()
        scenario.checked('account-demo is expected; a failed showcase read keeps official merchant work')
        await expect(page.get_by_role('button', name='重新載入', exact=True)).to_be_enabled()
        await expect(page.get_by_label('申請場域', exact=True)).to_have_count(0)
        await expect(page.get_by_role('heading', name='店家如何進駐')).to_have_count(0)
        await scenario.layout('existing-operator')
        application_link = page.get_by_role('link', name='查看申請進度', exact=True)
        await scenario.keyboard_to(application_link)
        await page.keyboard.press('Enter')
        await expect(page.get_by_role('heading', name='申請進度', exact=True)).to_be_focused()
        scenario.checked('Existing merchant sees the pending task, not a new application form; keyboard link focuses its destination')

        preparing_link = page.get_by_role('link', name='管理門市：北區準備門市', exact=True)
        await expect(preparing_link).to_have_attribute('href', '/merchant/workspace?tenant=qa-campus&location=qa-preparing')
        await preparing_link.click()
        name = page.get_by_label('品項 1 名稱', exact=True)
        await name.fill('保留的蔬菜便當草稿')
        await page.get_by_label('品項 1 售價（元）', exact=True).fill('85')
        await page.get_by_label('品項 1 初始庫存', exact=True).fill('20')
        await page.get_by_role('link', name='返回我的門市', exact=True).click()
        await page.get_by_role('link', name='管理門市：北區準備門市', exact=True).click()
        await expect(name).to_have_value('保留的蔬菜便當草稿')
        await expect(page.get_by_label('品項 1 售價（元）', exact=True)).to_have_value('85')
        await expect(page.get_by_label('品項 1 初始庫存', exact=True)).to_have_value('20')
        await expect(page.get_by_role('button', name='確認建立並上架菜單', exact=True)).to_be_disabled()
        scenario.checked('Returning from the selected store preserves its menu draft and does not inherit submission consent')
        await scenario.layout('menu-draft-return')

        await page.get_by_role('link', name='返回我的門市', exact=True).click()
        await page.get_by_role('link', name='管理門市：東區營運門市', exact=True).click()
        daily = page.get_by_role('region', name='門市工作台', exact=True)
        await expect(daily).to_be_visible()
        assert await daily.evaluate('node => !!(node.compareDocumentPosition(document.getElementById("merchant-activate-title")) & Node.DOCUMENT_POSITION_FOLLOWING)')
        await page.get_by_role('link', name='處理訂單與收銀', exact=True).click()
        assert parse_qs(urlparse(page.url).query) == {
            'tenant': ['qa-campus'], 'location': ['qa-operating'], 'section': ['orders']}
        await expect(page.get_by_text('這一頁沒有待處理的訂單。', exact=True)).to_be_visible()
        await page.get_by_label('期初現金（元）', exact=True).fill('150')
        await page.get_by_role('navigation', name='門市工作', exact=True).get_by_role('link', name='門市概況', exact=True).click()
        await expect(page.get_by_role('region', name='門市訂單工作台', exact=True)).to_have_count(0)
        await page.get_by_role('navigation', name='門市工作', exact=True).get_by_role('link', name='訂單與收銀', exact=True).click()
        await expect(page.get_by_label('期初現金（元）', exact=True)).to_have_value('150')
        await expect(page.get_by_role('button', name='確認開班', exact=True)).to_be_disabled()
        scenario.checked('Daily work is reachable before settings; switching overview/orders preserves the store URL and cash draft without confirming a shift')
        await scenario.layout('daily-orders')

        await page.get_by_role('link', name='返回我的門市', exact=True).click()
        await page.get_by_role('link', name='申請新門市', exact=True).click()
        await expect(page.get_by_role('heading', name='這個帳號已有進駐申請', exact=True)).to_be_visible()
        await expect(page.get_by_label('申請場域', exact=True)).to_have_count(0)
        await page.get_by_role('button', name='申請另一間門市', exact=True).click()
        await page.get_by_role('combobox', name='申請場域', exact=True).select_option('qa-campus')
        await page.get_by_role('combobox', name='校區／營運區域', exact=True).select_option('north')
        await page.get_by_label('對外品牌名稱', exact=True).fill('另一間門市的未送出草稿')
        reload_button = page.get_by_role('button', name='重新載入', exact=True)
        await reload_button.click()
        # Refresh hides the form without clearing its values. Wait for it to return
        # before asserting the draft or measuring the full-page screenshot.
        await expect(reload_button).to_be_enabled()
        await expect(page.get_by_role('heading', name='申請進駐', exact=True)).to_be_visible()
        brand = page.get_by_label('對外品牌名稱', exact=True)
        await expect(brand).to_be_visible()
        await expect(brand).to_have_value('另一間門市的未送出草稿')
        scenario.checked('A second application opens explicitly, preserves the draft during refresh and sends no application')
        await scenario.layout('secondary-application')
        await page.go_back()
        await expect(page.get_by_role('heading', name='1 筆申請需要補件', exact=True)).to_be_visible()
        await expect(page.get_by_label('申請場域', exact=True)).to_have_count(0)
        scenario.checked('Browser Back returns to the existing merchant work list')
        await scenario.finish()
    except Exception as error:
        failure = error
        raise
    finally:
        await scenario.close(failure)


async def main():
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0),
        functools.partial(QuietHandler, directory=str(OUTPUT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f'http://127.0.0.1:{server.server_port}'
    reports = []
    failure = None
    try:
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(executable_path=os.environ.get('CHROME_PATH'))
            try:
                for width, theme in [(1440, 'light'), (390, 'dark'), (320, 'light')]:
                    await account_scenario(browser, origin, width, theme, reports)
                    await account_scenario(browser, origin, width, theme, reports, empty=True)
                    await merchant_scenario(browser, origin, width, theme, reports)
            finally:
                await browser.close()
        print(json.dumps({'scenarios': len(reports), 'checks': sum(len(row['checks']) for row in reports),
                          'screenshots': sum(len(row['screenshots']) for row in reports)}, ensure_ascii=False))
    except Exception as error:
        failure = error
        raise
    finally:
        server.shutdown()
        report = {
            'status': 'failed' if failure else 'passed',
            'scope': 'Actual product components with synthetic session/API; no production login or backend.',
            'scenarios': reports,
            **({'error': repr(failure)} if failure else {}),
        }
        (OUTPUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')


if __name__ == '__main__':
    asyncio.run(main())
