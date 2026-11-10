"""Verify native PNG downloads from production components and fictional local plans.

Build with node scripts/qa/campus-spatial/build.mjs, then run this script.
Native pixel checks are separate from explicitly injected callback faults.
No deployed route, live school service, real campus geometry, or physical device is tested.
"""
import asyncio
import copy
import functools
import hashlib
import importlib
import json
import os
import struct
import threading
import traceback
from http.server import ThreadingHTTPServer

from playwright.async_api import async_playwright, expect

svg = importlib.import_module("svg-download-check")
spatial, building, OUT = svg.spatial, svg.building, svg.OUT
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


def png_group(page):
    return building.preview(page).get_by_role("group", name="PNG 圖片匯出", exact=True)


async def inspect_pixels(page, filename, expected_size, probes, screenshot=False, bounded=False):
    """Decode the actual downloaded PNG in Chromium, without mocking image/canvas APIs."""
    exported = await page.context.new_page()
    try:
        await exported.set_viewport_size({"width": 960, "height": 900})
        await exported.goto(page.url.rsplit("/", 1)[0] + "/" + filename)
        image = exported.locator("img")
        await expect(image).to_be_visible()
        pixels = await image.evaluate("""async (image, probes) => {
          await image.decode();
          const width = image.naturalWidth, height = image.naturalHeight;
          const canvas = document.createElement('canvas');
          canvas.width = width; canvas.height = height;
          const context = canvas.getContext('2d');
          if (!context) throw new Error('Missing native 2D canvas context');
          context.drawImage(image, 0, 0);
          const data = context.getImageData(0, 0, width, height).data;
          let opaque = 0, red = 0, room = 0, background = 0;
          for (let i = 0; i < data.length; i += 4) {
            const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
            if (a === 255) opaque++;
            if (r > 100 && r > g * 1.5 && r > b * 1.5) red++;
            if (r === 220 && g === 234 && b === 243) room++;
            if (r === 238 && g === 243 && b === 246) background++;
          }
          const samples = probes.map(probe => {
            const x = Math.min(width - 1, Math.round(probe.x * width / 960));
            const y = Math.min(height - 1, Math.round(probe.y * width / 960));
            const offset = (y * width + x) * 4;
            return {name: probe.name, rgba: Array.from(data.subarray(offset, offset + 4))};
          });
          const digest = await crypto.subtle.digest('SHA-256', data);
          return {width, height, opaquePixels: opaque, redPixels: red, roomPixels: room,
            backgroundPixels: background, samples,
            pixelSha256: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')};
        }""", probes)
        if expected_size:
            assert (pixels["width"], pixels["height"]) == expected_size, pixels
        assert pixels["opaquePixels"] == pixels["width"] * pixels["height"], pixels
        assert pixels["redPixels"] > 20 and pixels["roomPixels"] > 100 and pixels["backgroundPixels"] > 100, pixels
        for actual, probe in zip(pixels["samples"], probes):
            assert actual["rgba"] == probe["rgba"], (filename, actual, probe)
        if bounded:
            assert pixels["width"] <= 4096 and pixels["height"] == 4096, pixels
            assert pixels["width"] * pixels["height"] <= 4_000_000, pixels
            assert abs(pixels["width"] / pixels["height"] - 960 / 4338) < 1 / pixels["height"], pixels
        if screenshot:
            await image.evaluate("""image => {
              document.body.style.margin = '0';
              image.style.maxWidth = '100%'; image.style.height = 'auto';
            }""")
            await exported.screenshot(path=str(OUT / filename.replace(".png", "-rendered.png")))
        return pixels
    finally:
        await exported.close()


async def workflow(page, _requests, _resources):
    width = page.viewport_size["width"]
    prefix = f"png-download-{width}"
    downloads, native_events = [], []
    page.on("download", lambda result: native_events.append(result.suggested_filename))
    await building.open_plan(page, example=False)
    await page.evaluate("""() => {
      const create = URL.createObjectURL, revoke = URL.revokeObjectURL;
      window.__pngUrls = {created: [], revoked: []};
      URL.createObjectURL = function(blob) {
        const url = Reflect.apply(create, this, [blob]);
        window.__pngUrls.created.push({url, type: blob.type});
        return url;
      };
      URL.revokeObjectURL = function(url) {
        window.__pngUrls.revoked.push(url);
        return Reflect.apply(revoke, this, [url]);
      };
    }""")
    plan = svg.fictional_plan()
    await svg.upload(page, plan)
    floors = building.preview(page).get_by_role("combobox", name="樓層", exact=True)
    quality = png_group(page).get_by_role("combobox", name="PNG 畫質", exact=True)
    await expect(quality).to_have_value("2")
    await expect(floors).to_have_value("")
    await building.no_overflow(page)

    async def download(stage, expected_filename, expected_size, probes=(), keyboard=False, bounded=False):
        button = png_group(page).get_by_role("button", name="下載平面圖 PNG", exact=True)
        async with page.expect_download() as pending:
            if keyboard:
                await button.focus()
                await page.keyboard.press("Enter")
            else:
                await button.click()
        result = await pending.value
        assert await result.failure() is None
        assert result.suggested_filename == expected_filename, (stage, result.suggested_filename)
        assert len(result.suggested_filename.encode("utf-8")) <= 150
        target = OUT / f"{prefix}-{stage}.png"
        await result.save_as(target)
        data = target.read_bytes()
        assert data[:8] == PNG_MAGIC and data[12:16] == b"IHDR", (stage, data[:24])
        ihdr = struct.unpack(">II", data[16:24])
        if expected_size:
            assert ihdr == expected_size, (stage, ihdr)
        await expect(button).to_be_enabled()
        await expect(png_group(page).get_by_role("button", name="取消 PNG 匯出", exact=True)).to_have_count(0)
        await expect(png_group(page).get_by_role("status")).to_contain_text("瀏覽器")
        await expect(page.locator("a[download]")).to_have_count(0)
        pixels = await inspect_pixels(page, target.name, expected_size, list(probes),
                                      screenshot=stage in {"all", "one", "twelve-floors"}, bounded=bounded)
        assert ihdr == (pixels["width"], pixels["height"])
        record = {"stage": stage, "file": target.name, "suggestedFilename": result.suggested_filename,
                  "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(), "pixels": pixels,
                  "nativeEncodingAndDecoding": True}
        downloads.append(record)
        return record

    all_name = "平面圖-虛構圖面・中文下載驗證-全部樓層.png"
    one_name = "平面圖-虛構圖面・中文下載驗證-單層-二樓・研究區.png"
    # These known fixture positions distinguish the two floors' room geometry.
    all_probes = [{"name": "first-floor-outside-room", "x": 490, "y": 250, "rgba": [244, 247, 249, 255]},
                  {"name": "second-floor-inside-room", "x": 490, "y": 600, "rgba": [220, 234, 243, 255]}]
    single_probes = [{"name": "selected-second-floor-room", "x": 490, "y": 250, "rgba": [220, 234, 243, 255]}]
    await download("all", all_name, (1920, 1676), all_probes, keyboard=width > 1000)
    await floors.select_option(label=svg.FLOORS[1])
    await expect(floors).to_have_value("研究層")
    single = await download("one", one_name, (1920, 976), single_probes)
    repeated = await download("repeat", one_name, (1920, 976), single_probes)
    assert repeated["pixels"]["pixelSha256"] == single["pixels"]["pixelSha256"]
    await quality.select_option("1")
    await download("one-standard", one_name, (960, 488), single_probes)
    await png_group(page).scroll_into_view_if_needed()
    await building.no_overflow(page)
    await page.screenshot(path=str(OUT / f"{prefix}-controls.png"))
    await png_group(page).screenshot(path=str(OUT / f"{prefix}-controls-detail.png"))

    faults = None
    if width > 1000:
        tall = copy.deepcopy(plan)
        tall["name"] = "十二層虛構圖面"
        tall["floors"] = []
        for index in range(12):
            floor = copy.deepcopy(plan["floors"][0])
            floor.update({"id": f"floor-{index}", "label": f"第{index + 1}層・虛構", "elevation": index * 3})
            floor["rooms"][0].update({"id": f"room-{index}", "name": f"虛構房間{index + 1}"})
            tall["floors"].append(floor)
        await svg.upload(page, tall)
        await quality.select_option("2")
        await download("twelve-floors", "平面圖-十二層虛構圖面-全部樓層.png", None, bounded=True)

        # The native downloads above are complete. These injected callback faults
        # test lifecycle/error behavior only and are reported separately from pixels.
        await svg.upload(page, plan)
        await floors.select_option("研究層")
        await quality.select_option("2")
        await page.evaluate("""() => {
          const original = HTMLCanvasElement.prototype.toBlob;
          const state = {mode: 'hold', pending: []};
          window.__pngBlobFault = state;
          state.restore = () => { HTMLCanvasElement.prototype.toBlob = original; };
          HTMLCanvasElement.prototype.toBlob = function(callback, ...args) {
            if (state.mode === 'null') { queueMicrotask(() => callback(null)); return; }
            if (state.mode === 'hold') {
              return Reflect.apply(original, this, [blob => state.pending.push(() => callback(blob)), ...args]);
            }
            return Reflect.apply(original, this, [callback, ...args]);
          };
        }""")
        try:
            before = len(native_events)
            await png_group(page).get_by_role("button", name="下載平面圖 PNG", exact=True).click()
            await page.wait_for_function("window.__pngBlobFault.pending.length === 1")
            await expect(png_group(page).get_by_role("button", name="正在產生 PNG…", exact=True)).to_be_disabled()
            await png_group(page).get_by_role("button", name="取消 PNG 匯出", exact=True).click()
            await page.evaluate("window.__pngBlobFault.pending.splice(0).forEach(callback => callback())")
            await expect(png_group(page).get_by_role("button", name="下載平面圖 PNG", exact=True)).to_be_enabled()
            await expect(png_group(page).get_by_role("button", name="取消 PNG 匯出", exact=True)).to_have_count(0)

            await png_group(page).get_by_role("button", name="下載平面圖 PNG", exact=True).click()
            await page.wait_for_function("window.__pngBlobFault.pending.length === 1")
            await floors.select_option("")
            await page.evaluate("window.__pngBlobFault.pending.splice(0).forEach(callback => callback())")
            await expect(png_group(page).get_by_role("button", name="下載平面圖 PNG", exact=True)).to_be_enabled()
            # Returning to the cancelled selection must not resurrect stale busy UI.
            await floors.select_option("研究層")
            await expect(png_group(page).get_by_role("button", name="下載平面圖 PNG", exact=True)).to_be_enabled()
            await floors.select_option("")
            await page.evaluate("() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
            assert len(native_events) == before, native_events

            await page.evaluate("window.__pngBlobFault.mode = 'null'")
            await png_group(page).get_by_role("button", name="下載平面圖 PNG", exact=True).click()
            await expect(building.preview(page).get_by_role("alert")).to_be_visible()
            await expect(png_group(page).get_by_role("button", name="下載平面圖 PNG", exact=True)).to_be_enabled()
            assert len(native_events) == before, native_events
        finally:
            await page.evaluate("window.__pngBlobFault.restore()")
        await download("after-error-retry", all_name, (1920, 1676), all_probes)
        await expect(building.preview(page).get_by_role("alert")).to_have_count(0)
        faults = {"injection": "Desktop only: held native toBlob callbacks, then a null toBlob callback; restored before retry",
                  "cancelSuppressesLateDownload": True, "floorChangeSuppressesLateDownload": True,
                  "returnToCancelledSelectionEnabled": True,
                  "nullBlobShowsError": True, "retryUsesNativeEncoder": True}

    await building.preview(page).get_by_role("button", name="關閉視窗", exact=True).click()
    await page.wait_for_function("""() => window.__pngUrls.created.length > 0 &&
      window.__pngUrls.created.every(item => window.__pngUrls.revoked.includes(item.url))""")
    urls = await page.evaluate("""() => ({
      created: window.__pngUrls.created.length, revoked: window.__pngUrls.revoked.length,
      svgIntermediates: window.__pngUrls.created.filter(item => item.type.startsWith('image/svg+xml')).length,
      pngDownloads: window.__pngUrls.created.filter(item => item.type === 'image/png').length,
      allRevoked: window.__pngUrls.created.every(item => window.__pngUrls.revoked.includes(item.url))
    })""")
    assert urls["svgIntermediates"] >= len(downloads) and urls["pngDownloads"] == len(downloads), urls
    assert len(native_events) == len(downloads), native_events
    return {"nativeDownloads": downloads, "objectURLs": urls, "mockFaults": faults,
            "repeatPixelsStable": True, "unicodeFilenamePreserved": True}


async def main():
    report = {"status": "failed", "scope": "Native Chromium PNG downloads from production components with fictional local plans",
              "limitations": ["Public-POI fixture, not authenticated or deployed Next.js routes.",
                              "1440px and 320px viewport emulation, not physical mobile hardware or Safari.",
                              "Native PNG pixel evidence excludes the separately reported callback fault injections.",
                              "No real campus drawings, live school services, indoor navigation, printing, or competitor comparison."],
              "checks": []}
    server = None
    try:
        assert (OUT / "scene.html").is_file(), "Build the production-component fixture first"
        server = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(spatial.QuietHandler, directory=str(OUT)))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(
                executable_path=os.environ.get("CAMPUS_PNG_CHROMIUM"),
                args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
            )
            try:
                report["browserVersion"] = browser.version
                for name, viewport in [
                    ("png-download-desktop", {"width": 1440, "height": 1100}),
                    ("png-download-narrow", {"width": 320, "height": 568}),
                ]:
                    report["checks"].append(await spatial.run_case(
                        browser, f"http://127.0.0.1:{server.server_port}", name, viewport, workflow, set()))
            finally:
                await browser.close()
        if len(report["checks"]) == 2 and all(check["status"] == "passed" for check in report["checks"]):
            report["status"] = "passed"
    except Exception:
        report["failure"] = traceback.format_exc()
    finally:
        if server:
            server.shutdown()
            server.server_close()
        OUT.mkdir(parents=True, exist_ok=True)
        (OUT / "png-download-results.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"status": report["status"], "pngChecks": len(report["checks"])}), flush=True)
    if report["status"] != "passed":
        raise SystemExit(1)


if __name__ == "__main__":
    asyncio.run(main())
