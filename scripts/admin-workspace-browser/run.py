"""Exercise the real admin components with synthetic, locally fulfilled API calls.

Run from any directory: python scripts/admin-workspace-browser/run.py
Requires Node 22, installed workspace dependencies, Python Playwright and Chromium.
ADMIN_BROWSER_NODE, ADMIN_BROWSER_CHROMIUM and ADMIN_BROWSER_OUTPUT are optional.
No real session, school service, backend, or public deployment is contacted.
"""

import asyncio
import hashlib
import json
import mimetypes
import os
import re
import shutil
import subprocess
import traceback
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from playwright.async_api import async_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(os.environ.get("ADMIN_BROWSER_OUTPUT", ROOT / "tmp/admin-workspace-browser")).resolve()
DIST = OUT / "dist"
ORIGIN = "http://127.0.0.1:4123"
STAMP = "2026-11-06T09:00:00.000Z"
SCHOOL_APPLICATION = "soa_33333333-3333-4333-8333-333333333333"
AFFILIATION = "cwaa_44444444-4444-4444-8444-444444444444"
MERCHANT_INTEREST = "mpi_55555555-5555-4555-8555-555555555555"
MERCHANT_APPLICATION = "fma_66666666-6666-4666-8666-666666666666"


def school(tenant_id, name, state="open"):
    return dict(kind="tenant", applicationId=None, tenantId=tenant_id, displayName=name,
                emailDomain=None, lifecycle=state, description="校方窗口與管理服務的合成驗收資料。",
                modules=dict(leave=False, identity=False, food=False), peopleCount=0, merchantCount=0)


class Fixture:
    """Mutable fixture state follows the existing platform-admin response DTOs."""

    def __init__(self, role="operator"):
        self.role = role
        self.context = "a" * 43
        self.requests = []
        self.writes = []
        self.errors = []
        self.failed_reads = set()
        self.holds = {}
        self.schools = [school("school-a", "青禾科技大學"),
                        school("school-b", "海風大學", "provisioned")]
        self.people = {}
        self.proxies = {}
        self.school_applications = [dict(
            id=SCHOOL_APPLICATION, state="pending", displayName="山川大學",
            proposedTenantId="school-c", proposedEmailDomain="school-c.example.test",
            contactName="合成申請人", contactEmail="school-c@example.test",
            justification="校方聯絡窗口已準備服務接入資料，請查核校方代表與管理權責。",
            tenantId=None, tenantState=None, honestyBanner="核准只建立學校資料。",
            createdAt=STAMP, decidedAt=None,
        )]
        self.affiliations = [dict(
            id=AFFILIATION, workspaceId="cw_11111111-1111-4111-8111-111111111111",
            workspaceTitle="資訊管理專題：校園資料治理與跨單位服務設計",
            tenantId="school-a", sectionId=None,
            justification="教師提出課班掛靠，供管理員核對課程與所屬學校。",
            state="pending", honestyBanner="課班掛靠不改變正式學籍或選課。",
            createdAt=STAMP, decidedAt=None, decisionReason=None,
        )]
        self.interest = [dict(
            id=MERCHANT_INTEREST, brandName="青禾咖啡", schoolName="青禾科技大學",
            contactName="合成店主", contactEmail="merchant@example.test",
            note="提供飲品與輕食，須另行確認校內營業範圍與可提供的服務。",
            state="submitted", createdAt=STAMP, decidedAt=None,
        )]
        self.merchant_applications = [dict(
            tenantId="school-a", tenantName="青禾科技大學",
            applicationId=MERCHANT_APPLICATION, brandName="慢慢食堂",
            locationName="學生生活館二樓共享餐飲空間與戶外取餐窗口",
            contactName="合成店主", contactEmail="restaurant@example.test",
            state="submitted", version=3, submittedAt=STAMP,
        )]
        self.catalog = [dict(
            tenantId="school-a", tenantName="青禾科技大學", locationId="food-location-a",
            locationName="圖書館旁餐車", merchantMode="info_only", merchantModeLabel="資訊展示",
            sourceLabel="校方提供", sourceUpdatedAt=STAMP, published=True,
            locationStatus="open", publicAccess=True,
        )]
        self.reports = [dict(
            id="report-one", tenantId="school-a", postId="post-one", state="open", version=2,
            reason="spam", createdAt=STAMP, detail="重複刊登廣告，請管理員確認原文。",
            snapshot=dict(id="post-one", tenantId="school-a", tenantName="青禾科技大學",
                          communityId="community-one", communityName="校園交流",
                          text="供介面驗收使用的合成檢舉貼文內容。",
                          author=dict(displayName="合成發文者", isSelf=False),
                          publishedAt=STAMP, version=4),
            decisionReason=None, canDecide=True,
        )]

    def people_for(self, tenant_id):
        item = next(row for row in self.schools if row["tenantId"] == tenant_id)
        return self.people.get(tenant_id) or dict(
            tenantId=tenant_id, displayName=item["displayName"], tenantState=item["lifecycle"],
            hasRoleAdmin=False, roleAdmins=[], people=[], honesty="僅包含已核發的管理員與職員授權。",
        )

    @staticmethod
    def decision(body, max_length=1000):
        assert set(body) == {"decision", "reason", "idempotencyKey"}, body
        assert body["decision"] in ("approve", "reject"), body
        assert 5 <= len(body["reason"].strip()) <= max_length, body
        assert 8 <= len(body["idempotencyKey"]) <= 100, body

    async def route(self, route):
        try:
            await self.handle(route)
        except Exception as failure:
            self.errors.append(dict(path=urlparse(route.request.url).path, message=str(failure)))
            await route.fulfill(status=599, json={"error": "FIXTURE_CONTRACT_MISMATCH"})

    async def handle(self, route):
        request = route.request
        url = urlparse(request.url)
        path, method = url.path, request.method
        if f"{url.scheme}://{url.netloc}" != ORIGIN:
            self.errors.append(dict(path=path, message="External request blocked"))
            return await route.abort()
        if path == "/favicon.ico" and method == "GET":
            return await route.fulfill(status=204, body="")
        if not path.startswith("/api/"):
            file = DIST / ("index.html" if path in ("/admin", "/admin/ops", "/admin/school-review") else path.lstrip("/"))
            assert file.resolve().is_relative_to(DIST), "Static path escaped fixture output"
            assert method == "GET" and file.is_file(), f"Unknown local asset: {path}"
            mime = mimetypes.guess_type(file)[0] or "application/octet-stream"
            return await route.fulfill(body=file.read_bytes(), content_type=mime,
                                      headers={"Cache-Control": "no-store",
                                               "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'"})
        self.requests.append(dict(path=path, method=method, query=url.query))
        assert path.startswith("/api/platform-admin/"), "Unexpected API realm"
        assert self.role == "operator", "Guest/non-operator requested management data"
        assert request.headers.get("x-campus-session") == self.context, "Wrong session context"
        if path in self.holds:
            await self.holds[path].wait()
        if path in self.failed_reads and method == "GET":
            return await route.fulfill(status=503, json={"error": "TEMPORARILY_UNAVAILABLE"})
        endpoint = path.removeprefix("/api/platform-admin/")
        if method == "GET":
            if endpoint == "schools":
                assert set(parse_qs(url.query)) <= {"q"}
                return await route.fulfill(json={"schools": self.schools})
            if endpoint == "school-applications":
                assert parse_qs(url.query) == {"scope": ["pending"]}
                return await route.fulfill(json={"applications": [row for row in self.school_applications if row["state"] == "pending"], "operatorHonesty": "核准只建立學校資料。"})
            if endpoint == "class-workspace-affiliation-applications":
                assert not url.query
                return await route.fulfill(json={"applications": [row for row in self.affiliations if row["state"] == "pending"], "operatorHonesty": "課班掛靠不改變正式學籍。"})
            if endpoint == "merchants":
                return await route.fulfill(json=dict(interest=self.interest, applications=self.merchant_applications, catalog=self.catalog, honesty="核准不會直接開放點餐。"))
            if endpoint == "people":
                tenant_id = parse_qs(url.query).get("tenantId", [None])[0]
                assert tenant_id in [row["tenantId"] for row in self.schools]
                return await route.fulfill(json=self.people_for(tenant_id))
            if re.fullmatch(r"schools/[a-z-]+/proxy", endpoint):
                tenant_id = endpoint.split("/")[1]
                return await route.fulfill(json=self.proxies.get(tenant_id) or dict(tenantId=tenant_id, expiresAt="1970-01-01T00:00:00.000Z", extended=False, ended=True))
            if endpoint == "reports":
                state = parse_qs(url.query).get("state", ["open"])[0]
                return await route.fulfill(json={"items": [row for row in self.reports if row["state"] == state]})
            if endpoint == "audit":
                return await route.fulfill(json={"records": []})
            if endpoint == "boards":
                return await route.fulfill(json={"items": []})
        assert method == "POST", f"Unknown endpoint: {method} {endpoint}"
        body = request.post_data_json
        if endpoint == f"school-applications/{SCHOOL_APPLICATION}/decision":
            self.decision(body)
            item = self.school_applications[0]
            item.update(state="approved" if body["decision"] == "approve" else "rejected", decidedAt=STAMP)
            if body["decision"] == "approve":
                item.update(tenantId="school-c", tenantState="provisioned")
                self.schools.append(school("school-c", "山川大學", "provisioned"))
            result = item
        elif endpoint == "people/bind":
            assert set(body) <= {"tenantId", "email", "personId", "role", "idempotencyKey"}, body
            assert bool(body.get("email")) != bool(body.get("personId")), body
            assert body["role"] in ("school_admin", "school_staff"), body
            assert isinstance(body["idempotencyKey"], str) and body["idempotencyKey"], body
            tenant_id = body["tenantId"]
            result = self.people_for(tenant_id)
            person = dict(personId="person-one", displayName="合成校方管理員", email=body.get("email"),
                          role=body["role"], roleLabel="學校管理員", state="active", stateLabel="使用中")
            result.update(hasRoleAdmin=True, roleAdmins=[dict(personId=person["personId"], displayName=person["displayName"])], people=[person])
            self.people[tenant_id] = result
        elif endpoint == f"merchants/interest/{MERCHANT_INTEREST}/decision":
            self.decision(body, 500)
            result = self.interest[0]
            result.update(state="approved" if body["decision"] == "approve" else "rejected", decidedAt=STAMP)
        elif endpoint == f"merchants/applications/school-a/{MERCHANT_APPLICATION}/decision":
            assert set(body) == {"decision", "reason", "expectedVersion"}, body
            assert body["decision"] in ("approve", "reject"), body
            assert 5 <= len(body["reason"].strip()) <= 500, body
            assert body["expectedVersion"] == self.merchant_applications[0]["version"], body
            item = self.merchant_applications[0]
            item.update(state="approved" if body["decision"] == "approve" else "rejected", version=item["version"] + 1)
            # The decision endpoint returns the application projection, not the
            # cross-school oversight row returned by GET /merchants.
            result = dict(
                tenantId=item["tenantId"], applicationId=MERCHANT_APPLICATION,
                businessKind="campus-stall", legalName="合成店家", brandName=item["brandName"],
                businessRegistrationNumber=None, foodBusinessRegistrationNumber=None,
                contactName=item["contactName"], contactEmail=item["contactEmail"],
                contactPhone="0900000000", locationName=item["locationName"],
                operatingAddress="合成校區", campusLabel="青禾本部", campusId="campus-a",
                serviceModes=["pickup"], state=item["state"], version=item["version"],
                businessRegistryCheck="not-applicable", foodRegistryCheck="not-applicable",
                reasonCode="platform-operator-reviewed", reviewerNote=body["reason"],
                merchantId="merchant_77777777-7777-4777-8777-777777777777",
                locationId="food-location_88888888-8888-4888-8888-888888888888",
                submittedAt=STAMP, updatedAt=STAMP,
            )
        elif endpoint == f"class-workspace-affiliation-applications/{AFFILIATION}/decision":
            self.decision(body, 500)
            result = self.affiliations[0]
            result.update(state="approved" if body["decision"] == "approve" else "rejected", decidedAt=STAMP, decisionReason=body["reason"])
        elif re.fullmatch(r"schools/[a-z-]+/proxy/(start|end|extend)", endpoint):
            assert not body, body
            tenant_id = endpoint.split("/")[1]
            result = dict(tenantId=tenant_id, expiresAt=(datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat(), extended=endpoint.endswith("/extend"), ended=endpoint.endswith("/end"))
            self.proxies[tenant_id] = result
        elif endpoint == "schools/school-c/open":
            assert set(body) == {"reason", "idempotencyKey"}, body
            assert self.people_for("school-c")["hasRoleAdmin"], "Opening before administrator binding"
            assert 5 <= len(body["reason"].strip()) <= 1000, body
            next(row for row in self.schools if row["tenantId"] == "school-c")["lifecycle"] = "open"
            result = dict(tenantId="school-c", tenantState="open", honestyNote="學校已開通。")
        else:
            raise AssertionError(f"Unknown write: {endpoint}")
        self.writes.append(dict(path=path, body=body))
        await route.fulfill(json=result)


async def check_layout(page, report, label):
    navigation = page.get_by_role("navigation", name="平台管理項目", include_hidden=True)
    if not await navigation.is_visible():
        await expect(page.get_by_role("button", name=re.compile(r"^管理選單"))).to_be_visible()
    overflow = await page.evaluate("document.documentElement.scrollWidth > innerWidth + 1")
    assert not overflow, f"{label}: horizontal overflow"
    undersized = await navigation.locator("button").evaluate_all("""nodes => nodes.filter(node => {
      const rect = node.getBoundingClientRect();
      return node.checkVisibility() && (rect.height < 43.5 || rect.width < 43.5);
    }).map(node => ({text: node.textContent, height: node.getBoundingClientRect().height}))""")
    assert not undersized, f"{label}: undersized navigation controls: {undersized}"
    assert await page.locator("h1").count() == 1, f"{label}: duplicate primary page headings"
    report["checks"].append(f"{label}: no overflow, 44px navigation, one primary heading")


async def nav(page, title):
    navigation = page.get_by_role("navigation", name="平台管理項目", include_hidden=True)
    if not await navigation.is_visible():
        await page.get_by_role("button", name=re.compile(r"^管理選單")).click()
        await expect(navigation).to_be_visible()
    item = navigation.get_by_role("button", name=title, exact=True, include_hidden=True)
    assert await item.evaluate("node => node.getBoundingClientRect().height >= 43.5"), "Navigation control below 44px"
    await item.click()
    await expect(item).to_have_attribute("aria-current", "page")
    await expect(page.locator("h1")).to_be_focused()


async def capture(page, report, name):
    file = OUT / "screenshots" / name
    file.parent.mkdir(parents=True, exist_ok=True)
    await page.screenshot(path=file, full_page=True, animations="disabled")
    report["screenshots"].append(str(file.relative_to(OUT)))


async def new_page(browser, fixture, report, width=1440, height=1000):
    page = await browser.new_page(viewport=dict(width=width, height=height), locale="zh-TW", timezone_id="Asia/Taipei")
    await page.route("**/*", fixture.route)
    page.on("pageerror", lambda error: report["pageErrors"].append(str(error)))
    return page


async def scenarios(browser, report):
    fixtures = []
    for width, height in ((1440, 1000), (390, 844), (320, 720)):
        for theme in ("light", "dark"):
            fixture = Fixture()
            fixtures.append(fixture)
            page = await new_page(browser, fixture, report, width, height)
            await page.goto(f"{ORIGIN}/admin?theme={theme}")
            await expect(page.get_by_role("heading", level=1, name="工作總覽")).to_be_visible()
            await expect(page.get_by_role("button", name="查看店家申請", exact=True)).to_be_visible()
            await expect(page.get_by_role("button", name="查看掛靠申請", exact=True)).to_be_visible()
            await check_layout(page, report, f"{width}-{theme}/overview")
            await capture(page, report, f"overview-{width}-{theme}.png")
            for title, section in (("學校接入", "school-review"), ("人員授權", "people"),
                                   ("店家管理", "merchants"), ("課班掛靠", "affiliation"),
                                   ("學校管理", "schools"), ("社群檢舉", "reports")):
                await nav(page, title)
                await expect(page).to_have_url(re.compile(r"/admin#" + section))
                await check_layout(page, report, f"{width}-{theme}/{section}")
            await page.close()

    # Complete the school onboarding task without leaving the workbench.
    fixture = Fixture()
    fixtures.append(fixture)
    page = await new_page(browser, fixture, report, 390, 844)
    await page.goto(f"{ORIGIN}/admin")
    await page.get_by_role("button", name="查看學校申請", exact=True).click()
    await expect(page.get_by_role("heading", level=1, name="學校接入申請")).to_be_visible()
    application = page.locator("article").filter(has=page.get_by_text("山川大學", exact=True)).first
    await application.get_by_role("button", name="核准申請", exact=True).click()
    await expect(application.get_by_role("button", name="確定核准申請", exact=True)).to_be_disabled()
    assert not fixture.writes, "Choosing approval must not write before a reason and confirmation"
    await application.get_by_label("審核理由", exact=True).fill("已核對校方窗口與接入需求資料")
    await capture(page, report, "school-confirm-390-light.png")
    await application.get_by_role("button", name="確定核准申請", exact=True).click()
    receipt = page.get_by_role("region", name="學校審核結果", exact=True)
    await receipt.get_by_role("button", name="設定山川大學的管理員", exact=True).click()
    await expect(page).to_have_url(re.compile(r"/admin#people/school-c"))
    await expect(page.get_by_label("選擇學校", exact=True)).to_have_value("school-c")
    await page.get_by_label("Google 登入信箱或人員代號", exact=True).fill("school-admin@example.test")
    await page.get_by_role("button", name=re.compile(r"^(加人|新增授權|核發授權)$")).click()
    await expect(page.get_by_text("合成校方管理員", exact=True)).to_be_visible()
    assert len([item for item in fixture.writes if item["path"].endswith("people/bind")]) == 1
    assert fixture.writes[-1]["body"]["tenantId"] == "school-c"
    assert fixture.writes[-1]["body"]["role"] == "school_admin"
    await capture(page, report, "people-after-bind-390-light.png")
    report["checks"].append("School approval → selected school → one verified administrator binding, within one workbench")

    await nav(page, "學校接入")
    ready = page.locator("article").filter(has=page.get_by_text("山川大學", exact=True)).first
    await ready.get_by_role("button", name="檢查開通條件", exact=True).click()
    await ready.get_by_role("button", name="確認開通 山川大學", exact=True).click()
    await expect(page.get_by_role("button", name="確認開通 山川大學", exact=True)).to_have_count(0)
    assert next(row for row in fixture.schools if row["tenantId"] == "school-c")["lifecycle"] == "open"
    report["checks"].append("School cannot open until administrator readiness is checked and opening is explicitly confirmed")
    await page.close()

    fixture = Fixture()
    fixtures.append(fixture)
    page = await new_page(browser, fixture, report)
    await page.goto(f"{ORIGIN}/admin")
    await page.get_by_role("button", name="查看學校申請：山川大學", exact=True).click()
    await expect(page).to_have_url(ORIGIN + "/admin#school-review/" + SCHOOL_APPLICATION)
    await expect(page.get_by_role("heading", name="申請詳情", exact=True)).to_be_visible()
    await page.go_back()
    await expect(page.get_by_role("heading", level=1, name="工作總覽")).to_be_visible()
    await page.get_by_role("button", name="查看店家申請：青禾咖啡", exact=True).click()
    await expect(page).to_have_url(ORIGIN + "/admin#merchants/interest%3A" + MERCHANT_INTEREST)
    await expect(page.get_by_role("button", name="核准意向", exact=True)).to_be_visible()
    await expect(page.get_by_role("button", name="核准進件", exact=True)).to_have_count(0)
    report["checks"].append("Overview case rows open the exact review; browser Back returns to the work queue")
    await page.close()

    fixture = Fixture()
    fixture.failed_reads.add("/api/platform-admin/merchants")
    fixtures.append(fixture)
    page = await new_page(browser, fixture, report, 390, 844)
    await page.goto(f"{ORIGIN}/admin")
    merchant_queue = page.get_by_role("region", name="店家申請", exact=True)
    await expect(merchant_queue.get_by_role("alert")).to_be_visible()
    await expect(merchant_queue.get_by_label("件數尚未確認", exact=True)).to_be_visible()
    await expect(merchant_queue.get_by_text("目前沒有待審核的店家申請。", exact=True)).to_have_count(0)
    fixture.failed_reads.clear()
    await merchant_queue.get_by_role("button", name="重試店家申請", exact=True).click()
    await expect(merchant_queue.get_by_label("已載入 2 件", exact=True)).to_be_visible()
    await expect(merchant_queue.get_by_role("button", name="查看店家申請：青禾咖啡", exact=True)).to_be_visible()
    report["checks"].append("Failed queue reads show unknown counts and retry independently instead of reporting zero work")
    await capture(page, report, "queue-recovered-390-light.png")
    await page.close()

    fixture = Fixture()
    fixtures.append(fixture)
    page = await new_page(browser, fixture, report, 390, 844)
    await page.goto(f"{ORIGIN}/admin#people/school-a")
    account = page.get_by_label("Google 登入信箱或人員代號", exact=True)
    await expect(account).to_be_disabled()
    await page.get_by_role("button", name="開始 15 分鐘代操作", exact=True).click()
    await expect(account).to_be_enabled()
    await account.fill("operator-bound-admin@example.test")
    await page.get_by_role("button", name="新增授權", exact=True).click()
    await expect(page.get_by_text("已為青禾科技大學新增校方授權。", exact=True)).to_be_visible()
    await page.get_by_role("button", name="結束代操作", exact=True).click()
    await expect(account).to_be_disabled()
    await expect(page).to_have_url(ORIGIN + "/admin#people/school-a")
    assert [row["path"] for row in fixture.writes] == [
        "/api/platform-admin/schools/school-a/proxy/start",
        "/api/platform-admin/people/bind",
        "/api/platform-admin/schools/school-a/proxy/end",
    ]
    report["checks"].append("An open school starts limited proxy access, binds staff, and ends access on the same page")
    await capture(page, report, "people-proxy-ended-390-light.png")
    await page.close()

    # Legacy bookmarks must enter the correct actionable workspace, never a second console.
    for old_path, expected_hash, selected_school in (
        ("/admin/ops?tab=merchants", "#merchants", None),
        ("/admin/ops?tab=people&school=school-b", "#people/school-b", "school-b"),
        ("/admin/ops?tab=people&tenantId=school-b", "#people/school-b", "school-b"),
        ("/admin/ops#affiliation", "#affiliation", None),
        ("/admin/school-review", "#school-review", None),
    ):
        fixture = Fixture()
        fixtures.append(fixture)
        page = await new_page(browser, fixture, report, 390, 844)
        await page.goto(ORIGIN + old_path)
        await expect(page).to_have_url(ORIGIN + "/admin" + expected_hash)
        await expect(page.get_by_text("完整管理台", exact=True)).to_have_count(0)
        if selected_school:
            await expect(page.get_by_label("選擇學校", exact=True)).to_have_value(selected_school)
        report["checks"].append(f"Legacy bookmark preserves destination: {old_path}")
        await page.close()

    fixture = Fixture()
    fixtures.append(fixture)
    page = await new_page(browser, fixture, report, 320, 720)
    await page.goto(f"{ORIGIN}/admin?theme=dark#merchants")
    merchant = page.locator("article").filter(has=page.get_by_role("button", name="核准進件", exact=True)).first
    await merchant.get_by_role("button", name="核准進件", exact=True).click()
    await expect(merchant.get_by_label("審核理由", exact=True)).to_be_focused()
    assert not fixture.writes, "Merchant approval must first show a confirmation form"
    await merchant.get_by_label("審核理由", exact=True).fill("已確認店家資料與申請營業位置")
    await check_layout(page, report, "320-dark/merchant-confirmation")
    await capture(page, report, "merchant-confirm-320-dark.png")
    await merchant.get_by_role("button", name="確認核准", exact=True).click()
    await expect(page.get_by_text("已核准這筆店家申請。", exact=True)).to_be_visible()
    assert len(fixture.writes) == 1
    assert fixture.writes[0]["body"]["expectedVersion"] == 3
    report["checks"].append("Merchant review focuses reason, confirms once, and submits current expectedVersion")
    await page.close()

    # Keyboard access, return location, and school draft protection.
    fixture = Fixture()
    fixtures.append(fixture)
    page = await new_page(browser, fixture, report)
    await page.goto(f"{ORIGIN}/admin#schools/school-b")
    await expect(page.get_by_label("學校名稱", exact=True)).to_have_value("海風大學")
    await page.get_by_label("學校名稱", exact=True).fill("尚未儲存的學校名稱")
    dialogs = []

    async def decline(dialog):
        dialogs.append(dialog.message)
        await dialog.dismiss()

    page.on("dialog", decline)
    await page.get_by_role("navigation", name="平台管理項目").get_by_role("button", name="店家管理", exact=True).click()
    await expect(page.get_by_label("學校名稱", exact=True)).to_have_value("尚未儲存的學校名稱")
    assert dialogs and "尚未儲存" in dialogs[-1]
    assert not fixture.writes
    report["checks"].append("Navigation cancellation preserves the selected school and unsaved form without writing")
    await page.get_by_label("學校名稱", exact=True).fill("海風大學")
    audit = page.get_by_role("navigation", name="平台管理項目").get_by_role("button", name="操作紀錄", exact=True)
    await audit.focus()
    await page.keyboard.press("Enter")
    await expect(audit).to_have_attribute("aria-current", "page")
    skip = page.get_by_role("link", name="跳到主要內容", exact=True)
    await skip.focus()
    await page.keyboard.press("Enter")
    await expect(page.locator("#page-content")).to_be_focused()
    await expect(page).to_have_url(ORIGIN + "/admin#audit")
    report["checks"].append("Keyboard Enter activates navigation; skip link focuses main without replacing workbench location")
    await page.close()

    # Revocation during an active view must hide private data and disable every write.
    fixture = Fixture()
    fixtures.append(fixture)
    page = await new_page(browser, fixture, report)
    await page.goto(f"{ORIGIN}/admin#merchants")
    await page.get_by_role("button", name="核准進件", exact=True).click()
    await page.get_by_label("審核理由", exact=True).fill("尚未送出的審核理由")
    await page.evaluate("window.__adminFixtureSession({loading:true})")
    await expect(page.get_by_label("審核理由", exact=True)).not_to_be_visible()
    await page.evaluate("window.__adminFixtureSession({loading:false,session:null})")
    await expect(page.get_by_text("請先登入管理員帳號", exact=True)).to_be_visible()
    assert not fixture.writes
    report["checks"].append("Session recheck and logout hide the active review and prevent stale confirmation")
    await page.close()

    for role in ("guest", "member"):
        fixture = Fixture(role)
        fixtures.append(fixture)
        page = await new_page(browser, fixture, report)
        await page.goto(f"{ORIGIN}/admin?role={role}#merchants")
        await expect(page.get_by_text("請先登入管理員帳號" if role == "guest" else "沒有管理權限", exact=True)).to_be_visible()
        assert not fixture.requests
        report["checks"].append(f"{role} never requests management data")
        await page.close()

    assert not report["pageErrors"], report["pageErrors"]
    for fixture in fixtures:
        assert not fixture.errors, fixture.errors
    report["syntheticWrites"] = sum(len(fixture.writes) for fixture in fixtures)
    report["syntheticReads"] = sum(sum(row["method"] == "GET" for row in fixture.requests) for fixture in fixtures)


async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    report = dict(scope="Production admin components/CSS, synthetic session and API, fixture site shell",
                  status="building", checks=[], screenshots=[], pageErrors=[], errors=[])
    # Do not leave a previous successful report beside a newly failed build.
    (OUT / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    browser = None
    try:
        if os.environ.get("ADMIN_BROWSER_SKIP_BUILD") != "1":
            node = os.environ.get("ADMIN_BROWSER_NODE") or shutil.which("node")
            assert node, "Node is unavailable"
            subprocess.run([node, str(Path(__file__).with_name("build.mjs"))], cwd=ROOT, check=True)
        build = json.loads((OUT / "build.json").read_text())
        report.update(sourceHead=build["sourceHead"], sourceDigest=build["sourceDigest"])
        for file, expected_digest in build["sourceFiles"].items():
            actual_digest = hashlib.sha256((ROOT / file).read_bytes()).hexdigest()
            assert actual_digest == expected_digest, f"Source changed since bundle was built: {file}"
        report["status"] = "launching"
        async with async_playwright() as playwright:
            chromium = os.environ.get("ADMIN_BROWSER_CHROMIUM") or shutil.which("chromium") or shutil.which("google-chrome")
            options = dict(headless=True, args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"])
            if chromium:
                options["executable_path"] = chromium
            try:
                browser = await playwright.chromium.launch(**options)
            except Exception as failure:
                report["status"] = "browser-unavailable"
                report["errors"].append(str(failure))
                raise
            report["browser"] = browser.version
            report["status"] = "running"
            try:
                await scenarios(browser, report)
                report["status"] = "passed"
            finally:
                await browser.close()
    except Exception:
        if report["status"] != "browser-unavailable":
            report["status"] = "failed"
            report["errors"].append(traceback.format_exc())
        raise
    finally:
        report["completedAt"] = datetime.now(timezone.utc).isoformat()
        (OUT / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
        print(json.dumps({"status": report["status"], "checks": len(report["checks"]),
                          "screenshots": len(report["screenshots"]), "report": str(OUT / "report.json")}, ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(main())
