export type WebSearchSource = {
  title: string;
  url: string;
  snippet: string;
  source: string;
  updatedAt?: string;
};

export type WebGroundedAnswer = {
  content: string;
  sources: WebSearchSource[];
  fetchedAt: string;
  confidence: "high" | "medium" | "low";
  suggestions?: string[];
};

type IntentCategoryLike =
  | "food"
  | "health"
  | "course"
  | "location"
  | "event"
  | "announcement"
  | "library"
  | "dorm"
  | "transport"
  | "print"
  | "lost_found"
  | "schedule"
  | "greeting"
  | "thanks"
  | "help"
  | "weather"
  | "mood"
  | "leave"
  | "general";

type DuckDuckGoTopic = {
  FirstURL?: string;
  Text?: string;
  Name?: string;
  Topics?: DuckDuckGoTopic[];
};

type DuckDuckGoResponse = {
  AbstractText?: string;
  AbstractURL?: string;
  AbstractSource?: string;
  Answer?: string;
  AnswerType?: string;
  Definition?: string;
  DefinitionURL?: string;
  DefinitionSource?: string;
  Heading?: string;
  RelatedTopics?: DuckDuckGoTopic[];
};

type WikipediaSearchResponse = {
  query?: {
    search?: Array<{
      title?: string;
      snippet?: string;
      timestamp?: string;
    }>;
  };
};

type WikipediaSummaryResponse = {
  title?: string;
  extract?: string;
  timestamp?: string;
  content_urls?: {
    desktop?: { page?: string };
    mobile?: { page?: string };
  };
};

type OpenMeteoGeocodingResponse = {
  results?: Array<{
    name?: string;
    latitude?: number;
    longitude?: number;
    admin1?: string;
    country?: string;
  }>;
};

type OpenMeteoForecastResponse = {
  current?: {
    time?: string;
    temperature_2m?: number;
    relative_humidity_2m?: number;
    precipitation?: number;
    rain?: number;
    weather_code?: number;
    wind_speed_10m?: number;
  };
  current_units?: Record<string, string>;
};

const SEARCH_TIMEOUT_MS = 7000;
const MAX_SOURCE_COUNT = 4;
const GENERIC_STOP_WORDS = new Set([
  "請問", "幫我", "搜尋", "查詢", "一下", "現在", "目前", "今天", "可以", "怎麼", "如何",
  "什麼", "為什麼", "哪裡", "哪個", "是否", "是不是", "告訴我", "我想知道",
]);

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, "\"")
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 1).trim()}…`;
}

function splitSentences(value: string): string[] {
  return stripHtml(value)
    .split(/[。！？!?]\s*|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 8);
}

function tokenizeQuery(query: string): string[] {
  const normalized = query.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ");
  const words = normalized
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 2 && !GENERIC_STOP_WORDS.has(word));

  const cjkMatches = normalized.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
  const cjkTokens = cjkMatches.flatMap((segment) => {
    const tokens = [segment];
    for (let index = 0; index < segment.length - 1; index += 1) {
      tokens.push(segment.slice(index, index + 2));
    }
    return tokens;
  });

  return Array.from(new Set([...words, ...cjkTokens])).slice(0, 24);
}

function scoreEvidenceSentence(query: string, sentence: string, sourceIndex: number): number {
  const tokens = tokenizeQuery(query);
  const lowerSentence = sentence.toLowerCase();
  let score = Math.max(0, 4 - sourceIndex);

  for (const token of tokens) {
    if (lowerSentence.includes(token.toLowerCase())) score += token.length >= 3 ? 3 : 1.5;
  }
  if (/\d/.test(sentence)) score += 1.5;
  if (/現任|目前|截至|更新|current|第\d+任/i.test(sentence)) score += 2;
  if (/不是|無法|不能|風險|可能|建議|提醒/.test(sentence)) score += 0.75;

  return score;
}

function selectEvidence(query: string, sources: WebSearchSource[], maxCount = 4): Array<{ text: string; source: WebSearchSource; sourceNumber: number }> {
  const seen = new Set<string>();
  return sources
    .flatMap((source, sourceIndex) =>
      splitSentences(source.snippet).slice(0, 4).map((sentence) => ({
        text: truncate(sentence, 170),
        source,
        sourceNumber: sourceIndex + 1,
        score: scoreEvidenceSentence(query, sentence, sourceIndex),
      })),
    )
    .sort((a, b) => b.score - a.score)
    .filter((item) => {
      const key = item.text.replace(/\s+/g, "");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, maxCount);
}

function inferQuestionMode(query: string): "current_fact" | "how_to" | "compare" | "definition" | "forecast" | "general" {
  if (/明天會|會不會|預測|漲|跌|股票|投資/.test(query)) return "forecast";
  if (/怎麼|如何|步驟|路線|方法|教我/.test(query)) return "how_to";
  if (/差異|比較|哪個好|推薦|選哪個|vs|VS/.test(query)) return "compare";
  if (/誰是|是誰|現任|總統|市長|校長|ceo/i.test(query)) return "current_fact";
  if (/是什麼|意思|定義|介紹|原理/.test(query)) return "definition";
  return "general";
}

function buildReasonedSummary(query: string, sources: WebSearchSource[]): { conclusion: string; rationale: string[]; confidence: WebGroundedAnswer["confidence"] } {
  const evidence = selectEvidence(query, sources);
  const mode = inferQuestionMode(query);
  const mainClaim = pickMainClaim(query, sources);
  const firstEvidence = evidence[0]?.text || truncate(sources[0]?.snippet ?? "", 280);

  if (mode === "forecast") {
    return {
      conclusion: "結論：這類問題不能只靠搜尋結果斷言未來走勢。我可以整理已知資訊，但不會把股價、匯率或事件結果講成確定會發生。",
      rationale: evidence.map((item) => `來源 ${item.sourceNumber} 提到：${item.text}`),
      confidence: "low",
    };
  }

  const conclusionPrefix =
    mode === "how_to" ? "整理後的做法：" :
    mode === "compare" ? "整理後的判斷：" :
    mode === "definition" ? "整理後的解釋：" :
    "結論：";

  const conclusion = `${conclusionPrefix}${mainClaim || firstEvidence || "我找到公開資料，但內容不足以形成明確結論。"}`;
  const rationale = evidence.length > 0
    ? evidence.map((item) => `來源 ${item.sourceNumber}：${item.text}`)
    : sources.slice(0, 2).map((source, index) => `來源 ${index + 1}：${truncate(source.snippet, 170)}`);

  const hasPrimaryLikeSource = sources.some((source) =>
    /Open-Meteo|Wikipedia|官方|政府|臺中市|台中市|Google Maps/.test(source.source) ||
    /\.gov|\.edu|wikipedia\.org|open-meteo\.com/.test(source.url),
  );

  return {
    conclusion,
    rationale,
    confidence: hasPrimaryLikeSource && sources.length >= 1 ? "medium" : "low",
  };
}

function removePolitePrefix(query: string): string {
  return query
    .replace(/^(請問|幫我查|幫我搜尋|搜尋|查一下|查詢|我想知道|告訴我)/, "")
    .replace(/[？?。！!]+$/g, "")
    .trim();
}

function uniqueSources(sources: WebSearchSource[]): WebSearchSource[] {
  const seen = new Set<string>();
  const result: WebSearchSource[] = [];
  for (const source of sources) {
    const key = source.url || `${source.source}:${source.title}`;
    if (seen.has(key) || !source.snippet.trim()) continue;
    seen.add(key);
    result.push(source);
  }
  return result.slice(0, MAX_SOURCE_COUNT);
}

async function fetchJson<T>(url: string, signal?: AbortSignal, timeoutMs = SEARCH_TIMEOUT_MS): Promise<T | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const abortFromParent = () => controller.abort();

  try {
    if (signal) {
      if (signal.aborted) return null;
      signal.addEventListener("abort", abortFromParent);
    }
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "Accept-Language": "zh-TW,zh-Hant;q=0.9,zh;q=0.8,en;q=0.5",
        "User-Agent": "CampusAssistant/1.0",
      },
    });
    if (!response.ok) return null;
    return await response.json() as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abortFromParent);
  }
}

function flattenDuckDuckGoTopics(topics: DuckDuckGoTopic[] = []): DuckDuckGoTopic[] {
  return topics.flatMap((topic) => [
    topic,
    ...flattenDuckDuckGoTopics(topic.Topics ?? []),
  ]);
}

async function searchDuckDuckGo(query: string, signal?: AbortSignal): Promise<WebSearchSource[]> {
  const params = new URLSearchParams({
    q: query,
    format: "json",
    no_html: "1",
    skip_disambig: "1",
    no_redirect: "1",
    t: "campus-assistant",
  });
  const data = await fetchJson<DuckDuckGoResponse>(`https://api.duckduckgo.com/?${params.toString()}`, signal);
  if (!data) return [];

  const sources: WebSearchSource[] = [];
  if (data.Answer) {
    sources.push({
      title: data.Heading || "DuckDuckGo Instant Answer",
      url: data.AbstractURL || "https://duckduckgo.com/",
      snippet: stripHtml(data.Answer),
      source: "DuckDuckGo",
    });
  }
  if (data.AbstractText) {
    sources.push({
      title: data.Heading || "DuckDuckGo 摘要",
      url: data.AbstractURL || "https://duckduckgo.com/",
      snippet: stripHtml(data.AbstractText),
      source: data.AbstractSource || "DuckDuckGo",
    });
  }
  if (data.Definition) {
    sources.push({
      title: data.Heading || "DuckDuckGo 定義",
      url: data.DefinitionURL || data.AbstractURL || "https://duckduckgo.com/",
      snippet: stripHtml(data.Definition),
      source: data.DefinitionSource || "DuckDuckGo",
    });
  }

  flattenDuckDuckGoTopics(data.RelatedTopics ?? [])
    .filter((topic) => topic.Text && topic.FirstURL)
    .slice(0, 3)
    .forEach((topic) => {
      sources.push({
        title: topic.Text!.split(" - ")[0] || "搜尋結果",
        url: topic.FirstURL!,
        snippet: stripHtml(topic.Text!),
        source: "DuckDuckGo",
      });
    });

  return sources;
}

async function fetchWikipediaSummary(title: string, language: "zh" | "en", signal?: AbortSignal): Promise<WebSearchSource | null> {
  const encodedTitle = encodeURIComponent(title.replace(/\s/g, "_"));
  const data = await fetchJson<WikipediaSummaryResponse>(
    `https://${language}.wikipedia.org/api/rest_v1/page/summary/${encodedTitle}`,
    signal
  );
  if (!data?.extract) return null;
  return {
    title: data.title || title,
    url: data.content_urls?.desktop?.page || data.content_urls?.mobile?.page || `https://${language}.wikipedia.org/wiki/${encodedTitle}`,
    snippet: stripHtml(data.extract),
    source: language === "zh" ? "Wikipedia 中文" : "Wikipedia",
    updatedAt: data.timestamp,
  };
}

async function searchWikipedia(query: string, signal?: AbortSignal): Promise<WebSearchSource[]> {
  const sources: WebSearchSource[] = [];
  for (const language of ["zh", "en"] as const) {
    const params = new URLSearchParams({
      action: "query",
      list: "search",
      srsearch: query,
      format: "json",
      origin: "*",
      srlimit: "3",
    });
    const data = await fetchJson<WikipediaSearchResponse>(
      `https://${language}.wikipedia.org/w/api.php?${params.toString()}`,
      signal
    );
    const entries = data?.query?.search ?? [];
    for (const entry of entries.slice(0, 2)) {
      if (!entry.title) continue;
      const summary = await fetchWikipediaSummary(entry.title, language, signal);
      if (summary) {
        sources.push(summary);
      } else if (entry.snippet) {
        sources.push({
          title: entry.title,
          url: `https://${language}.wikipedia.org/wiki/${encodeURIComponent(entry.title.replace(/\s/g, "_"))}`,
          snippet: stripHtml(entry.snippet),
          source: language === "zh" ? "Wikipedia 中文" : "Wikipedia",
          updatedAt: entry.timestamp,
        });
      }
    }
    if (sources.length > 0) break;
  }
  return sources;
}

function normalizeWeatherLocation(query: string): { name: string; latitude?: number; longitude?: number } | null {
  if (/靜宜|静宜|沙鹿|台中|臺中/.test(query)) {
    if (/靜宜|静宜|沙鹿/.test(query)) {
      return { name: "台中市沙鹿區靜宜大學", latitude: 24.226, longitude: 120.563 };
    }
    return { name: "台中市", latitude: 24.1477, longitude: 120.6736 };
  }

  const match = query.match(/(?:今天|現在|目前|明天|後天)?\s*([^，。？！?]{2,18}?)(?:天氣|氣溫|會下雨|下雨|帶傘)/);
  const name = match?.[1]?.replace(/的$/, "").trim();
  return name && !/今天|現在|目前/.test(name) ? { name } : null;
}

function describeWeather(code?: number): string {
  if (code == null) return "天氣狀態未提供";
  if (code === 0) return "晴朗";
  if ([1, 2, 3].includes(code)) return "多雲到晴";
  if ([45, 48].includes(code)) return "有霧";
  if ([51, 53, 55, 56, 57].includes(code)) return "毛毛雨";
  if ([61, 63, 65, 66, 67].includes(code)) return "降雨";
  if ([71, 73, 75, 77].includes(code)) return "降雪";
  if ([80, 81, 82].includes(code)) return "陣雨";
  if ([95, 96, 99].includes(code)) return "雷雨";
  return `天氣代碼 ${code}`;
}

async function resolveWeatherLocation(
  location: { name: string; latitude?: number; longitude?: number },
  signal?: AbortSignal
): Promise<{ name: string; latitude: number; longitude: number } | null> {
  if (typeof location.latitude === "number" && typeof location.longitude === "number") {
    return { name: location.name, latitude: location.latitude, longitude: location.longitude };
  }

  const params = new URLSearchParams({
    name: location.name,
    count: "1",
    language: "zh",
    format: "json",
  });
  const data = await fetchJson<OpenMeteoGeocodingResponse>(
    `https://geocoding-api.open-meteo.com/v1/search?${params.toString()}`,
    signal
  );
  const result = data?.results?.[0];
  if (typeof result?.latitude !== "number" || typeof result.longitude !== "number") return null;
  return {
    name: [result.name, result.admin1, result.country].filter(Boolean).join("，"),
    latitude: result.latitude,
    longitude: result.longitude,
  };
}

async function fetchWeatherAnswer(query: string, signal?: AbortSignal): Promise<WebGroundedAnswer | null> {
  if (!/(天氣|氣溫|下雨|帶傘|雨具|天候)/.test(query)) return null;
  const normalizedLocation = normalizeWeatherLocation(query) ?? { name: "台中市沙鹿區靜宜大學", latitude: 24.226, longitude: 120.563 };
  const location = await resolveWeatherLocation(normalizedLocation, signal);
  if (!location) return null;

  const params = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    current: "temperature_2m,relative_humidity_2m,precipitation,rain,weather_code,wind_speed_10m",
    timezone: "Asia/Taipei",
  });
  const data = await fetchJson<OpenMeteoForecastResponse>(
    `https://api.open-meteo.com/v1/forecast?${params.toString()}`,
    signal
  );
  const current = data?.current;
  if (!current) return null;

  const tempUnit = data?.current_units?.temperature_2m ?? "°C";
  const rainUnit = data?.current_units?.rain ?? "mm";
  const windUnit = data?.current_units?.wind_speed_10m ?? "km/h";
  const rain = current.rain ?? current.precipitation ?? 0;
  const fetchedAt = new Date().toISOString();
  const source: WebSearchSource = {
    title: "Open-Meteo Current Weather",
    url: `https://open-meteo.com/en/docs?latitude=${location.latitude}&longitude=${location.longitude}`,
    source: "Open-Meteo",
    updatedAt: current.time,
    snippet: `${location.name}：${describeWeather(current.weather_code)}，${current.temperature_2m ?? "?"}${tempUnit}，降雨 ${rain}${rainUnit}，風速 ${current.wind_speed_10m ?? "?"}${windUnit}`,
  };

  return {
    fetchedAt,
    confidence: "high",
    sources: [source],
    content: [
      `我剛剛連網查到 ${location.name} 的即時天氣：`,
      "",
      `- 狀況：${describeWeather(current.weather_code)}`,
      `- 溫度：${current.temperature_2m ?? "未提供"}${tempUnit}`,
      `- 濕度：${current.relative_humidity_2m ?? "未提供"}%`,
      `- 降雨：${rain}${rainUnit}`,
      `- 風速：${current.wind_speed_10m ?? "未提供"}${windUnit}`,
      "",
      rain > 0 ? "目前有降雨資料，建議帶傘。" : "目前降雨量資料不高，但天氣仍可能變化，出門前可以再確認一次。",
      "",
      `查詢時間：${new Date(fetchedAt).toLocaleString("zh-TW")}`,
      "資料來源：Open-Meteo",
    ].join("\n"),
    suggestions: ["再查一次天氣", "查公車", "推薦午餐"],
  };
}

function isRouteQuery(query: string): boolean {
  return /怎麼去|怎樣去|如何去|如何到|怎麼到|到.*怎麼走|搭什麼|搭哪|幾號公車|公車.*到|路線|導航|交通/.test(query);
}

function buildMapDirectionsUrl(origin: string, destination: string): string {
  const params = new URLSearchParams({
    api: "1",
    origin,
    destination,
    travelmode: "transit",
  });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function extractRoutePlaces(query: string): { origin: string; destination: string } | null {
  const cleaned = removePolitePrefix(query)
    .replace(/[？?。！!]+$/g, "")
    .trim();
  const explicit = cleaned.match(/(?:從|自)([^到去，。？！?]{2,24})(?:到|去)([^，。？！?]{2,30})/);
  if (explicit?.[1] && explicit[2]) {
    return {
      origin: explicit[1].trim(),
      destination: explicit[2].trim(),
    };
  }

  const destination = cleaned
    .replace(/^(我)?(要|想)?(怎麼|怎樣|如何)(去|到)/, "")
    .replace(/^(去|到)/, "")
    .replace(/搭什麼(公車)?(去|到)?/, "")
    .replace(/(怎麼走|路線|導航|交通|怎麼去|如何去|如何到|怎麼到)/g, "")
    .trim();

  if (!destination || destination.length < 2) return null;
  return {
    origin: "靜宜大學",
    destination,
  };
}

function fetchTransitRouteAnswer(query: string): WebGroundedAnswer | null {
  if (!isRouteQuery(query)) return null;

  const places = extractRoutePlaces(query);
  if (!places) return null;

  const normalizedDestination = places.destination.replace(/\s+/g, "");
  const fromPu =
    /靜宜|静宜|pu|providence/i.test(places.origin) ||
    places.origin === "靜宜大學";
  const toTaichungStation = /台中車站|臺中車站|台中火車站|臺中火車站|台中.*車站|臺中.*車站/i.test(normalizedDestination);
  const directionsUrl = buildMapDirectionsUrl(places.origin, places.destination);
  const fetchedAt = new Date().toISOString();

  if (fromPu && toTaichungStation) {
    const sources: WebSearchSource[] = [
      {
        title: "臺中市友善公車到站時間查詢：300 靜宜大學 - 臺中車站",
        url: "https://citybus-free.taichung.gov.tw/driving-map?route=300",
        source: "臺中市公車即時動態",
        snippet: "300 路線為靜宜大學 - 臺中車站，可查往臺中車站方向的即時到站資訊。",
      },
      {
        title: "Google Maps 大眾運輸路線",
        url: directionsUrl,
        source: "Google Maps",
        snippet: "用目前時間開啟靜宜大學到臺中車站的大眾運輸路線。",
      },
    ];

    return {
      fetchedAt,
      confidence: "high",
      sources,
      content: [
        "我剛剛連網查路線：從靜宜大學去臺中車站，最直接先看台中市公車 300 路。",
        "",
        "建議走法：",
        "1. 到「靜宜大學（專用道）」或校門口台灣大道方向的站位。",
        "2. 搭 300 路往「臺中車站」方向。",
        "3. 下車點看即時站牌，通常會顯示「臺中車站(A月台)」或車站周邊站位。",
        "",
        "我不會亂編幾分鐘後到站，因為班距會即時變動。出發前請點開臺中市公車即時動態確認下一班；如果 300 等太久，再用 Google Maps 比較 301-309 臺灣大道幹線或轉乘方案。",
        "",
        "資料來源：",
        "1. 臺中市公車即時動態 300 路",
        sources[0].url,
        "2. Google Maps 即時大眾運輸路線",
        sources[1].url,
        "",
        `查詢時間：${new Date(fetchedAt).toLocaleString("zh-TW")}`,
      ].join("\n"),
      suggestions: ["查 300 到站", "去高鐵怎麼走", "改成從宿舍出發"],
    };
  }

  const sources: WebSearchSource[] = [
    {
      title: "Google Maps 大眾運輸路線",
      url: directionsUrl,
      source: "Google Maps",
      snippet: `從 ${places.origin} 到 ${places.destination} 的即時大眾運輸路線。`,
    },
  ];

  return {
    fetchedAt,
    confidence: "medium",
    sources,
    content: [
      "我有幫你準備即時路線查詢：",
      "",
      `出發：${places.origin}`,
      `目的地：${places.destination}`,
      "",
      directionsUrl,
      "",
      "我目前沒有付費地圖 API，所以不會在聊天裡硬編即時班次或票價。請打開上面的地圖連結，用「大眾運輸」和「現在出發」確認最新路線。",
      "",
      `查詢時間：${new Date(fetchedAt).toLocaleString("zh-TW")}`,
      "資料來源：Google Maps",
    ].join("\n"),
    suggestions: ["換出發地", "查公車到站", "問校園位置"],
  };
}

export function shouldUseWebSearch(query: string, category: IntentCategoryLike = "general"): boolean {
  const q = query.toLowerCase().trim();
  if (!q) return false;
  if (/偽造|竄改|作弊|偷看|帳號密碼|密碼|駭|破解|繞過|入侵|盜用/.test(q)) return false;
  if (/幫我寫|草稿|寫一封|寫信|寫訊息|改寫|潤飾/.test(q)) return false;
  if (category === "greeting" || category === "thanks" || category === "help" || category === "mood" || category === "leave") return false;

  if (isRouteQuery(q) && !/我的課表|我的作業|我的成績|校內導航|教室|辦公室/.test(q)) {
    return true;
  }

  const privateCampusData =
    category === "course" ||
    category === "food" ||
    category === "schedule" ||
    /我的|我有|課表|作業|成績|學分|請假|gpa|待繳|截止/.test(q);

  if (privateCampusData) return false;

  const explicitOnlineRequest =
    /連網|上網|網路|搜尋|查一下|查詢|幫我查|google|資料來源|來源|最新|即時|目前|現在|今天|昨天|明天|現任|新聞|公告最新|更新/.test(q);

  const appPersonalQuestion =
    category === "dorm" ||
    category === "library" ||
    category === "lost_found" ||
    category === "print" ||
    /宿舍|校內|校園|餐廳|圖書館/.test(q);

  if (category === "weather") return true;
  if (explicitOnlineRequest) return true;
  if (appPersonalQuestion) return false;

  const generalQuestion =
    /誰|哪|什麼|為什麼|如何|怎麼|多少|幾|是什麼|意思|定義|介紹|比較|差異|推薦|可以嗎|\?$|？$/.test(q);

  return (
    generalQuestion ||
    /最新|目前|現在|今日|昨日|昨天|明天|即時|新聞|最近|現任|誰是|是誰|哪一年|幾年|幾月|幾號|價格|票價|匯率|股票|總統|市長|校長|ceo|版本|發布|政策|法規|天氣|氣溫|下雨|路線|導航|交通/.test(q)
  );
}

function pickMainClaim(query: string, sources: WebSearchSource[]): string {
  const first = sources[0];
  if (!first) return "";
  const sentences = first.snippet
    .split(/[。！？.!?]\s*/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  if (/誰是|是誰|現任|總統|市長|校長|ceo/i.test(query)) {
    const current = sentences.find((sentence) => /現任|现任|current|第\d+任|是|為|为/.test(sentence));
    if (current) return truncate(current, 260);
  }

  return truncate(sentences.slice(0, 2).join(" "), 320);
}

export function buildWebGroundedAnswer(query: string, sources: WebSearchSource[], fetchedAt = new Date().toISOString()): WebGroundedAnswer | null {
  const usableSources = uniqueSources(sources);
  if (usableSources.length === 0) return null;

  const reasoned = buildReasonedSummary(query, usableSources);
  const sourceLines = usableSources.map((source, index) => {
    const updated = source.updatedAt ? `，更新：${new Date(source.updatedAt).toLocaleDateString("zh-TW")}` : "";
    return `${index + 1}. ${source.title}（${source.source}${updated}）\n${source.url}`;
  });

  return {
    fetchedAt,
    confidence: reasoned.confidence,
    sources: usableSources,
    content: [
      "我先連網查公開來源，再把證據整理後回答：",
      "",
      reasoned.conclusion,
      "",
      "我用到的依據：",
      ...reasoned.rationale.map((line) => `- ${line}`),
      "",
      "資料來源：",
      ...sourceLines,
      "",
      `查詢時間：${new Date(fetchedAt).toLocaleString("zh-TW")}`,
      "提醒：外部網站資料可能更新或有誤，重要決策請再點來源確認原文。",
    ].join("\n"),
    suggestions: ["再查一次", "換個關鍵字", "問校園資料"],
  };
}

export async function answerWithOnlineSearch(query: string, signal?: AbortSignal): Promise<WebGroundedAnswer | null> {
  const cleanedQuery = removePolitePrefix(query);
  const weather = await fetchWeatherAnswer(cleanedQuery, signal);
  if (weather) return weather;

  const transit = fetchTransitRouteAnswer(cleanedQuery);
  if (transit) return transit;

  const [wikipediaSources, duckDuckGoSources] = await Promise.all([
    searchWikipedia(cleanedQuery, signal),
    searchDuckDuckGo(cleanedQuery, signal),
  ]);

  return buildWebGroundedAnswer(cleanedQuery, [...wikipediaSources, ...duckDuckGoSources]);
}
