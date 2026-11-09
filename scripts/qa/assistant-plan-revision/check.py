"""Real Chromium interactions on production Assistant with fixed fake API data.

No model, school system, deployed backend or real account is used. Normal cases
use native UI actions. Explicit controlled faults alter only fixture API replies.
Build with build.mjs first. Artifacts include screenshots, requests and fake writes.
"""
import asyncio
import functools
import hashlib
import json
import os
import re
import subprocess
import threading
import traceback
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from playwright.async_api import async_playwright, expect

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'artifacts/assistant-plan-revision'
CHANGE = '第二筆改到21:00至21:30，第一筆保持不變'
ORIGINAL = [
    {'title': '測試微積分複習', 'date': '2026-11-12', 'allDay': False, 'startTime': '19:00', 'endTime': '19:30'},
    {'title': '測試英文閱讀', 'date': '2026-11-12', 'allDay': False, 'startTime': '20:00', 'endTime': '20:30'},
]


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def card_list(page):
    return page.get_by_role('article', name='行程確認卡', exact=True)


async def snapshot(page):
    return await page.evaluate('window.__agentQA.snapshot()')


def actions(state):
    return [row['action'] for row in state['requests'] if row['action'] != 'capability']


async def no_writes(page):
    state = await snapshot(page)
    assert state['writes'] == [], state
    assert 'confirm' not in actions(state), state
    local_key = f"campus.personal-imports.v1:platform%3A{state['account']}:{state['school']}"
    assert await page.evaluate('key => localStorage.getItem(key)', local_key) is None, state


async def idle(page):
    await expect(page.get_by_role('log')).not_to_have_attribute('aria-busy', 'true')


async def start_plan(page, events=None):
    events = ORIGINAL if events is None else events
    consent = page.get_by_role('checkbox', name=re.compile('同意在本次對話'))
    await expect(consent).to_be_enabled()
    await consent.check()
    question = page.get_by_role('textbox', name='問題', exact=True)
    await question.fill('請幫我安排兩段讀書時間')
    await question.press('Enter')
    await expect(card_list(page)).to_have_count(len(events))
    for index, event in enumerate(events):
        await expect(card_list(page).nth(index)).to_contain_text(event['title'])
        await expect(card_list(page).nth(index)).to_contain_text(event['startTime'] + '–' + event['endTime'])
    await expect(card_list(page).nth(0).get_by_role('button', name='確認', exact=True)).to_be_enabled()
    await expect(card_list(page).nth(1).get_by_role('button', name='確認', exact=True)).to_be_disabled()
    await no_writes(page)


async def open_revision(page, keyboard=False, instruction=CHANGE):
    entry = page.get_by_role('button', name='修改時間或條件', exact=True).first
    if keyboard:
        await entry.focus()
        await page.keyboard.press('Enter')
    else:
        await entry.click()
    field = page.get_by_role('textbox', name='修改條件', exact=True)
    await expect(field).to_be_focused()
    await field.fill(instruction)
    if keyboard:
        await page.keyboard.press('Tab')
        await expect(page.get_by_role('button', name='重新預覽', exact=True)).to_be_focused()
    return field


async def assert_preview(page, expected_asks=2):
    await expect(card_list(page)).to_have_count(4)
    await idle(page)
    for index in range(2):
        old = card_list(page).nth(index)
        await expect(old).to_contain_text('已撤銷未執行提議')
        await expect(old.get_by_role('button', name='確認', exact=True)).to_have_count(0)
    await expect(card_list(page).nth(2)).to_contain_text('測試微積分複習')
    await expect(card_list(page).nth(2)).to_contain_text('19:00–19:30')
    await expect(card_list(page).nth(3)).to_contain_text('測試英文閱讀')
    await expect(card_list(page).nth(3)).to_contain_text('21:00–21:30')
    await expect(card_list(page).nth(3).get_by_role('button', name='確認', exact=True)).to_be_disabled()
    await no_writes(page)
    state = await snapshot(page)
    asks = [row for row in state['requests'] if row['action'] == 'ask']
    assert len(asks) == expected_asks, state
    body = asks[-1]['body']
    assert body['consent'] is True and body['schoolId'] == 'fixture-campus-a', body
    assert body['history'] == [], body
    assert CHANGE in body['question'], body
    # Decode the allowlisted snapshot independently, and check every event field.
    payload = body['question'].split('原安排：', 1)[1].split('\n修改條件：', 1)[0]
    assert json.loads(payload) == ORIGINAL, payload
    assert 'token' not in body['question'] and 'mutationId' not in body['question'], body
    for row in state['requests']:
        if row['action'] == 'cancel':
            assert row['body']['token'] not in body['question'], body
    assert state['revoked'] == ['qa-original-1', 'qa-original-2'], state
    await basic_comparison(page)


def comparison(page):
    return page.get_by_role('region', name='這次提議改了什麼', exact=True)


async def changed_field(row, label, before, after):
    term = row.get_by_text(label, exact=True)
    await expect(term).to_have_count(1)
    values = term.locator('xpath=following-sibling::dd').locator(':scope > div')
    await expect(values).to_have_count(2)
    await expect(values.nth(0)).to_have_text('原提議：' + before)
    await expect(values.nth(1)).to_have_text('新提議：' + after)


async def comparison_before_cards(page):
    panel = comparison(page)
    await expect(panel).to_be_visible()
    assert await panel.evaluate('''node => {
      const firstNewCard = document.querySelectorAll('article[aria-label="行程確認卡"]')[2];
      return !!firstNewCard && Boolean(node.compareDocumentPosition(firstNewCard) & Node.DOCUMENT_POSITION_FOLLOWING);
    }'''), 'Comparison must precede the revised confirmation cards'
    return panel


async def basic_comparison(page):
    panel = await comparison_before_cards(page)
    ledger = await snapshot(page)
    await expect(panel.get_by_text('內容未變更：1 項。', exact=True)).to_be_visible()
    changed = panel.get_by_role('list', name='內容變更的提議', exact=True)
    await expect(changed.get_by_role('listitem')).to_have_count(1)
    row = changed.get_by_role('listitem', name='測試英文閱讀', exact=True)
    assert sorted(await row.locator('dt').all_text_contents()) == ['結束時間', '開始時間']
    await changed_field(row, '開始時間', '2026-11-12 20:00（台灣時間）', '2026-11-12 21:00（台灣時間）')
    await changed_field(row, '結束時間', '2026-11-12 20:30（台灣時間）', '2026-11-12 21:30（台灣時間）')
    for label in ['新提議新增', '新提議不再列入', '原提議行程', '新提議行程']:
        await expect(panel.get_by_role('list', name=label, exact=True)).to_have_count(0)
    assert await snapshot(page) == ledger, 'Reading the comparison caused an API call or write'


async def geometry_against_composer(target, dock_element):
    # Read target and the entire composer dock in one layout snapshot.
    return await target.evaluate('''(node, dock) => {
      const box = element => {const r=element.getBoundingClientRect();
        return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height};};
      const style=getComputedStyle(node), visual=window.visualViewport, scrolling=document.scrollingElement;
      return {target:box(node),dock:box(dock),viewport:{width:innerWidth,height:innerHeight},
        dockPosition:getComputedStyle(dock).position,scroll:{x:scrollX,y:scrollY},
        documentScrollingElement:scrolling?{scrollHeight:scrolling.scrollHeight,clientHeight:scrolling.clientHeight,scrollTop:scrolling.scrollTop}:null,
        computedMargins:{marginBlockStart:style.marginBlockStart,marginBlockEnd:style.marginBlockEnd,
          scrollMarginBlockStart:style.scrollMarginBlockStart,scrollMarginBlockEnd:style.scrollMarginBlockEnd},
        visualViewport:visual?{width:visual.width,height:visual.height,offsetLeft:visual.offsetLeft,
          offsetTop:visual.offsetTop,pageLeft:visual.pageLeft,pageTop:visual.pageTop,scale:visual.scale}:null};
    }''', dock_element)


async def focused_action_readability(page, button, name, before_tab=None):
    # Observe native Tab scrolling only. Do not repair visibility with scrollIntoView/focus.
    await expect(button).to_be_focused()
    await page.evaluate('''() => new Promise(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    })''')
    dock = page.get_by_role('form', name='傳送問題', exact=True).locator('..')
    await expect(dock).to_be_visible()
    evidence = await geometry_against_composer(button, await dock.element_handle())
    evidence['focused'] = await button.evaluate('node => document.activeElement === node')
    evidence['action'] = await button.inner_text()
    probe = await button.evaluate("node => ({installed:!!node.__qaScrollRequests,requests:node.__qaScrollRequests || []})")
    evidence['scrollRequests'] = probe['requests']
    evidence['scrollProbe'] = 'Single-element observer delegates the original native scrollIntoView' if probe['installed'] else None
    if before_tab is not None:
        evidence['beforeTab'] = before_tab
        previous, previous_dock, previous_viewport = before_tab['target'], before_tab['dock'], before_tab['viewport']
        evidence['noScrollExpected'] = (previous['width'] > 0 and previous['height'] > 0
            and previous['top'] >= 12 and previous['bottom'] + 12 <= min(previous_dock['top'], previous_viewport['height'])
            and previous['left'] >= 0 and previous['right'] <= previous_viewport['width'])
        evidence['scrollDelta'] = {axis: evidence['scroll'][axis] - before_tab['scroll'][axis] for axis in ['x', 'y']}
    evidence['viewportScreenshot'] = f'{name}-viewport.png'
    (OUT / f'{name}.json').write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding='utf-8')
    await page.screenshot(path=str(OUT / evidence['viewportScreenshot']), full_page=False)
    target, dock_box, viewport = evidence['target'], evidence['dock'], evidence['viewport']
    assert (evidence['focused'] and target['width'] > 0 and target['height'] > 0
            and target['top'] >= 0 and target['bottom'] <= min(dock_box['top'], viewport['height'])
            and target['left'] >= 0 and target['right'] <= viewport['width']), (
                f'Native Tab leaves the focused action obscured: {evidence}')
    if evidence.get('noScrollExpected'):
        assert all(abs(delta) <= 1 for delta in evidence['scrollDelta'].values()), (
            f'Tab scrolled an action that already had 12px clearance: {evidence}')
    return evidence


async def completed_revision_preview(page):
    # Pending=false does not imply the original revision editor has finished closing.
    await expect(page.get_by_role('form', name='修改安排再預覽', exact=True)).to_have_count(0, timeout=5000)
    original = page.get_by_role('region', name='修改行程提議', exact=True).first
    await expect(original.get_by_role('status')).to_contain_text('這次重新預覽沒有寫入行程', timeout=5000)


async def settled_comparison_geometry(panel):
    # Read only: observe completion of native smooth scrolling and layout changes.
    # The independent timer also bounds waiting if animation frames stop arriving.
    return await panel.evaluate('''node => new Promise(resolve => {
      const timeoutMs=5000, requiredStableFrames=8, requiredStableMs=100;
      const sample=()=>{const r=node.getBoundingClientRect(), scrolling=document.scrollingElement;
        return {connected:node.isConnected,scrollX,scrollY,scrollHeight:scrolling?.scrollHeight ?? 0,
          comparison:{top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height}};};
      const started=performance.now(), first=sample();
      let last=first, lastKey=JSON.stringify(first), frames=0, changedFrames=0;
      let stableFrames=0, stableSince=started, finished=false, frame=0;
      const finish=(settled,reason)=>{
        if(finished)return;
        finished=true;clearTimeout(timer);cancelAnimationFrame(frame);
        const ended=performance.now();
        resolve({settled,reason,timeoutMs,requiredStableFrames,requiredStableMs,
          waitMs:ended-started,frames,changedFrames,stableFrames,stableMs:ended-stableSince,first,last});
      };
      const timer=setTimeout(()=>finish(false,'timeout'),timeoutMs);
      const tick=now=>{
        last=sample();frames+=1;
        const key=JSON.stringify(last);
        if(key===lastKey)stableFrames+=1;
        else{stableFrames=0;stableSince=now;changedFrames+=1;lastKey=key;}
        if(!last.connected){finish(false,'comparison detached');return;}
        if(stableFrames>=requiredStableFrames && now-stableSince>=requiredStableMs){
          finish(true,'native scroll and layout stable');return;
        }
        frame=requestAnimationFrame(tick);
      };
      frame=requestAnimationFrame(tick);
    })''')


async def comparison_readability(page, name):
    """Read the actual scrollable UI; never hide the sticky composer for evidence."""
    panel = comparison(page)
    dock = page.get_by_role('form', name='傳送問題', exact=True).locator('..')
    await expect(dock).to_be_visible()
    dock_element = await dock.element_handle()
    ledger = await snapshot(page)
    evidence = {'viewportScreenshots': [], 'fields': []}
    evidence_path = OUT / f'{name}-readability.json'

    def save():
        evidence_path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding='utf-8')

    async def scroll(target, block):
        await target.evaluate('''(node, block) => new Promise(resolve => {
          node.scrollIntoView({block, inline:'nearest', behavior:'instant'});
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        })''', block)

    async def geometry(target):
        return await geometry_against_composer(target, dock_element)

    def readable(value):
        target, dock_box, viewport = value['target'], value['dock'], value['viewport']
        return (target['width'] > 0 and target['height'] > 0 and target['top'] >= 0
                and target['bottom'] < min(dock_box['top'], viewport['height'])
                and target['left'] >= 0 and target['right'] <= viewport['width'])

    await completed_revision_preview(page)
    evidence['settling'] = await settled_comparison_geometry(panel)
    save()
    assert evidence['settling']['settled'], f'Native comparison layout did not settle: {evidence["settling"]}'
    await scroll(panel, 'start')
    evidence['panelAtStart'] = await geometry(panel)
    evidence['headingAtStart'] = await geometry(panel.get_by_role('heading', name='這次提議改了什麼', exact=True))
    save()
    assert readable(evidence['headingAtStart']), evidence
    start_image = f'{name}-viewport-start.png'
    await page.screenshot(path=str(OUT / start_image), full_page=False)
    evidence['viewportScreenshots'].append(start_image)
    element_image = OUT / f'{name}.png'
    if readable(evidence['panelAtStart']):
        # Only an already unobscured element may be captured; no screenshot-only styling.
        await panel.screenshot(path=str(element_image))
        evidence['panelAfterElementScreenshot'] = await geometry(panel)
        save()
        assert readable(evidence['panelAfterElementScreenshot']), evidence
        evidence['elementScreenshot'] = element_image.name
    else:
        # Avoid retaining a stale, previously obscured element shot on local reruns.
        element_image.unlink(missing_ok=True)
        evidence['elementScreenshot'] = None
        evidence['elementScreenshotNote'] = 'Panel does not fit above the composer; use real start/end viewport evidence.'
    save()

    terms = panel.locator('dt')
    for index in range(await terms.count()):
        term = terms.nth(index)
        field = term.locator('..')  # The actual grid row includes dt and both old/new dd values.
        await scroll(field, 'center')
        value = await geometry(field)
        value.update({'label': await term.inner_text(), 'text': await field.inner_text()})
        value['readable'] = readable(value)
        evidence['fields'].append(value)
        save()
        assert value['readable'], f'Comparison field is obscured after native scrolling: {value}'
    if evidence['fields']:
        end_image = f'{name}-viewport-end.png'
        await page.screenshot(path=str(OUT / end_image), full_page=False)
        evidence['viewportScreenshots'].append(end_image)
        evidence['panelAtLastField'] = await geometry(panel)
    evidence['ledgerUnchangedWhileScrolling'] = await snapshot(page) == ledger
    save()
    assert evidence['ledgerUnchangedWhileScrolling'], 'Scrolling the comparison caused an API call or write'
    return evidence


async def comparison_case(page, name):
    # Independent fixed scenarios: no production comparison helper is used as an oracle.
    before = [dict(event) for event in ORIGINAL]
    after = [dict(event) for event in ORIGINAL]
    scenario = name.removesuffix('-320')
    if scenario == 'cross-day-rename':
        after[0].update(date='2026-11-13', endDate='2026-11-14', startTime='23:30', endTime='00:30')
        after[1]['title'] = '測試英文精讀'
        instruction = '第一筆改到11月13日23:30至11月14日00:30，第二筆改名為測試英文精讀，時間不變'
    elif scenario == 'reordered':
        after.reverse()
        instruction = '交換兩筆安排的順序，日期與時間不變'
    elif scenario == 'added':
        after.append({**ORIGINAL[1], 'title': '測試整理筆記', 'startTime': '22:00', 'endTime': '22:30'})
        instruction = '新增11月12日22:00至22:30的測試整理筆記，原安排保持不變'
    elif scenario == 'removed':
        after = after[:1]
        instruction = '新版只列出第一筆提議'
    elif scenario == 'same-name-ambiguous':
        for event in before + after:
            event['title'] = '測試讀書'
        after[0].update(startTime='21:00', endTime='21:30')
        after[1].update(startTime='22:00', endTime='22:30')
        instruction = '把兩段測試讀書改為21:00與22:00，各30分鐘'
    else:
        assert scenario == 'unchanged', scenario
        instruction = '保留兩筆安排的日期、時間與名稱'
    await page.evaluate('value => window.__agentQA.configurePlan(value)', {'originalEvents': before, 'revisedEvents': after})
    await start_plan(page, before)
    await expect(comparison(page)).to_have_count(0)
    await open_revision(page, keyboard=True, instruction=instruction)
    await page.keyboard.press('Enter')
    await expect(card_list(page)).to_have_count(len(before) + len(after))
    await idle(page)
    for index in range(len(before)):
        await expect(card_list(page).nth(index)).to_contain_text('已撤銷未執行提議')
        await expect(card_list(page).nth(index).get_by_role('button', name='確認', exact=True)).to_have_count(0)
    for index, event in enumerate(after):
        card = card_list(page).nth(len(before) + index)
        await expect(card.get_by_role('heading', name=event['title'], exact=True)).to_be_visible()
        await expect(card).to_contain_text(event['startTime'] + '–' + event['endTime'])
        button = card.get_by_role('button', name='確認', exact=True)
        if index == 0:
            await expect(button).to_be_enabled()
        else:
            await expect(button).to_be_disabled()
    await no_writes(page)
    ledger = await snapshot(page)
    assert actions(ledger) == ['ask', 'cancel', 'cancel', 'ask'], ledger
    request = [row for row in ledger['requests'] if row['action'] == 'ask'][-1]['body']
    assert request['history'] == [] and request['consent'] is True, request
    assert instruction in request['question'], request
    payload = request['question'].split('原安排：', 1)[1].split('\n修改條件：', 1)[0]
    assert json.loads(payload) == before, payload
    assert 'token' not in request['question'] and 'mutationId' not in request['question'], request
    panel = await comparison_before_cards(page)
    changed = panel.get_by_role('list', name='內容變更的提議', exact=True)
    if scenario == 'cross-day-rename':
        await expect(changed.get_by_role('listitem')).to_have_count(2)
        row = changed.get_by_role('listitem', name='測試微積分複習', exact=True)
        assert set(await row.locator('dt').all_text_contents()) == {'開始日期', '結束日期', '開始時間', '結束時間'}
        for label, old, new in [
            ('開始日期', '2026-11-12', '2026-11-13'),
            ('結束日期', '2026-11-12', '2026-11-14'),
            ('開始時間', '2026-11-12 19:00（台灣時間）', '2026-11-13 23:30（台灣時間）'),
            ('結束時間', '2026-11-12 19:30（台灣時間）', '2026-11-14 00:30（台灣時間）'),
        ]:
            await changed_field(row, label, old, new)
        rename = changed.get_by_role('listitem', name='測試英文精讀', exact=True)
        assert await rename.locator('dt').all_text_contents() == ['名稱']
        await changed_field(rename, '名稱', '測試英文閱讀', '測試英文精讀')
    else:
        await expect(changed).to_have_count(0)
    unchanged_count = {'cross-day-rename': 0, 'reordered': 2, 'added': 2, 'removed': 1, 'same-name-ambiguous': 0, 'unchanged': 2}[scenario]
    unchanged_note = panel.locator('p').filter(has_text='內容未變更：')
    await expect(unchanged_note).to_have_count(1 if unchanged_count else 0)
    if unchanged_count:
        await expect(unchanged_note).to_have_text(f'內容未變更：{unchanged_count} 項。')
    await expect(panel.get_by_text('兩份提議的安排內容相同。', exact=True)).to_have_count(
        1 if scenario in ['reordered', 'unchanged'] else 0)
    order_note = panel.get_by_text('顯示順序與原提議不同，請依新版確認卡的順序核對。', exact=True)
    await expect(order_note).to_have_count(1 if scenario == 'reordered' else 0)
    for label, expected in [('新提議新增', [after[-1]] if scenario == 'added' else []),
                            ('新提議不再列入', [before[-1]] if scenario == 'removed' else [])]:
        listing = panel.get_by_role('list', name=label, exact=True)
        if expected:
            await expect(listing.get_by_role('listitem')).to_have_count(1)
            event = expected[0]
            await expect(listing).to_contain_text(event['title'])
            await expect(listing).to_contain_text(f"{event['date']} {event['startTime']} – {event['date']} {event['endTime']}（台灣時間）")
        else:
            await expect(listing).to_have_count(0)
    if scenario == 'removed':
        await expect(panel.get_by_text('只表示新版提議未列入這些項目，不代表刪除既有行程。', exact=True)).to_be_visible()
    await expect(panel.get_by_role('heading', name='無法可靠逐筆對照', exact=True)).to_have_count(1 if scenario == 'same-name-ambiguous' else 0)
    for label, events in [('原提議行程', before), ('新提議行程', after)]:
        listing = panel.get_by_role('list', name=label, exact=True)
        if scenario == 'same-name-ambiguous':
            await expect(listing.get_by_role('listitem')).to_have_count(2)
            for index, event in enumerate(events):
                item = listing.get_by_role('listitem').nth(index)
                await expect(item).to_contain_text(event['title'])
                await expect(item).to_contain_text(
                    f"{event['date']} {event['startTime']} – {event['date']} {event['endTime']}（台灣時間）")
        else:
            await expect(listing).to_have_count(0)
    overflow = await no_overflow(page)
    panel_size = await panel.evaluate('node => ({client:node.clientWidth,scroll:node.scrollWidth})')
    assert panel_size['scroll'] <= panel_size['client'] + 1, panel_size
    readability = await comparison_readability(page, f'comparison-{name}-summary')
    await capture(page, f'comparison-{name}-zero-writes')
    assert await snapshot(page) == ledger, 'Comparison rendering or reading caused another API call or write'
    assert await page.evaluate("localStorage.getItem('campus.personal-imports.v1:platform%3Aqa-agent:fixture-campus-a')") is None
    return {'mode': 'native UI with configured fixed comparison data; no model or backend',
            'fixtureOriginal': before, 'fixtureRevised': after, 'summaryText': await panel.inner_text(),
            'overflow': overflow, 'panelSize': panel_size, 'ledgerUnchangedWhileReading': True,
            'readability': readability}


async def capture(page, name):
    await page.screenshot(path=str(OUT / f'{name}.png'), full_page=True)


async def no_overflow(page):
    dimensions = await page.evaluate('''() => ({ viewport: innerWidth,
      document: document.documentElement.scrollWidth, body: document.body.scrollWidth })''')
    assert dimensions['document'] <= dimensions['viewport'] + 1, dimensions
    assert dimensions['body'] <= dimensions['viewport'] + 1, dimensions
    return dimensions


async def native_case(page, width):
    await start_plan(page)
    await capture(page, f'native-{width}-initial')
    await open_revision(page, keyboard=True)
    overflow = await no_overflow(page)
    await capture(page, f'native-{width}-editor')
    await page.keyboard.press('Enter')
    await assert_preview(page)
    assert actions(await snapshot(page)) == ['ask', 'cancel', 'cancel', 'ask']
    await no_overflow(page)
    readability = await comparison_readability(page, f'native-{width}-comparison')
    await capture(page, f'native-{width}-preview-zero-writes')
    first = card_list(page).nth(2)
    second = card_list(page).nth(3)
    await first.get_by_role('button', name='確認', exact=True).click()
    await expect(first.get_by_label('行程執行回執', exact=True)).to_contain_text('已核對並加入個人行事曆')
    state = await snapshot(page)
    assert len(state['writes']) == 1, state
    await expect(second.get_by_role('button', name='確認', exact=True)).to_be_enabled()
    await second.get_by_role('button', name='確認', exact=True).click()
    await expect(second.get_by_label('行程執行回執', exact=True)).to_contain_text('已核對並加入個人行事曆')
    state = await snapshot(page)
    assert actions(state) == ['ask', 'cancel', 'cancel', 'ask', 'confirm', 'confirm'], state
    assert len(state['writes']) == 2 and len({w['mutationId'] for w in state['writes']}) == 2, state
    for index, write in enumerate(state['writes']):
        expected = {**ORIGINAL[index], **({'startTime': '21:00', 'endTime': '21:30'} if index else {})}
        assert {key: write['record'][key] for key in expected} == expected, write
        assert write['mutationId'].startswith('qa-revised-'), write
    local = await page.evaluate('''() => JSON.parse(localStorage.getItem(
      'campus.personal-imports.v1:platform%3Aqa-agent:fixture-campus-a'))''')
    assert len(local['records']) == 2 and local['records'] == state['records'], local
    assert local['sync']['enabled'] is False, local
    journal = await page.evaluate('''() => sessionStorage.getItem(
      'campus.assistant-execution.v1:platform%3Aqa-agent:fixture-campus-a:' + 'a'.repeat(43))''')
    assert journal is None, journal
    await no_overflow(page)
    await capture(page, f'native-{width}-confirmed')
    return {'mode': 'native UI with fixed fake API', 'keyboard': 'Enter opens editor; focus moves to textarea; Tab/Enter submits',
            'overflow': overflow, 'readability': readability}


async def ask_error_case(page, fault):
    await start_plan(page)
    await open_revision(page)
    await page.evaluate('fault => window.__agentQA.configure({revisionAsk:fault})', fault)
    await page.get_by_role('button', name='重新預覽', exact=True).click()
    await expect(page.get_by_role('alert').first).to_be_visible()
    await idle(page)
    await expect(page.get_by_role('textbox', name='修改條件', exact=True)).to_have_value(CHANGE)
    await expect(card_list(page)).to_have_count(2)
    for index in range(2):
        await expect(card_list(page).nth(index)).to_contain_text('已撤銷未執行提議')
        await expect(card_list(page).nth(index).get_by_role('button', name='確認', exact=True)).to_have_count(0)
    await no_writes(page)
    await expect(comparison(page)).to_have_count(0)
    assert actions(await snapshot(page)) == ['ask', 'cancel', 'cancel', 'ask']
    await capture(page, f'controlled-{fault}-retained-draft')
    await page.get_by_role('button', name='重新預覽', exact=True).click()
    await assert_preview(page, expected_asks=3)
    state = await snapshot(page)
    assert actions(state) == ['ask', 'cancel', 'cancel', 'ask', 'ask'], state
    await no_writes(page)
    return {'mode': f'controlled fake API revision {fault}; successful retry does not recancel or confirm'}


async def unknown_case(page):
    await start_plan(page)
    await open_revision(page)
    await page.evaluate('window.__agentQA.configure({unknownCancellation:true})')
    await page.get_by_role('button', name='重新預覽', exact=True).click()
    await expect(card_list(page).nth(0).get_by_role('button', name='重新核對結果', exact=True)).to_be_enabled()
    await idle(page)
    state = await snapshot(page)
    assert actions(state) == ['ask', 'cancel', 'reconcile'], state
    await expect(page.get_by_role('button', name='重新預覽', exact=True)).to_be_disabled()
    await expect(page.get_by_role('textbox', name='修改條件', exact=True)).to_have_value(CHANGE)
    await no_writes(page)
    await capture(page, 'controlled-unknown-paused')
    await page.evaluate('window.__agentQA.configure({unknownCancellation:false})')
    await card_list(page).nth(0).get_by_role('button', name='重新核對結果', exact=True).click()
    await expect(card_list(page).nth(0)).to_contain_text('已撤銷未執行提議')
    assert actions(await snapshot(page)) == ['ask', 'cancel', 'reconcile', 'reconcile']
    await page.get_by_role('button', name='重新預覽', exact=True).click()
    await assert_preview(page)
    assert actions(await snapshot(page)) == ['ask', 'cancel', 'reconcile', 'reconcile', 'cancel', 'ask']
    await capture(page, 'controlled-unknown-recovered')
    return {'mode': 'controlled cancellation response loss + failed readback; explicit reconcile then resume'}


async def late_school_case(page):
    await start_plan(page)
    await open_revision(page)
    await page.evaluate('window.__agentQA.configure({holdAsk:true})')
    await page.get_by_role('button', name='重新預覽', exact=True).click()
    await page.wait_for_function('window.__agentQA.snapshot().waiting')
    await page.get_by_role('combobox', name='QA 校園', exact=True).select_option('fixture-campus-b')
    await expect(card_list(page)).to_have_count(0)
    await page.evaluate('window.__agentQA.release()')
    await page.wait_for_function("window.__agentQA.requests.filter(row=>row.action==='ask').every(row=>row.outcome)")
    await idle(page)
    await expect(card_list(page)).to_have_count(0)
    await expect(page.get_by_role('textbox', name='修改條件', exact=True)).to_have_count(0)
    await no_writes(page)
    state = await snapshot(page)
    assert actions(state) == ['ask', 'cancel', 'cancel', 'ask'], state
    assert state['school'] == 'fixture-campus-b', state
    await capture(page, 'controlled-late-preview-school-switch')
    return {'mode': 'controlled delayed preview ignores AbortSignal; old response must not enter new school UI'}


async def double_case(page):
    await start_plan(page)
    await open_revision(page)
    await page.evaluate('window.__agentQA.configure({holdCancel:true})')
    # Two native mouse clicks while the first cancellation remains unresolved.
    await page.get_by_role('button', name='重新預覽', exact=True).dblclick()
    await page.wait_for_function('window.__agentQA.snapshot().waiting')
    assert actions(await snapshot(page)) == ['ask', 'cancel']
    await expect(page.get_by_role('button', name='正在重新預覽…', exact=True)).to_be_disabled()
    await page.evaluate('window.__agentQA.release()')
    await assert_preview(page)
    assert actions(await snapshot(page)) == ['ask', 'cancel', 'cancel', 'ask']
    return {'mode': 'native double click with controlled delayed first cancellation; exactly one chain'}


def protection_checkbox(page, index):
    return page.get_by_role('form', name='修改安排再預覽', exact=True).get_by_role(
        'checkbox', name=re.compile(rf'^保留原樣\s+第\s+{index + 1}\s+項(?:\s|$)'))


async def select_protection(page, events, indices, keyboard=False):
    for index, event in enumerate(events):
        checkbox = protection_checkbox(page, index)
        await expect(checkbox).to_have_accessible_name(re.compile(
            re.escape(event['title']) + r'.*' + event['date'] + r'.*' + event['startTime'] + r'.*' + event['endTime']))
    if keyboard:
        # Native Space toggles the first checkbox; Tab visits the next checkbox and textarea.
        assert indices == [0] and len(events) == 2
        await protection_checkbox(page, 0).focus()
        await page.keyboard.press('Space')
        await expect(protection_checkbox(page, 0)).to_be_checked()
        await page.keyboard.press('Tab')
        await expect(protection_checkbox(page, 1)).to_be_focused()
        await page.keyboard.press('Tab')
        await expect(page.get_by_role('textbox', name='修改條件', exact=True)).to_be_focused()
    else:
        for index in indices:
            await protection_checkbox(page, index).check()
    for index in range(len(events)):
        await expect(protection_checkbox(page, index)).to_be_checked(checked=index in indices)


async def protected_preview(page, before, after, indices, instruction, expected_actions):
    await expect(card_list(page)).to_have_count(len(before) + len(after))
    await idle(page)
    await completed_revision_preview(page)
    for index in range(len(before)):
        old = card_list(page).nth(index)
        await expect(old).to_contain_text('已撤銷未執行提議')
        await expect(old.get_by_role('button', name='確認', exact=True)).to_have_count(0)
    for index, event in enumerate(after):
        card = card_list(page).nth(len(before) + index)
        await expect(card.get_by_role('heading', name=event['title'], exact=True)).to_be_visible()
        await expect(card).to_contain_text(event['startTime'] + '–' + event['endTime'])
        button = card.get_by_role('button', name='確認', exact=True)
        if index == 0:
            await expect(button).to_be_enabled()
        else:
            await expect(button).to_be_disabled()
    await expect(comparison(page)).to_be_visible()
    await no_writes(page)
    state = await snapshot(page)
    assert actions(state) == expected_actions, state
    asks = [row for row in state['requests'] if row['action'] == 'ask']
    body = asks[-1]['body']
    assert body['planProtection'] == {'originalEvents': before, 'protectedIndices': indices}, body
    assert body['history'] == [] and body['consent'] is True, body
    assert instruction in body['question'], body
    payload = body['question'].split('原安排：', 1)[1].split('\n修改條件：', 1)[0]
    assert json.loads(payload) == before, payload
    assert 'token' not in body['question'] and 'mutationId' not in body['question'], body
    for row in state['requests']:
        if row['action'] == 'cancel':
            assert row['body']['token'] not in body['question'], body
    assert state['revoked'] == [f'qa-original-{index + 1}' for index in range(len(before))], state
    fresh = state['previews'][-1]['cards']
    previous_ids = {card['mutationId'] for preview in state['previews'][:-1] for card in preview['cards']}
    previous_tokens = {card['token'] for preview in state['previews'][:-1] for card in preview['cards']}
    assert len({card['mutationId'] for card in fresh}) == len(after), fresh
    assert all(card['mutationId'] not in previous_ids and card['token'] not in previous_tokens for card in fresh), state
    assert [card['args'] for card in fresh] == after, fresh
    return state


async def confirm_protected_preview(page, before, after, request_prefix):
    for index in range(len(after)):
        card = card_list(page).nth(len(before) + index)
        await card.get_by_role('button', name='確認', exact=True).click()
        await expect(card.get_by_label('行程執行回執', exact=True)).to_contain_text('已核對並加入個人行事曆')
        assert len((await snapshot(page))['writes']) == index + 1
    state = await snapshot(page)
    assert actions(state) == request_prefix + ['confirm'] * len(after), state
    assert len({write['mutationId'] for write in state['writes']}) == len(after), state
    for write, event in zip(state['writes'], after):
        assert write['mutationId'].startswith('qa-revised-2-'), write
        assert {key: write['record'][key] for key in event} == event, write
    local = await page.evaluate("JSON.parse(localStorage.getItem('campus.personal-imports.v1:platform%3Aqa-agent:fixture-campus-a'))")
    assert local['records'] == state['records'] and local['sync']['enabled'] is False, local
    journal = await page.evaluate("sessionStorage.getItem('campus.assistant-execution.v1:platform%3Aqa-agent:fixture-campus-a:'+'a'.repeat(43))")
    assert journal is None, journal


async def protected_good_case(page, name):
    before = [dict(event) for event in ORIGINAL]
    indices, instruction = [0], CHANGE
    after = [dict(before[0]), {**before[1], 'startTime': '21:00', 'endTime': '21:30'}]
    if name == 'multiple-reordered':
        before.append({**before[1], 'title': '測試整理筆記', 'startTime': '22:00', 'endTime': '22:30'})
        indices = [0, 2]
        after = [dict(before[2]), after[1], dict(before[0])]
        instruction = '第一及第三筆保留原樣，第二筆改到21:00至21:30，新版順序為第三、第二、第一筆'
    await page.evaluate('value => window.__agentQA.configurePlan(value)', {'originalEvents': before, 'revisedEvents': after})
    await start_plan(page, before)
    await open_revision(page, keyboard=True, instruction=instruction)
    await select_protection(page, before, indices, keyboard=len(before) == 2)
    await no_overflow(page)
    await page.screenshot(path=str(OUT / f'protected-{name}-selection-viewport.png'), full_page=False)
    focused_action = None
    if len(before) == 2:
        button = page.get_by_role('button', name='重新預覽', exact=True)
        dock = page.get_by_role('form', name='傳送問題', exact=True).locator('..')
        before_tab = await geometry_against_composer(button, await dock.element_handle())
        # Observe only this button instance; every product call delegates unchanged to native.
        await button.evaluate('''node => {
          const original=node.scrollIntoView, requests=[];
          const sample=target=>{const r=target.getBoundingClientRect(), scrolling=document.scrollingElement;
            return {button:{top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height},
              scroll:{x:scrollX,y:scrollY},documentScrollingElement:scrolling?{
                scrollHeight:scrolling.scrollHeight,clientHeight:scrolling.clientHeight,scrollTop:scrolling.scrollTop}:null};};
          node.__qaScrollRequests=requests;
          node.scrollIntoView=function(options){
            const request={options:options ?? null,before:sample(this)};
            requests.push(request);
            try {return original.call(this,options);}
            finally {request.after=sample(this);}
          };
        }''')
        await page.keyboard.press('Tab')
        focused_action = await focused_action_readability(page, button, f'protected-{name}-preview-focus', before_tab)
        await page.keyboard.press('Enter')
    else:
        await page.get_by_role('button', name='重新預覽', exact=True).click()
    prefix = ['ask'] + ['cancel'] * len(before) + ['ask']
    await protected_preview(page, before, after, indices, instruction, prefix)
    readability = await comparison_readability(page, f'protected-{name}-comparison')
    await capture(page, f'protected-{name}-zero-writes')
    await confirm_protected_preview(page, before, after, prefix)
    await capture(page, f'protected-{name}-confirmed')
    return {'mode': 'native protection selection and manual confirmations against fixed fake API',
            'protectedIndices': indices, 'fixtureOriginal': before, 'fixtureRevised': after,
            'readability': readability, 'focusedPreview': focused_action}


async def protected_all_case(page):
    await start_plan(page)
    await open_revision(page, keyboard=True)
    await protection_checkbox(page, 0).focus()
    await page.keyboard.press('Space')
    await page.keyboard.press('Tab')
    await expect(protection_checkbox(page, 1)).to_be_focused()
    await page.keyboard.press('Space')
    for index in range(2):
        await expect(protection_checkbox(page, index)).to_be_checked()
    await expect(page.get_by_role('button', name='重新預覽', exact=True)).to_be_disabled()
    await expect(page.get_by_text('全部項目已勾選保留原樣，不需重新預覽；原提議保持不變。', exact=True)).to_be_visible()
    await page.keyboard.press('Tab')
    await expect(page.get_by_role('textbox', name='修改條件', exact=True)).to_be_focused()
    await page.keyboard.press('Tab')
    focused_return = await focused_action_readability(
        page, page.get_by_role('button', name='回到原提議', exact=True), 'protected-all-320-return-focus')
    await page.keyboard.press('Enter')
    await expect(page.get_by_role('form', name='修改安排再預覽', exact=True)).to_have_count(0)
    await expect(page.get_by_role('button', name='修改時間或條件', exact=True)).to_be_focused()
    await expect(card_list(page).nth(0).get_by_role('button', name='確認', exact=True)).to_be_enabled()
    await expect(card_list(page).nth(1).get_by_role('button', name='確認', exact=True)).to_be_disabled()
    await no_writes(page)
    state = await snapshot(page)
    assert actions(state) == ['ask'] and state['revoked'] == [], state
    await expect(comparison(page)).to_have_count(0)
    await no_overflow(page)
    await capture(page, 'protected-all-original-cards-retained')
    return {'mode': 'native Tab/Space selects every item; disabled preview and Enter returns to original cards',
            'extraAsk': 0, 'cancel': 0, 'writes': 0, 'focusedReturn': focused_return}


async def protected_bad_case(page, fault):
    # Deliberately bypass the real server guard with valid fake card metadata.
    # This verifies client defense only; real server 422/retirement has separate tests.
    before = [dict(event) for event in ORIGINAL]
    good = [dict(before[0]), {**before[1], 'startTime': '21:00', 'endTime': '21:30'}]
    if fault == 'missing':
        bad = [dict(good[1])]
    elif fault == 'changed-time':
        bad = [{**before[0], 'startTime': '19:15', 'endTime': '19:45'}, dict(good[1])]
    elif fault == 'duplicate':
        bad = [dict(before[0]), dict(before[0]), dict(good[1])]
    else:
        assert fault == 'same-name-ambiguous', fault
        for event in before + good:
            event['title'] = '測試讀書'
        bad = [dict(event) for event in good]
        good = [dict(before[1]), dict(before[0])]  # Exact same-name events may be reordered.
    await page.evaluate('value => window.__agentQA.configurePlan(value)', {'originalEvents': before, 'revisedEvents': bad})
    await start_plan(page, before)
    await open_revision(page, instruction=CHANGE)
    await select_protection(page, before, [0])
    await page.get_by_role('button', name='重新預覽', exact=True).click()
    await expect(page.get_by_role('alert').first).to_contain_text('新預覽不符合保留條件')
    await idle(page)
    await expect(card_list(page)).to_have_count(2)
    for index in range(2):
        await expect(card_list(page).nth(index)).to_contain_text('已撤銷未執行提議')
        await expect(card_list(page).nth(index).get_by_role('button', name='確認', exact=True)).to_have_count(0)
    await expect(comparison(page)).to_have_count(0)
    await expect(page.get_by_role('textbox', name='修改條件', exact=True)).to_have_value(CHANGE)
    await expect(protection_checkbox(page, 0)).to_be_checked()
    await expect(protection_checkbox(page, 1)).not_to_be_checked()
    await no_writes(page)
    state = await snapshot(page)
    assert actions(state) == ['ask', 'cancel', 'cancel', 'ask'], state
    assert state['requests'][-1]['outcome'] == '200', 'This case must exercise the client, not a fake server 422'
    await capture(page, f'controlled-protection-{fault}-rejected')
    await page.evaluate('events => window.__agentQA.configurePlan({revisedEvents:events})', good)
    await page.get_by_role('button', name='重新預覽', exact=True).click()
    state = await protected_preview(page, before, good, [0], CHANGE, ['ask', 'cancel', 'cancel', 'ask', 'ask'])
    for row in state['requests']:
        if row['action'] == 'ask' and 'planProtection' in row['body']:
            assert row['body']['planProtection'] == {'originalEvents': before, 'protectedIndices': [0]}, row
    await no_overflow(page)
    await capture(page, f'controlled-protection-{fault}-fresh-retry')
    return {'mode': 'controlled bad API response bypasses server protection; client rejects whole candidate and keeps selections',
            'fault': fault, 'fixtureRejected': bad, 'fixtureRetry': good, 'protectedIndices': [0], 'writes': 0}


async def protected_partial_duplicate_case(page):
    before = [dict(ORIGINAL[0]), dict(ORIGINAL[0]), dict(ORIGINAL[1])]
    await page.evaluate('events => window.__agentQA.configurePlan({originalEvents:events})', before)
    await start_plan(page, before)
    instruction = '只修改第三項，保留第一項'
    await open_revision(page, instruction=instruction)
    await select_protection(page, before, [0])
    await page.get_by_role('button', name='重新預覽', exact=True).click()
    await expect(page.get_by_role('alert')).to_contain_text('完全相同的行程需一起標記保留')
    await expect(page.get_by_role('textbox', name='修改條件', exact=True)).to_have_value(instruction)
    await expect(protection_checkbox(page, 0)).to_be_checked()
    await expect(card_list(page)).to_have_count(3)
    await expect(card_list(page).nth(0).get_by_role('button', name='確認', exact=True)).to_be_enabled()
    await no_writes(page)
    state = await snapshot(page)
    assert actions(state) == ['ask'] and state['revoked'] == [], state
    await expect(comparison(page)).to_have_count(0)
    await capture(page, 'protected-partial-exact-duplicate-preflight')
    return {'mode': 'partial selection of exact duplicate group rejected before any cancellation or new ask', 'writes': 0}


async def protected_unknown_case(page):
    await start_plan(page)
    await open_revision(page)
    await select_protection(page, ORIGINAL, [0])
    await page.evaluate('window.__agentQA.configure({unknownCancellation:true})')
    await page.get_by_role('button', name='重新預覽', exact=True).click()
    await expect(card_list(page).nth(0).get_by_role('button', name='重新核對結果', exact=True)).to_be_enabled()
    await idle(page)
    assert actions(await snapshot(page)) == ['ask', 'cancel', 'reconcile']
    await expect(protection_checkbox(page, 0)).to_be_checked()
    await expect(page.get_by_role('textbox', name='修改條件', exact=True)).to_have_value(CHANGE)
    await expect(page.get_by_role('button', name='重新預覽', exact=True)).to_be_disabled()
    await no_writes(page)
    await capture(page, 'protected-unknown-cancel-paused')
    await page.evaluate('window.__agentQA.configure({unknownCancellation:false})')
    await card_list(page).nth(0).get_by_role('button', name='重新核對結果', exact=True).click()
    await expect(card_list(page).nth(0)).to_contain_text('已撤銷未執行提議')
    assert actions(await snapshot(page)) == ['ask', 'cancel', 'reconcile', 'reconcile']
    await page.get_by_role('button', name='重新預覽', exact=True).click()
    after = [dict(ORIGINAL[0]), {**ORIGINAL[1], 'startTime': '21:00', 'endTime': '21:30'}]
    await protected_preview(page, ORIGINAL, after, [0], CHANGE, ['ask', 'cancel', 'reconcile', 'reconcile', 'cancel', 'ask'])
    await capture(page, 'protected-unknown-cancel-recovered')
    return {'mode': 'controlled cancellation loss; protected choices survive explicit reconcile and resume', 'writes': 0}


async def protected_late_scope_case(page, scope):
    await start_plan(page)
    await open_revision(page)
    await select_protection(page, ORIGINAL, [0])
    await page.evaluate('window.__agentQA.configure({holdAsk:true})')
    await page.get_by_role('button', name='重新預覽', exact=True).click()
    await page.wait_for_function('window.__agentQA.snapshot().waiting')
    if scope == 'account':
        await page.get_by_role('combobox', name='QA 帳號', exact=True).select_option('qa-agent-b')
    else:
        assert scope == 'school', scope
        await page.get_by_role('combobox', name='QA 校園', exact=True).select_option('fixture-campus-b')
    await expect(card_list(page)).to_have_count(0)
    await page.evaluate('window.__agentQA.release()')
    await page.wait_for_function("window.__agentQA.requests.filter(row=>row.action==='ask').every(row=>row.outcome)")
    await idle(page)
    await expect(card_list(page)).to_have_count(0)
    await expect(comparison(page)).to_have_count(0)
    await expect(page.get_by_role('form', name='修改安排再預覽', exact=True)).to_have_count(0)
    await expect(page.get_by_role('checkbox', name=re.compile('保留原樣'))).to_have_count(0)
    await expect(page.get_by_role('checkbox', name=re.compile('同意在本次對話'))).not_to_be_checked()
    await no_writes(page)
    state = await snapshot(page)
    assert actions(state) == ['ask', 'cancel', 'cancel', 'ask'], state
    assert state['account'] == ('qa-agent-b' if scope == 'account' else 'qa-agent'), state
    assert state['school'] == ('fixture-campus-b' if scope == 'school' else 'fixture-campus-a'), state
    bound = [row for row in state['requests'] if row['action'] == 'ask'][-1]
    assert bound['account'] == 'qa-agent' and bound['body']['schoolId'] == 'fixture-campus-a', bound
    assert bound['body']['planProtection'] == {'originalEvents': ORIGINAL, 'protectedIndices': [0]}, bound
    for account in ['qa-agent', 'qa-agent-b']:
        for school in ['fixture-campus-a', 'fixture-campus-b']:
            assert await page.evaluate('key => localStorage.getItem(key)', f'campus.personal-imports.v1:platform%3A{account}:{school}') is None
    await capture(page, f'controlled-protected-late-{scope}')
    return {'mode': 'controlled delayed protected preview ignores AbortSignal; stale scope response must remain invisible',
            'scopeSwitch': scope, 'writes': 0}


DRAFT_PREFIX = 'campus.assistant-plan-draft.v1:'


def draft_offer(page):
    return page.get_by_role('region', name='未送出的修訂草稿', exact=True)


async def inspect_drafts(page):
    return await page.evaluate('window.__agentQA.inspectDrafts()')


async def audit_draft(page, events=ORIGINAL, instruction=CHANGE, indices=None):
    indices = [0] if indices is None else indices
    rows = await inspect_drafts(page)
    assert len(rows) == 1, rows
    row, value = rows[0], json.loads(rows[0]['value'])
    assert re.fullmatch(re.escape(DRAFT_PREFIX) + r'[a-f0-9]{64}', row['key']), row
    assert set(value) == {'version', 'id', 'scopeKey', 'source', 'instruction', 'protectedIndices', 'savedAt'}, value
    assert row['key'] == DRAFT_PREFIX + value['scopeKey'], value
    assert set(value['source']) == {'key', 'events'} and re.fullmatch(r'[a-f0-9]{64}', value['source']['key']), value
    assert value['source']['events'] == events and value['instruction'] == instruction and value['protectedIndices'] == indices, value
    for event in value['source']['events']:
        assert set(event) <= {'title', 'date', 'endDate', 'allDay', 'startTime', 'endTime'}, event
    for forbidden in ['token', 'mutationId', 'context', 'conversationId', 'consent', 'turn', 'accountId', 'schoolId']:
        assert f'"{forbidden}"' not in row['value'], row
    assert 'fixture-token-' not in row['value'] and 'a' * 43 not in row['value'], row
    return {'key': row['key'], 'payload': value, 'containsExecutionAuthorization': False}


async def seed_reload_draft(page):
    state = await snapshot(page)
    assert state['persistentBackend'] is True and state['pageEpoch'] == 1, state
    await start_plan(page)
    await open_revision(page, keyboard=True)
    await select_protection(page, ORIGINAL, [0], keyboard=True)
    value = await audit_draft(page)
    await no_writes(page)
    return value


async def true_reload(page, name, expected_extra=None):
    expected_extra = [] if expected_extra is None else expected_extra
    before = await snapshot(page)
    before_drafts = await inspect_drafts(page)
    await page.reload(wait_until='networkidle')
    await page.wait_for_function('epoch => window.__agentQA.pageEpoch > epoch', arg=before['pageEpoch'])
    await expect(page.get_by_role('checkbox', name=re.compile('同意在本次對話'))).to_be_enabled()
    expected = actions(before) + expected_extra
    await page.wait_for_function("expected => JSON.stringify(window.__agentQA.snapshot().requests.filter(r=>r.action!=='capability').map(r=>r.action))===JSON.stringify(expected)", arg=expected)
    await idle(page)
    after = await snapshot(page)
    assert actions(after) == expected, after
    assert after['pageEpoch'] == before['pageEpoch'] + 1, after
    evidence = {'navigation': 'actual page.reload()', 'before': before, 'after': after,
                'productDraftsBefore': before_drafts, 'productDraftsAfter': await inspect_drafts(page)}
    (OUT / f'{name}-reload.json').write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding='utf-8')
    return evidence


async def restore_draft(page, instruction=CHANGE):
    panel = draft_offer(page)
    await expect(panel).to_be_visible()
    # Before explicit recovery the saved instruction and event snapshot are absent from DOM.
    await expect(panel.get_by_role('textbox')).to_have_count(0)
    await expect(panel.get_by_role('list', name='草稿的原提議內容', exact=True)).to_have_count(0)
    assert instruction not in await panel.inner_text()
    for event in ORIGINAL:
        assert event['title'] not in await panel.inner_text()
    before = await snapshot(page)
    await panel.get_by_role('button', name='恢復修訂草稿', exact=True).focus()
    await page.keyboard.press('Enter')
    field = panel.get_by_role('textbox', name='已恢復的修改條件', exact=True)
    await expect(field).to_have_value(instruction)
    await expect(field).to_be_focused()
    await expect(page.get_by_role('checkbox', name=re.compile('同意在本次對話'))).not_to_be_checked()
    assert (await snapshot(page))['requests'] == before['requests'], 'Explicit content recovery sent an API request'
    return field


async def open_empty_revision(page):
    await page.get_by_role('button', name='修改時間或條件', exact=True).first.click()
    field = page.get_by_role('textbox', name='修改條件', exact=True)
    await expect(field).to_be_focused()
    await expect(field).to_have_value('')
    return field


async def apply_restored_draft(page, expected_indices, instruction=CHANGE):
    before = await snapshot(page)
    await open_empty_revision(page)
    await page.get_by_role('button', name='套用已恢復的草稿', exact=True).focus()
    await page.keyboard.press('Enter')
    field = page.get_by_role('textbox', name='修改條件', exact=True)
    await expect(field).to_have_value(instruction)
    await expect(field).to_be_focused()
    for index in range(2):
        await expect(protection_checkbox(page, index)).to_be_checked(checked=index in expected_indices)
    assert (await snapshot(page))['requests'] == before['requests'], 'Applying recovered content sent an API request'


async def draft_happy_case(page):
    original_audit = await seed_reload_draft(page)
    first = await snapshot(page)
    first_ids = {card['mutationId'] for card in first['previews'][-1]['cards']}
    reload_evidence = await true_reload(page, 'draft-happy-320')
    await expect(card_list(page)).to_have_count(0)
    await restore_draft(page)
    await no_overflow(page)
    await page.screenshot(path=str(OUT / 'draft-happy-320-restored-viewport.png'), full_page=False)
    await start_plan(page)  # The user explicitly grants consent and asks for fresh cards.
    fresh = (await snapshot(page))['previews'][-1]['cards']
    assert not first_ids.intersection(card['mutationId'] for card in fresh), fresh
    await apply_restored_draft(page, [0])
    applied_audit = await audit_draft(page)
    assert applied_audit['payload']['source']['key'] != original_audit['payload']['source']['key'], applied_audit
    await page.get_by_role('button', name='重新預覽', exact=True).click()
    await expect(card_list(page)).to_have_count(4)
    await completed_revision_preview(page)
    await no_writes(page)
    state = await snapshot(page)
    assert actions(state) == ['ask', 'ask', 'cancel', 'cancel', 'ask'], state
    assert set(state['revoked']) == {card['mutationId'] for card in fresh}, state
    assert await inspect_drafts(page) == [], 'A submitted revision must not return as an unsent draft'
    revised = state['previews'][-1]['cards']
    assert not {card['mutationId'] for card in fresh}.intersection(card['mutationId'] for card in revised), state
    assert state['requests'][-1]['body']['planProtection'] == {'originalEvents': ORIGINAL, 'protectedIndices': [0]}, state
    readability = await comparison_readability(page, 'draft-happy-320-comparison')
    for index in range(2):
        card = card_list(page).nth(2 + index)
        await card.get_by_role('button', name='確認', exact=True).click()
        await expect(card.get_by_label('行程執行回執', exact=True)).to_contain_text('已核對並加入個人行事曆')
        assert len((await snapshot(page))['writes']) == index + 1
    state = await snapshot(page)
    assert actions(state) == ['ask', 'ask', 'cancel', 'cancel', 'ask', 'confirm', 'confirm'], state
    assert [write['mutationId'] for write in state['writes']] == [card['mutationId'] for card in revised], state
    assert [write['record']['startTime'] for write in state['writes']] == ['19:00', '21:00'], state
    local = await page.evaluate("JSON.parse(localStorage.getItem('campus.personal-imports.v1:platform%3Aqa-agent:fixture-campus-a'))")
    assert local['records'] == state['records'] and local['sync']['enabled'] is False, local
    await no_overflow(page)
    await capture(page, 'draft-happy-320-confirmed')
    return {'mode': 'true reload with fixed persistent QA backend; explicit restore/apply/preview/manual confirmation',
            'originalDraft': original_audit, 'appliedDraft': applied_audit, 'reload': reload_evidence, 'readability': readability}


async def draft_changed_source_case(page):
    audit = await seed_reload_draft(page)
    await true_reload(page, 'draft-changed-source')
    await restore_draft(page)
    changed = [dict(ORIGINAL[0]), {**ORIGINAL[1], 'startTime': '22:00', 'endTime': '22:30'}]
    await page.evaluate('events => window.__agentQA.configurePlan({originalEvents:events})', changed)
    await start_plan(page, changed)
    await apply_restored_draft(page, [])
    await expect(page.get_by_text('已帶入修改文字；目前提議與草稿來源不同，請重新選擇保留項目。', exact=True).first).to_be_visible()
    after = await audit_draft(page, changed, indices=[])
    await no_writes(page)
    assert actions(await snapshot(page)) == ['ask', 'ask']
    await capture(page, 'draft-changed-source-text-only')
    return {'mode': 'same event names with changed schedule restore text only; preservation choices require reselection', 'before': audit, 'after': after}


async def draft_clear_case(page, operation):
    await seed_reload_draft(page)
    if operation == 'clear':
        before = await inspect_drafts(page)
        await page.get_by_role('button', name='收起修改', exact=True).click()
        assert await inspect_drafts(page) == before, 'Collapsing the editor lost its unfinished draft'
        await page.get_by_role('button', name='修改時間或條件', exact=True).click()
        await page.get_by_role('button', name='清除修改內容', exact=True).click()
        await expect(page.get_by_role('textbox', name='修改條件', exact=True)).to_have_value('')
        await expect(protection_checkbox(page, 0)).not_to_be_checked()
        await expect(card_list(page).nth(0).get_by_role('button', name='確認', exact=True)).to_be_enabled()
    else:
        assert operation == 'discard'
        await true_reload(page, 'draft-before-discard')
        await draft_offer(page).get_by_role('button', name='捨棄修訂草稿', exact=True).click()
    assert await inspect_drafts(page) == []
    await true_reload(page, f'draft-after-{operation}')
    await expect(draft_offer(page)).to_have_count(0)
    await no_writes(page)
    state = await snapshot(page)
    assert actions(state) == ['ask'] and state['revoked'] == [], state
    return {'mode': f'explicit {operation}; actual reload does not offer a removed draft', 'writes': 0}


async def draft_quota_case(page):
    stored = await seed_reload_draft(page)
    await true_reload(page, 'draft-before-quota')
    recovered = await restore_draft(page)
    await page.evaluate('window.__agentQA.configure({draftSetDenied:true})')
    changed = CHANGE + '，保留這段尚未寫入的文字'
    await recovered.fill(changed)
    await expect(recovered).to_have_value(changed)
    await expect(draft_offer(page).get_by_role('status')).to_contain_text('尚未確認儲存')
    assert (await audit_draft(page)) == stored, 'Quota failure replaced the last durable draft'
    await start_plan(page)
    await open_empty_revision(page)
    await page.get_by_role('button', name='套用已恢復的草稿', exact=True).click()
    await expect(page.get_by_role('alert')).to_contain_text('尚未確認儲存')
    await expect(page.get_by_role('textbox', name='修改條件', exact=True)).to_have_value('')
    await expect(recovered).to_have_value(changed)
    await expect(page.get_by_role('button', name='重新預覽', exact=True)).to_be_disabled()
    await no_writes(page)
    assert actions(await snapshot(page)) == ['ask', 'ask']
    await capture(page, 'controlled-draft-quota-memory-retained')
    await page.evaluate('window.__agentQA.configure({draftSetDenied:false})')
    await page.get_by_role('button', name='套用已恢復的草稿', exact=True).click()
    await expect(page.get_by_role('textbox', name='修改條件', exact=True)).to_have_value(changed)
    saved = await audit_draft(page, instruction=changed)
    return {'mode': 'draft-prefix-only controlled quota failure retains memory and blocks applying unsaved recovery', 'durableBefore': stored, 'durableAfterRetry': saved}


async def draft_remove_failure_case(page):
    saved = await seed_reload_draft(page)
    await page.evaluate('window.__agentQA.configure({draftRemoveDenied:true})')
    await page.get_by_role('button', name='清除修改內容', exact=True).click()
    await expect(page.get_by_role('alert')).to_contain_text('尚未確認清除')
    await expect(page.get_by_role('textbox', name='修改條件', exact=True)).to_have_value(CHANGE)
    await expect(protection_checkbox(page, 0)).to_be_checked()
    await page.get_by_role('button', name='重新預覽', exact=True).click()
    await expect(page.get_by_role('alert').first).to_contain_text('尚未確認清除')
    await no_writes(page)
    state = await snapshot(page)
    assert actions(state) == ['ask'] and state['revoked'] == [], state
    assert await audit_draft(page) == saved
    await capture(page, 'controlled-draft-remove-blocks-send')
    await page.evaluate('window.__agentQA.configure({draftRemoveDenied:false})')
    await page.get_by_role('button', name='清除修改內容', exact=True).click()
    assert await inspect_drafts(page) == []
    await true_reload(page, 'draft-remove-retry')
    await expect(draft_offer(page)).to_have_count(0)
    return {'mode': 'draft-prefix-only remove failure preserves draft and blocks cancellation/new preview until cleanup succeeds', 'writes': 0}


async def draft_unreadable_case(page):
    saved = await seed_reload_draft(page)
    await page.evaluate('window.__agentQA.configure({draftGetDenied:true})')
    await true_reload(page, 'draft-read-denied')
    await expect(draft_offer(page)).to_have_count(0)
    await expect(page.get_by_role('status').filter(has_text='無法讀取修改草稿')).to_be_visible()
    assert CHANGE not in await page.locator('body').inner_text()
    assert await audit_draft(page) == saved
    await no_writes(page)
    await page.evaluate('window.__agentQA.configure({draftGetDenied:false})')
    await true_reload(page, 'draft-read-restored')
    await expect(draft_offer(page)).to_be_visible()
    return {'mode': 'draft-prefix-only read denial hides content, retains data and does not affect execution journal access', 'storedDraft': saved}


async def draft_journal_unreadable_case(page):
    saved = await seed_reload_draft(page)
    await page.evaluate('window.__agentQA.configure({journalGetDenied:true})')
    await true_reload(page, 'draft-journal-read-denied')
    await restore_draft(page)
    await start_plan(page)  # Read-only proposing remains a separate explicit user action.
    await open_empty_revision(page)
    await page.get_by_role('button', name='套用已恢復的草稿', exact=True).click()
    await expect(page.get_by_role('alert').filter(has_text='目前提議或舊操作尚未完成核對')).to_be_visible()
    await expect(page.get_by_role('textbox', name='修改條件', exact=True)).to_have_value('')
    await expect(page.get_by_role('textbox', name='已恢復的修改條件', exact=True)).to_have_value(CHANGE)
    await expect(protection_checkbox(page, 0)).not_to_be_checked()
    assert await audit_draft(page) == saved
    await no_writes(page)
    assert actions(await snapshot(page)) == ['ask', 'ask']
    await capture(page, 'controlled-journal-read-blocks-draft-apply')
    await draft_offer(page).get_by_role('button', name='捨棄修訂草稿', exact=True).click()
    await expect(draft_offer(page)).to_have_count(0)
    assert await inspect_drafts(page) == []
    assert actions(await snapshot(page)) == ['ask', 'ask']
    return {'mode': 'independent controlled journal read denial; content recovery/discard allowed but applying to a proposal is blocked', 'writes': 0}


async def draft_invalid_case(page, fault):
    await seed_reload_draft(page)
    mutation = await page.evaluate('mode => window.__agentQA.mutateDraft(mode)', fault)
    await true_reload(page, f'draft-{fault}')
    await expect(draft_offer(page)).to_have_count(0)
    await expect(page.get_by_role('textbox', name='已恢復的修改條件', exact=True)).to_have_count(0)
    assert CHANGE not in await page.locator('body').inner_text()
    assert await inspect_drafts(page) == [], 'Expired/corrupt current draft was not removed'
    await no_writes(page)
    assert actions(await snapshot(page)) == ['ask']
    return {'mode': f'controlled {fault} product-draft data is hidden and cleaned on actual reload', 'mutation': mutation}


async def draft_scope_case(page):
    saved = await seed_reload_draft(page)
    await true_reload(page, 'draft-scope-initial')
    await restore_draft(page)
    for scope, label, other, original in [('school', 'QA 校園', 'fixture-campus-b', 'fixture-campus-a'),
                                          ('account', 'QA 帳號', 'qa-agent-b', 'qa-agent')]:
        await page.get_by_role('combobox', name=label, exact=True).select_option(other)
        await expect(draft_offer(page)).to_have_count(0)
        await expect(page.get_by_role('textbox', name='已恢復的修改條件', exact=True)).to_have_count(0)
        assert CHANGE not in await page.locator('body').inner_text()
        await true_reload(page, f'draft-other-{scope}')
        await expect(draft_offer(page)).to_have_count(0)
        await page.get_by_role('combobox', name=label, exact=True).select_option(original)
        await expect(draft_offer(page)).to_be_visible()
        await expect(page.get_by_role('textbox', name='已恢復的修改條件', exact=True)).to_have_count(0)
        assert await audit_draft(page) == saved
    await no_writes(page)
    assert actions(await snapshot(page)) == ['ask']
    await capture(page, 'draft-account-school-isolation')
    return {'mode': 'real reload and school/account scope switches require fresh explicit recovery; no cross-scope content', 'draft': saved}


async def draft_pending_case(page, action):
    await seed_reload_draft(page)
    if action == 'ask':
        await page.evaluate('window.__agentQA.configure({holdAsk:true})')
        await page.get_by_role('button', name='重新預覽', exact=True).click()
    else:
        assert action == 'confirm'
        await page.evaluate('window.__agentQA.configure({holdConfirmAfterWrite:true})')
        await card_list(page).nth(0).get_by_role('button', name='確認', exact=True).click()
    await page.wait_for_function('window.__agentQA.snapshot().waiting')
    assert await inspect_drafts(page) == [], 'A dispatched operation kept an unsent recovery offer'
    before = await snapshot(page)
    if action == 'ask':
        assert actions(before) == ['ask', 'cancel', 'cancel', 'ask'] and before['writes'] == [], before
    else:
        assert actions(before) == ['ask', 'confirm'] and len(before['writes']) == 1, before
    reload_evidence = await true_reload(page, f'draft-pending-{action}', ['reconcile'] if action == 'confirm' else [])
    await expect(draft_offer(page)).to_have_count(0)
    after = await snapshot(page)
    assert len(after['writes']) == len(before['writes']), after
    assert await inspect_drafts(page) == []
    if action == 'confirm':
        await expect(card_list(page)).to_have_count(1)
        await expect(card_list(page).get_by_label('行程執行回執', exact=True)).to_contain_text('已核對並加入個人行事曆')
        assert after['requests'][-1]['body']['token'] == [row for row in before['requests'] if row['action'] == 'confirm'][0]['body']['token'], after
        local = await page.evaluate("JSON.parse(localStorage.getItem('campus.personal-imports.v1:platform%3Aqa-agent:fixture-campus-a'))")
        assert local['records'] == after['records'] and len(local['records']) == 1, local
    else:
        await expect(card_list(page)).to_have_count(0)
        await no_writes(page)
    await capture(page, f'draft-pending-{action}-reloaded')
    return {'mode': 'controlled response held across actual reload; only existing journal reconciliation may run',
            'pendingAction': action, 'reload': reload_evidence}


def build_evidence():
    meta = json.loads((OUT / 'bundle-meta.json').read_text())
    paths = [name for name in meta['inputs'] if not name.startswith(('fixture:', '<', '(disabled):')) and 'node_modules/' not in name]
    hashes = {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in paths}
    for required in ['Assistant.tsx', 'AssistantCards.tsx', 'AssistantPlanRevision.tsx', 'AssistantPlanComparison.tsx', 'planComparison.ts', 'assistantExecutionJournal.ts', 'assistantCalendarExecution.ts', 'assistantPlanProtection.ts', 'assistantPlanRevisionDraft.ts', 'usePlanRevisionDraft.ts', 'AssistantPlanDraftRecovery.tsx']:
        assert any(name.endswith('/' + required) for name in hashes), f'Real implementation missing: {required}'
    return {'head': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(), 'sourceSha256': hashes}


async def main():
    report = {'scope': 'Production React UI in Chromium; fixed fake API/account/campus; no model or real backend',
              'modelLimitation': 'Fixture returns predefined revised cards; this does not test model interpretation or generation quality',
              'build': build_evidence(), 'cases': []}
    handler = functools.partial(QuietHandler, directory=str(OUT))
    server = ThreadingHTTPServer(('127.0.0.1', 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f'http://127.0.0.1:{server.server_port}'
    try:
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(executable_path=os.environ.get('ASSISTANT_QA_CHROMIUM_EXECUTABLE'))
            report['browser'] = {'version': browser.version, 'executableOverride': os.environ.get('ASSISTANT_QA_CHROMIUM_EXECUTABLE')}
            try:
                cases = [('native-1440', 1440, lambda p: native_case(p, 1440)),
                         ('native-320', 320, lambda p: native_case(p, 320)),
                         ('controlled-ask-error', 1440, lambda p: ask_error_case(p, 'error')),
                         ('controlled-empty-preview', 1440, lambda p: ask_error_case(p, 'empty')),
                         ('controlled-unknown-cancel', 1440, unknown_case),
                         ('controlled-late-school-switch', 1440, late_school_case),
                         ('controlled-double-preview', 1440, double_case),
                         ('controlled-malformed-preview', 1440, lambda p: ask_error_case(p, 'malformed'))]
                cases.extend((f'comparison-{name}', width, lambda p, value=name: comparison_case(p, value))
                             for name, width in [('cross-day-rename', 1440), ('cross-day-rename-320', 320),
                                                 ('reordered', 1440), ('added', 1440), ('removed', 1440),
                                                 ('same-name-ambiguous', 1440), ('unchanged', 1440)])
                cases.extend([
                    ('protected-single-1440', 1440, lambda p: protected_good_case(p, 'single-1440')),
                    ('protected-single-320', 320, lambda p: protected_good_case(p, 'single-320')),
                    ('protected-multiple-reordered', 1440, lambda p: protected_good_case(p, 'multiple-reordered')),
                    ('protected-all-320', 320, protected_all_case),
                    ('protected-partial-exact-duplicates', 1440, protected_partial_duplicate_case),
                    ('protected-unknown-cancel', 1440, protected_unknown_case),
                    ('controlled-protected-late-school', 1440, lambda p: protected_late_scope_case(p, 'school')),
                    ('controlled-protected-late-account', 1440, lambda p: protected_late_scope_case(p, 'account')),
                ])
                cases.extend((f'controlled-protected-{fault}', 1440, lambda p, value=fault: protected_bad_case(p, value))
                             for fault in ['missing', 'changed-time', 'duplicate', 'same-name-ambiguous'])
                cases.extend([
                    ('draft-happy-320', 320, draft_happy_case),
                    ('draft-changed-source', 1440, draft_changed_source_case),
                    ('draft-clear', 1440, lambda p: draft_clear_case(p, 'clear')),
                    ('draft-discard', 1440, lambda p: draft_clear_case(p, 'discard')),
                    ('draft-quota', 1440, draft_quota_case),
                    ('draft-remove-failure', 1440, draft_remove_failure_case),
                    ('draft-read-denied', 1440, draft_unreadable_case),
                    ('draft-journal-read-denied', 1440, draft_journal_unreadable_case),
                    ('draft-expired', 1440, lambda p: draft_invalid_case(p, 'expired')),
                    ('draft-corrupt', 1440, lambda p: draft_invalid_case(p, 'corrupt')),
                    ('draft-scope-isolation', 1440, draft_scope_case),
                    ('draft-pending-ask', 1440, lambda p: draft_pending_case(p, 'ask')),
                    ('draft-pending-confirm', 1440, lambda p: draft_pending_case(p, 'confirm')),
                ])
                for name, width, run in cases:
                    motion = 'no-preference' if name == 'protected-single-320' else 'reduce'
                    context = await browser.new_context(viewport={'width': width, 'height': 900 if width > 320 else 720},
                                                        reduced_motion=motion, locale='zh-TW', timezone_id='Asia/Taipei', service_workers='block')
                    page = await context.new_page()
                    page.set_default_timeout(10_000)
                    errors, blocked = [], []
                    page.on('pageerror', lambda error: errors.append(str(error)))
                    async def route(request_route):
                        if urlparse(request_route.request.url).netloc == urlparse(base).netloc:
                            await request_route.continue_()
                        else:
                            blocked.append(request_route.request.url)
                            await request_route.abort()
                    await context.route('**/*', route)
                    result = {'name': name, 'viewport': width, 'motion': motion, 'status': 'failed'}
                    try:
                        await page.goto(base + '/index.html' + ('?draft-reload=1' if name.startswith('draft-') else ''), wait_until='networkidle')
                        result.update(await run(page))
                        assert not errors, errors
                        assert not blocked, blocked
                        result['status'] = 'passed'
                    except Exception:
                        result['error'] = traceback.format_exc()
                        await capture(page, name + '-failure')
                        raise
                    finally:
                        result['pageErrors'], result['blockedNetwork'] = errors, blocked
                        try:
                            result['ledger'] = await snapshot(page)
                        except Exception as evidence_error:
                            result['ledgerUnavailable'] = str(evidence_error)
                        report['cases'].append(result)
                        (OUT / f'{name}-ledger.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
                        (OUT / 'results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
                        await context.close()
            finally:
                await browser.close()
    except Exception:
        report['failure'] = traceback.format_exc()
        raise
    finally:
        (OUT / 'results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        server.shutdown()
        server.server_close()
    print(json.dumps({'passed': len(report['cases']), 'artifacts': str(OUT)}, ensure_ascii=False))


if __name__ == '__main__':
    asyncio.run(main())
