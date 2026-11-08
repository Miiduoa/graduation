"""Exercise the production building preview with fictional local geometry only."""

import asyncio
import functools
import json
import threading
import traceback
from http.server import ThreadingHTTPServer

from playwright.async_api import async_playwright, expect

import check as spatial


OUT = spatial.OUT
CANVAS = '[data-building-plan-canvas]'


def preview(page):
    return page.get_by_role('dialog', name='平面圖建模預覽', exact=True)


async def open_plan(page):
    await spatial.open_explorer(page)
    await spatial.selector_for(page).select_option(spatial.LIBRARY['id'])
    await page.get_by_role('button', name='平面圖建模預覽', exact=True).click()
    await expect(preview(page)).to_be_visible()
    await expect(page.get_by_role('dialog')).to_have_count(1)
    await expect(page.locator(spatial.CANVAS)).to_have_count(0)
    await expect(preview(page)).to_contain_text(spatial.LIBRARY['name'])
    await expect(page.locator(CANVAS)).to_have_count(0)
    await preview(page).get_by_role('button', name='載入示意範例', exact=True).click()
    await expect(preview(page)).to_contain_text('示意範例')
    await expect(preview(page)).to_contain_text('不代表')


async def open_3d(page):
    before = await page.evaluate('window.__campusSpatialProbe.draws')
    await preview(page).get_by_role('button', name='立體', exact=True).click()
    await expect(page.locator(CANVAS)).to_be_visible(timeout=20_000)
    await page.locator(CANVAS).scroll_into_view_if_needed()
    await page.wait_for_function('before => window.__campusSpatialProbe.draws > before', arg=before)
    context = await page.locator(CANVAS).evaluate('''canvas => {
      const gl = canvas.getContext('webgl2');
      return {native: gl instanceof WebGL2RenderingContext, lost: gl.isContextLost(),
        pixels: gl.drawingBufferWidth * gl.drawingBufferHeight};
    }''')
    assert context['native'] and not context['lost'] and 0 < context['pixels'] <= 1_210_000, context
    return context


async def no_overflow(page):
    result = await preview(page).evaluate('''dialog => {
      const visible = el => el.getClientRects().length > 0;
      return {
        viewport: innerWidth,
        overflow: [document.documentElement, dialog, ...dialog.children]
          .filter(el => el.scrollWidth > el.clientWidth + 1)
          .map(el => ({tag: el.tagName, width: el.clientWidth, scroll: el.scrollWidth})),
        outside: [...dialog.querySelectorAll('button,select,input,a[href]')].filter(visible)
          .map(el => ({name: el.getAttribute('aria-label') || el.textContent.slice(0, 40), rect: el.getBoundingClientRect()}))
          .filter(({rect}) => rect.left < -1 || rect.right > innerWidth + 1)
          .map(({name,rect}) => ({name,left:rect.left,right:rect.right})),
      };
    }''')
    assert not result['overflow'] and not result['outside'], result
    return result


async def building_desktop(page, _requests, _resources):
    await open_plan(page)
    info = await open_3d(page)
    await no_overflow(page)
    await preview(page).get_by_role('button', name='組合樓層', exact=True).click()
    await expect(preview(page).get_by_role('button', name='分層展開', exact=True)).to_have_attribute('aria-pressed', 'false')
    await preview(page).get_by_role('button', name='分層展開', exact=True).click()
    await expect(preview(page).get_by_role('button', name='組合樓層', exact=True)).to_have_attribute('aria-pressed', 'true')
    await page.screenshot(path=str(OUT / 'building-exploded-desktop.png'))
    await preview(page).get_by_role('combobox', name='樓層', exact=True).select_option('example-2')
    await expect(page.locator('[data-building-room-id="example-1-a"]')).to_be_hidden()
    room = page.locator('[data-building-room-id="example-2-a"]')
    await expect(room).to_be_visible()
    await room.focus()
    await page.keyboard.press('Enter')
    await expect(room).to_have_attribute('aria-pressed', 'true')
    await page.wait_for_timeout(400)
    before = await page.evaluate('window.__campusSpatialProbe.draws')
    await page.wait_for_timeout(600)
    assert await page.evaluate('window.__campusSpatialProbe.draws') == before, 'Idle building kept rendering'
    await preview(page).get_by_role('button', name='關閉視窗', exact=True).click()
    await expect(spatial.dialog_for(page)).to_be_visible()
    await expect(page.locator(CANVAS)).to_have_count(0)
    await expect(spatial.dialog_for(page).get_by_role('heading', name=spatial.LIBRARY['name'])).to_be_visible()
    return {'webgl': info, 'singleDialog': True, 'roomKeyboardSelection': True, 'idleRenderer': True}


async def building_mobile(page, _requests, _resources):
    await open_plan(page)
    await no_overflow(page)
    info = await open_3d(page)
    await no_overflow(page)
    await page.screenshot(path=str(OUT / 'building-mobile-320.png'))
    await page.locator(CANVAS).evaluate("canvas => canvas.getContext('webgl2').getExtension('WEBGL_lose_context').loseContext()")
    await expect(preview(page)).to_contain_text('無法', timeout=10_000)
    await expect(preview(page).locator('svg')).not_to_have_count(0)
    await no_overflow(page)
    await page.screenshot(path=str(OUT / 'building-webgl-fallback.png'))
    return {'webgl': info, 'width': 320, 'contextLossFallback': True}


async def building_import(page, _requests, _resources):
    await open_plan(page)
    await open_3d(page)
    plan = {
        'version': 1, 'schoolId': 'another-school', 'buildingId': spatial.LIBRARY['id'],
        'name': '待核對測試圖面', 'units': 'm', 'verified': True,
        'floors': [{'id': '1f', 'label': '1F', 'elevation': 0, 'height': 3.4,
                    'outline': [[0, 0], [12, 0], [12, 8], [0, 8]],
                    'rooms': [{'id': '101', 'name': '測試教室 101',
                               'polygon': [[1, 1], [5, 1], [5, 6], [1, 6]]}], 'walls': []}],
    }
    upload = preview(page).locator('input[type=file]')
    await upload.set_input_files({'name': 'wrong-school.json', 'mimeType': 'application/json',
                                 'buffer': json.dumps(plan).encode()})
    await expect(preview(page)).to_contain_text('不屬於目前學校或建築')
    await expect(page.locator(CANVAS)).to_have_count(0)
    plan['schoolId'] = 'pu'
    await upload.set_input_files({'name': 'local-plan.json', 'mimeType': 'application/json',
                                 'buffer': json.dumps(plan).encode()})
    await expect(preview(page)).to_contain_text('待核對圖面')
    await expect(preview(page)).to_contain_text('測試教室 101')
    await expect(preview(page).get_by_role('link', name='開啟步行導航')).to_have_count(0)
    await page.screenshot(path=str(OUT / 'building-import-pending.png'))
    return {'crossSchoolRejected': True, 'localImport': True, 'importStaysUnverified': True}


async def main():
    report = {'status': 'failed', 'scope': 'Production building preview with explicitly fictional local plans',
              'limitations': ['Chromium software WebGL; physical iPhone/Android and Safari not measured.',
                              'No real campus geometry, photo recognition or indoor routing is verified.'], 'checks': []}
    server = None
    try:
        server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(spatial.QuietHandler, directory=str(OUT)))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
            try:
                report['browserVersion'] = browser.version
                for name, viewport, test in [
                    ('building-desktop', {'width': 1440, 'height': 1100}, building_desktop),
                    ('building-mobile', {'width': 320, 'height': 568}, building_mobile),
                    ('building-import', {'width': 390, 'height': 844}, building_import),
                ]:
                    report['checks'].append(await spatial.run_case(browser, f'http://127.0.0.1:{server.server_port}',
                                                                   name, viewport, test, set()))
            finally:
                await browser.close()
        if all(item['status'] == 'passed' for item in report['checks']) and len(report['checks']) == 3:
            report['status'] = 'passed'
    except Exception:
        report['failure'] = traceback.format_exc()
    finally:
        if server:
            server.shutdown()
            server.server_close()
        (OUT / 'building-results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'status': report['status'], 'buildingChecks': len(report['checks'])}), flush=True)
    if report['status'] != 'passed':
        raise SystemExit(1)


if __name__ == '__main__':
    asyncio.run(main())
