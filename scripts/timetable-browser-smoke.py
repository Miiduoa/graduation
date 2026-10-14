"""Exercise guest timetable interactions against a local production build only."""
import asyncio
import json
import os
import traceback
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright, expect

BASE = os.environ.get('TIMETABLE_TEST_URL', 'http://127.0.0.1:3100')
if urlparse(BASE).hostname not in ('127.0.0.1', 'localhost'):
    raise RuntimeError('Timetable smoke tests must not run against a deployed service')
OUT = Path('artifacts/timetable-browser')
OUT.mkdir(parents=True, exist_ok=True)
SEED = {'courses': [{'id': 'browser-database', 'name': '資料庫管理', 'day': 1, 'start': 3, 'end': 4,
                     'teacher': '測試教師', 'room': '主顧303'}],
        'meta': {'title': '測試課表'}, 'schoolId': 'pu', 'shareWithFriends': False, 'updatedAt': '2026-10-12T00:00:00Z'}

async def main():
    results = []
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={'width': 1440, 'height': 1000})
        await page.context.tracing.start(screenshots=True, snapshots=True)
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        await page.add_init_script('if (!localStorage.getItem("campus-one-personal-timetable:local")) localStorage.setItem("campus-one-personal-timetable:local", ' + json.dumps(json.dumps(SEED, ensure_ascii=False)) + ');')
        try:
            await page.goto(BASE + '/timetable', wait_until='networkidle')
            await expect(page.get_by_role('button', name='移動課程', exact=True)).to_be_visible()
            async def choose():
                await page.get_by_role('button', name='移動課程', exact=True).click()
                await page.get_by_role('combobox', name='要移動的課程', exact=True).select_option('browser-database')
            await choose()
            await page.get_by_role('button', name='移到星期二第 13 節', exact=True).click()
            await expect(page.get_by_role('status').filter(has_text='放不下')).to_be_visible()
            assert await page.get_by_role('dialog').count() == 0
            results.append('out-of-bounds movement rejected')
            await page.get_by_role('button', name='移到星期二第 5 節', exact=True).focus()
            await page.keyboard.press('Enter')
            dialog = page.get_by_role('dialog', name='編輯課程', exact=True)
            await expect(dialog.get_by_role('combobox', name='開始節次', exact=True)).to_have_value('5')
            await expect(dialog.get_by_role('combobox', name='結束節次', exact=True)).to_have_value('6')
            await dialog.get_by_role('button', name='取消', exact=True).click()
            confirm = page.get_by_role('dialog', name='放棄這次修改？', exact=True)
            await expect(confirm.get_by_role('button', name='繼續編輯')).to_be_focused()
            await confirm.get_by_role('button', name='放棄修改', exact=True).click()
            saved = await page.evaluate('JSON.parse(localStorage.getItem("campus-one-personal-timetable:local"))')
            assert saved['courses'][0]['day'] == 1
            await expect(page.get_by_role('status').filter(has_text='確認儲存後才會移動')).to_have_count(0)
            results.append('keyboard move, cancel and draft protection')
            await expect(dialog).to_have_count(0)
            # A new import link never grants movement privileges to a private manual timetable.
            await expect(page.get_by_role('button', name='移動課程', exact=True)).to_be_visible()
            await page.evaluate('''() => {
                window.dragEvents = [];
                for (const type of ['mousedown', 'dragstart', 'dragover', 'drop', 'dragend']) {
                    document.addEventListener(type, (event) => {
                        if (window.dragEvents.length < 300) window.dragEvents.push({
                            type, trusted: event.isTrusted, target: event.target.closest('button,td')?.outerHTML.slice(0, 350),
                            x: event.clientX, y: event.clientY
                        });
                    }, true);
                }
            }''')
            source = page.get_by_role('button', name='編輯 資料庫管理，星期一第 4 節，續堂', exact=True)
            target = page.locator('td[data-day="2"][data-period="7"]')
            await expect(source).to_have_attribute('draggable', 'true')
            # Keep both ends visible before pressing. A long table must not scroll
            # under the pointer between mousedown and the first native drag event.
            await target.scroll_into_view_if_needed()
            await source.hover()
            bounds = await source.bounding_box()
            assert bounds is not None
            await page.mouse.down()
            await page.mouse.move(bounds['x'] + bounds['width'] / 2 + 12, bounds['y'] + bounds['height'] / 2, steps=4)
            await target.hover()
            await target.hover()
            await page.mouse.up()
            drag_events = await page.evaluate('window.dragEvents')
            (OUT / 'drag-events.json').write_text(json.dumps(drag_events, ensure_ascii=False, indent=2))
            assert any(event['type'] == 'drop' and event['trusted'] for event in drag_events), 'No native drop event reached the timetable'
            await expect(dialog.get_by_role('combobox', name='開始節次', exact=True)).to_have_value('6')
            await expect(dialog.get_by_role('combobox', name='結束節次', exact=True)).to_have_value('7')
            await dialog.get_by_role('button', name='儲存', exact=True).click()
            await expect(dialog).to_have_count(0)
            await page.reload(wait_until='networkidle')
            await expect(page.get_by_role('button', name='編輯 資料庫管理，星期二第 6 節', exact=True)).to_be_visible()
            results.append('real drag with continuation offset, save and reload')
            await page.screenshot(path=str(OUT / 'desktop.png'), full_page=True, animations='disabled')
            await page.set_viewport_size({'width': 390, 'height': 844})
            assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'mobile page overflows horizontally'
            await choose()
            await page.get_by_role('button', name='移到星期三第 2 節', exact=True).click()
            await expect(dialog.get_by_role('combobox', name='開始節次', exact=True)).to_have_value('2')
            assert await dialog.evaluate('(el) => el.getBoundingClientRect().width <= innerWidth'), 'editor wider than viewport'
            await page.screenshot(path=str(OUT / 'mobile-editor.png'), animations='disabled')
            assert await dialog.evaluate('(el) => getComputedStyle(el).opacity') == '1', 'dialog animation did not settle'
            await dialog.get_by_role('button', name='儲存', exact=True).scroll_into_view_if_needed()
            await expect(dialog.get_by_role('button', name='儲存', exact=True)).to_be_in_viewport()
            await page.screenshot(path=str(OUT / 'mobile-editor-actions.png'), animations='disabled')
            await dialog.get_by_role('button', name='取消', exact=True).click()
            await page.get_by_role('button', name='放棄修改', exact=True).click()
            await expect(page.get_by_role('status').filter(has_text='確認儲存後才會移動')).to_have_count(0)
            await page.screenshot(path=str(OUT / 'mobile.png'), full_page=True, animations='disabled')
            results.append('390px layout, reachable editor actions and non-dragging movement')
            await page.evaluate('''() => { const key = 'campus-one-personal-timetable:local'; const data = JSON.parse(localStorage.getItem(key)); data.courses.push({...data.courses[0],id:'pending',name:'時間未定',day:0,start:0,end:0}); localStorage.setItem(key,JSON.stringify(data)); }''')
            await page.reload(wait_until='networkidle')
            await expect(page.get_by_role('button', name='今天空堂', exact=True)).to_be_disabled()
            await expect(page.get_by_role('button', name='排讀書時間', exact=True)).to_be_disabled()
            results.append('incomplete schedules do not produce planning suggestions')
            assert not errors, errors
        except Exception:
            (OUT / 'failure.txt').write_text(traceback.format_exc(), encoding='utf-8')
            (OUT / 'accessibility.yml').write_text(await page.locator('body').aria_snapshot(), encoding='utf-8')
            await page.screenshot(path=str(OUT / 'failure.png'), full_page=True, animations='disabled')
            raise
        finally:
            await page.context.tracing.stop(path=str(OUT / 'trace.zip'))
            (OUT / 'results.json').write_text(json.dumps({'completed': results, 'pageErrors': errors}, ensure_ascii=False, indent=2))
            await browser.close()
    print(json.dumps({'passed': len(results), 'checks': results}, ensure_ascii=False))

asyncio.run(main())
