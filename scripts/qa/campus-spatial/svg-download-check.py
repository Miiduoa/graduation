"""Verify native SVG downloads from production components using fictional local plans.

Build with node scripts/qa/campus-spatial/build.mjs, then run this script.
No school account, live map API, deployed route, or physical device is exercised.
"""
import asyncio
import copy
import functools
import hashlib
import importlib
import json
import os
import threading
import traceback
import xml.etree.ElementTree as ET
from http.server import ThreadingHTTPServer

from playwright.async_api import async_playwright, expect

import check as spatial

building = importlib.import_module("building-check")
OUT = spatial.OUT
SVG = "{http://www.w3.org/2000/svg}"
TITLE = "虛構圖面・中文下載驗證"
FLOORS = ["地下一樓 B１", "二樓・研究區"]
ROOMS = ["研討室甲", "研究室乙"]


def fictional_plan():
    return {
        "version": 1, "schoolId": "pu", "buildingId": spatial.LIBRARY["id"],
        "name": TITLE, "units": "m", "source": {"label": "虛構驗收資料，非校方圖資"},
        "floors": [
            {"id": "地下層", "label": FLOORS[0], "elevation": -3, "height": 3,
             "outline": [[0, 0], [12, 0], [12, 8], [0, 8]],
             "rooms": [{"id": "甲", "name": ROOMS[0], "polygon": [[1, 1], [5, 1], [5, 6], [1, 6]]}],
             "walls": []},
            {"id": "研究層", "label": FLOORS[1], "elevation": 3, "height": 3,
             "outline": [[0, 0], [10, 0], [10, 8], [0, 8]],
             "rooms": [{"id": "乙", "name": ROOMS[1], "polygon": [[1, 1], [6, 1], [6, 6], [1, 6]]}],
             "walls": []},
        ],
    }


async def open_importer(page):
    details = building.preview(page).locator("details").filter(
        has=page.get_by_label("匯入 JSON 圖面", exact=True))
    if await details.get_attribute("open") is None:
        await details.locator("summary").click()


async def upload(page, plan):
    await open_importer(page)
    await building.preview(page).get_by_label("匯入 JSON 圖面", exact=True).set_input_files({
        "name": "虛構圖面.json", "mimeType": "application/json",
        "buffer": json.dumps(plan, ensure_ascii=False).encode("utf-8"),
    })
    await expect(building.preview(page).get_by_role("heading", name=plan["name"], exact=True)).to_be_visible()
    await expect(building.preview(page).get_by_role("alert")).to_have_count(0)


async def workflow(page, _requests, _resources):
    width = page.viewport_size["width"]
    prefix = f"svg-download-{width}"
    downloads = []
    await building.open_plan(page, example=False)
    await page.evaluate("""() => {
      const create = URL.createObjectURL, revoke = URL.revokeObjectURL;
      window.__svgUrls = {created: [], revoked: []};
      URL.createObjectURL = function(blob) {
        const url = Reflect.apply(create, this, [blob]);
        if (blob.type.startsWith('image/svg+xml')) window.__svgUrls.created.push(url);
        return url;
      };
      URL.revokeObjectURL = function(url) {
        window.__svgUrls.revoked.push(url);
        return Reflect.apply(revoke, this, [url]);
      };
    }""")

    async def download(stage, required, excluded=(), keyboard=False):
        button = building.preview(page).get_by_role("button", name="下載平面圖 SVG", exact=True)
        async with page.expect_download() as pending:
            if keyboard:
                await button.focus()
                await page.keyboard.press("Enter")
            else:
                await button.click()
        result = await pending.value
        assert await result.failure() is None
        assert result.suggested_filename.endswith(".svg"), result.suggested_filename
        target = OUT / f"{prefix}-{stage}.svg"
        await result.save_as(target)
        data = target.read_bytes()
        root = ET.fromstring(data)
        assert root.tag == SVG + "svg"
        texts = [element.text or "" for element in root.iter(SVG + "text")]
        for value in required:
            assert value in texts, (stage, value, texts)
        for value in excluded:
            assert value not in texts, (stage, value)
        assert any("待核對" in text for text in texts)
        assert all(element.tag in {SVG + tag for tag in ("svg", "g", "title", "desc", "rect", "text", "polygon", "line")}
                   for element in root.iter())
        assert not any(attribute.lower().endswith("href") or attribute.lower().startswith("on")
                       for element in root.iter() for attribute in element.attrib)
        await expect(page.locator("a[download]")).to_have_count(0)
        downloads.append({"stage": stage, "file": target.name, "suggestedFilename": result.suggested_filename,
                          "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(),
                          "requiredText": required, "excludedText": list(excluded)})
        return data

    plan = fictional_plan()
    await upload(page, plan)
    floors = building.preview(page).get_by_role("combobox", name="樓層", exact=True)
    await expect(floors).to_have_value("")
    await building.no_overflow(page)
    await download("all", [TITLE, *FLOORS, *ROOMS], keyboard=width > 1000)
    await floors.select_option(label=FLOORS[1])
    await expect(floors).to_have_value("研究層")
    one = await download("one", [TITLE, FLOORS[1], ROOMS[1]], [FLOORS[0], ROOMS[0]])
    assert await download("repeat", [TITLE, FLOORS[1], ROOMS[1]], [FLOORS[0], ROOMS[0]]) == one
    await floors.scroll_into_view_if_needed()
    await page.screenshot(path=str(OUT / f"{prefix}-selected.png"))

    # Cancel the real tracing UI and verify it preserves the selected export.
    await open_importer(page)
    await building.preview(page).get_by_role("button", name="從圖片建立圖面", exact=True).click()
    await expect(building.preview(page).get_by_role("button", name="下載平面圖 SVG", exact=True)).to_have_count(0)
    await building.preview(page).get_by_role("button", name="取消描圖", exact=True).click()
    await expect(floors).to_have_value("研究層")
    assert await download("after-cancel", [TITLE, FLOORS[1], ROOMS[1]], [FLOORS[0], ROOMS[0]]) == one

    # A rejected replacement must not silently replace the visible plan or export.
    await open_importer(page)
    await building.preview(page).get_by_label("匯入 JSON 圖面", exact=True).set_input_files({
        "name": "invalid.json", "mimeType": "application/json", "buffer": b"{broken",
    })
    await expect(building.preview(page).get_by_role("alert")).to_be_visible()
    await expect(floors).to_have_value("研究層")
    assert await download("after-rejected-import", [TITLE, FLOORS[1], ROOMS[1]], [FLOORS[0], ROOMS[0]]) == one

    replacement = copy.deepcopy(plan)
    replacement["name"] = "另一份虛構圖面"
    replacement["floors"] = [replacement["floors"][0]]
    replacement["floors"][0].update({"id": "新樓層", "label": "屋頂層・測試"})
    replacement["floors"][0]["rooms"][0].update({"id": "新房間", "name": "設備間丙"})
    await upload(page, replacement)
    await expect(floors).to_have_value("")
    await download("replacement", [replacement["name"], "屋頂層・測試", "設備間丙"], [TITLE, *FLOORS, *ROOMS])
    await open_importer(page)
    await building.preview(page).get_by_role("button", name="清除圖面", exact=True).click()
    await expect(building.preview(page)).to_contain_text("尚未載入圖面")
    await expect(building.preview(page).get_by_role("button", name="下載平面圖 SVG", exact=True)).to_have_count(0)
    await building.preview(page).get_by_role("button", name="載入示意範例", exact=True).click()
    await expect(floors).to_have_value("")
    await download("reloaded-example", ["1F", "2F", "範例教室 101", "範例教室 201"], [TITLE, "屋頂層・測試"])
    await building.no_overflow(page)
    await building.preview(page).get_by_role("button", name="關閉視窗", exact=True).click()
    await page.wait_for_function("""() => window.__svgUrls.created.length === 7 &&
      window.__svgUrls.created.every(url => window.__svgUrls.revoked.includes(url))""")
    urls = await page.evaluate("({created: window.__svgUrls.created.length, revoked: window.__svgUrls.revoked.length})")

    # Open the native downloaded artifact itself to verify it renders independently.
    exported = await page.context.new_page()
    await exported.goto(page.url.rsplit("/", 1)[0] + f"/{prefix}-all.svg")
    await expect(exported.locator("svg")).to_be_visible()
    await expect(exported.locator("text").filter(has_text=ROOMS[1])).to_be_visible()
    await exported.screenshot(path=str(OUT / f"{prefix}-rendered.png"), full_page=True)
    await exported.close()
    return {"downloads": downloads, "objectURLs": urls, "cancelPreservedSelection": True,
            "rejectedImportPreservedSelection": True, "replacementResetSelection": True,
            "clearRemovedExport": True, "reloadedExampleHasNoPreviousPlan": True,
            "standaloneSvgRendered": True}


async def main():
    report = {"status": "failed", "scope": "Production components; native Chromium SVG downloads of fictional local plans",
              "limitations": ["Public-POI fixture; authenticated/deployed Next.js route not exercised.",
                              "Desktop and 320px viewport emulation, not physical mobile hardware or Safari.",
                              "No real campus drawing, indoor navigation, live school service, or competitor comparison."],
              "checks": []}
    server = None
    try:
        assert (OUT / "scene.html").is_file(), "Build the production-component fixture first"
        server = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(spatial.QuietHandler, directory=str(OUT)))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(
                executable_path=os.environ.get("CAMPUS_SVG_CHROMIUM"),
                args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
            )
            try:
                report["browserVersion"] = browser.version
                for name, viewport in [
                    ("svg-download-desktop", {"width": 1440, "height": 1100}),
                    ("svg-download-narrow", {"width": 320, "height": 568}),
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
        (OUT / "svg-download-results.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"status": report["status"], "svgChecks": len(report["checks"])}), flush=True)
    if report["status"] != "passed":
        raise SystemExit(1)


if __name__ == "__main__":
    asyncio.run(main())
