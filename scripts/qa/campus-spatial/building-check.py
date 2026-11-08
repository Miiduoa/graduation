"""Exercise the production building preview with fictional local geometry only."""

import asyncio
import functools
import json
import math
import struct
import threading
import traceback
import zlib
from http.server import ThreadingHTTPServer
from pathlib import Path

from playwright.async_api import async_playwright, expect

import check as spatial


OUT = spatial.OUT
CANVAS = '[data-building-plan-canvas]'


def preview(page):
    return page.get_by_role('dialog', name='平面圖建模預覽', exact=True)


async def open_plan(page, example=True):
    await spatial.open_explorer(page)
    await spatial.selector_for(page).select_option(spatial.LIBRARY['id'])
    await page.get_by_role('button', name='平面圖建模預覽', exact=True).click()
    await expect(preview(page)).to_be_visible()
    await expect(page.get_by_role('dialog')).to_have_count(1)
    await expect(page.locator(spatial.CANVAS)).to_have_count(0)
    await expect(preview(page)).to_contain_text(spatial.LIBRARY['name'])
    await expect(page.locator(CANVAS)).to_have_count(0)
    if example:
        await preview(page).get_by_role('button', name='載入示意範例', exact=True).click()
        await expect(preview(page)).to_contain_text('示意範例')
        await expect(preview(page)).to_contain_text('不代表')


async def open_3d(page):
    before = await page.evaluate('window.__campusSpatialProbe.draws')
    await preview(page).get_by_role('button', name='立體', exact=True).click()
    return await assert_building_3d(page, before)


async def assert_building_3d(page, before):
    # Offscreen previews intentionally pause and hide their renderer. Scroll the
    # host into view before waiting for its IntersectionObserver to activate it.
    await preview(page).get_by_role('group', name='立體圖面', exact=True).scroll_into_view_if_needed()
    await expect(page.locator(CANVAS)).to_be_visible(timeout=20_000)
    await page.wait_for_function('before => window.__campusSpatialProbe.draws > before', arg=before)
    context = await page.locator(CANVAS).evaluate('''canvas => {
      const gl = canvas.getContext('webgl2');
      return {native: gl instanceof WebGL2RenderingContext, lost: gl.isContextLost(),
        pixels: gl.drawingBufferWidth * gl.drawingBufferHeight};
    }''')
    assert context['native'] and not context['lost'] and 0 < context['pixels'] <= 1_210_000, context
    return context


def reference_png():
    """A synthetic 600x400 drawing; the browser decodes and re-encodes real PNG bytes."""
    width, height = 600, 400
    rows = []
    for y in range(height):
        row = bytearray([0])
        for x in range(width):
            outer = ((abs(x - 60) <= 2 or abs(x - 540) <= 2) and 40 <= y <= 360 or
                     (abs(y - 40) <= 2 or abs(y - 360) <= 2) and 60 <= x <= 540)
            room = ((abs(x - 120) <= 2 or abs(x - 240) <= 2) and 80 <= y <= 200 or
                    (abs(y - 80) <= 2 or abs(y - 200) <= 2) and 120 <= x <= 240)
            row.extend((35, 58, 53) if outer or room else
                       (220, 234, 228) if 120 < x < 240 and 80 < y < 200 else (250, 249, 245))
        rows.append(bytes(row))
    def chunk(kind, data):
        return struct.pack('!I', len(data)) + kind + data + struct.pack('!I', zlib.crc32(kind + data))
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!2I5B', width, height, 8, 2, 0, 0, 0)) + \
        chunk(b'IDAT', zlib.compress(b''.join(rows))) + chunk(b'IEND', b'')


async def open_tracer(page):
    await open_plan(page, example=False)
    await page.evaluate('''() => {
      const create = URL.createObjectURL, revoke = URL.revokeObjectURL;
      window.__planUrls = {created: [], revoked: []};
      URL.createObjectURL = function(blob) {
        const url = Reflect.apply(create, this, [blob]); window.__planUrls.created.push(url); return url;
      };
      URL.revokeObjectURL = function(url) {
        window.__planUrls.revoked.push(url); return Reflect.apply(revoke, this, [url]);
      };
    }''')
    await preview(page).get_by_role('button', name='從圖片建立圖面', exact=True).click()
    await preview(page).get_by_label('選擇圖面圖片', exact=True).set_input_files({
        'name': 'fictional-floor-plan.png', 'mimeType': 'image/png', 'buffer': reference_png()})
    canvas = preview(page).get_by_role('group', name='圖片描圖區', exact=True)
    await expect(canvas).to_be_visible()
    await expect(preview(page)).to_contain_text('未校正比例／示意單位')
    await expect(page.locator(CANVAS)).to_have_count(0)
    return canvas


async def image_point(canvas, x, y):
    await canvas.scroll_into_view_if_needed()
    return await canvas.evaluate('''(svg, position) => {
      const box = svg.viewBox.baseVal;
      const point = new DOMPoint(box.width * position.x, box.height * position.y).matrixTransform(svg.getScreenCTM());
      return {x: point.x, y: point.y};
    }''', {'x': x, 'y': y})


async def add_coordinates(page, x, y):
    await preview(page).get_by_label('水平位置（%）', exact=True).fill(str(x))
    await preview(page).get_by_label('垂直位置（%）', exact=True).fill(str(y))
    await preview(page).get_by_role('button', name='加入描點', exact=True).click()


async def build_tracing(page):
    before = await page.evaluate('window.__campusSpatialProbe.draws')
    await preview(page).get_by_role('button', name='建立立體預覽', exact=True).click()
    await expect(preview(page)).to_contain_text('待核對圖面')
    return await assert_building_3d(page, before)


async def download_plan(page):
    async with page.expect_download() as pending:
        await preview(page).get_by_role('button', name='下載目前圖面', exact=True).click()
    download = await pending.value
    assert download.suggested_filename == 'building-plan.json'
    data = json.loads(Path(await download.path()).read_text(encoding='utf-8'))
    assert data['schoolId'] == 'pu' and data['buildingId'] == spatial.LIBRARY['id'], data
    assert 'verified' not in data and 'image' not in data, data
    return data


async def tracing_desktop(page, _requests, _resources):
    uploads = []
    page.on('request', lambda request: uploads.append(request.url) if request.method == 'POST' else None)
    canvas = await open_tracer(page)
    source_url = await canvas.locator('image').get_attribute('href')
    # Native click coordinates can be quantized to integer CSS pixels. Derive
    # the maximum error from one pixel at each endpoint, including the origin
    # translation, instead of requiring subpixel accuracy from a real mouse.
    pointer_tolerance = await canvas.evaluate('''svg => {
      const inverse = svg.getScreenCTM().inverse();
      const box = svg.viewBox.baseVal, unit = 20 / Math.max(box.width, box.height);
      return [2 * unit * (Math.abs(inverse.a) + Math.abs(inverse.c)),
        2 * unit * (Math.abs(inverse.b) + Math.abs(inverse.d))];
    }''')
    for x, y in [(0.1, 0.1), (0.9, 0.1), (0.9, 0.9), (0.1, 0.9)]:
        point = await image_point(canvas, x, y)
        await page.mouse.click(point['x'], point['y'])
    await expect(preview(page)).to_contain_text('樓層外框描點：4 / 64')
    await preview(page).get_by_role('button', name='完成外框', exact=True).click()
    await preview(page).get_by_role('button', name='新增房間', exact=True).click()
    await preview(page).get_by_label('新房間名稱', exact=True).fill('圖面教室 101')
    for point in [(20, 20), (40, 20), (40, 50), (20, 50)]:
        await add_coordinates(page, *point)
    await preview(page).get_by_role('button', name='完成房間', exact=True).click()
    await no_overflow(page)
    await canvas.scroll_into_view_if_needed()
    await page.screenshot(path=str(OUT / 'building-tracing-desktop.png'))
    webgl = await build_tracing(page)
    await expect(preview(page)).to_contain_text('未校正比例：使用示意單位')
    await expect(preview(page).get_by_role('region', name='房間清單')).to_contain_text('圖面教室 101')
    await page.screenshot(path=str(OUT / 'building-traced-3d.png'))
    relative = await download_plan(page)
    assert relative['units'] == 'relative' and relative['floors'][0]['height'] == 3, relative
    relative_outline = relative['floors'][0]['outline']
    assert len(relative_outline) == 4, relative_outline
    for actual, expected in zip(relative_outline, [(0, 0), (16, 0), (16, 32 / 3), (0, 32 / 3)]):
        for axis in (0, 1):
            assert math.isclose(actual[axis], expected[axis], abs_tol=pointer_tolerance[axis]), {
                'actual': actual, 'expected': expected, 'pixelTolerance': pointer_tolerance}
    await preview(page).get_by_role('button', name='返回圖面編輯', exact=True).click()
    await expect(page.locator(CANVAS)).to_have_count(0)
    await expect(preview(page).get_by_label('房間 1 名稱', exact=True)).to_have_value('圖面教室 101')
    assert source_url not in await page.evaluate('window.__planUrls.revoked')
    await preview(page).get_by_role('button', name='選兩點校正比例', exact=True).click()
    await add_coordinates(page, 10, 10)
    await add_coordinates(page, 90, 10)
    await preview(page).get_by_label('兩點實際距離（公尺）', exact=True).fill('12')
    await preview(page).get_by_label('樓高（公尺）', exact=True).fill('3.2')
    await preview(page).get_by_role('button', name='套用比例', exact=True).click()
    await build_tracing(page)
    measured = await download_plan(page)
    floor = measured['floors'][0]
    assert measured['units'] == 'm' and floor['height'] == 3.2, measured
    # Numeric calibration spans exactly 80% of the image width: 12 metres
    # replaces 16 relative units. Every existing vertex must scale by 0.75;
    # this remains strict even though the original native clicks were rounded.
    assert len(floor['outline']) == len(relative_outline), floor
    for actual, original in zip(floor['outline'], relative_outline):
        for axis in (0, 1):
            assert math.isclose(actual[axis], original[axis] * 0.75, abs_tol=1e-7), {
                'actual': actual, 'relative': original}
    room = floor['rooms'][0]['polygon']
    assert math.isclose(max(p[0] for p in room) - min(p[0] for p in room), 3, abs_tol=1e-7), room
    await preview(page).get_by_text('更換圖面與範本', exact=True).click()
    await preview(page).get_by_label('匯入 JSON 圖面', exact=True).set_input_files({
        'name': 'round-trip.json', 'mimeType': 'application/json', 'buffer': json.dumps(measured).encode()})
    await expect(preview(page)).to_contain_text('圖面教室 101')
    await expect(preview(page)).to_contain_text('待核對圖面')
    await expect(preview(page).get_by_role('button', name='返回圖面編輯', exact=True)).to_have_count(0)
    assert source_url in await page.evaluate('window.__planUrls.revoked')
    assert not uploads, uploads
    return {'webgl': webgl, 'realImageDecode': True, 'imageUploadRequests': len(uploads),
            'uncalibratedExport': True, 'pointerPixelTolerance': pointer_tolerance,
            'calibrationMetres': 12, 'calibratedMetres': [max(p[0] for p in floor['outline']),
                max(p[1] for p in floor['outline']), floor['height']], 'editableDraftPreserved': True,
            'exportReimport': True, 'referenceUrlReleased': True}


async def tracing_mobile(page, _requests, _resources):
    canvas = await open_tracer(page)
    await no_overflow(page)
    source_url = await canvas.locator('image').get_attribute('href')
    await canvas.evaluate('''svg => {
      window.__tracingTouches = [];
      svg.addEventListener('pointerdown', event => window.__tracingTouches.push({trusted:event.isTrusted, type:event.pointerType}));
    }''')
    point = await image_point(canvas, 0.1, 0.1)
    await page.touchscreen.tap(point['x'], point['y'])
    await expect(preview(page)).to_contain_text('樓層外框描點：1 / 64')
    await preview(page).get_by_label('水平位置（%）', exact=True).fill('85')
    await preview(page).get_by_label('垂直位置（%）', exact=True).fill('10')
    await canvas.focus()
    await page.keyboard.press('Shift+ArrowRight')
    await page.keyboard.press('Enter')
    await expect(preview(page).get_by_label('水平位置（%）', exact=True)).to_have_value('90')
    await add_coordinates(page, 90, 90)
    await add_coordinates(page, 10, 90)
    await expect(preview(page)).to_contain_text('樓層外框描點：4 / 64')
    await preview(page).get_by_role('button', name='完成外框', exact=True).click()
    await preview(page).get_by_role('button', name='新增房間', exact=True).click()
    await canvas.scroll_into_view_if_needed()
    scroller = await canvas.evaluate_handle('''svg => {
      for (let el=svg.parentElement;el;el=el.parentElement)
        if (/(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight+1) return el;
      throw new Error('No native dialog scroller');
    }''')
    before = await scroller.evaluate('el => el.scrollTop')
    position = await canvas.evaluate('''svg => {
      const r=svg.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height*0.75,dy:Math.min(110,r.height*0.4)};
    }''')
    session = await page.context.new_cdp_session(page)
    await session.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [
        {'x': position['x'], 'y': position['y'], 'id': 1}]})
    try:
        for step in range(1, 9):
            await session.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [
                {'x': position['x'], 'y': position['y']-position['dy']*step/8, 'id': 1}]})
            await page.wait_for_timeout(24)
    finally:
        await session.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
        await session.detach()
    await page.wait_for_function('args => args.el.scrollTop > args.before+20', arg={'el': scroller, 'before': before})
    after = await scroller.evaluate('el => el.scrollTop')
    await scroller.dispose()
    await expect(preview(page)).to_contain_text('房間描點：0 / 64')
    touch = await page.evaluate('window.__tracingTouches.filter(x=>x.type==="touch")')
    assert len(touch) >= 2 and all(item['trusted'] for item in touch), touch
    await preview(page).get_by_role('button', name='取消目前描點', exact=True).click()
    await no_overflow(page)
    await canvas.scroll_into_view_if_needed()
    await page.screenshot(path=str(OUT / 'building-tracing-mobile.png'))
    await build_tracing(page)
    await no_overflow(page)
    await preview(page).get_by_role('button', name='返回圖面編輯', exact=True).click()
    await preview(page).get_by_label('選擇圖面圖片', exact=True).set_input_files({
        'name': 'broken.png', 'mimeType': 'image/png', 'buffer': b'not image pixels'})
    await expect(preview(page).get_by_role('alert')).to_be_visible()
    await expect(canvas).to_have_count(0)
    await expect(preview(page).get_by_role('button', name='建立立體預覽', exact=True)).to_have_count(0)
    assert source_url in await page.evaluate('window.__planUrls.revoked')
    await no_overflow(page)
    return {'width': 320, 'nativeTouchInputs': touch, 'keyboardPointInput': True,
            'nativeVerticalScroll': {'before': before, 'after': after}, 'scrollAddsNoPoints': True,
            'outlineOnlyPreview': True, 'badReplacementClearsReference': True}


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
    before = await page.evaluate('window.__campusSpatialProbe.draws')
    await preview(page).get_by_role('button', name='組合樓層', exact=True).click()
    await expect(preview(page).get_by_role('button', name='分層展開', exact=True)).to_be_visible()
    await page.wait_for_function('before => window.__campusSpatialProbe.draws > before', arg=before)
    before = await page.evaluate('window.__campusSpatialProbe.draws')
    await preview(page).get_by_role('button', name='分層展開', exact=True).click()
    await expect(preview(page).get_by_role('button', name='組合樓層', exact=True)).to_be_visible()
    await page.wait_for_function('before => window.__campusSpatialProbe.draws > before', arg=before)
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
    await expect(preview(page).get_by_role('region', name='平面圖', exact=True).locator('svg')).to_have_count(2)
    await preview(page).get_by_role('region', name='房間清單', exact=True).get_by_role(
        'button', name='1F 範例教室 101', exact=True).click()
    await expect(preview(page)).to_contain_text('已選取：1F · 範例教室 101')
    await expect(preview(page).get_by_role('region', name='平面圖', exact=True).locator('svg')).to_have_count(1)
    await no_overflow(page)
    await page.screenshot(path=str(OUT / 'building-webgl-fallback.png'))
    return {'webgl': info, 'width': 320, 'contextLossFallback': True, 'fallbackRoomSelection': True}


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
                    ('building-tracing-desktop', {'width': 1440, 'height': 1100}, tracing_desktop),
                    ('building-tracing-mobile', {'width': 320, 'height': 568}, tracing_mobile),
                ]:
                    report['checks'].append(await spatial.run_case(browser, f'http://127.0.0.1:{server.server_port}',
                                                                   name, viewport, test, set()))
            finally:
                await browser.close()
        if all(item['status'] == 'passed' for item in report['checks']) and len(report['checks']) == 5:
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
