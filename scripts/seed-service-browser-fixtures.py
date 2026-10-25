#!/usr/bin/env python3
"""Seed synthetic service content in the fixed local browser-test emulator."""

import datetime as dt
import json
import urllib.error
import urllib.request


PROJECT = "demo-campus-services"
ORIGIN = "http://127.0.0.1:8085"
DATABASE = f"projects/{PROJECT}/databases/(default)"
DOCUMENTS = f"{ORIGIN}/v1/{DATABASE}/documents"
NOW = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)


def iso(value):
    return value.isoformat().replace("+00:00", "Z")


def firestore_value(value):
    if value is None:
        return {"nullValue": None}
    if isinstance(value, bool):
        return {"booleanValue": value}
    if isinstance(value, int):
        return {"integerValue": str(value)}
    if isinstance(value, float):
        return {"doubleValue": value}
    if isinstance(value, dt.datetime):
        return {"timestampValue": iso(value)}
    if isinstance(value, str):
        return {"stringValue": value}
    if isinstance(value, dict):
        return {"mapValue": {"fields": {key: firestore_value(item) for key, item in value.items()}}}
    if isinstance(value, list):
        return {"arrayValue": {"values": [firestore_value(item) for item in value]}}
    raise TypeError(type(value).__name__)


def write_document(path, fields):
    # The emulator recognizes this fixed local-only admin marker. No credentials
    # are loaded and callers cannot override the host or project.
    request = urllib.request.Request(
        f"{DOCUMENTS}/{path}",
        data=json.dumps({"fields": {key: firestore_value(value) for key, value in fields.items()}}).encode(),
        headers={"Content-Type": "application/json", "Authorization": "Bearer owner"},
        method="PATCH",
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        if response.status != 200:
            raise RuntimeError(f"Could not seed {path}: {response.status}")


def announcement(school, title, index, **extra):
    return {
        "schoolId": school,
        "title": title,
        "summary": "本機瀏覽器驗證使用的合成公告摘要。",
        "body": "本機瀏覽器驗證使用的合成公告內容，不是學校實際公告。",
        "source": "課務組",
        "office": "課務組",
        "sourceId": "services-fixture",
        "origin": "public_scrape",
        "category": "general",
        "publishedAt": NOW - dt.timedelta(minutes=index + 1),
        "studentFeed": True,
        "visible": True,
        **extra,
    }


def seed_announcements(school, count):
    write_document(f"schools/{school}/announcement-sources/services-fixture", {
        "sourceId": "services-fixture", "office": "課務組", "status": "healthy", "lastSuccessAt": NOW,
    })
    for index in range(1, count + 1):
        category = ("general", "academic", "event")[index % 3]
        heading = {"general": "校園生活提醒", "academic": "修課與選課通知", "event": "社團活動資訊"}[category]
        write_document(f"schools/{school}/announcements/notice-{index:03}", announcement(
            school, f"{heading} {index:02}", index + 1, category=category,
        ))
    write_document(f"schools/{school}/announcements/flow-reading", announcement(
        school, "選課與加退選時程" if school == "pu" else "清華校園閱讀活動", 0,
        summary="本學期選課提醒摘要。" if school == "pu" else "清華閱讀活動摘要。",
        body="完整公告第一段。\n\n加退選於指定期間開放，請確認課程時間與修課資格。\n\n完成選課後請重新核對課表，必要文件請洽課務組。",
        category="academic", pinned=True,
    ))
    write_document(f"schools/{school}/announcements/staff-notice", announcement(
        school, "教師研習報名通知", count + 3, category="event", studentFeed=False, audience="staff",
    ))
    write_document(f"schools/{school}/announcements/hidden-notice", announcement(
        school, "已撤下的測試公告", count + 4, visible=False, studentFeed=False,
    ))


def seed_events(school, count):
    names = {
        1: "校園攝影散步", 2: "圖書館閱讀夜", 3: "在地文化導覽",
        4: "時間待公布的學生交流會", 5: "環境教育講座", 6: "開始時間已過的展覽",
        26: "第二頁的天文觀測活動",
    }
    for index in range(1, count + 1):
        start = NOW + dt.timedelta(days=index + 1)
        end = start + dt.timedelta(hours=2)
        deadline = start - dt.timedelta(days=1)
        if index == 2:
            start, end = NOW - dt.timedelta(days=1, hours=2), NOW - dt.timedelta(days=1)
            deadline = start - dt.timedelta(days=1)
        elif index == 3:
            start, end = NOW - dt.timedelta(minutes=30), NOW + dt.timedelta(minutes=30)
            deadline = start - dt.timedelta(days=1)
        elif index == 5:
            deadline = NOW - dt.timedelta(days=1)
        elif index == 6:
            start = NOW - dt.timedelta(hours=2)
        fields = {
            "schoolId": school,
            "title": names.get(index, f"校園交流活動 {index:02}"),
            "description": "一起認識校園，與同學交流。\n\n請提前十分鐘到場。此內容為本機驗證合成資料。",
            "startsAt": start if index != 4 else "",
            "endsAt": end if index not in (4, 6) else "",
            "registrationDeadline": deadline,
            "location": "圖書館前廣場",
            "organizer": "學生服務中心",
            "capacity": 25,
            "registeredCount": 8,
            "appRegistrationCount": 8,
            "registrationPolicy": {"version": 1},
            "fee": 0,
        }
        write_document(f"schools/{school}/clubEvents/event-{index:03}", fields)


def seed_lost_found(school):
    for index, (title, kind, category) in enumerate([
        ("圖書館附近拾獲摺疊傘", "found", "other"),
        ("尋找黑色鑰匙包", "lost", "keys"),
        ("教室遺留的筆記本", "found", "books"),
    ], 1):
        write_document(f"schools/{school}/lostFound/item-{index:03}", {
            "schoolId": school, "title": title, "type": kind, "category": category,
            "description": "此為本機瀏覽器驗證資料。",
            "location": "圖書館", "date": NOW.astimezone(dt.timezone(dt.timedelta(hours=8))).date().isoformat(),
            "status": "open", "userId": "services-fixture-owner", "reporterId": "services-fixture-owner",
            "contactInfo": "請洽測試服務台", "createdAt": NOW - dt.timedelta(minutes=index), "updatedAt": NOW,
        })


def verify_public_access():
    checks = {}
    for collection, expected in [("announcements", 200), ("clubEvents", 200), ("lostFound", 403)]:
        try:
            with urllib.request.urlopen(f"{DOCUMENTS}/schools/nthu/{collection}", timeout=10) as response:
                actual = response.status
        except urllib.error.HTTPError as error:
            actual = error.code
        if actual != expected:
            raise RuntimeError(f"Guest {collection}: expected {expected}, got {actual}")
        checks[collection] = actual
    return checks


def main():
    for school, name, count in [("pu", "靜宜大學", 65), ("nthu", "國立清華大學", 3)]:
        write_document(f"schools/{school}", {"name": name, "code": school, "status": "open"})
        seed_announcements(school, count)
        seed_events(school, 30 if school == "nthu" else 5)
        seed_lost_found(school)
    print(json.dumps({
        "project": PROJECT, "endpoint": ORIGIN, "fixtureTime": iso(NOW),
        "announcements": {"pu": 68, "nthu": 6},
        "events": {"pu": 5, "nthu": 30},
        "lostFound": {"pu": 3, "nthu": 3},
        "guestReadStatus": verify_public_access(),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
