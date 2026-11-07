"""Run the real spatial explorer in Chromium against a local public-data fixture.

Build first with `node scripts/qa/campus-spatial/build.mjs`, then run this file.
No school account, deployed service, navigation destination or external request
is used. The WebGL probe observes native calls; it does not replace rendering.
"""

import asyncio
import functools
import hashlib
import json
import re
import threading
import time
import traceback
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urljoin, urlparse

from playwright.async_api import async_playwright, expect


ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / "artifacts/campus-spatial"
CANVAS = "[data-spatial-canvas]"
SCENE = "[data-spatial-state]"

# Independent navigation oracle from the checked-in public Providence snapshot.
LIBRARY = {
    "id": "pu-library",
    "name": "蓋夏圖書館",
    "lat": 24.226282,
    "lng": 120.581377,
    "source": "https://www.openstreetmap.org/way/255784049",
}
ZHUGU = {"id": "pu-zhugu", "name": "主顧樓", "lat": 24.226939, "lng": 120.583587}

PROBE = """(() => {
  const probe = { clears: 0, draws: 0, contexts: 0,
    rafRequested: 0, rafExecuted: 0, rafPending: 0, focusBoundaries: [] };
  window.__campusSpatialProbe = probe;
  const pending = new Set();
  const requestFrame = window.requestAnimationFrame;
  const cancelFrame = window.cancelAnimationFrame;
  window.requestAnimationFrame = function (callback) {
    const id = Reflect.apply(requestFrame, window, [timestamp => {
      pending.delete(id);
      probe.rafPending = pending.size;
      probe.rafExecuted += 1;
      Reflect.apply(callback, window, [timestamp]);
    }]);
    pending.add(id);
    probe.rafPending = pending.size;
    probe.rafRequested += 1;
    return id;
  };
  window.cancelAnimationFrame = function (id) {
    pending.delete(id);
    probe.rafPending = pending.size;
    return Reflect.apply(cancelFrame, window, [id]);
  };
  if (typeof WebGL2RenderingContext === 'undefined') return;
  const contexts = new WeakSet();
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (...args) {
    const context = Reflect.apply(getContext, this, args);
    if (this.dataset.spatialCanvas && context instanceof WebGL2RenderingContext &&
        !contexts.has(context)) {
      contexts.add(context);
      probe.contexts += 1;
    }
    return context;
  };
  for (const name of ['clear', 'drawArrays', 'drawElements',
                      'drawArraysInstanced', 'drawElementsInstanced']) {
    const original = WebGL2RenderingContext.prototype[name];
    WebGL2RenderingContext.prototype[name] = function (...args) {
      const result = Reflect.apply(original, this, args);
      if (this.canvas?.dataset.spatialCanvas) {
        if (name === 'clear') probe.clears += 1;
        else probe.draws += 1;
      }
      return result;
    };
  }
})();"""


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def lazy_resources():
    """Find real scene/Three.js outputs, including accidentally eager bundles."""
    meta = json.loads((OUT / "bundle-meta.json").read_text(encoding="utf-8"))
    resources = set()
    for output, details in meta["outputs"].items():
        inputs = ["/" + name.lstrip("/") for name in details.get("inputs", {})]
        contains_scene = any(
            name.endswith("/campusSpatialScene.ts")
            or "/node_modules/three/" in name
            or "/node_modules/.pnpm/three@" in name
            for name in inputs
        )
        if output.endswith(".js") and contains_scene:
            absolute = Path(output) if Path(output).is_absolute() else ROOT / output
            resources.add("/" + absolute.resolve().relative_to(OUT.resolve()).as_posix())
    assert resources, "Build metadata contains no scene/Three.js JavaScript output"
    return resources


def dialog_for(page):
    return page.get_by_role("dialog", name="校園空間導覽", exact=True)


def selector_for(page):
    return dialog_for(page).get_by_role("combobox", name="想去哪裡", exact=True)


def scene_host(page):
    return dialog_for(page).get_by_role("group", name="校園地點空間圖", exact=True)


async def clears(page):
    return await page.evaluate("window.__campusSpatialProbe.clears")


async def assert_native_tab_boundary(page, key, expected):
    # Native dialog traversal may visit browser chrome at a document boundary.
    # https://html.spec.whatwg.org/multipage/interaction.html#sequential-focus-navigation
    # Accept that transition only when the document lost focus and BODY is its
    # active element. A second key must return to the exact dialog boundary.
    for step in (1, 2):
        await page.keyboard.press(key)
        state = await expected.evaluate("""expected => {
          const active = document.activeElement;
          const dialog = expected.closest('dialog');
          return {
            documentFocused: document.hasFocus(),
            activeTag: active?.tagName ?? null,
            activeName: active?.getAttribute('aria-label') || active?.textContent?.trim().slice(0, 80),
            insideDialog: Boolean(dialog?.contains(active)),
            expectedActive: active === expected,
            nativeModal: Boolean(dialog?.matches(':modal')),
          };
        }""")
        state.update({"key": key, "step": step})
        await page.evaluate("state => window.__campusSpatialProbe.focusBoundaries.push(state)", state)
        assert state["nativeModal"], f"Dialog stopped being modal during {key}: {state}"
        if state["documentFocused"] and state["expectedActive"] and state["insideDialog"]:
            return
        assert step == 1 and not state["documentFocused"] and state["activeTag"] == "BODY", (
            f"{key} did not reach the expected dialog control or an unfocused browser boundary: {state}"
        )


async def ready(page):
    await expect(page.locator(SCENE)).to_have_attribute(
        "data-spatial-state", "ready", timeout=20_000
    )
    await expect(page.locator("[data-spatial-marker]:visible").first).to_be_visible()
    await page.wait_for_function("window.__campusSpatialProbe.draws > 0")
    await expect(scene_host(page)).to_have_attribute("tabindex", "0")


async def open_explorer(page):
    await page.get_by_role("button", name="空間導覽", exact=True).click()
    await expect(dialog_for(page)).to_be_visible()
    await ready(page)


async def assert_webgl(page):
    info = await page.locator(CANVAS).evaluate("""canvas => {
      const gl = canvas.getContext('webgl2');
      return {
        native: gl instanceof WebGL2RenderingContext,
        lost: gl?.isContextLost(),
        version: gl?.getParameter(gl.VERSION),
        width: gl?.drawingBufferWidth,
        height: gl?.drawingBufferHeight,
        draws: window.__campusSpatialProbe.draws,
      };
    }""")
    assert info["native"] and not info["lost"], info
    assert info["width"] > 0 and info["height"] > 0 and info["draws"] > 0, info
    return info


async def assert_layout(page):
    measurements = await dialog_for(page).evaluate("""dialog => {
      const visible = el => el.getClientRects().length > 0 &&
        getComputedStyle(el).visibility !== 'hidden';
      const controls = [...dialog.querySelectorAll('button, select, input, a[href]')]
        .filter(visible).map(el => {
          const rect = el.getBoundingClientRect();
          return { name: el.getAttribute('aria-label') || el.textContent.trim().slice(0, 45)
                    || el.tagName, width: rect.width, height: rect.height,
                    left: rect.left, right: rect.right };
        });
      const overflow = [document.documentElement, dialog, ...dialog.children]
        .filter(el => el.scrollWidth > el.clientWidth + 1)
        .map(el => ({ tag: el.tagName, width: el.clientWidth, scrollWidth: el.scrollWidth }));
      return { viewport: innerWidth, controls, overflow };
    }""")
    assert not measurements["overflow"], measurements["overflow"]
    small = [control for control in measurements["controls"]
             if control["width"] < 43.5 or control["height"] < 43.5]
    assert not small, f"Interactive targets smaller than 44 CSS px: {small}"
    outside = [control for control in measurements["controls"]
               if control["left"] < -1 or control["right"] > measurements["viewport"] + 1]
    assert not outside, f"Controls extend horizontally beyond the viewport: {outside}"
    return {"viewport": measurements["viewport"], "targets": len(measurements["controls"])}


async def assert_walking_link(link, destination_place):
    href = await link.get_attribute("href")
    parsed = urlparse(href)
    query = parse_qs(parsed.query)
    assert (parsed.scheme, parsed.netloc, parsed.path) == (
        "https", "www.google.com", "/maps/dir/"
    ), href
    assert query.get("api") == ["1"] and query.get("travelmode") == ["walking"], href
    assert "origin" not in query, "Fixture must not invent the user's current location"
    destination = [float(value) for value in query["destination"][0].split(",")]
    assert len(destination) == 2, href
    assert abs(destination[0] - destination_place["lat"]) < 1e-9, href
    assert abs(destination[1] - destination_place["lng"]) < 1e-9, href
    await expect(link).to_have_attribute("target", "_blank")
    assert {"noopener", "noreferrer"} <= set((await link.get_attribute("rel")).split())
    return href


async def assert_navigation(page):
    dialog = dialog_for(page)
    await expect(dialog.get_by_role("heading", name=LIBRARY["name"], exact=True)).to_be_visible()
    href = await assert_walking_link(dialog.get_by_role("link", name="開啟步行導航", exact=True), LIBRARY)
    await expect(dialog.get_by_role("link", name="查看地點資料來源 ↗", exact=True)).to_have_attribute(
        "href", LIBRARY["source"]
    )
    return href


async def camera_readout(page):
    """Read the visible compass and zoom, without exposing renderer internals."""
    dialog = dialog_for(page)
    await expect(dialog.get_by_text("畫面北向", exact=True)).to_be_visible()
    transform = await dialog.get_by_role("group", name="調整空間視角", exact=True).locator("svg g").get_attribute("transform")
    match = re.fullmatch(r"rotate\(([-+\d.eE]+) 20 20\)", transform or "")
    assert match, f"Compass does not expose a rendered rotation: {transform}"
    zoom_text = await dialog.get_by_text(re.compile(r"^縮放 \d+%$")).inner_text()
    return {"northDegrees": float(match[1]), "zoomPercent": int(re.search(r"\d+", zoom_text)[0])}


async def assert_same_scene(page, canvas, context, selected):
    await expect(page.locator(CANVAS)).to_have_count(1)
    await expect(selector_for(page)).to_have_value(selected)
    state = await page.locator(CANVAS).evaluate("""(current, previous) => ({
      sameCanvas: current === previous.canvas,
      sameContext: current.getContext('webgl2') === previous.context,
      lost: current.getContext('webgl2').isContextLost(),
      contexts: window.__campusSpatialProbe.contexts,
    })""", {"canvas": canvas, "context": context})
    assert state == {"sameCanvas": True, "sameContext": True, "lost": False, "contexts": 1}, state


async def assert_idle_renderer(page):
    # Both GPU work and scheduled callbacks must stop. Counting draws alone could
    # miss an empty requestAnimationFrame loop. These wrappers call the originals.
    await page.wait_for_timeout(650)
    before = await page.evaluate("""() => {
      const { clears, draws, rafRequested, rafExecuted, rafPending } = window.__campusSpatialProbe;
      return { clears, draws, rafRequested, rafExecuted, rafPending };
    }""")
    await page.wait_for_timeout(250)
    after = await page.evaluate("""() => {
      const { clears, draws, rafRequested, rafExecuted, rafPending } = window.__campusSpatialProbe;
      return { clears, draws, rafRequested, rafExecuted, rafPending };
    }""")
    assert after == before and after["rafPending"] == 0, {"before": before, "after": after}
    return after


async def wait_for_repaint(page, before):
    await page.wait_for_function("before => window.__campusSpatialProbe.clears > before", arg=before)


async def canvas_fingerprint(page):
    return hashlib.sha256(await page.locator(CANVAS).screenshot()).hexdigest()


async def camera_controls(page, _requests, _resources):
    await open_explorer(page)
    dialog = dialog_for(page)
    host = scene_host(page)
    selected = await selector_for(page).input_value()
    canvas = await page.locator(CANVAS).element_handle()
    context = await canvas.evaluate_handle("canvas => canvas.getContext('webgl2')")
    await assert_idle_renderer(page)
    initial = await camera_readout(page)
    assert initial["zoomPercent"] == 100 and 0 < initial["northDegrees"] < 90, initial
    baseline = await canvas_fingerprint(page)
    states = {"initial": initial}

    async def click_camera(name):
        before = await clears(page)
        await dialog.get_by_role("button", name=name, exact=True).click()
        await wait_for_repaint(page, before)
        await assert_same_scene(page, canvas, context, selected)
        return await camera_readout(page)

    states["right"] = await click_camera("向右旋轉")
    assert abs(states["right"]["northDegrees"] - initial["northDegrees"]) > 1
    assert await canvas_fingerprint(page) != baseline, "Rotation changed the UI but not the WebGL view"
    states["left"] = await click_camera("向左旋轉")
    assert abs(states["left"]["northDegrees"] - initial["northDegrees"]) < 1e-7
    states["zoomIn"] = await click_camera("放大空間圖")
    assert states["zoomIn"]["zoomPercent"] == 125
    assert await canvas_fingerprint(page) != baseline, "Zoom changed the UI but not the WebGL view"
    assert (await click_camera("縮小空間圖"))["zoomPercent"] == 100

    await host.focus()
    await expect(host).to_be_focused()
    # A keyboard event activates the visible-focus treatment on the scene.
    await page.keyboard.press("Home")
    await expect(dialog.get_by_text("縮放 100%", exact=True)).to_be_visible()
    await page.wait_for_timeout(100)
    assert abs((await camera_readout(page))["northDegrees"]) < 1e-7
    focus = await host.evaluate("""el => ({
      visible: el.matches(':focus-visible'),
      outline: getComputedStyle(el).outlineStyle,
      width: parseFloat(getComputedStyle(el).outlineWidth),
    })""")
    assert focus["visible"] and focus["outline"] != "none" and focus["width"] >= 2, focus
    for key, expected_zoom in [("ArrowLeft", 100), ("ArrowRight", 100),
                               ("Shift+Equal", 125), ("Minus", 100)]:
        before = await clears(page)
        await page.keyboard.press(key)
        await wait_for_repaint(page, before)
        state = await camera_readout(page)
        assert state["zoomPercent"] == expected_zoom, {"key": key, **state}
        if key == "ArrowLeft":
            assert abs(state["northDegrees"]) > 1
        if key == "ArrowRight":
            assert abs(state["northDegrees"]) < 1e-7
        await expect(host).to_be_focused()
        await assert_same_scene(page, canvas, context, selected)
        states[key] = state

    # Check the actual displayed bounds and disabled controls, including a key
    # that attempts to exceed each bound while the scene itself is focused.
    for name, bound, key in [("放大空間圖", 250, "Shift+Equal"), ("縮小空間圖", 65, "Minus")]:
        button = dialog.get_by_role("button", name=name, exact=True)
        for _ in range(12):
            if await button.get_attribute("aria-disabled") == "true":
                break
            await button.click()
        await expect(button).to_have_attribute("aria-disabled", "true")
        await expect(button).to_be_disabled()
        await expect(dialog.get_by_text(f"縮放 {bound}%", exact=True)).to_be_visible()
        await expect(button).to_be_focused()
        await page.keyboard.press("Enter")
        assert (await camera_readout(page))["zoomPercent"] == bound
        await expect(button).to_be_focused()
        states[f"limit{bound}"] = {"zoomPercent": bound, "focusRetainedAfterEnter": True}
        await host.focus()
        await page.keyboard.press(key)
        assert (await camera_readout(page))["zoomPercent"] == bound
        await assert_same_scene(page, canvas, context, selected)

    # Home resets both a rotated view and a non-default zoom.
    await page.keyboard.press("ArrowLeft")
    await page.keyboard.press("Home")
    await expect(dialog.get_by_text("縮放 100%", exact=True)).to_be_visible()
    assert abs((await camera_readout(page))["northDegrees"]) < 1e-7
    rotated = await click_camera("向右旋轉")
    await click_camera("放大空間圖")
    await selector_for(page).select_option(LIBRARY["id"])
    selected = LIBRARY["id"]
    await expect(dialog.get_by_text("縮放 100%", exact=True)).to_be_visible()
    assert abs((await camera_readout(page))["northDegrees"] - rotated["northDegrees"]) < 1e-7
    await assert_same_scene(page, canvas, context, selected)
    await assert_idle_renderer(page)
    await click_camera("放大空間圖")
    await dialog.get_by_role("button", name="看全部地點", exact=True).click()
    await expect(dialog.get_by_text("縮放 100%", exact=True)).to_be_visible()
    assert abs((await camera_readout(page))["northDegrees"] - rotated["northDegrees"]) < 1e-7
    await assert_same_scene(page, canvas, context, selected)
    await assert_idle_renderer(page)
    await click_camera("放大空間圖")
    states["northReset"] = await click_camera("回到北向")
    assert states["northReset"] == {"northDegrees": 0, "zoomPercent": 100}
    idle = await assert_idle_renderer(page)
    await page.screenshot(path=str(OUT / "camera-controls.png"))
    await context.dispose()
    await canvas.dispose()
    return {"readouts": states, "sameCanvasAndContext": True, "zoomBounds": [65, 250],
            "selectionAndOverviewResetZoom": True, "keyboardFocus": focus, "idle": idle}


async def touch_camera(page, _requests, _resources):
    await page.emulate_media(reduced_motion="reduce")
    await open_explorer(page)
    host = scene_host(page)
    await host.scroll_into_view_if_needed()
    await assert_idle_renderer(page)
    selected = await selector_for(page).input_value()
    canvas = await page.locator(CANVAS).element_handle()
    context = await canvas.evaluate_handle("canvas => canvas.getContext('webgl2')")
    await host.evaluate("""host => {
      window.__campusSpatialProbe.touchInputs = [];
      host.addEventListener('pointerdown', event => {
        window.__campusSpatialProbe.touchInputs.push({ trusted: event.isTrusted, type: event.pointerType });
      });
    }""")
    touch_action = await host.evaluate("el => getComputedStyle(el).touchAction")
    assert "pan-y" in touch_action and "pinch-zoom" in touch_action, touch_action
    scroller = await host.evaluate_handle("""host => {
      for (let el = host.parentElement; el; el = el.parentElement) {
        if (/(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 1) {
          return el;
        }
      }
      throw new Error('The mobile dialog has no scrollable content');
    }""")
    session = await page.context.new_cdp_session(page)

    async def swipe(horizontal):
        point = await host.evaluate("""host => {
          const rect = host.getBoundingClientRect();
          for (const fy of [0.72, 0.58, 0.44]) for (const fx of [0.2, 0.3, 0.4]) {
            const x = rect.left + rect.width * fx;
            const y = rect.top + rect.height * fy;
            const hit = document.elementFromPoint(x, y);
            if (hit && host.contains(hit) && !hit.closest('button, a, input, select, textarea')) {
              return { x, y, dx: rect.width * 0.35, dy: -Math.min(rect.height * 0.4, y - rect.top - 12) };
            }
          }
          throw new Error('No unobstructed scene surface for a genuine touch gesture');
        }""")
        assert point["dx"] > 50 and -point["dy"] > 60, point
        await session.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [
            {"x": point["x"], "y": point["y"], "id": 1, "radiusX": 2, "radiusY": 2}
        ]})
        try:
            for step in range(1, 9):
                await session.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [
                    {"x": point["x"] + (point["dx"] * step / 8 if horizontal else 0),
                     "y": point["y"] + (0 if horizontal else point["dy"] * step / 8),
                     "id": 1, "radiusX": 2, "radiusY": 2}
                ]})
                await page.wait_for_timeout(24)
        finally:
            await session.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})

    initial = await camera_readout(page)
    initial_scroll = await scroller.evaluate("el => el.scrollTop")
    before = await clears(page)
    await swipe(horizontal=True)
    await wait_for_repaint(page, before)
    horizontal = await camera_readout(page)
    assert abs(horizontal["northDegrees"] - initial["northDegrees"]) > 1, horizontal
    assert horizontal["zoomPercent"] == initial["zoomPercent"]
    assert abs(await scroller.evaluate("el => el.scrollTop") - initial_scroll) <= 3
    await assert_same_scene(page, canvas, context, selected)
    await assert_idle_renderer(page)
    await page.screenshot(path=str(OUT / "camera-touch.png"))

    await swipe(horizontal=False)
    await page.wait_for_function(
        "args => args.el.scrollTop > args.before + 30", arg={"el": scroller, "before": initial_scroll}
    )
    vertical_scroll = await scroller.evaluate("el => el.scrollTop")
    assert vertical_scroll > initial_scroll + 30, {"before": initial_scroll, "after": vertical_scroll}
    assert await camera_readout(page) == horizontal, "Vertical scrolling also changed the camera"
    await assert_same_scene(page, canvas, context, selected)
    inputs = await page.evaluate("window.__campusSpatialProbe.touchInputs")
    assert len(inputs) == 2 and all(item == {"trusted": True, "type": "touch"} for item in inputs), inputs
    idle = await assert_idle_renderer(page)
    await session.detach()
    await scroller.dispose()
    await context.dispose()
    await canvas.dispose()
    return {"touchAction": touch_action, "nativeTouchInputs": inputs,
            "horizontalRotation": {"before": initial, "after": horizontal},
            "verticalScroll": {"before": initial_scroll, "after": vertical_scroll}, "idle": idle}


async def open_map_fixture(page, school, query):
    await page.goto(urljoin(page.url, "map.html") + "?" + urlencode({"schoolId": school, "query": query}),
                    wait_until="networkidle")
    result = page.get_by_role("region", name="教室定位結果", exact=True)
    await expect(result.get_by_role("heading", name=query, exact=True)).to_be_visible()
    await expect(page.locator(".leaflet-container")).to_be_visible()
    assert not await page.evaluate("document.documentElement.scrollWidth > innerWidth + 1"), (
        "Map fixture overflows its viewport"
    )
    return result


async def classroom_unique(page, requests, resources):
    result = await open_map_fixture(page, "pu", "主顧303")
    await expect(result).to_contain_text("可對應「主顧樓」的位置。抵達後請依課表與現場標示確認教室。")
    details = page.get_by_role("region", name="地點詳情", exact=True)
    await expect(details.get_by_role("heading", name=ZHUGU["name"], exact=True)).to_be_visible()
    href = await assert_walking_link(details.get_by_role("link", name="從目前位置導航", exact=True), ZHUGU)
    await expect(page.locator(".leaflet-tile-loaded").first).to_be_visible()
    eager = resources.intersection(urlparse(url).path for url in requests)
    assert not eager, f"MapClient loaded 3D before opening: {sorted(eager)}"
    await page.screenshot(path=str(OUT / "map-classroom-unique.png"), full_page=True)
    await open_explorer(page)
    await expect(selector_for(page)).to_have_value(ZHUGU["id"])
    await expect(selector_for(page).locator("option")).to_have_count(1)
    await expect(dialog_for(page).get_by_role("heading", name=ZHUGU["name"], exact=True)).to_be_visible()
    await assert_walking_link(dialog_for(page).get_by_role("link", name="開啟步行導航", exact=True), ZHUGU)
    graphics = await assert_webgl(page)
    await dialog_for(page).get_by_role("button", name="在平面地圖查看", exact=True).click()
    await expect(dialog_for(page)).to_have_count(0)
    await expect(details.get_by_role("heading", name=ZHUGU["name"], exact=True)).to_be_visible()

    # The user explicitly clears the classroom filter before choosing another POI.
    await page.get_by_role("button", name="看整個校園", exact=True).click()
    await open_explorer(page)
    assert await selector_for(page).locator("option").count() > 2
    await selector_for(page).select_option(LIBRARY["id"])
    await assert_navigation(page)
    await dialog_for(page).get_by_role("button", name="在平面地圖查看", exact=True).click()
    await expect(details.get_by_role("heading", name=LIBRARY["name"], exact=True)).to_be_visible()
    await assert_walking_link(details.get_by_role("link", name="從目前位置導航", exact=True), LIBRARY)
    return {"query": "主顧303", "resolvedBuilding": ZHUGU, "navigationHref": href,
            "webgl": graphics, "selectionReturnedToMap": LIBRARY["id"]}


async def classroom_verified_code(page, _requests, _resources):
    result = await open_map_fixture(page, "pu", "PH303")
    await expect(result).to_contain_text("可對應「主顧樓」的位置。")
    details = page.get_by_role("region", name="地點詳情", exact=True)
    await expect(details.get_by_role("heading", name=ZHUGU["name"], exact=True)).to_be_visible()
    href = await assert_walking_link(
        details.get_by_role("link", name="從目前位置導航", exact=True), ZHUGU
    )
    assert await result.evaluate("""section => {
        const map = document.querySelector('.leaflet-container');
        return map && Boolean(section.compareDocumentPosition(map) & Node.DOCUMENT_POSITION_FOLLOWING);
    }"""), "The verified room code should be explained before the map"
    await page.screenshot(path=str(OUT / "map-classroom-verified-code.png"), full_page=True)
    return {"query": "PH303", "verifiedBuilding": ZHUGU, "roomOrFloorInferred": False,
            "navigationHref": href}


async def classroom_ambiguous(page, _requests, _resources):
    result = await open_map_fixture(page, "qa-campus", "測試教學101")
    await expect(result).to_contain_text("有多個相符地點，請核對位置後選擇。")
    await expect(result.get_by_role("button", name="選擇候選 1：測試教學大樓", exact=True)).to_be_visible()
    second = result.get_by_role("button", name="選擇候選 2：測試教學大樓", exact=True)
    await expect(second).to_be_visible()
    await expect(page.get_by_role("region", name="地點詳情", exact=True)).to_have_count(0)
    await expect(page.get_by_role("link", name="從目前位置導航", exact=True)).to_have_count(0)
    await open_explorer(page)
    await expect(selector_for(page)).to_have_value("")
    await expect(dialog_for(page).get_by_role("link", name="開啟步行導航", exact=True)).to_have_count(0)
    await expect(dialog_for(page).get_by_role("button", name="在平面地圖查看", exact=True)).to_have_count(0)
    await page.keyboard.press("Escape")
    await expect(dialog_for(page)).to_have_count(0)
    await expect(page.get_by_role("region", name="地點詳情", exact=True)).to_have_count(0)
    await second.click()
    details = page.get_by_role("region", name="地點詳情", exact=True)
    await expect(details.get_by_role("heading", name="測試教學大樓", exact=True)).to_be_visible()
    await expect(details).to_contain_text("測試候選：西側")
    href = await assert_walking_link(details.get_by_role("link", name="從目前位置導航", exact=True),
                                     {"lat": 24.225, "lng": 120.582})
    return {"query": "測試教學101", "candidateCount": 2, "noAutomaticSelection": True,
            "explicitCandidate": 2, "navigationHref": href, "data": "clearly labelled synthetic candidates"}


async def classroom_unknown(page, _requests, _resources):
    result = await open_map_fixture(page, "pu", "ZZ303")
    await expect(result).to_contain_text("目前地點資料無法確認這間教室的位置。")
    await expect(page.get_by_role("region", name="地點詳情", exact=True)).to_have_count(0)
    await expect(page.get_by_role("link", name="從目前位置導航", exact=True)).to_have_count(0)
    await expect(page.get_by_role("button", name="空間導覽", exact=True)).to_have_count(0)
    official = result.get_by_role("link", name="核對校方地圖", exact=True)
    href = "https://gnl.pu.edu.tw/p/426-1007-8.php?Lang=zh-tw"
    await expect(official).to_have_attribute("href", href)
    assert await result.evaluate("""section => {
        const map = document.querySelector('.leaflet-container');
        return map && Boolean(section.compareDocumentPosition(map) & Node.DOCUMENT_POSITION_FOLLOWING);
    }"""), "Unknown-room recovery should appear above the map"
    await page.screenshot(path=str(OUT / "map-classroom-unknown.png"), full_page=True)
    await result.get_by_role("button", name="修改教室名稱", exact=True).click()
    search = page.get_by_role("searchbox", name="搜尋地點", exact=True)
    await expect(search).to_be_focused()
    selection = await search.evaluate("el => [el.selectionStart, el.selectionEnd, el.value.length]")
    assert selection == [0, 5, 5], selection
    return {"query": "ZZ303", "noInventedDestination": True, "officialMapHref": href,
            "recoveryBeforeMap": True, "editFocusAndSelection": True}


async def desktop(page, requests, resources):
    eager = resources.intersection(urlparse(url).path for url in requests)
    assert not eager, f"3D code loaded before opening: {sorted(eager)}"
    await expect(page.locator(CANVAS)).to_have_count(0)
    launcher = page.get_by_role("button", name="空間導覽", exact=True)
    await launcher.focus()
    await page.keyboard.press("Enter")
    dialog = dialog_for(page)
    await expect(dialog).to_be_visible()
    close = dialog.get_by_role("button", name="關閉視窗", exact=True)
    await expect(close).to_be_focused()
    await expect(close).to_be_in_viewport()
    assert await dialog.evaluate("el => el.matches(':modal')"), "Dialog is not native-modal"

    # Native showModal makes the background inert without setting an inert attribute.
    assert not await page.get_by_role("button", name="背景操作測試", include_hidden=True).evaluate(
        "el => { el.focus(); return document.activeElement === el; }"
    ), "The background accepted focus while the modal was open"
    await ready(page)
    await expect(selector_for(page)).to_have_value("")
    await expect(dialog.get_by_role("link", name="開啟步行導航", exact=True)).to_have_count(0)
    loaded = resources.intersection(urlparse(url).path for url in requests)
    assert loaded, "Opening the explorer did not request its real lazy scene chunk"
    graphics = await assert_webgl(page)
    layout = await assert_layout(page)
    await page.screenshot(path=str(OUT / "desktop-overview.png"))
    await selector_for(page).select_option(LIBRARY["id"])
    await assert_layout(page)
    last = dialog.get_by_role("link", name="查看地點資料來源 ↗", exact=True)
    await last.focus()
    await expect(last).to_be_focused()
    await assert_native_tab_boundary(page, "Tab", close)
    await assert_native_tab_boundary(page, "Shift+Tab", last)

    await page.wait_for_timeout(650)
    marker = page.locator("[data-spatial-marker]:visible").first
    marker_id = await marker.get_attribute("data-spatial-marker")
    marker_name = await marker.inner_text()
    await marker.click()
    await expect(selector_for(page)).to_have_value(marker_id)
    await expect(dialog.get_by_role("heading", name=marker_name, exact=True)).to_be_visible()

    await selector_for(page).select_option(LIBRARY["id"])
    href = await assert_navigation(page)
    await page.wait_for_timeout(650)
    before = hashlib.sha256(await page.locator(CANVAS).screenshot()).hexdigest()
    overhead = dialog.get_by_role("button", name="俯視", exact=True)
    await overhead.click()
    await expect(overhead).to_have_attribute("aria-pressed", "true")
    await page.wait_for_timeout(650)
    after = hashlib.sha256(await page.locator(CANVAS).screenshot()).hexdigest()
    assert before != after, "Overhead control did not change the rendered WebGL view"
    await page.screenshot(path=str(OUT / "desktop.png"))

    options = await selector_for(page).locator("option").evaluate_all(
        "nodes => nodes.map(el => ({ id: el.value, name: el.textContent }))"
    )
    assert len(options) > 2
    progress = dialog.get_by_role("slider", name=re.compile(r"^導覽進度"))
    await progress.focus()
    await page.keyboard.press("Home")
    await expect(selector_for(page)).to_have_value(options[0]["id"])
    await expect(dialog.get_by_role("button", name="上一個地點", exact=True)).to_be_disabled()
    await page.keyboard.press("ArrowRight")
    await expect(selector_for(page)).to_have_value(options[1]["id"])
    await expect(progress).to_have_attribute(
        "aria-valuetext", f"第 2 個地點，共 {len(options)} 個：{options[1]['name']}"
    )
    await dialog.get_by_role("button", name="下一個地點", exact=True).click()
    await expect(selector_for(page)).to_have_value(options[2]["id"])
    await dialog.get_by_role("button", name="上一個地點", exact=True).click()
    await expect(selector_for(page)).to_have_value(options[1]["id"])
    await progress.focus()
    await page.keyboard.press("End")
    await expect(dialog.get_by_role("button", name="下一個地點", exact=True)).to_be_disabled()
    await dialog.get_by_role("button", name="看全部地點", exact=True).click()
    await expect(dialog.get_by_role("button", name="看全部地點", exact=True)).to_have_attribute(
        "aria-pressed", "true"
    )

    await selector_for(page).select_option(LIBRARY["id"])
    await dialog.get_by_role("button", name="在平面地圖查看", exact=True).click()
    await expect(dialog).to_have_count(0)
    await expect(page.get_by_role("status")).to_have_text(f"已選取：{LIBRARY['name']}")
    await expect(launcher).to_be_focused()
    await launcher.click()
    await ready(page)
    await expect(selector_for(page)).to_have_value(LIBRARY["id"])
    await page.keyboard.press("Escape")
    await expect(dialog).to_have_count(0)
    await expect(launcher).to_be_focused()
    await expect(page.locator(CANVAS)).to_have_count(0)
    return {"lazyOutputs": sorted(loaded), "webgl": graphics, "layout": layout,
            "placeCount": len(options), "navigationHref": href}


async def mobile(page, _requests, _resources):
    await open_explorer(page)
    layout = await assert_layout(page)
    close = dialog_for(page).get_by_role("button", name="關閉視窗", exact=True)
    await expect(close).to_be_in_viewport()
    await page.screenshot(path=str(OUT / f"mobile-{page.viewport_size['width']}.png"))
    await selector_for(page).select_option(LIBRARY["id"])
    await assert_navigation(page)
    await assert_layout(page)
    action = dialog_for(page).get_by_role("button", name="在平面地圖查看", exact=True)
    await action.scroll_into_view_if_needed()
    await expect(action).to_be_in_viewport()
    await action.click()
    await expect(dialog_for(page)).to_have_count(0)
    await expect(page.get_by_role("status")).to_have_text(f"已選取：{LIBRARY['name']}")
    return layout


async def dark_large_text(page, _requests, _resources):
    await page.evaluate("""() => {
      document.documentElement.dataset.theme = 'dark';
      document.documentElement.style.fontSize = '32px';
    }""")
    await page.emulate_media(color_scheme="dark", reduced_motion="reduce")
    await open_explorer(page)
    layout = await assert_layout(page)
    assert await page.evaluate("getComputedStyle(document.documentElement).fontSize") == "32px"
    background = await dialog_for(page).evaluate("el => getComputedStyle(el).backgroundColor")
    channels = [float(value) for value in re.findall(r"[\d.]+", background)[:3]]
    assert len(channels) == 3 and max(channels) < 80, background
    await selector_for(page).select_option(LIBRARY["id"])
    await assert_navigation(page)
    await assert_layout(page)
    await selector_for(page).scroll_into_view_if_needed()
    await page.screenshot(path=str(OUT / "dark-large-text.png"))
    await dialog_for(page).get_by_role("button", name="在平面地圖查看", exact=True).click()
    await expect(page.get_by_role("status")).to_have_text(f"已選取：{LIBRARY['name']}")
    return {**layout, "rootFontSize": "32px", "dialogBackground": background}


async def motion_and_visibility(page, _requests, _resources):
    await open_explorer(page)
    await page.wait_for_timeout(650)
    idle = await clears(page)
    await page.wait_for_timeout(300)
    assert await clears(page) == idle, "Still scene kept rendering"

    await page.emulate_media(reduced_motion="reduce")
    await page.wait_for_function("matchMedia('(prefers-reduced-motion: reduce)').matches")
    await page.wait_for_timeout(150)
    before = await clears(page)
    await selector_for(page).select_option(LIBRARY["id"])
    await page.wait_for_timeout(300)
    reduced_frames = await clears(page) - before
    assert 1 <= reduced_frames <= 3, f"Reduced-motion selection rendered {reduced_frames} frames"
    settled = await clears(page)
    await page.wait_for_timeout(300)
    assert await clears(page) == settled, "Reduced-motion scene did not settle"

    await page.emulate_media(reduced_motion="no-preference")
    await page.set_viewport_size({"width": 320, "height": 568})
    await page.locator(CANVAS).scroll_into_view_if_needed()
    await page.wait_for_timeout(650)
    navigation = dialog_for(page).get_by_role("link", name="開啟步行導航", exact=True)
    await navigation.scroll_into_view_if_needed()
    await expect(page.locator(CANVAS)).not_to_be_in_viewport()
    await page.wait_for_timeout(150)
    hidden_draws = await clears(page)
    await selector_for(page).select_option("pu-zhugu")
    await expect(page.locator(CANVAS)).not_to_be_in_viewport()
    await page.wait_for_timeout(300)
    assert await clears(page) == hidden_draws, "Offscreen scene rendered despite IntersectionObserver"
    await page.locator(CANVAS).scroll_into_view_if_needed()
    await page.wait_for_function(
        "before => window.__campusSpatialProbe.clears > before", arg=hidden_draws
    )
    await expect(page.locator('[data-spatial-marker="pu-zhugu"]')).to_have_attribute(
        "aria-pressed", "true"
    )
    return {"initialRenderCount": idle, "reducedMotionFrames": reduced_frames,
            "offscreenPause": "observed", "resume": "observed"}


async def context_loss(page, _requests, _resources):
    await page.emulate_media(reduced_motion="reduce")
    await open_explorer(page)
    await assert_webgl(page)
    previous = await page.locator(CANVAS).element_handle()
    loss = await previous.evaluate("""canvas => new Promise((resolve, reject) => {
      const gl = canvas.getContext('webgl2');
      const extension = gl?.getExtension('WEBGL_lose_context');
      if (!extension) return reject(new Error('CI browser lacks WEBGL_lose_context'));
      const timer = setTimeout(() => reject(new Error('No native context-loss event')), 5000);
      canvas.addEventListener('webglcontextlost', event => {
        clearTimeout(timer);
        resolve({ trusted: event.isTrusted, lost: gl.isContextLost() });
      }, { once: true, capture: true });
      extension.loseContext();
    })""")
    assert loss == {"trusted": True, "lost": True}, loss
    await expect(page.locator(SCENE)).to_have_attribute("data-spatial-state", "error")
    await expect(page.locator(CANVAS)).to_have_count(0)
    await expect(dialog_for(page).get_by_text(
        "這次無法顯示立體畫面。你仍可選擇地點，查看資訊與導航。", exact=True
    )).to_be_visible()
    await selector_for(page).select_option(LIBRARY["id"])
    await assert_navigation(page)
    await page.screenshot(path=str(OUT / "context-loss-fallback.png"))
    await dialog_for(page).get_by_role("button", name="重試立體畫面", exact=True).click()
    await ready(page)
    assert await page.locator(CANVAS).evaluate("(canvas, old) => canvas !== old", previous)
    await assert_webgl(page)
    await expect(selector_for(page)).to_have_value(LIBRARY["id"])
    await expect(page.locator('[data-spatial-marker="pu-library"]')).to_have_attribute(
        "aria-pressed", "true"
    )
    await previous.dispose()
    return {"nativeContextLoss": loss, "htmlDetailsAfterLoss": "available", "retry": "new WebGL2 canvas"}


async def run_case(browser, base, name, viewport, test, resources):
    context = await browser.new_context(
        viewport=viewport, device_scale_factor=1, color_scheme="light",
        reduced_motion="no-preference", service_workers="block",
        has_touch=name == "camera-touch", is_mobile=name == "camera-touch",
    )
    await context.add_init_script(PROBE)
    requests, blocked, errors, console = [], [], [], []
    allowed = urlparse(base)

    async def local_only(route):
        parsed = urlparse(route.request.url)
        if (parsed.scheme, parsed.netloc) == (allowed.scheme, allowed.netloc):
            await route.continue_()
        else:
            blocked.append(route.request.url)
            await route.abort("blockedbyclient")

    async def no_websocket(route):
        blocked.append(route.url)
        await route.close(code=1008, reason="This fixture does not use WebSockets")

    await context.route("**/*", local_only)
    await context.route_web_socket("**/*", no_websocket)
    context.on("request", lambda request: requests.append(request.url))
    page = await context.new_page()
    page.set_default_timeout(10_000)
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("console", lambda message: console.append({"type": message.type, "text": message.text})
            if message.type in ("error", "warning") else None)
    await context.tracing.start(screenshots=True, snapshots=True)
    result = {"name": name, "status": "failed", "viewport": viewport}
    started = time.monotonic()
    try:
        await page.goto(base + "/scene.html", wait_until="networkidle")
        result["observations"] = await test(page, requests, resources)
        assert not errors, f"Unhandled JavaScript errors: {errors}"
        assert not blocked, f"Fixture attempted non-local requests: {blocked}"
        result["status"] = "passed"
    except Exception:
        result["failure"] = traceback.format_exc()
        try:
            await page.screenshot(path=str(OUT / f"failure-{name}.png"))
            (OUT / f"failure-{name}.yml").write_text(
                await page.locator("body").aria_snapshot(), encoding="utf-8"
            )
        except Exception as evidence_error:
            result["evidenceError"] = str(evidence_error)
    finally:
        result.update({"seconds": round(time.monotonic() - started, 2),
                       "pageErrors": errors, "blockedRequests": blocked, "console": console})
        try:
            focus = await page.evaluate("window.__campusSpatialProbe?.focusBoundaries ?? []")
            if focus:
                result["focusBoundaries"] = focus
            result["rendererCounters"] = await page.evaluate("""() => {
              const { clears, draws, contexts, rafRequested, rafExecuted, rafPending } = window.__campusSpatialProbe;
              return { clears, draws, contexts, rafRequested, rafExecuted, rafPending };
            }""")
        except Exception as evidence_error:
            result["focusEvidenceError"] = str(evidence_error)
        await context.tracing.stop(
            path=str(OUT / f"trace-{name}.zip") if result["status"] == "failed" else None
        )
        await context.close()
    print(f"{result['status']}: {name}", flush=True)
    return result


async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    report = {
        "status": "failed",
        "scope": "Production spatial explorer and MapClient components with public POIs and labelled ambiguous fixtures",
        "limitations": [
            "Chromium with software WebGL; physical iPhone/Android GPU performance is not measured.",
            "Touch gestures use Chromium's native input emulation; physical touchscreen and Safari behavior are not verified.",
            "Offscreen pause is tested; operating-system background-tab visibility is not verified.",
            "200% root font size is tested, not browser page zoom.",
            "Navigation URLs are checked without visiting Google Maps or any external destination.",
            "The component fixture does not verify the authenticated Next.js map route or live POI freshness.",
            "MapClient uses local placeholder map tiles and mocked read-only data; this is not a full Today-to-Next.js routing test.",
        ],
        "checks": [],
    }
    server = None
    try:
        assert (OUT / "scene.html").is_file(), "Build the fixture before running browser checks"
        assert (OUT / "map.html").is_file(), "Build the MapClient fixture before running browser checks"
        resources = lazy_resources()
        server = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(QuietHandler, directory=str(OUT)))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        base = f"http://127.0.0.1:{server.server_port}"
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(
                args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
            )
            try:
                report["browserVersion"] = browser.version
                cases = [
                    ("desktop", {"width": 1440, "height": 1000}, desktop),
                    ("camera-controls", {"width": 1440, "height": 1000}, camera_controls),
                    ("camera-touch", {"width": 390, "height": 844}, touch_camera),
                    ("mobile-320", {"width": 320, "height": 568}, mobile),
                    ("mobile-390", {"width": 390, "height": 844}, mobile),
                    ("dark-large-text", {"width": 390, "height": 844}, dark_large_text),
                    ("motion-visibility", {"width": 1440, "height": 1000}, motion_and_visibility),
                    ("context-loss", {"width": 1440, "height": 1000}, context_loss),
                    ("map-classroom-unique", {"width": 390, "height": 844}, classroom_unique),
                    ("map-classroom-verified-code", {"width": 390, "height": 844}, classroom_verified_code),
                    ("map-classroom-ambiguous", {"width": 390, "height": 844}, classroom_ambiguous),
                    ("map-classroom-unknown", {"width": 320, "height": 568}, classroom_unknown),
                ]
                for name, viewport, test in cases:
                    report["checks"].append(await run_case(browser, base, name, viewport, test, resources))
            finally:
                await browser.close()
        if report["checks"] and all(check["status"] == "passed" for check in report["checks"]):
            report["status"] = "passed"
    except Exception:
        report["failure"] = traceback.format_exc()
    finally:
        if server:
            server.shutdown()
            server.server_close()
        (OUT / "results.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"status": report["status"], "checks": len(report["checks"])}), flush=True)
    if report["status"] != "passed":
        raise SystemExit(1)


if __name__ == "__main__":
    asyncio.run(main())
