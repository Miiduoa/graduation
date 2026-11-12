"""Small public web-search tool for the local Campus AI server.

This is intentionally narrow: it handles public/current facts, weather, and
transit-route queries. Personal course, assignment, grade, leave, and account
questions must stay inside App/RAG data and never be sent to public sources.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import re
from urllib.parse import quote, urlencode

import httpx


PERSONAL_PATTERNS = re.compile(
    r"(我的|我今天|我明天|課表|作業|成績|學分|請假|缺曠|繳交|帳號|個資|學生證|付款|訂單)"
)
WEB_PATTERNS = re.compile(
    r"(連網|搜尋|查網路|公開來源|最新|目前|現任|天氣|下雨|帶傘|路線|怎麼去|如何到|怎麼到|公車|google|wikipedia|維基)",
    re.I,
)


@dataclass
class WebSource:
    title: str
    url: str
    snippet: str
    source: str
    updated_at: str | None = None


def strip_html(value: str) -> str:
    return re.sub(r"<[^>]+>", "", value or "").replace("&quot;", '"').replace("&amp;", "&").strip()


def truncate(value: str, max_len: int = 220) -> str:
    value = " ".join(str(value or "").split())
    return value if len(value) <= max_len else value[: max_len - 1].strip() + "…"


def should_use_web_search(query: str) -> bool:
    if not query or PERSONAL_PATTERNS.search(query):
        return False
    return bool(WEB_PATTERNS.search(query))


def _route_answer(query: str, school_id: str | None = None) -> tuple[str, list[WebSource]] | None:
    if not re.search(r"(怎麼去|如何到|怎麼到|路線|公車|導航|交通)", query):
        return None

    cleaned = re.sub(r"^(請問|幫我|搜尋|查詢)", "", query).strip("？?。！! ")
    explicit = re.search(r"(?:從|自)([^到去，。？！?]{2,24})(?:到|去)([^，。？！?]{2,30})", cleaned)
    origin = re.sub(r"(怎麼|如何|要|想)$", "", explicit.group(1)).strip() if explicit else None
    if not origin and school_id in ("pu", "tw-pu"):
        origin = "靜宜大學"
    destination = explicit.group(2).strip() if explicit else re.sub(
        r"^(我)?(要|想)?(怎麼|如何)(去|到)|怎麼走|路線|導航|交通",
        "",
        cleaned,
    ).strip()

    if len(destination) < 2:
        return None

    params = {"api": "1", "destination": destination, "travelmode": "transit"}
    if origin:
        params["origin"] = origin
    url = "https://www.google.com/maps/dir/?" + urlencode(params)
    route_label = f"{origin} → {destination}" if origin else f"前往{destination}（可在地圖選擇出發地）"
    sources = [
        WebSource(
            title="Google Maps 大眾運輸路線",
            url=url,
            source="Google Maps",
            snippet=f"大眾運輸路線：{route_label}",
        )
    ]

    if origin and re.fullmatch(r"(?:靜宜|静宜)(?:大學)?|Providence University", origin, re.I) and re.search(
        r"台中車站|臺中車站|台中火車站|臺中火車站", destination
    ):
        sources.insert(
            0,
            WebSource(
                title="臺中市公車即時動態：300 靜宜大學 - 臺中車站",
                url="https://citybus-free.taichung.gov.tw/driving-map?route=300",
                source="臺中市公車即時動態",
                snippet="300 路線為靜宜大學 - 臺中車站，可查往臺中車站方向的即時到站資訊。",
            ),
        )

    content = "\n".join(
        [
            f"路線查詢：{route_label}",
            "請開啟地圖確認班次與轉乘時間。",
            f"Google Maps: {url}",
        ]
    )
    return content, sources[:4]


async def _fetch_weather(query: str, client: httpx.AsyncClient, school_id: str | None = None) -> tuple[str, list[WebSource]] | None:
    if not re.search(r"(天氣|氣溫|下雨|帶傘|雨具|天候)", query):
        return None

    providence = ("靜宜大學", "静宜大學", "靜宜", "静宜", "沙鹿區", "沙鹿")
    taichung = ("台中市", "臺中市", "台中", "臺中")
    if any(token in query for token in providence):
        name, lat, lon = "台中市沙鹿區靜宜大學", 24.226, 120.563
    elif any(token in query for token in taichung):
        name, lat, lon = "台中市", 24.1477, 120.6736
    else:
        place = re.sub(
            r"今天|明天|昨天|現在|目前|今晚|早上|中午|下午|晚上|近期|"
            r"請問|幫我|麻煩|搜尋|查詢|查查|一下|會不會|要不要|好不好|好嗎|"
            r"天氣|氣溫|下雨|帶傘|雨具|天候|weather|temperature|rain|umbrella|"
            r"如何|怎麼樣|怎樣|怎麼|即時|需要|應該|大概|可能|好像|"
            r"的|會|嗎|呢|啊|喔|呀|唄|啦|吧|嘛|了|在|裡|内|內|查|雨|傘|要|好|"
            r"[？?！!。，、\s]",
            "",
            query,
            flags=re.IGNORECASE,
        )
        if place in providence or (not place and school_id in ("pu", "tw-pu")):
            name, lat, lon = "台中市沙鹿區靜宜大學", 24.226, 120.563
        elif place in taichung:
            name, lat, lon = "台中市", 24.1477, 120.6736
        else:
            return "目前無法確認查詢地點的即時天氣，可至中央氣象署選擇所在鄉鎮查詢。", []

    params = urlencode(
        {
            "latitude": lat,
            "longitude": lon,
            "current": "temperature_2m,relative_humidity_2m,precipitation,rain,weather_code,wind_speed_10m",
            "timezone": "Asia/Taipei",
        }
    )
    resp = await client.get(f"https://api.open-meteo.com/v1/forecast?{params}")
    resp.raise_for_status()
    current = resp.json().get("current") or {}
    rain = current.get("rain", current.get("precipitation", 0))
    content = (
        f"{name} 即時天氣：溫度 {current.get('temperature_2m', '未提供')}°C，"
        f"濕度 {current.get('relative_humidity_2m', '未提供')}%，降雨 {rain}mm，"
        f"風速 {current.get('wind_speed_10m', '未提供')} km/h。"
        + (" 目前有降雨資料，建議帶傘。" if rain and rain > 0 else " 目前降雨量不高，但出門前仍可再確認。")
    )
    source = WebSource(
        title="Open-Meteo Current Weather",
        url=f"https://open-meteo.com/en/docs?latitude={lat}&longitude={lon}",
        source="Open-Meteo",
        updated_at=current.get("time"),
        snippet=content,
    )
    return content, [source]


async def _fetch_wikipedia(query: str, client: httpx.AsyncClient) -> list[WebSource]:
    params = urlencode(
        {
            "action": "query",
            "list": "search",
            "srsearch": query,
            "format": "json",
            "origin": "*",
            "srlimit": "3",
        }
    )
    resp = await client.get(f"https://zh.wikipedia.org/w/api.php?{params}")
    if not resp.is_success:
        return []
    entries = resp.json().get("query", {}).get("search", [])
    return [
        WebSource(
            title=item.get("title", "Wikipedia"),
            url=f"https://zh.wikipedia.org/wiki/{quote(str(item.get('title', '')).replace(' ', '_'))}",
            source="Wikipedia 中文",
            updated_at=item.get("timestamp"),
            snippet=truncate(strip_html(item.get("snippet", "")), 260),
        )
        for item in entries
        if item.get("snippet")
    ]


async def _fetch_duckduckgo(query: str, client: httpx.AsyncClient) -> list[WebSource]:
    params = urlencode(
        {
            "q": query,
            "format": "json",
            "no_html": "1",
            "skip_disambig": "1",
            "no_redirect": "1",
            "t": "campus-assistant",
        }
    )
    resp = await client.get(f"https://api.duckduckgo.com/?{params}")
    if not resp.is_success:
        return []
    data = resp.json()
    sources: list[WebSource] = []
    if data.get("Answer"):
        sources.append(
            WebSource(
                title=data.get("Heading") or "DuckDuckGo Instant Answer",
                url=data.get("AbstractURL") or "https://duckduckgo.com/",
                snippet=strip_html(data["Answer"]),
                source="DuckDuckGo",
            )
        )
    if data.get("AbstractText"):
        sources.append(
            WebSource(
                title=data.get("Heading") or "DuckDuckGo 摘要",
                url=data.get("AbstractURL") or "https://duckduckgo.com/",
                snippet=strip_html(data["AbstractText"]),
                source=data.get("AbstractSource") or "DuckDuckGo",
            )
        )
    return sources


async def search_public_web(query: str, *, school_id: str | None = None) -> tuple[str, list[WebSource]]:
    if not should_use_web_search(query):
        return "", []

    route = _route_answer(query, school_id)
    if route:
        return route

    async with httpx.AsyncClient(timeout=httpx.Timeout(7.0, connect=3.0)) as client:
        weather = await _fetch_weather(query, client, school_id)
        if weather:
            return weather

        wiki, ddg = await asyncio_gather_safe(
            _fetch_wikipedia(query, client),
            _fetch_duckduckgo(query, client),
        )
        sources = [*(wiki or []), *(ddg or [])][:4]
        if not sources:
            return "", []
        content = "\n".join(
            [f"公開搜尋結果（查詢時間：{datetime.now().strftime('%Y/%m/%d %H:%M')}）:"]
            + [f"[{i}] {s.title}: {truncate(s.snippet, 220)}" for i, s in enumerate(sources, 1)]
        )
        return content, sources


async def asyncio_gather_safe(*aws):
    import asyncio

    results = await asyncio.gather(*aws, return_exceptions=True)
    return [None if isinstance(item, Exception) else item for item in results]


def format_web_context(content: str, sources: list[WebSource]) -> str:
    if not content:
        return ""
    source_lines = [
        f"[W{i}] {source.title} | {source.source} | {source.url}\n{truncate(source.snippet, 300)}"
        for i, source in enumerate(sources, 1)
    ]
    return "\n\n".join([content, *source_lines])
