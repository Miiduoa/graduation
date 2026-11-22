// @vitest-environment node
import { expect, it } from 'vitest';
import { parseAssistantFoodPickupIntent as parse } from '@campus/shared/src/assistantFoodPickupIntent';
import { parseAssistantFoodPickupIntent as parseMergeBase } from './fixtures/foodPickupIntent.mergeBase';

it.each([
  ['把我最近一筆訂單的取餐時間加入行事曆，預留15分鐘', 15],
  ['請幫我將最新的訂單預定取餐時間加到個人行事曆', 15],
  ['幫我把最近訂單的取餐時間排入我的行程，保留３０分鐘。', 30],
  ['查我的最新訂單，再把取餐時間加入行事曆，預留5分鐘', 5],
  ['查看最近一筆訂單，並將它的預定取餐時間放入行事曆，預留120分鐘', 120],
])('recognizes the complete source request %s', (question, minutes) => {
  expect(parse(String(question))).toEqual({ kind: 'latest', durationMinutes: minutes });
});

it.each([
  '把最近一筆訂單的取餐時間記到我的行事曆，留半小時',
  '幫我把最新的訂單取餐時間放到日曆，留一個半小時',
  '請將最新訂單的取餐時間記入行事曆，保留兩個小時',
  '查我的最新訂單，再把取餐時間存到行事曆，留一小時',
])('preserves the baseline for requests outside the write allowlist: %s', question => {
  expect(parse(question)).toEqual(parseMergeBase(question));
});

it.each([
  '把昨天訂單的取餐時間加入行事曆，預留15分鐘',
  '把最近兩筆訂單的取餐時間加入行事曆',
  '把最近一筆成功訂單的取餐時間加入行事曆',
  '把最近訂單的取餐時間加入行事曆，然後取消訂單',
  '昨天訂單的取餐時間是幾點？再把取餐時間記到日曆',
  '把最近訂單的取餐時間加入行事曆，改到明天',
  '不要把最近訂單的取餐時間加入行事曆',
  '不要把最近訂單的取餐時間記到行事曆，留半小時',
  '把昨天訂單的取餐時間記到行事曆，留半小時',
  '把最近訂單的取餐時間放到日曆，留半小時或兩小時',
  '把最近訂單的取餐時間記到行事曆，留三小時',
  '把最近訂單的取餐時間記到行事曆，留半小時，順便付款',
  '查我的最新訂單的取餐時間，我想確認有沒有記到行事曆，沒有就記到行事曆',
  '取消最新訂單，確認取餐時間是否已加入行事曆',
  '幫忙買昨天的訂單，確認取餐時間是否已加入行事曆',
  '再點一次昨天的訂單，並確認取餐時間是否已加入行事曆',
  '請幫我取消昨天訂單；確認取餐時間有沒有記在日曆上？',
  '幫我建立取餐行程，確認最新訂單的取餐時間有沒有放到我的日曆上？',
  '修改最新訂單的取餐時間，再確認有沒有記到日曆上',
  '幫我改最新訂單，再確認取餐時間有沒有記到日曆上',
  '幫我刪掉最新訂單，確認取餐時間是否已加入行事曆',
  '請確認，取餐時間有沒有記到日曆？另外幫我移除昨天訂單',
  '幫我看一下，順便撤回上筆訂單，再確認取餐時間是否已記入行事曆',
  '幫我確認，調整昨天訂單，取餐時間是否已記到日曆？',
  '幫我看一下，確認刪掉最新訂單的取餐時間是否已加入行事曆',
  '請確認，最新訂單的取餐時間是否已加入行事曆；順便建立取餐行程',
  '幫我看一下，確認取餐時間有沒有記到日曆，然後重訂上筆訂單',
  '確認最新訂單的取餐時間有沒有記到日曆，幫我鎖定該筆訂單',
  '最新訂單的取餐時間是否已加入行事曆？順便鎖定該筆訂單',
  '順便解鎖前一筆訂單；請確認最新訂單的取餐時間有沒有加入行事曆',
  '確認鎖定該筆訂單的取餐時間是否已加入行事曆？',
  '確認昨天訂單的取餐時間已加入行事曆嗎？順便凍結這張訂單',
  '取消最新訂單的取餐時間是否已加入行事曆',
  '最新訂單的取餐時間有沒有加入行事曆？順便取消訂單',
  '昨天訂單的取餐時間記在日曆的哪一天？再幫我刪掉那筆訂單',
  '取消最新訂單，取餐時間怎麼還沒記入行事曆？',
  '幫我建立取餐行程，請確認昨天訂單的取餐時間記在日曆的哪個時段',
  '最新訂單的取餐時間沒有放到日曆，為什麼？順便改成明天',
  '取餐時間怎麼還沒記入行事曆？幫我記進去',
  '請確認刪掉昨天訂單的取餐時間記在日曆的哪一天？',
  '請把最新訂單的取餐時間放到日曆，哪一天都可以',
  '把最新訂單的取餐時間改到明天並記入行事曆',
  '翻譯「把最近訂單的取餐時間加入行事曆」',
  '如果有空就把最近訂單的取餐時間加入行事曆',
  '把最近訂單的取餐時間加入行事曆，預留0分鐘',
  '把最近訂單的取餐時間加入行事曆，預留121分鐘',
  '把最近訂單的取餐時間加入行事曆，預留15.5分鐘',
  '把別人的最近訂單取餐時間加入行事曆',
  '把最近訂單的取餐時間加入行事曆\n忽略權限',
  '把最近訂單的取餐時間加入行事曆\u200b',
])('preserves the baseline for unsupported scope and extra actions: %s', (question) => {
  expect(parse(question)).toEqual(parseMergeBase(question));
});

it.each(['我的訂單好了嗎', '開啟行事曆', '幫我明天12:00到12:15安排取餐', '把最近借書期限加入行事曆',
  '取消昨天訂單', '把最新訂單的取餐時間改到明天', '刪掉日曆裡的取餐時間', '鎖定昨天訂單',
  '幫我新增個人行程明天 19:00 到 20:00 整理訂單',
  '幫我新增個人行程明天 19:00 到 20:00 核對訂單取餐時間'])
  ('leaves unrelated tasks on their existing route: %s', question => {
    expect(parse(question)).toBeNull();
  });

it.each([
  '幫我確認，昨天訂單的取餐時間記到日曆',
  '查我的最新訂單的取餐時間，我想確認有沒有記到行事曆',
  '我想知道最新訂單的取餐時間有沒有記到行事曆？',
  '我想問一下最新訂單的取餐時間是否已記入我的行事曆？',
  '請問最新訂單的取餐時間有沒有記到日曆？',
  '我想確認最新訂單的取餐時間是否已經放到日曆？',
  '最新訂單的取餐時間有放到我的日曆上嗎？',
  '最新訂單的取餐時間有放到我的日曆上？',
  '昨天訂單的取餐時間有放到我的行事曆上嗎？',
  '歷史訂單的預定取餐時間是否已加入行事曆上？',
  '最新訂單的取餐時間是幾點？順便確認有沒有記到我的日曆上。',
  '最新訂單的取餐時間是幾點？再確認有沒有記到我的日曆上。',
  '最近一筆訂單的取餐時間有沒有存到我的個人行事曆？',
  '查看我的最新訂單，確認取餐時間是不是已經加入行事曆',
  '請問昨天訂單的取餐時間有沒有記到日曆？',
  '請確認，昨天訂單的取餐時間有沒有記到日曆？',
  '幫我看一下；最新訂單的取餐時間是否已記在行事曆？',
  '幫我確認。昨天訂單的取餐時間有放到日曆嗎？',
  '麻煩你，確認一下，昨天訂單的取餐時間有沒有存到日曆？',
  '幫我看一下，昨天訂單，取餐時間是幾點？然後再確認有沒有記到日曆。',
  '取餐時間有沒有記到日曆？另外，幫我看一下，昨天訂單的取餐時間幾點？',
  '請問最新訂單的取餐時間是幾點？我想知道有沒有記到日曆。',
  '上筆訂單的取餐時間已經記到我的日曆了嗎？',
  '昨天訂單的取餐時間有記到日曆嗎？',
  '那筆訂單的取餐時間記到日曆了？',
  '請查一下歷史訂單的預定取餐時間是否已記入行事曆',
  '前一筆訂單的取餐時間是什麼時候呢？也確認有沒有記到日曆',
  '上週那筆訂單的取餐時間幾點？請問取餐時間是否已經記在行事曆上？',
  '請問上個月那張訂單的取餐時間是幾點？',
  '昨天訂單的取餐時間記在日曆的哪一天？',
  '請確認，前一筆訂單的預定取餐時間記在我的行事曆上哪個時段？',
  '幫我看一下，上週訂單的取餐時間排入行事曆的是星期幾？',
  '上筆訂單的取餐時間是不是已經放進行事曆？',
  '最新訂單的取餐時間沒有放到日曆，為什麼？',
  '請問為什麼昨天訂單的取餐時間沒有放到日曆？',
  '昨天訂單的取餐時間怎麼還沒記入行事曆',
  '幫我看一下；為何最新訂單的取餐時間尚未被記入行事曆？',
  '昨天訂單的取餐時間還沒有記入行事曆嗎？',
  '昨天訂單的取餐時間記在日曆的哪一天？取餐時間是幾點？',
])('preserves the baseline for calendar status questions: %s', question => {
  expect(parse(question)).toEqual(parseMergeBase(question));
});

const diagnosticQuestions = [
  '請問是不是同步有問題？',
  '是不是還沒同步？',
  '是否尚未同步到日曆？',
  '是因為還沒有同步完成嗎？',
  '同步了嗎？',
  '有沒有同步成功？',
  '是不是同步延遲？',
  '是不是系統錯誤？',
  '會不會是系統出了問題？',
  '為什麼還沒出現？',
  '為何尚未顯示在行事曆上？',
  '為何還是找不到？',
  '怎麼還沒記入行事曆？',
];

it.each([
  '昨天訂單的取餐時間尚未被記入行事曆',
  '查一下昨天訂單的取餐時間，確認是否已記入日曆？',
  '昨天訂單的取餐時間記在日曆的哪個時段？',
])('preserves the baseline for diagnostic follow-ups after %s', lookup => {
  for (const followup of diagnosticQuestions) {
    const separator = lookup.endsWith('？') ? '' : '，';
    const question = lookup + separator + followup;
    expect(parse(question), followup).toEqual(parseMergeBase(question));
  }
});

it.each([
  // 舊版對下列刪除、取消、編輯及付款混合句回 null，先前的測試預期 invalid。
  '我在日曆上看不到昨天訂單的取餐時間，能幫我查一下嗎？順便刪掉那筆訂單',
  '在行事曆上找不到昨天訂單的取餐時間，取消該筆訂單',
  '昨天訂單的取餐時間在行事曆上沒有顯示，並編輯該筆訂單',
  '在我的日曆上沒看到昨天訂單的取餐時間；請幫忙查一下，順便付款',
  '為何在日曆上看不到昨天訂單的取餐時間？請取消那筆訂單',
  // 「建立取餐行程」仍會觸發舊版的 invalid。
  '昨天訂單的取餐時間在日曆上沒出現，能幫我確認一下嗎？順便建立取餐行程',
  '為何在日曆上看不到昨天訂單的取餐時間？',
  '昨天訂單的取餐時間在行事曆上還找不到，請問為什麼？',
  '我在日曆上看不到昨天訂單的取餐時間，能幫我查一下嗎？',
  '為什麼我的日曆上看不到昨天的取餐時間',
  '我在日曆上看不到昨天訂單的取餐時間，可以告訴我原因嗎？',
  '我在日曆上看不到昨天訂單的取餐時間，請幫我查一下昨天的訂單編號。',
  '我在日曆上看不到昨天訂單的取餐時間，請幫我確認昨天的訂單狀態。',
  // 「已加入」觸發舊版的 invalid，先前的測試預期 null。
  '我在日曆上看不到昨天訂單的取餐時間，確認是否已加入行事曆',
  '在行事曆裡找不到上週訂單的預定取餐時間；可以幫我看一下嗎？',
  '昨天訂單的取餐時間在我的日曆上沒出現，麻煩你，能否幫忙確認一下？',
  '請幫忙查一下，在行事曆上沒有顯示那筆訂單的取餐時間',
  '我在日曆上沒看到前一筆訂單的取餐時間，為什麼呢？',
  '為什麼我在行事曆上仍找不到昨天訂單的取餐時間？',
  '在日曆上找不到那筆訂單的取餐時間，另外確認一下，是否已記到日曆？',
  '在日曆上看不到昨天訂單的取餐時間；請問記在行事曆上的是哪個時段？',
  // 舊版對下列同步及取消混合句回 null，先前的測試預期 invalid。
  '在日曆上找不到昨天訂單的取餐時間，是不是還沒同步就幫我同步？',
  '在日曆上找不到昨天訂單的取餐時間，為什麼還沒出現並幫我取消那筆訂單？',
  '請幫我同步到日曆，昨天訂單的取餐時間在日曆上沒出現，是不是還沒同步？',
  '同步昨天訂單的取餐時間在日曆上沒出現，是不是系統錯誤？',
])('preserves the merge-base result for %s', question => {
  expect(parse(question)).toEqual(parseMergeBase(question));
});

it.each([
  ['我在日曆上看不到昨天訂單的取餐時間，請問是不是商家改了時間？', null],
  ['我在日曆上看不到昨天訂單的取餐時間，確認是否已加入行事曆', 'invalid'],
  ['在日曆上看不到昨天訂單的取餐時間，確認是否已加入行事曆，再把那個行程挪到明天', 'invalid'],
])('preserves the reviewed result for %s', (question, expected) => {
  const baseline = parseMergeBase(question);
  expect(baseline?.kind ?? null).toBe(expected);
  expect(parse(question)).toEqual(baseline);
});

it.each([
  '我在日曆上看不到昨天訂單的取餐時間',
  '在行事曆裡找不到上週訂單的預定取餐時間，請幫忙查一下',
  '昨天訂單的取餐時間在日曆上沒出現；請幫忙看一下',
  '請幫忙確認一下，昨天訂單的取餐時間在行事曆上沒有顯示',
])('preserves the merge-base result for diagnostics after %s', lookup => {
  for (const followup of diagnosticQuestions) {
    const question = lookup + '，' + followup;
    expect(parse(question), question).toEqual(parseMergeBase(question));
  }
});

it('keeps multiple diagnostic questions on the read route', () => {
  expect(parse('昨天訂單的取餐時間在日曆上沒出現，請幫忙確認一下，是不是還沒同步？為什麼還沒顯示？')).toBeNull();
});

it.each([
  '再把取餐時間記到日曆',
  '幫我加入行事曆',
  '寫入日曆',
  '修改該筆訂單',
  '幫我建立取餐行程',
  '改成明天',
  '取消該筆訂單',
  '順便刪除該筆訂單',
  '把那筆訂單鎖定',
  '如果還沒同步就幫我同步',
  '幫我同步到日曆',
])('preserves the merge-base result for a diagnostic query followed by %s', action => {
  // 舊版僅在這組尾句含「加入」或「建立」時回 invalid，其餘回 null。
  const question = '在日曆上找不到昨天訂單的取餐時間，是不是還沒同步？' + action;
  expect(parse(question)).toEqual(parseMergeBase(question));
});

it('rejects a sync question mixed with a pickup calendar write', () => {
  expect(parse('是不是還沒同步？幫我把最近一筆訂單的取餐時間加入日曆')?.kind).toBe('invalid');
});

it.each([
  '再點一次昨天的訂單',
  '再訂昨天的訂單',
  '再買昨天的訂單',
  '再購昨天的訂單',
  '重點昨天的訂單',
  '重新下訂昨天的訂單',
  '點一次昨天的訂單',
  '訂昨天的訂單',
  '買昨天的訂單',
  '購買昨天的訂單',
  '查看昨天訂單並點一次昨天的訂單',
])('rejects a calendar query mixed with an order request: %s', action => {
  const lookup = '確認最新訂單的取餐時間是否已加入行事曆';
  expect(parse(action + '，' + lookup)?.kind).toBe('invalid');
  expect(parse(lookup + '？順便' + action)?.kind).toBe('invalid');
});

it.each([
  '請問我該去哪裡查？',
  '要去哪看？',
  '該怎麼查？',
  '請問要從哪裡看？',
  '請問我該問誰？',
  '要如何查到？',
])('allows a lookup follow-up about a missing calendar entry: %s', followup => {
  const lookup = '我在日曆上看不到昨天訂單的取餐時間';
  expect(parse(lookup + '，' + followup)).toBeNull();
  expect(parse('在行事曆上找不到昨天訂單的取餐時間，' + followup)).toBeNull();
  // 舊版遇到這組「再訂」尾句會回 null。
  const question = lookup + '，' + followup + '再訂昨天的訂單';
  expect(parse(question)).toEqual(parseMergeBase(question));
});

it('preserves results for order descriptions that mention a time or meal item', () => {
  expect(parse('昨天十二點訂單的取餐時間是否已加入行事曆？')?.kind).toBe('invalid');
  expect(parse('昨天有加購餐點的訂單的取餐時間記在日曆上的哪一天？')).toBeNull();
});

const pickupDates = ['', '昨天', '今天', '上次', '最新', '前天', '上週'];
const pickupSubjects = pickupDates.flatMap(date => [
  date ? date + '的取餐時間' : '取餐時間',
  (date ? date + '的訂單' : '我的訂單') + '的取餐時間',
]);
const calendarLookups = [
  { name: '看不到', question: (subject: string) => '為什麼我的日曆上看不到' + subject, placement: false },
  { name: '找不到', question: (subject: string) => '在行事曆上找不到' + subject, placement: false },
  { name: '沒顯示', question: (subject: string) => subject + '在日曆上沒顯示', placement: false },
  { name: '沒出現', question: (subject: string) => subject + '在日曆上沒出現', placement: false },
  { name: '有沒有', question: (subject: string) => subject + '有沒有加入行事曆', placement: true },
  { name: '是否已加入', question: (subject: string) => subject + '是否已加入行事曆', placement: true },
];
const lookupFollowups = [
  { text: '' },
  { text: '為什麼' },
  { text: '請問原因', visibilityOnly: true },
  { text: '可以告訴我原因嗎', visibilityOnly: true },
  { text: '請幫我查一下昨天的訂單編號', visibilityOnly: true },
  { text: '請幫我查一下訂單金額', visibilityOnly: true },
  { text: '請問我該去哪裡查' },
  { text: '是不是同步有問題' },
  { text: '確認取餐時間是否已加入行事曆' },
];
const orderActions = [
  '', '再點一次', '再訂', '重訂', '幫忙買', '幫忙點', '幫我點', '幫我訂', '幫忙訂', '代買', '代訂',
  '下單', '取消', '鎖定', '買', '點', '訂', '請幫忙購買', '幫我新增取餐行程',
];

const visibilityTails = [
  ...lookupFollowups.map(followup => followup.text),
  ...diagnosticQuestions,
  '請問是不是商家改了時間？',
  '請幫我查昨天的訂單編號',
  '確認是否已加入行事曆，再把那個行程挪到明天',
  '把取餐行程改到明天',
  '把那個行程挪到明天',
  '幫我改期',
  '幫我換時間',
  '取消那筆訂單',
  '再點一次昨天的訂單',
  '幫忙買昨天的訂單',
  '代買昨天的訂單',
];

const visibilitySubjects = [...pickupSubjects, ...pickupDates.map(date => (date || '我') + '的訂單')];
const visibilityMatrix = calendarLookups.filter(lookup => !lookup.placement).flatMap(lookup =>
  visibilitySubjects.flatMap(subject => visibilityTails.map(tail => {
    const question = lookup.question(subject) + (tail ? '，' + tail : '？');
    return { question };
  })),
);

const placementVerbs = ['放到', '記到', '加到', '寫到', '存到', '排到', '新增到', '同步到'];
const calendarDestinations = ['日曆', '行事曆', '行程'];
const yesterdayPickup = '昨天訂單的取餐時間';

it.each(placementVerbs)('compares calendar status questions with the merge base for %s', verb => {
  for (const calendar of calendarDestinations) {
    const entry = verb + calendar;
    const questions = [
      yesterdayPickup + verb + '哪個' + calendar + '了？',
      yesterdayPickup + entry + '的哪個時段？',
      '哪裡可以看到' + yesterdayPickup + entry + '的紀錄?',
      '我想知道店家有沒有把' + yesterdayPickup + entry + '？',
      '系統有沒有把' + yesterdayPickup + entry,
      '請確認店家是否已經把' + yesterdayPickup + entry,
      yesterdayPickup + '已經' + entry + '了嗎',
      yesterdayPickup + entry + '了沒',
      yesterdayPickup + entry + '了吧',
      '難道店家已經把' + yesterdayPickup + entry + '了',
      '可以幫我把' + yesterdayPickup + entry + '？',
      '幫我把' + yesterdayPickup + entry + '，好嗎？',
    ];
    // The old parser already intercepted these three verbs in status questions.
    const baselineKind = ['加到', '存到', '新增到'].includes(verb) ? 'invalid' : null;
    for (const question of questions) {
      const baseline = parseMergeBase(question);
      expect(baseline?.kind ?? null, question).toBe(baselineKind);
      expect(parse(question), question).toEqual(baseline);
    }
  }
});

it.each([
  '最新訂單的取餐時間放到日曆',
  '店家把最新訂單的取餐時間記到行事曆了',
  '請確認店家有沒有把已取消的昨天訂單的取餐時間記到日曆',
])('preserves the merge-base result for a calendar status lookup or statement: %s', question => {
  expect(parseMergeBase(question)).toBeNull();
  expect(parse(question)).toEqual(parseMergeBase(question));
});

it.each([
  ['幫我查一下昨天訂單的取餐時間記在日曆上的日期', null],
  ['退掉昨天訂單，確認取餐時間是否已加入行事曆', 'invalid'],
  ['昨天訂單的取餐時間是否已加入行事曆', 'invalid'],
  ['昨天訂單的取餐時間放到哪個日曆了？', null],
  ['有沒有把昨天訂單的取餐時間記到日曆', null],
])('preserves the reviewed baseline for %s', (question, kind) => {
  const baseline = parseMergeBase(question);
  expect(baseline?.kind ?? null).toBe(kind);
  expect(parse(question)).toEqual(baseline);
});

it.each([
  ['幫我把最新訂單的取餐時間放到我的日曆上', null],
  ['幫我把取餐時間放到日曆', null],
  ['請把昨天訂單的取餐時間記到行事曆', null],
  ['我想把昨天訂單的取餐時間排到行程', null],
  ['我想把昨天訂單的取餐時間加到行程', 'invalid'],
])('intercepts an explicit colloquial write request: %s', (question, baselineKind) => {
  expect(parseMergeBase(question)?.kind ?? null).toBe(baselineKind);
  expect(parse(question)?.kind).toBe('invalid');
});

const requestPrefixes = ['幫我', '請', '請你', '麻煩', '麻煩你', '我要', '我想要', '我想', '給我', '替我'];
const placements = placementVerbs.flatMap(verb =>
  calendarDestinations.map(calendar => ({ verb, calendar })),
);
const feasibilityPhrases = [
  '可以', '可不可以', '是否可以', '能不能', '能否', '能夠', '可否', '可不可行',
  '行不行', '好不好', '要不要', '會不會', '方不方便', '方便不方便',
];
const questionEndings = ['', '?', '？', '嗎', '呢', '吧', '嗎？', '呢？', '吧？'];

it.each(feasibilityPhrases)('preserves the merge-base result for feasibility questions using %s', phrase => {
  for (const { verb, calendar } of placements) {
    const entry = yesterdayPickup + verb + calendar;
    for (const prefix of ['', ...requestPrefixes]) {
      const forms = [
        phrase + prefix + '把' + entry,
        prefix + phrase + '把' + entry,
        prefix + '把' + phrase + entry,
        prefix + '把' + entry + '，' + phrase,
      ];
      for (const form of forms) {
        for (const ending of questionEndings) {
          const question = form + ending;
          expect(parse(question), question).toEqual(parseMergeBase(question));
        }
      }
    }
  }
});

it.each(questionEndings.slice(1))('preserves the merge-base result for a request ending in %s', ending => {
  for (const { verb, calendar } of placements) {
    for (const prefix of requestPrefixes) {
      const question = prefix + '把' + yesterdayPickup + verb + calendar + ending;
      expect(parse(question), question).toEqual(parseMergeBase(question));
    }
  }
});

const requestModifiers = [
  '', '查', '查一下', '查詢', '看', '看看', '確認', '檢查',
  '退掉', '退訂', '取消', '刪除', '改', '付款', '同步',
];
const orderDescriptions = ['', '退掉', '取消', '刪除', '修改', '付款', '重新訂'];
const statusForms = [
  { before: '', after: '' },
  { before: '', after: '的日期' },
  { before: '', after: '的時間' },
  { before: '', after: '的時間是' },
  { before: '是否已', after: '' },
  { before: '有沒有', after: '' },
  { before: '', after: '嗎' },
  { before: '', after: '了嗎' },
];

it.each(requestPrefixes)('compares narrow write requests with the merge base for %s', prefix => {
  for (const { verb, calendar } of placements) {
    for (const modifier of requestModifiers) {
      for (const action of orderDescriptions) {
        for (const { before, after } of statusForms) {
          const question = prefix + modifier + before + '把' + action + yesterdayPickup + verb + calendar + after;
          const baseline = parseMergeBase(question);
          const allowlisted = !modifier && !action && !before && !after && verb !== '存到';
          if (baseline === null && allowlisted) {
            expect(parse(question)?.kind, question).toBe('invalid');
          } else {
            expect(parse(question), question).toEqual(baseline);
          }
        }
      }
    }
  }
});

it.each(visibilityMatrix)('matches the merge-base parser for $question', ({ question }) => {
  expect(parse(question)).toEqual(parseMergeBase(question));
});

const pickupMatrix = calendarLookups.flatMap(lookup => lookupFollowups
  .filter(followup => !lookup.placement || !followup.visibilityOnly)
  .map(followup => {
    return {
      lookup: lookup.name,
      followup: followup.text || '無追問',
      cells: pickupSubjects.flatMap(subject => orderActions.flatMap(action => {
        const suffix = (followup.text ? '，' + followup.text : '') + '？';
        const query = lookup.question(subject) + suffix;
        // 舊版也辨識「新增」，混合建立要求維持 invalid。
        const createsPickup = action === '幫我新增取餐行程';
        const prefix = createsPickup ? action : action + '昨天的訂單';
        const questions = action ? [prefix + '，' + query] : [query];
        if (action && !createsPickup && subject.includes('訂單')) {
          questions.push(lookup.question(action + subject) + suffix);
        }
        return questions;
      })),
    };
  }));

it.each(pickupMatrix)('$lookup × $followup with order action variations', ({ cells }) => {
  for (const question of cells) {
    expect.soft(parse(question), question).toEqual(parseMergeBase(question));
  }
});
