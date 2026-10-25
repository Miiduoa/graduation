"""Exercise signed-in lost-and-found navigation using local Firebase emulators.

Run seed-service-browser-fixtures.py and start-service-auth-emulator.cjs first.
The browser obtains a real emulator-only Firebase session with a locally served
SDK fixture. Production app code, AuthProvider and Firestore rules are used
unchanged. No external network requests or real accounts are involved.
"""

import asyncio
import importlib.util
import json
import os
import subprocess
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from playwright.async_api import async_playwright, expect

ROOT = Path(__file__).resolve().parent.parent
BASE = os.environ.get('CAMPUS_SERVICE_URL', 'http://127.0.0.1:3105')
if urlparse(BASE).hostname not in ('localhost', '127.0.0.1'):
    raise RuntimeError('Lost-and-found checks must run against a local server')
OUT = ROOT / 'artifacts/campus-services/lost-found'
OUT.mkdir(parents=True, exist_ok=True)


def prepare_bundle():
    destination = OUT / 'fixture-auth.js'
    build = '''
      const fs = require('node:fs');
      const path = require('node:path');
      const esbuild = require('esbuild');
      const root = process.cwd();
      esbuild.buildSync({
        stdin: {
          contents: fs.readFileSync(path.join(root, 'scripts/fixtures/service-browser-auth.js'), 'utf8'),
          sourcefile: 'service-browser-auth.js',
          resolveDir: path.join(root, 'apps/web'),
        },
        bundle: true, platform: 'browser', format: 'iife', minify: true,
        outfile: path.join(root, 'artifacts/campus-services/lost-found/fixture-auth.js'),
      });
    '''
    subprocess.run(['node', '-e', build], cwd=ROOT, check=True)
    return destination.read_text(encoding='utf-8')


def seed_owned_rows(uid):
    spec = importlib.util.spec_from_file_location('service_fixtures', ROOT / 'scripts/seed-service-browser-fixtures.py')
    seed = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(seed)
    for index in range(1, 61):
        seed.write_document(f'schools/nthu/lostFound/browser-{index:03}', {
            'schoolId': 'nthu', 'title': f'清華校園物品 {index:02}',
            'description': '本機瀏覽器驗證使用的合成刊登。', 'category': 'other',
            'type': 'found' if index % 2 == 0 else 'lost',
            'status': 'resolved' if index % 4 == 0 else 'open',
            'location': '圖書館', 'date': seed.NOW.date().isoformat(),
            'userId': 'services-fixture-owner', 'reporterId': 'services-fixture-owner',
            'createdAt': seed.NOW - seed.dt.timedelta(hours=index + 2),
            'updatedAt': seed.NOW - seed.dt.timedelta(hours=index + 2),
        })
    seed.write_document('schools/nthu/lostFound/browser-mine', {
        'schoolId': 'nthu', 'title': '我刊登的藍色筆袋',
        'description': '本機驗證帳號擁有的合成刊登。', 'category': 'other',
        'type': 'lost', 'status': 'open', 'location': '理學院教室',
        'date': seed.NOW.date().isoformat(), 'userId': uid, 'reporterId': uid,
        'createdAt': seed.NOW, 'updatedAt': seed.NOW,
    })


async def main():
    bundle = prepare_bundle()
    checks = []
    errors = []
    network_errors = []
    blocked = []
    firestore_requests = []
    uid = None

    async def fixtures(route):
        url = urlparse(route.request.url)
        if url.hostname not in ('localhost', '127.0.0.1'):
            blocked.append(route.request.url)
            await route.abort()
        elif url.path == '/__service_browser__/auth.js':
            await route.fulfill(content_type='application/javascript', body=bundle)
        elif url.path == '/api/schools':
            await route.fulfill(json={'schools': [
                {'id': 'pu', 'name': '靜宜大學', 'status': 'not-open'},
                {'id': 'nthu', 'name': '國立清華大學', 'status': 'not-open'},
            ]})
        elif url.path in ('/api/nuni/session', '/auth/session'):
            await route.fulfill(json={'authenticated': False})
        elif url.path == '/auth/platform/providers':
            await route.fulfill(json={'kinds': ['google-consumer']})
        else:
            if url.port == 8085:
                firestore_requests.append(url.path)
            await route.continue_()

    async with async_playwright() as playwright:
        launch = {}
        if os.environ.get('CAMPUS_SERVICE_CHROMIUM'):
            launch['executable_path'] = os.environ['CAMPUS_SERVICE_CHROMIUM']
        browser = await playwright.chromium.launch(**launch)
        context = await browser.new_context(
            viewport={'width': 1440, 'height': 1000}, locale='zh-TW', timezone_id='Asia/Taipei',
            reduced_motion='reduce', service_workers='block', color_scheme='light',
        )
        await context.route('**/*', fixtures)
        page = await context.new_page()
        page.set_default_timeout(15000)
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('requestfailed', lambda request: network_errors.append({'url': request.url, 'error': request.failure}))
        try:
            await page.goto(BASE + '/privacy', wait_until='load')
            await page.add_script_tag(url='/__service_browser__/auth.js')
            await page.wait_for_function('window.serviceBrowserAuth !== undefined')
            auth = await page.evaluate('window.serviceBrowserAuth')
            assert auth.get('ready') and auth.get('uid'), auth
            uid = auth['uid']
            await asyncio.to_thread(seed_owned_rows, uid)
            await page.goto(BASE + '/lost-found?schoolId=nthu&campus=nthu', wait_until='load')
            await expect(page.get_by_role('heading', name='本校刊登', exact=True)).to_be_visible()
            rows = page.locator('main h2 a[href^="/lost-found/"]')
            await expect(rows).to_have_count(50)
            assert firestore_requests, 'The list never requested the real emulator'
            checks.append('real Firebase emulator session and unchanged rules load the signed-in list with 50 initial rows')

            await page.get_by_role('button', name='載入更多（尚有 14 則）', exact=True).click()
            await expect(rows).to_have_count(64)
            assert parse_qs(urlparse(page.url).query).get('page') == ['2']
            older = rows.nth(58)
            title = await older.inner_text()
            await older.click()
            await expect(page.get_by_role('article')).to_contain_text(title)
            await page.go_back(wait_until='load')
            await expect(rows).to_have_count(64)
            assert parse_qs(urlparse(page.url).query).get('page') == ['2']
            checks.append('browser Back restores the expanded lost-and-found list from a detail page')

            await page.get_by_role('searchbox', name='搜尋', exact=True).fill('筆袋')
            await page.get_by_role('combobox', name='類型', exact=True).select_option('lost')
            await page.get_by_role('combobox', name='狀態', exact=True).select_option('open')
            await page.get_by_label('只看我刊登的', exact=True).check()
            await expect(rows).to_have_count(1)
            assert parse_qs(urlparse(page.url).query) == {
                'schoolId': ['nthu'], 'campus': ['nthu'], 'q': ['筆袋'],
                'type': ['lost'], 'status': ['open'], 'mine': ['1'],
            }
            await rows.first.click()
            await expect(page.get_by_role('article')).to_contain_text('我刊登的藍色筆袋')
            await page.go_back(wait_until='load')
            await expect(page.get_by_role('searchbox', name='搜尋', exact=True)).to_have_value('筆袋')
            await expect(page.get_by_role('combobox', name='類型', exact=True)).to_have_value('lost')
            await expect(page.get_by_role('combobox', name='狀態', exact=True)).to_have_value('open')
            await expect(page.get_by_label('只看我刊登的', exact=True)).to_be_checked()
            await expect(rows).to_have_count(1)
            checks.append('browser Back retains text, type, status and current-user filters after a genuine owner-scoped read')

            await rows.first.click()
            await page.get_by_role('link', name='返回列表', exact=True).click()
            await expect(page.get_by_role('searchbox', name='搜尋', exact=True)).to_have_value('筆袋')
            await expect(page.get_by_label('只看我刊登的', exact=True)).to_be_checked()
            await page.reload(wait_until='load')
            await expect(rows).to_have_count(1)
            await expect(page.get_by_role('searchbox', name='搜尋', exact=True)).to_have_value('筆袋')
            checks.append('detail return link and reload retain the same filters and Firebase session')

            await page.get_by_role('searchbox', name='搜尋', exact=True).fill('沒有這件物品')
            await expect(page.get_by_text('沒有符合目前篩選條件的刊登', exact=True)).to_be_visible()
            await page.get_by_role('button', name='清除篩選', exact=True).click()
            await expect(rows).to_have_count(50)
            await expect(page.get_by_role('searchbox', name='搜尋', exact=True)).to_be_focused()
            checks.append('empty filters clear back to the complete local school collection and restore keyboard focus')

            await page.screenshot(path=str(OUT / 'lost-found-desktop.png'), animations='disabled')
            for theme in ['light', 'dark']:
                await page.emulate_media(color_scheme=theme)
                for width in [390, 320]:
                    await page.set_viewport_size({'width': width, 'height': 844})
                    await page.get_by_role('searchbox', name='搜尋', exact=True).fill('筆袋')
                    await expect(rows).to_have_count(1)
                    assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                    if theme == 'dark':
                        assert await page.evaluate('getComputedStyle(document.body).backgroundColor') == 'rgb(0, 0, 0)'
                    if width == 390:
                        await page.screenshot(path=str(OUT / f'lost-found-{theme}-mobile.png'), full_page=True, animations='disabled')
                checks.append(f'signed-in lost-and-found search fits 320px and 390px in {theme} mode')

            await page.goto(BASE + '/lost-found?schoolId=nthu&campus=pu', wait_until='load')
            await expect(page.get_by_role('heading', name='本校刊登', exact=True)).to_be_visible()
            await expect(rows).to_have_count(3)
            await expect(page.get_by_role('link', name='我刊登的藍色筆袋', exact=True)).to_have_count(0)
            checks.append('switching the explicit campus clears the previous school results while keeping the emulator account')
            assert not errors, errors
            assert not [request for request in network_errors if request['error'] != 'net::ERR_ABORTED'], network_errors
        finally:
            result = {
                'checks': checks, 'pageErrors': errors,
                'networkErrors': [request for request in network_errors if request['error'] != 'net::ERR_ABORTED'],
                'cancelledRequestCount': sum(request['error'] == 'net::ERR_ABORTED' for request in network_errors),
                'blockedExternalRequests': blocked,
                'emulatorProject': 'demo-campus-services', 'usedEmulatorAccount': uid is not None,
                'firestoreRequestCount': len(firestore_requests),
                'fixtureNote': 'Anonymous Firebase emulator account and synthetic Firestore content; no real school login or external services.',
            }
            (OUT / 'results.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
            await context.close()
            await browser.close()
        print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    asyncio.run(main())
