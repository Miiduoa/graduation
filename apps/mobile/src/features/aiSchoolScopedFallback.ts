import {
  getOfficialLibrary,
  isProvidenceSchoolId,
  resolveGroundedOfficialDirectoryHint,
  resolveSchoolAssistantIdentity,
  resolveSchoolPublicServices,
} from '@campus/shared/src';

export type SchoolScopedReply = {
  content: string;
  suggestions: string[];
  actions?: Array<{
    label: string;
    action: 'navigate';
    params: Record<string, unknown>;
    sensitivity?: 'low';
  }>;
};

function schoolLabel(schoolId?: string | null, schoolName?: string | null): string {
  return resolveSchoolAssistantIdentity(schoolId, schoolName).schoolName;
}

function navigateActionsForUnavailableFacts(): SchoolScopedReply['actions'] {
  return [
    { label: '開啟校園地圖', action: 'navigate', params: { screen: '校園' }, sensitivity: 'low' },
    {
      label: '查看校園公車',
      action: 'navigate',
      params: { screen: '校園', nested: 'BusV2' },
      sensitivity: 'low',
    },
    {
      label: '查看校園公告',
      action: 'navigate',
      params: { screen: 'Today', nested: '公告總覽' },
      sensitivity: 'low',
    },
  ];
}

/** Offline PU→Taichung directions; null for non-PU so callers do not invent routes. */
export function buildSchoolScopedTransportDirections(
  schoolId: string | null | undefined,
  msg: string,
  schoolName?: string | null,
): SchoolScopedReply | null {
  if (!isProvidenceSchoolId(schoolId)) {
    if (
      !/怎麼去|怎樣去|如何去|怎麼到|到.*怎麼走|搭什麼|搭哪|幾號公車|路線|交通|車站|高鐵|公車/.test(
        msg,
      )
    ) {
      return null;
    }
    const name = schoolLabel(schoolId, schoolName);
    const directory = resolveGroundedOfficialDirectoryHint(schoolId, schoolName);
    return {
      content: [
        `目前沒有可核實的「${name}」離線交通路線資料，不能套用其他學校的班次或車程。`,
        directory ? directory : '請改以校方公告、當地運輸業者 App，或 App 內該校已串接的地圖／公車頁為準。',
        '若問題與校園站牌有關，可改開校園地圖或校園公車。',
      ].join('\n\n'),
      suggestions: ['開啟校園地圖', '查看校園公車', '查看公告'],
      actions: navigateActionsForUnavailableFacts(),
    };
  }

  const q = msg.toLowerCase();
  const asksDirections =
    /怎麼去|怎樣去|如何去|怎麼到|到.*怎麼走|搭什麼|搭哪|幾號公車|路線|交通/.test(q);
  const mentionsStation = /台中車站|臺中車站|台中火車站|臺中火車站|車站|火車站/.test(q);
  const mentionsHsr = /高鐵|烏日/.test(q);
  const mentionsShalu = /沙鹿.*(車站|火車站)|沙鹿火車站/.test(q);
  const mentionsMitsui = /三井|outlet|港井/.test(q);
  const mentionsGaomei = /高美/.test(q);

  if (!asksDirections && !mentionsStation && !mentionsHsr && !mentionsMitsui && !mentionsGaomei) {
    return null;
  }

  if (mentionsShalu) {
    return {
      content: [
        '從靜宜大學到沙鹿火車站：',
        '',
        '1. 最快：計程車或共乘，約 10 分鐘。',
        '2. 省錢：到校門口周邊搭往沙鹿市區方向的公車，或用 YouBike 轉乘，實際班次請看台中公車 App。',
        '3. 如果你要再去台中車站，可從沙鹿火車站搭台鐵區間車到台中車站，約 20-30 分鐘。',
        '',
        '離線模式沒有即時班次，出發前請查台鐵或台中公車即時資訊。',
      ].join('\n'),
      suggestions: ['怎麼去台中車站', '怎麼去高鐵', '校門口公車'],
    };
  }

  if (mentionsHsr) {
    return {
      content: [
        '從靜宜大學到高鐵台中站：',
        '',
        '1. 推薦：在校門口一帶搭往高鐵台中站方向的客運或 35 路公車，約 30-40 分鐘。',
        '2. 趕時間：計程車或共乘約 20-30 分鐘，費用會比公車高很多。',
        '3. 到站後依指標進入高鐵站大廳；若要轉台鐵，旁邊是新烏日車站。',
        '',
        '離線模式不能查即時到站，請用台中公車 App 確認下一班車。',
      ].join('\n'),
      suggestions: ['怎麼去台中車站', '查公車站位置', '去沙鹿火車站'],
    };
  }

  if (mentionsMitsui) {
    return {
      content: [
        '從靜宜大學到三井 Outlet 台中港：',
        '',
        '1. 公車：從校門口周邊搭往梧棲/台中港方向的路線，再依台中公車 App 顯示轉乘或下車。',
        '2. 計程車或共乘：約 15-25 分鐘，適合多人分攤。',
        '3. 若時間不趕，先查即時公車會比較穩，因為班距可能不固定。',
      ].join('\n'),
      suggestions: ['怎麼去台中車站', '怎麼去高美濕地', '校門口公車'],
    };
  }

  if (mentionsGaomei) {
    return {
      content: [
        '從靜宜大學到高美濕地：',
        '',
        '1. 公車：通常要往清水/高美方向轉乘，建議直接用台中公車 App 查當下最佳路線。',
        '2. 計程車或共乘：約 25-35 分鐘，傍晚回程較難叫車，建議先規劃。',
        '3. 看夕陽要注意潮汐、風大和回程時間。',
      ].join('\n'),
      suggestions: ['怎麼去台中車站', '怎麼去三井', '查公車'],
    };
  }

  if (mentionsStation || /台中/.test(q)) {
    return {
      content: [
        '從靜宜大學到台中車站，離線版建議兩種走法：',
        '',
        '1. 直達公車：到校門口台灣大道上的公車站，搭 300、307 或 308 往台中車站方向，約 40-50 分鐘。尖峰時間可能更久。',
        '2. 台鐵轉乘：先到沙鹿火車站，再搭台鐵區間車到台中車站。這個方式要多一次轉乘，但有時比較穩。',
        '',
        '下車提醒：目的地可設「台中車站」或「臺中車站」。離線模式不能看即時班次，出門前請用台中公車 App 或台鐵 App 確認下一班。',
      ].join('\n'),
      suggestions: ['校門口公車在哪', '怎麼去高鐵', '去沙鹿火車站'],
    };
  }

  return {
    content: [
      '靜宜大學常用交通：',
      '',
      '1. 台中車站：校門口搭 300、307、308，約 40-50 分鐘。',
      '2. 高鐵台中站：搭往高鐵方向的客運或 35 路，約 30-40 分鐘。',
      '3. 沙鹿火車站：計程車約 10 分鐘，也可查台中公車轉乘。',
      '',
      '離線模式沒有即時到站，請用台中公車 App 確認班次。',
    ].join('\n'),
    suggestions: ['怎麼去台中車站', '怎麼去高鐵', '去沙鹿火車站'],
  };
}

export function buildSchoolScopedWeatherQuickReply(
  schoolId: string | null | undefined,
  schoolName?: string | null,
): SchoolScopedReply {
  const month = new Date().getMonth() + 1;
  const seasonInfo =
    month >= 6 && month <= 9
      ? '夏季氣候偏熱，午後容易有雷陣雨，建議攜帶雨具'
      : month >= 10 && month <= 12
        ? '秋冬季節早晚溫差較大，建議帶件外套'
        : month >= 3 && month <= 5
          ? '春季天氣多變，建議留意氣象預報'
          : '冬季偏涼，請注意保暖';

  if (isProvidenceSchoolId(schoolId)) {
    return {
      content: `靜宜大學位於台中沙鹿，${seasonInfo}。\n\n⚠️ 即時天氣資訊請查看氣象 APP 或中央氣象署網站以獲得最準確的預報。`,
      suggestions: ['查公車', '推薦午餐'],
    };
  }

  const name = schoolLabel(schoolId, schoolName);
  return {
    content: [
      `目前沒有「${name}」的即時天氣資料來源，也不會套用其他校園的氣候描述。`,
      '請改查中央氣象署或氣象 APP；若只要校園動線，可改開地圖或公告。',
    ].join('\n\n'),
    suggestions: ['開啟校園地圖', '查看公告'],
    actions: navigateActionsForUnavailableFacts(),
  };
}

export function buildSchoolScopedTransportQuickReply(
  schoolId: string | null | undefined,
  schoolName?: string | null,
): SchoolScopedReply {
  if (isProvidenceSchoolId(schoolId)) {
    return {
      content:
        '靜宜大學主要公車路線：\n\n• 300/307/308：往台中車站方向\n• 304：往清水方向\n• 統聯：往高鐵台中站\n\n⚠️ 即時到站資訊請查看「台中公車」APP 以獲得最準確的時間。\n\n要開啟校園地圖查看公車站位置嗎？',
      suggestions: ['校門在哪', '怎麼去台中車站'],
      actions: [{ label: '查看公車站位置', action: 'navigate', params: { screen: '校園' } }],
    };
  }

  const name = schoolLabel(schoolId, schoolName);
  return {
    content: [
      `目前沒有可核實的「${name}」固定公車路線表，不能套用其他學校的站點或班次資訊。`,
      '請改用 App 內該校已串接的校園公車／地圖，或以當地運輸業者公告為準。',
    ].join('\n\n'),
    suggestions: ['開啟校園地圖', '查看校園公車'],
    actions: navigateActionsForUnavailableFacts(),
  };
}

export type EmergencyFallbackInput = {
  schoolId?: string | null;
  schoolName?: string | null;
  userText: string;
  /** School-scoped loaded public snippets (announcement titles, POI names, cafeteria names). */
  loadedPublicSnippets?: string[];
};

export function buildSchoolScopedEmergencyFallback(
  input: EmergencyFallbackInput,
): SchoolScopedReply | null {
  const { schoolId, schoolName, userText } = input;
  const text = userText.toLowerCase();
  const name = schoolLabel(schoolId, schoolName);
  const snippets = (input.loadedPublicSnippets ?? [])
    .map((s) => String(s ?? '').trim())
    .filter(Boolean)
    .slice(0, 5);

  const transport = buildSchoolScopedTransportDirections(schoolId, text, schoolName);
  if (transport) return transport;

  if (isProvidenceSchoolId(schoolId)) {
    const campusKB: { pattern: RegExp; answer: string; suggestions: string[] }[] = [
      {
        pattern: /圖書館|蓋夏|借書|還書|自習|看書|討論室/,
        answer:
          '靜宜大學蓋夏圖書館資訊：\n\n📍 位置：校園中心區域，蓋夏圖書館\n⏰ 開放時間：週一至週五 08:00-21:30，週六 09:00-17:00，週日及國定假日休館（學期間）\n\n主要服務：借還書、館際互借、自習室、團體討論室預約、電子資源查詢、列印影印\n\n💡 借書上限通常為 30 冊，借期 14-28 天，可線上續借。\n如需預約討論室，請至圖書館網站或親洽服務台。',
        suggestions: ['怎麼去圖書館', '借書規則', '預約討論室'],
      },
      {
        pattern: /宿舍|住宿|寢室|報修|漏水|洗衣/,
        answer:
          '靜宜大學宿舍相關資訊：\n\n🏠 宿舍包含男生宿舍與女生宿舍，住宿申請通常於每學期初開放。\n\n常見服務：\n- 報修：可至宿舍管理室填報修單或透過學校系統線上報修\n- 洗衣機/烘衣機：各樓層設有投幣式洗衣設備\n- 包裹：宿舍管理室代收，請攜帶學生證領取\n- 門禁時間：通常為 23:00，請留意各宿舍公告\n\n有其他宿舍問題可以繼續問我！',
        suggestions: ['宿舍報修', '洗衣機位置', '門禁時間'],
      },
      {
        pattern: /餐廳|吃什麼|午餐|晚餐|食堂|美食街|便當|飯/,
        answer:
          '靜宜大學校園餐飲：\n\n🍽️ 可確認的校內餐飲點：\n- 靜園餐廳：早餐、咖哩、滷味、自助餐、飲料與點心等櫃位\n- 宜園餐廳：早餐、自助餐、茶飲、炸物、咖哩與鍋貼類櫃位\n- 至善美食廣場：快餐、早餐、飯捲、拉麵、水果與便利商店鮮食\n- 小木屋鬆餅、OK 便利商店\n\n⏰ 營業時間依校方公告與現場公告為準。\n\n想知道今天有哪些可推薦餐點，我會用已載入的官方菜單資料回答，不會亂編價格。',
        suggestions: ['附近有什麼好吃的', '便利商店在哪', '餐廳營業時間'],
      },
      {
        pattern: /選課|加退選|課程|修課|學分|必修|選修|通識/,
        answer:
          '靜宜大學選課相關：\n\n📚 選課時程與學分上限請以教務處當學期公告為準，App 不會在緊急回退時捏造截止日期或學分數字。\n\n可改用課綱查詢、個人課表，或開啟校方課綱系統確認開課資料。',
        suggestions: ['開啟課綱查詢', '查看我的課表'],
      },
      {
        pattern: /請假|缺課|曠課|出席|病假|事假/,
        answer:
          '請假流程與缺課規定請以靜宜大學學務／教務當學期公告為準。\n\nApp 緊急回退不會捏造扣考比例或補假天數；建議直接洽詢導師、任課老師或學務處，或在 App 內建立請假草稿後再送審。',
        suggestions: ['請假信草稿', '查看公告'],
      },
      {
        pattern: /成績|分數|GPA|學期成績|期中考|期末考/,
        answer:
          '成績與 GPA 需登入校務系統即時查詢才正確。緊急回退不會捏造配分比例；請改開成績查詢頁或以教務公告為準。',
        suggestions: ['怎麼查成績', '查看公告'],
      },
      {
        pattern: /停車|機車|汽車|腳踏車|車位|停車場/,
        answer:
          '靜宜大學停車與 YouBike 位置請以校安／總務公告與現場標示為準。緊急回退不會捏造車位數量或拖吊規則；可改開校園地圖查看動線。',
        suggestions: ['開啟校園地圖', 'YouBike 在哪'],
      },
      {
        pattern: /校園|學校|靜宜|在哪|怎麼走|地圖|位置/,
        answer:
          '靜宜大學校園資訊：\n\n📍 地址：台中市沙鹿區台灣大道七段 200 號\n📞 總機：(04) 2632-8001\n\n特定建築動線請改開校園地圖；開放時間與服務規定以校方公告為準。',
        suggestions: ['開啟校園地圖', '圖書館在哪', '怎麼去台中車站'],
      },
    ];

    for (const kb of campusKB) {
      if (kb.pattern.test(text)) {
        return { content: kb.answer, suggestions: kb.suggestions };
      }
    }
  } else {
    const library = getOfficialLibrary(schoolId ?? undefined, schoolName);
    if (/圖書館|借書|還書|自習|看書|討論室/.test(text) && library) {
      return {
        content: [
          `目前沒有「${name}」的內建開放時間／借閱規則知識庫。`,
          `可參考校方圖書館官方頁：${library.websiteUrl}`,
          library.hoursUrl ? `開放時間頁：${library.hoursUrl}` : null,
        ]
          .filter(Boolean)
          .join('\n'),
        suggestions: ['開啟校園地圖', '查看公告'],
        actions: navigateActionsForUnavailableFacts(),
      };
    }

    if (
      /圖書館|宿舍|餐廳|選課|請假|成績|停車|校園|地圖|公車|天氣|交通|課程|學分|醫療|衛保/.test(
        text,
      )
    ) {
      const publicServices = resolveSchoolPublicServices(schoolId);
      const courseLink = publicServices?.services.courses;
      const healthLink = publicServices?.services.health;
      const dormLink = publicServices?.services.dormitory;
      const topicLink = /選課|課程|學分/.test(text)
        ? courseLink
        : /醫療|衛保|健康|諮商/.test(text)
          ? healthLink
          : /宿舍|住宿/.test(text)
            ? dormLink
            : courseLink ?? healthLink ?? dormLink;
      const grounded =
        snippets.length > 0
          ? `目前已載入的「${name}」公開資料片段：\n${snippets.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\n以上僅為已載入標題／名稱，不含未驗證的規則或數字。`
          : `目前沒有可核實的「${name}」本地知識庫條目，也不會套用其他學校的規定或數字。`;
      const directory = resolveGroundedOfficialDirectoryHint(schoolId, schoolName);
      const officialLine = topicLink
        ? `可參考校方公開頁「${topicLink.label}」：${topicLink.url}（${topicLink.sourceLabel}）。這是公開入口，不代表 App 已接入私有校務資料。`
        : null;
      return {
        content: [grounded, officialLine, directory, '請改開校園地圖、公車或公告查看該校已串接來源。']
          .filter(Boolean)
          .join('\n\n'),
        suggestions: ['開啟校園地圖', '查看校園公車', '查看公告'],
        actions: navigateActionsForUnavailableFacts(),
      };
    }
  }

  if (/你好|嗨|哈囉|hello|hi|hey|早安|午安|晚安/.test(text)) {
    return {
      content: `你好！我是${name}的校園助理。\n\n可以問我已載入的校園資料；沒有來源時我會明白說無法確認，並導向地圖、公車或公告。`,
      suggestions: ['開啟校園地圖', '查看公告', '查看校園公車'],
    };
  }
  if (/謝謝|感謝|thx|thanks/.test(text)) {
    return {
      content: '不客氣！有其他問題隨時問我。',
      suggestions: ['查看公告', '開啟校園地圖'],
    };
  }
  if (/你是誰|你叫什麼|自我介紹/.test(text)) {
    const identity = resolveSchoolAssistantIdentity(schoolId, schoolName);
    return {
      content: [
        `我是${identity.assistantLabel}，服務範圍是「${identity.schoolName}」。`,
        '我可以整理已載入的課表、公告與校園公開資料；沒有來源時不會捏造其他學校的路線、開放時間或校規。',
      ].join('\n\n'),
      suggestions: ['開啟校園地圖', '查看公告'],
    };
  }

  return null;
}

export function buildCheckBusOfflineMessage(
  schoolId: string | null | undefined,
  schoolName?: string | null,
): string {
  return buildSchoolScopedTransportQuickReply(schoolId, schoolName).content;
}
