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
from urllib.parse import parse_qs, urlparse

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

PROBE = """(() => {
  const probe = { clears: 0, draws: 0 };
  window.__campusSpatialProbe = probe;
  if (typeof WebGL2RenderingContext === 'undefined') return;
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


async def clears(page):
    return await page.evaluate("window.__campusSpatialProbe.clears")


async def ready(page):
    await expect(page.locator(SCENE)).to_have_attribute(
        "data-spatial-state", "ready", timeout=20_000
    )
    await expect(page.locator("[data-spatial-marker]:visible").first).to_be_visible()
    await page.wait_for_function("window.__campusSpatialProbe.draws > 0")


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


async def assert_navigation(page):
    dialog = dialog_for(page)
    await expect(dialog.get_by_role("heading", name=LIBRARY["name"], exact=True)).to_be_visible()
    link = dialog.get_by_role("link", name="開啟步行導航", exact=True)
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
    assert abs(destination[0] - LIBRARY["lat"]) < 1e-9, href
    assert abs(destination[1] - LIBRARY["lng"]) < 1e-9, href
    await expect(link).to_have_attribute("target", "_blank")
    assert {"noopener", "noreferrer"} <= set((await link.get_attribute("rel")).split())
    await expect(dialog.get_by_role("link", name="查看地點資料來源 ↗", exact=True)).to_have_attribute(
        "href", LIBRARY["source"]
    )
    return href


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
    last = dialog.get_by_role("link", name="查看地點資料來源 ↗", exact=True)
    await last.focus()
    await page.keyboard.press("Tab")
    await expect(close).to_be_focused()
    await page.keyboard.press("Shift+Tab")
    await expect(last).to_be_focused()

    await ready(page)
    loaded = resources.intersection(urlparse(url).path for url in requests)
    assert loaded, "Opening the explorer did not request its real lazy scene chunk"
    graphics = await assert_webgl(page)
    layout = await assert_layout(page)
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
        "scope": "Production spatial explorer components with checked-in public POIs",
        "limitations": [
            "Chromium with software WebGL; physical iPhone/Android GPU performance is not measured.",
            "Offscreen pause is tested; operating-system background-tab visibility is not verified.",
            "200% root font size is tested, not browser page zoom.",
            "Navigation URLs are checked without visiting Google Maps or any external destination.",
            "The component fixture does not verify the authenticated Next.js map route or live POI freshness.",
        ],
        "checks": [],
    }
    server = None
    try:
        assert (OUT / "scene.html").is_file(), "Build the fixture before running browser checks"
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
                    ("mobile-320", {"width": 320, "height": 568}, mobile),
                    ("mobile-390", {"width": 390, "height": 844}, mobile),
                    ("dark-large-text", {"width": 390, "height": 844}, dark_large_text),
                    ("motion-visibility", {"width": 1440, "height": 1000}, motion_and_visibility),
                    ("context-loss", {"width": 1440, "height": 1000}, context_loss),
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
