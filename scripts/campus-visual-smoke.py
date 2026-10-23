"""Check the campus entry pages against a local Web build with a guest session.

Run with the same Playwright installation as timetable-browser-smoke.py.
Screenshots use a local school-directory fixture, never a signed-in account.
"""

import asyncio
import json
import os
import re
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from playwright.async_api import async_playwright, expect

BASE = os.environ.get('CAMPUS_VISUAL_URL', 'http://127.0.0.1:3100')
if urlparse(BASE).hostname not in ('localhost', '127.0.0.1'):
    raise RuntimeError('Visual checks must run against a local server')
OUT = Path('artifacts/campus-visual')
OUT.mkdir(parents=True, exist_ok=True)


async def fixtures(route):
    url = urlparse(route.request.url)
    if url.hostname not in ('localhost', '127.0.0.1'):
        await route.abort()
    elif url.path == '/api/schools':
        await route.fulfill(json={'schools': [
            {'id': 'pu', 'name': '靜宜大學', 'status': 'not-open'},
            {'id': 'nthu', 'name': '國立清華大學', 'status': 'not-open'},
        ]})
    elif url.path == '/api/nuni/session':
        await route.fulfill(json={'authenticated': False})
    elif url.path.startswith('/api/transit'):
        await route.fulfill(json={'status': 'unavailable', 'reason': 'not-configured'})
    else:
        await route.continue_()


async def no_overflow(page):
    assert await page.evaluate(
        'document.documentElement.scrollWidth <= window.innerWidth'
    ), 'Page overflows horizontally'


async def main():
    results = []
    errors = []
    async with async_playwright() as playwright:
        launch = {}
        if os.environ.get('CAMPUS_VISUAL_CHROMIUM'):
            launch['executable_path'] = os.environ['CAMPUS_VISUAL_CHROMIUM']
        browser = await playwright.chromium.launch(**launch)
        context = await browser.new_context(
            viewport={'width': 1440, 'height': 1000},
            color_scheme='light',
            reduced_motion='reduce',
            service_workers='block',
        )
        await context.route('**/*', fixtures)
        page = await context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        try:
            for width, label in [(1440, 'desktop'), (768, 'tablet'), (390, 'mobile'), (320, 'small')]:
                await page.set_viewport_size({'width': width, 'height': 1000 if width > 768 else 844})
                await page.goto(BASE + '/?campus=pu', wait_until='networkidle')
                await expect(page.get_by_role('heading', name='今天的校園日常')).to_be_visible()
                await expect(page.get_by_role('link', name='用 Google 帳號登入')).to_be_visible()
                await expect(page.locator('time[aria-current="date"]')).to_have_count(1)
                await no_overflow(page)
                await page.screenshot(path=str(OUT / f'home-{label}.png'), full_page=True, animations='disabled')
                results.append(f'home reflows at {width}px')

                await page.goto(BASE + '/life?campus=pu', wait_until='networkidle')
                await expect(page.get_by_role('heading', name='生活', exact=True)).to_be_visible()
                await expect(page.get_by_role('heading', name='常用查詢', exact=True)).to_be_visible()
                await no_overflow(page)
                await page.screenshot(path=str(OUT / f'life-{label}.png'), full_page=True, animations='disabled')
                results.append(f'life directory reflows at {width}px')

            await page.set_viewport_size({'width': 390, 'height': 844})
            await page.goto(BASE + '/?campus=pu', wait_until='networkidle')
            services = page.locator('header summary').filter(has_text='所有服務')
            await services.click()
            await expect(page.get_by_role('link', name='尋找校園服務')).to_be_visible()
            await no_overflow(page)
            await page.screenshot(path=str(OUT / 'mobile-services.png'), animations='disabled')
            await page.keyboard.press('Escape')
            await expect(services).to_be_focused()
            await expect(page.get_by_role('link', name='尋找校園服務')).not_to_be_visible()
            results.append('service menu opens within viewport and Escape restores focus')

            campus = page.get_by_role('button', name=re.compile(r'^切換校園：'))
            await campus.click()
            await expect(page.get_by_role('combobox', name='瀏覽校園', exact=True)).to_be_visible()
            await no_overflow(page)
            await page.get_by_role('combobox', name='瀏覽校園', exact=True).select_option('nthu')
            await expect(campus).to_contain_text('國立清華大學')
            await expect(page.get_by_role('combobox', name='瀏覽校園', exact=True)).not_to_be_visible()
            timetable = page.get_by_role('navigation', name='主要導覽').get_by_role('link', name='課務')
            href = await timetable.get_attribute('href')
            assert parse_qs(urlparse(href).query).get('campus') == ['nthu']
            results.append('campus selection closes the picker and preserves navigation scope')

            for route, heading in [('/', '今天的校園日常'), ('/life', '生活')]:
                await page.emulate_media(color_scheme='dark', reduced_motion='reduce')
                await page.goto(BASE + route + '?campus=pu', wait_until='networkidle')
                await expect(page.get_by_role('heading', name=heading, exact=True)).to_be_visible()
                await no_overflow(page)
                name = 'home' if route == '/' else 'life'
                await page.screenshot(path=str(OUT / f'{name}-dark.png'), full_page=True, animations='disabled')
            results.append('home and life render in dark mode')

            await page.evaluate('''() => localStorage.setItem('campus-web-preferences', JSON.stringify({
                appearance: {theme: 'light', fontSize: 'large', animations: false}
            }))''')
            await page.set_viewport_size({'width': 320, 'height': 844})
            await page.goto(BASE + '/?campus=pu', wait_until='networkidle')
            await expect(page.locator('html')).to_have_attribute('data-reduced-motion', 'true')
            await no_overflow(page)
            await page.screenshot(path=str(OUT / 'home-large-text.png'), full_page=True, animations='disabled')
            await page.goto(BASE + '/life?campus=pu', wait_until='networkidle')
            await no_overflow(page)
            results.append('320px large-text preference has no overflow')
            assert not errors, errors
        except Exception:
            await page.screenshot(path=str(OUT / 'failure.png'), full_page=True, animations='disabled')
            raise
        finally:
            (OUT / 'results.json').write_text(json.dumps({
                'checks': results, 'pageErrors': errors,
            }, ensure_ascii=False, indent=2), encoding='utf-8')
            await browser.close()
    print(json.dumps({'passed': len(results), 'checks': results}, ensure_ascii=False))


asyncio.run(main())
