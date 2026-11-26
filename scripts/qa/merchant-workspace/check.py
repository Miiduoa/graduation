"""CI browser checks of real merchant UI with explicitly synthetic data.

This script starts the read-only fixture server. It never connects to a deployed
application, signs into a real account, or submits a merchant/payment mutation.
"""

import asyncio
import hashlib
import json
import os
import re
import socket
import subprocess
import time
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlparse
from urllib.request import urlopen

from playwright.async_api import async_playwright, expect


ROOT = Path(__file__).resolve().parents[3]
OUTPUT = ROOT / "artifacts" / "merchant-workspace"
BASE = "/merchant/workspace"
A = BASE + "?tenant=campus-one&location=store-a"
B = BASE + "?tenant=campus-one&location=store-b"
ACTIVE = A + "&section=orders&queue=active"
A_NAME = "日常食堂／學生活動中心一樓"
B_NAME = "日常食堂／圖書館旁外帶門市"
A_LINK = "管理門市：學生活動中心一樓"
B_LINK = "管理門市：圖書館旁外帶門市"
ACCESS_ERROR = "目前無法取得這間門市的管理權限。請重新讀取，或返回我的門市。"
SCENARIOS = [
    {"name": "desktop-light", "width": 1440, "height": 1000, "theme": "light"},
    {"name": "phone-dark", "width": 390, "height": 844, "theme": "dark"},
    {
        "name": "compact-text200-reduced",
        "width": 320,
        "height": 740,
        "theme": "dark",
        "text": "200",
        "motion": "reduce",
    },
]


def workspace_query(url):
    return parse_qs(urlparse(url).query)


def verify_sources(manifest):
    head = subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True
    ).strip()
    expected = os.environ.get("MERCHANT_QA_SOURCE_SHA") or head
    assert head == expected, f"Checkout {head} does not match requested source {expected}"
    assert manifest.get("gitHead") == head, "Fixture manifest belongs to a different commit"
    assert manifest.get("synthetic") is True and manifest.get("files")
    for entry in manifest["files"]:
        source = ROOT / entry["path"]
        digest = hashlib.sha256(source.read_bytes()).hexdigest()
        assert digest == entry["sha256"], f"Fixture source changed after bundling: {entry['path']}"
    return {"gitHead": head, "expectedGitHead": expected, "fileCount": len(manifest["files"])}


async def no_writes(page, report, stage):
    snapshot = await page.evaluate("window.__merchantQA.snapshot()")
    report["ledgers"].append({"stage": stage, **snapshot})
    assert not snapshot["ledger"]["writes"], f"Unexpected synthetic write at {stage}"
    assert not snapshot["ledger"]["externalRequests"], f"Unexpected fetch at {stage}"
    assert not any(row["mutation"] for row in snapshot["ledger"]["requests"]), stage
    return snapshot


async def layout(page, report, stage):
    # Scroll width is the document oracle. Off-screen fixed UI or clipped text
    # cannot be excused merely because the principal card fits the viewport.
    geometry = await page.evaluate("""() => {
      const viewport = document.documentElement.clientWidth;
      const scrollWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
      const overflow = [...document.querySelectorAll('main *, .fixture-controls *')]
        .filter(node => {
          const r = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          return r.width > 0 && r.height > 0 && style.visibility !== 'hidden' &&
            style.display !== 'none' && (r.left < -1 || r.right > viewport + 1);
        }).slice(0, 10).map(node => ({
          tag: node.tagName, text: node.textContent?.trim().slice(0, 90),
          left: node.getBoundingClientRect().left, right: node.getBoundingClientRect().right,
        }));
      const targets = [...document.querySelectorAll('nav[aria-label="門市工作"] a, nav[aria-label="訂單篩選"] a')]
        .map(node => ({ label: node.textContent?.trim(), height: node.getBoundingClientRect().height }));
      return { viewport, scrollWidth, rootFont: getComputedStyle(document.documentElement).fontSize,
        theme: document.documentElement.dataset.theme, overflow, targets };
    }""")
    report["layouts"].append({"stage": stage, **geometry})
    assert geometry["scrollWidth"] <= geometry["viewport"] + 1, (stage, geometry)
    assert not geometry["overflow"], (stage, geometry)
    assert all(target["height"] >= 43.99 for target in geometry["targets"]), (stage, geometry)


async def capture(page, report, stage):
    await layout(page, report, stage)
    filename = f'{report["name"]}-{stage}.png'
    await page.screenshot(path=str(OUTPUT / filename), full_page=True, animations="disabled")
    report["screenshots"].append(filename)


async def wait_store(page, name=A_NAME):
    # The list contains the same store name at h4. Await the actual h2 detail
    # heading so a route transition cannot pass on the outgoing list item.
    await expect(page.get_by_role("heading", name=name, exact=True, level=2)).to_be_visible()
    await expect(page.get_by_role("button", name="重新讀取門市狀態", exact=True)).to_be_enabled()


async def wait_orders(page, codes):
    desk = page.get_by_role("region", name="門市訂單工作台", exact=True)
    await expect(desk).to_be_visible()
    await expect(desk.get_by_role("navigation", name="訂單篩選", exact=True)).to_be_visible()
    await expect(desk.get_by_role("heading", name=re.compile(r"^取餐 A10"))).to_have_count(len(codes))
    for code in ("A101", "A102", "A103", "A104"):
        target = desk.get_by_role("heading", name=re.compile(rf"^取餐 {code} ·"))
        if code in codes:
            await expect(target).to_be_visible()
        else:
            await expect(target).to_have_count(0)
    return desk


async def choose_queue(page, label, value, codes):
    link = page.get_by_role("navigation", name="訂單篩選", exact=True).get_by_role(
        "link", name=label, exact=True
    )
    await link.click()
    await expect(link).to_have_attribute("aria-current", "page")
    assert workspace_query(page.url).get("queue", ["all"]) == [value]
    await wait_orders(page, codes)


async def verify_navigation(page, report):
    await expect(page.get_by_role("heading", name="已授權門市", exact=True)).to_be_visible()
    first = page.get_by_role("link", name=A_LINK, exact=True)
    second = page.get_by_role("link", name=B_LINK, exact=True)
    await expect(first).to_have_attribute("href", A)
    await expect(second).to_have_attribute("href", B)
    await capture(page, report, "locations")
    await first.focus()
    await page.keyboard.press("Enter")
    await wait_store(page)
    assert workspace_query(page.url) == {"tenant": ["campus-one"], "location": ["store-a"]}
    await expect(page.get_by_role("navigation", name="門市工作").get_by_role(
        "link", name="門市概況", exact=True
    )).to_have_attribute("aria-current", "page")
    await capture(page, report, "overview")
    await page.go_back()
    await expect(first).to_be_visible()
    await expect(first).to_be_focused()
    await layout(page, report, "back-to-locations")
    await page.go_forward()
    await wait_store(page)
    assert workspace_query(page.url).get("location") == ["store-a"]
    report["checks"].append("Distinct store links, keyboard entry and browser Back/Forward preserve the selected location and return focus")

    await page.get_by_role("navigation", name="門市工作").get_by_role(
        "link", name="訂單與收銀", exact=True
    ).click()
    await wait_orders(page, ("A101", "A102", "A103", "A104"))
    await layout(page, report, "orders-all")
    await choose_queue(page, "待收款與確認，本頁 2 筆", "incoming", ("A101", "A102"))
    await layout(page, report, "orders-incoming")
    await choose_queue(page, "備餐與取餐，本頁 2 筆", "active", ("A103", "A104"))
    await capture(page, report, "orders-active")
    await no_writes(page, report, "before-refresh")
    url_before = page.url
    await page.reload()
    await wait_store(page)
    await wait_orders(page, ("A103", "A104"))
    assert page.url == url_before, "Refresh lost the canonical store/section/filter URL"
    await layout(page, report, "orders-after-refresh")
    await choose_queue(page, "全部，本頁 4 筆", "all", ("A101", "A102", "A103", "A104"))
    await choose_queue(page, "待收款與確認，本頁 2 筆", "incoming", ("A101", "A102"))
    nav = page.get_by_role("navigation", name="門市工作", exact=True)
    await nav.get_by_role("link", name="門市概況", exact=True).click()
    await expect(page.get_by_role("region", name="門市訂單工作台")).to_have_count(0)
    await nav.get_by_role("link", name="訂單與收銀", exact=True).click()
    await wait_orders(page, ("A101", "A102"))
    assert workspace_query(page.url).get("queue") == ["incoming"]
    report["checks"].append("All/incoming/active filters use real order cards; refresh and overview/orders navigation preserve the URL filter without mutations")

    opener_url = page.url
    async with page.context.expect_page() as popup_info:
        await nav.get_by_role("link", name="門市概況", exact=True).click(modifiers=["Control"])
    popup = await popup_info.value
    try:
        await wait_store(popup)
        assert workspace_query(popup.url).get("location") == ["store-a"]
        assert workspace_query(popup.url).get("section", ["overview"]) == ["overview"]
        assert page.url == opener_url, "Opening another tab changed the original workspace"
        await layout(popup, report, "new-tab-overview")
        await no_writes(popup, report, "new-tab-overview")
    finally:
        await popup.close()
    await page.bring_to_front()
    report["checks"].append("Modified-click opens a real store link in another tab while preserving the original order workspace")


async def verify_drafts_and_access(page, report):
    await page.get_by_role("link", name="返回我的門市", exact=True).click()
    await page.get_by_role("link", name=B_LINK, exact=True).click()
    await wait_store(page, B_NAME)
    draft = page.get_by_label("品項 1 名稱", exact=True)
    draft_value = "圖書館門市的手作便當草稿"
    await draft.fill(draft_value)
    await capture(page, report, "store-b-draft")
    await page.get_by_role("link", name="返回我的門市", exact=True).click()
    await page.get_by_role("link", name=A_LINK, exact=True).click()
    await wait_store(page)
    await expect(page.get_by_label("品項 1 名稱", exact=True)).to_have_count(0)
    await page.get_by_role("link", name="返回我的門市", exact=True).click()
    await page.get_by_role("link", name=B_LINK, exact=True).click()
    await wait_store(page, B_NAME)
    await expect(draft).to_have_value(draft_value)
    await page.get_by_role("navigation", name="門市工作").get_by_role(
        "link", name="訂單與收銀", exact=True
    ).click()
    await expect(page.get_by_role("heading", name="這間門市尚未開放訂單工作台", exact=True)).to_be_visible()
    await expect(page.get_by_role("region", name="門市訂單工作台")).to_have_count(0)
    snapshot = await no_writes(page, report, "unactivated-store")
    assert not any(row["path"].endswith("store-b/orders") for row in snapshot["ledger"]["requests"])
    await layout(page, report, "unactivated-orders")
    await page.get_by_role("link", name="查看門市概況", exact=True).click()
    await expect(draft).to_have_value(draft_value)
    report["checks"].append("Unsaved menu data stays with its store; another location cannot receive it and an unactivated store cannot load orders")

    await page.get_by_role("button", name="切換合成帳號", exact=True).click()
    await expect(page.get_by_role("alert").filter(has_text=ACCESS_ERROR)).to_be_visible()
    await expect(page.get_by_role("heading", name=B_NAME, exact=True)).to_have_count(0)
    await expect(draft).to_have_count(0)
    await layout(page, report, "account-without-access")
    await page.get_by_role("button", name="切換合成帳號", exact=True).click()
    await wait_store(page, B_NAME)
    await expect(draft).to_have_value("")
    report["checks"].append("A confirmed account change hides previous store data, rechecks authorization and clears the previous account's draft")

    await page.get_by_role("button", name="開啟一樓備餐與取餐", exact=True).click()
    await wait_orders(page, ("A103", "A104"))
    await page.get_by_role("button", name="撤回一樓門市權限", exact=True).click()
    await page.get_by_role("button", name="重新讀取門市狀態", exact=True).click()
    await expect(page.get_by_role("alert").filter(has_text=ACCESS_ERROR)).to_be_visible()
    await expect(page.get_by_role("heading", name=A_NAME, exact=True)).to_have_count(0)
    await expect(page.get_by_role("region", name="門市訂單工作台")).to_have_count(0)
    await capture(page, report, "permission-revoked")
    await page.get_by_role("button", name="恢復一樓門市權限", exact=True).click()
    await page.get_by_role("button", name="重新讀取門市狀態", exact=True).click()
    await wait_orders(page, ("A103", "A104"))
    report["checks"].append("A server-denied permission refresh removes old store/order content and provides a working recovery action")

    await page.get_by_role("button", name="延遲後續讀取", exact=True).click()
    await page.get_by_role("button", name="重新讀取門市狀態", exact=True).click()
    await page.wait_for_function("window.__merchantQA.snapshot().state.pendingReads > 0")
    await expect(page.get_by_text("正在重新確認門市，確認後會接回訂單工作台。", exact=True)).to_be_visible()
    await page.get_by_role("button", name="切換合成帳號", exact=True).click()
    await expect(page.get_by_role("alert").filter(has_text=ACCESS_ERROR)).to_be_visible()
    await page.get_by_role("button", name="釋放等待中的讀取", exact=True).click()
    await page.wait_for_function("window.__merchantQA.snapshot().state.pendingReads === 0")
    await page.evaluate("() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
    await expect(page.get_by_role("heading", name=A_NAME, exact=True)).to_have_count(0)
    await expect(page.get_by_role("region", name="門市訂單工作台")).to_have_count(0)
    await expect(page.get_by_role("alert").filter(has_text=ACCESS_ERROR)).to_be_visible()
    await capture(page, report, "stale-response-ignored")
    snapshot = await no_writes(page, report, "stale-response-ignored")
    assert snapshot["state"]["account"] == "account-b"
    await page.get_by_role("button", name="切換合成帳號", exact=True).click()
    await wait_orders(page, ("A103", "A104"))
    await layout(page, report, "account-recovered")
    report["checks"].append("Delayed success from the previous account is ignored after switching accounts; the original account can independently reload its authorized target")


async def verify_invalid_and_sign_in(page, origin, report):
    await no_writes(page, report, "before-invalid-links")
    for index, query in enumerate(("tenant=campus-one", "tenant=campus-one&tenant=campus-two&location=store-a")):
        await page.goto(origin + BASE + "?" + query)
        await expect(page.get_by_role("heading", name="無法開啟這個門市連結", exact=True)).to_be_visible()
        await expect(page.get_by_role("region", name="門市訂單工作台")).to_have_count(0)
        snapshot = await no_writes(page, report, f"invalid-link-{index}")
        assert not any(row["path"].startswith("merchant-workspaces") for row in snapshot["ledger"]["requests"])
        await layout(page, report, f"invalid-link-{index}")
    await page.goto(origin + BASE + "?tenant=campus-one&location=missing-store")
    await expect(page.get_by_role("alert").filter(has_text=ACCESS_ERROR)).to_be_visible()
    await expect(page.get_by_role("heading", name=A_NAME, exact=True)).to_have_count(0)
    await expect(page.get_by_role("heading", name=B_NAME, exact=True)).to_have_count(0)
    await layout(page, report, "missing-store")
    await no_writes(page, report, "missing-store")
    report["checks"].append("Incomplete/ambiguous selectors issue no merchant request; an unknown location never falls back to another store")

    await page.goto(origin + ACTIVE + "&account=guest&role=admin&pickupToken=fixture-only")
    await expect(page.get_by_role("heading", name="用 Google 帳號登入", exact=True)).to_be_visible()
    form = page.locator('form[action^="/auth/platform/start?"]')
    await expect(form).to_be_visible()
    action = await form.get_attribute("action")
    destination = workspace_query(action)["returnUrl"][0]
    assert destination == ACTIVE, destination
    assert "role" not in workspace_query(destination) and "pickupToken" not in workspace_query(destination)
    await capture(page, report, "sign-in-destination")
    await no_writes(page, report, "sign-in-destination")
    report["checks"].append("The real sign-in form retains only validated store/section/filter selectors; no OAuth submission or payment action occurs")


async def run_scenario(browser, origin, config, report):
    context = await browser.new_context(
        viewport={"width": config["width"], "height": config["height"]},
        color_scheme=config["theme"],
        reduced_motion="reduce" if config.get("motion") == "reduce" else "no-preference",
        locale="zh-TW",
        timezone_id="Asia/Taipei",
    )
    errors, external = [], []

    def observe_page(new_page):
        new_page.on("pageerror", lambda error: errors.append(str(error)))

    context.on("page", observe_page)

    async def allow_local_only(route):
        url = route.request.url
        if not url.startswith(origin + "/"):
            external.append(url)
            await route.abort()
        else:
            await route.continue_()

    await context.route("**/*", allow_local_only)
    # Appearance persists across canonical URL reloads without adding fixture
    # parameters to the product's location/section/filter URL contract.
    appearance = json.dumps({"theme": config["theme"], "text": config.get("text"), "motion": config.get("motion")})
    await context.add_init_script("""(() => {
      const config = CONFIG;
      const apply = () => {
        if (!document.documentElement) return;
        document.documentElement.dataset.theme = config.theme;
        if (config.text === '200') document.documentElement.style.fontSize = '200%';
        if (config.motion === 'reduce') document.documentElement.dataset.reducedMotion = 'true';
      };
      document.addEventListener('DOMContentLoaded', apply, {once: true}); apply();
    })();""".replace("CONFIG", appearance))
    page = await context.new_page()
    page.set_default_timeout(12000)
    try:
        await page.goto(origin + BASE + "?" + urlencode({key: config[key] for key in ("theme", "text", "motion") if key in config}))
        await expect(page.locator("html")).to_have_attribute("data-theme", config["theme"])
        if config.get("text") == "200":
            await expect(page.locator("html")).to_have_css("font-size", "32px")
        if config.get("motion") == "reduce":
            assert await page.evaluate("document.documentElement.dataset.reducedMotion === 'true' && matchMedia('(prefers-reduced-motion: reduce)').matches")
        report["checks"].append("Requested theme, 200% root text and reduced-motion settings are active before interface checks")
        await verify_navigation(page, report)
        await verify_drafts_and_access(page, report)
        await verify_invalid_and_sign_in(page, origin, report)
        assert not errors, errors
        assert not external, external
        report["checks"].append("Every visited state fits the viewport, makes no external request and produces no browser runtime error")
        report["status"] = "passed"
    except Exception as failure:
        report.update({"status": "failed", "error": repr(failure), "url": page.url})
        try:
            filename = f'{config["name"]}-failure.png'
            await page.screenshot(path=str(OUTPUT / filename), full_page=True, animations="disabled")
            report["screenshots"].append(filename)
            (OUTPUT / f'{config["name"]}-failure.html').write_text(await page.content(), encoding="utf-8")
            report["failureSnapshot"] = await page.evaluate("window.__merchantQA?.snapshot()")
        except Exception as capture_error:
            report["captureError"] = repr(capture_error)
    finally:
        report.update({"pageErrors": errors, "externalRequests": external})
        try:
            await context.close()
        except Exception as cleanup_error:
            report.update({"status": "failed", "cleanupError": repr(cleanup_error)})


async def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    reports = [{**config, "status": "pending", "checks": [], "screenshots": [], "layouts": [], "ledgers": []} for config in SCENARIOS]
    server = None
    source_verification = None
    server_log = (OUTPUT / "fixture-server.log").open("w", encoding="utf-8")
    try:
        with socket.socket() as available:
            available.bind(("127.0.0.1", 0))
            port = available.getsockname()[1]
        origin = f"http://127.0.0.1:{port}"
        server = subprocess.Popen(
            ["node", "scripts/qa/merchant-workspace/serve.mjs"], cwd=ROOT,
            env={**os.environ, "MERCHANT_QA_PORT": str(port)}, stdout=server_log, stderr=subprocess.STDOUT,
        )
        deadline = time.monotonic() + 15
        while True:
            if server.poll() is not None:
                raise RuntimeError("Fixture server exited; see fixture-server.log")
            try:
                with urlopen(origin + "/source-sha256.json", timeout=1) as response:
                    manifest = json.load(response)
                break
            except (OSError, ValueError):
                if time.monotonic() >= deadline:
                    raise RuntimeError("Fixture server did not serve a built manifest")
                await asyncio.sleep(0.1)
        source_verification = verify_sources(manifest)
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(executable_path=os.environ.get("CHROME_PATH"), headless=True)
            try:
                for config, report in zip(SCENARIOS, reports):
                    await run_scenario(browser, origin, config, report)
            finally:
                await browser.close()
    except Exception as failure:
        for report in reports:
            if report["status"] != "failed":
                report.update({"status": "failed", "error": repr(failure)})
    finally:
        if server:
            server.terminate()
            try:
                server.wait(timeout=5)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait(timeout=5)
        server_log.close()
        result = {
            "synthetic": True,
            "scope": "Real product UI with synthetic local API/session data. No real account, OAuth, payment, backend deployment or production mutation is validated.",
            "sourceManifest": "source-sha256.json",
            "sourceVerification": source_verification,
            "scenarios": reports,
        }
        (OUTPUT / "checks.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    assert len(reports) == len(SCENARIOS) and all(row["status"] == "passed" for row in reports), "Merchant browser checks failed; see checks.json and failure artifacts"
    print(json.dumps({"scenarios": len(reports), "checks": sum(len(row["checks"]) for row in reports), "synthetic": True}))


if __name__ == "__main__":
    asyncio.run(main())
