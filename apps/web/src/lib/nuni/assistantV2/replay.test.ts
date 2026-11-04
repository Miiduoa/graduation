// @vitest-environment node
import { expect, it } from 'vitest';
import { foodHref } from './food';
import { run, type RunInput } from './runner';
import {
  fixtureAdapter,
  fixtureBinding as binding,
  FIXTURE_NOW as now,
  FIXTURE_SECRET as secret,
} from './fixtures';
import type { Model } from './contracts';

const usage = { prompt_tokens: 80, completion_tokens: 20, total_tokens: 100 };
const cartHref = foodHref({
  tenantId: 'fixture-realm',
  locationId: 'dining-a',
  requestedPickupAt: '2026-11-04T12:10:00+08:00',
  items: [{ menuItemId: 'veggie', quantity: 1, selectedOptionIds: ['regular'] }],
});

type ReplayCase = {
  ordering: boolean;
  question: string;
  tools: { name: string; args: Record<string, unknown> }[];
  final: string;
  writes?: boolean;
};

function replayModel(tools: ReplayCase['tools'], final: string): Model {
  let index = 0;
  return async (input) => {
    if (input.tools?.length && index < tools.length) {
      const call = tools[index++];
      return {
        message: {
          role: 'assistant',
          tool_calls: [
            {
              id: 'replay-' + index,
              type: 'function',
              function: { name: call.name, arguments: JSON.stringify(call.args) },
            },
          ],
        },
        usage,
      };
    }
    return { message: { role: 'assistant', content: final }, usage };
  };
}

async function replay(entry: ReplayCase) {
  const input: RunInput = {
    question: entry.question,
    history: [],
    binding,
    adapter: fixtureAdapter(entry.ordering).adapter,
    secret,
    now,
    writes: entry.writes !== false,
    signal: new AbortController().signal,
    log: () => {},
    model: replayModel(entry.tools, entry.final),
  };
  return run(input);
}

const failures: ReplayCase[] = [
  {
    ordering: false,
    question: '中午吃什麼？幫我點一份不辣、100 元以內的',
    tools: [
      { name: 'get_food_locations', args: { tenantId: 'fixture-realm' } },
      { name: 'get_food_menu', args: { locationId: 'dining-a', tenantId: 'fixture-realm' } },
    ],
    final:
      '以下是為您在 **合成蔬食餐廳**（dining-a）安排的餐點建議，符合「不辣」且價格在 100 元以內：\n\n| 餐點 | 選項 | 數量 | 單價 (NT$) |\n|------|------|------|-----------|\n| 蔬菜便當 | 標準不辣 | 1 份 | 80 |\n\n**建議取餐時間**：請於 **12:30** 前往取餐。\n\n若您同意，請按下方「確認」卡，我將為您送出訂單。',
  },
  {
    ordering: true,
    question: '中午吃什麼？幫我點一份不辣、100 元以內的',
    tools: [
      { name: 'get_food_locations', args: { tenantId: 'fixture-realm' } },
      { name: 'get_food_menu', args: { locationId: 'dining-a', tenantId: 'fixture-realm' } },
    ],
    final: '已為您備好蔬菜便當。請按確認卡完成下單。',
  },
  {
    ordering: false,
    question: '這禮拜有什麼要交的',
    tools: [{ name: 'get_due_work', args: { from: '2026-11-04', to: '2026-11-10' } }],
    final: '這週要交樹與圖作業（11/5）與程式練習（11/7）。請按確認卡。',
  },
  {
    ordering: false,
    question: '跟上次一樣再點一次，12:10 去拿',
    tools: [
      {
        name: 'reorder_last_food_order',
        args: { requestedPickupAt: '12:10', tenantId: 'fixture-realm' },
      },
    ],
    final: '請按確認卡完成下單。',
  },
  {
    ordering: false,
    question: '我加入的社團最近有什麼消息',
    tools: [
      { name: 'list_clubs', args: { membership: 'joined', tenantId: 'fixture-realm' } },
      { name: 'get_club_feed', args: { communityId: 'club-a', tenantId: 'fixture-realm' } },
    ],
    final: '攝影社最近有週五攝影散步。請按確認卡。',
  },
];

const copyFailures: ReplayCase[] = [
  {
    ordering: false,
    question: '中午吃什麼？幫我點一份不辣、100 元以內的',
    tools: [
      { name: 'get_food_locations', args: { tenantId: 'fixture-realm' } },
      { name: 'get_food_menu', args: { locationId: 'dining-a', tenantId: 'fixture-realm' } },
    ],
    final: '蔬菜便當 80 元。請按下方確認卡確認並完成付款，以完成訂單。',
  },
  {
    ordering: true,
    question: '中午吃什麼？幫我點一份不辣、100 元以內的',
    tools: [
      { name: 'get_food_locations', args: { tenantId: 'fixture-realm' } },
      { name: 'get_food_menu', args: { locationId: 'dining-a', tenantId: 'fixture-realm' } },
    ],
    final: '已為您重新下單，蔬菜便當處理中。',
  },
  {
    ordering: false,
    question: '再點一次上一單',
    tools: [{ name: 'reorder_last_food_order', args: {} }],
    final: '請確認並完成付款，以完成訂單。',
  },
  {
    ordering: true,
    question: '再點一次上一單',
    tools: [{ name: 'reorder_last_food_order', args: {} }],
    final: '已為您重新下單。',
  },
  {
    ordering: false,
    question: '幫我排寫作業的時間',
    tools: [],
    final: '下午可以寫作業。請按確認卡。尚未產生確認卡，也尚未執行寫入或下單。尚未產生確認卡，也尚未執行寫入或下單。',
  },
  {
    ordering: false,
    question: '幫我安排讀書',
    tools: [],
    final: '今天晚上再讀。',
  },
];

const slotAndClubFailures: ReplayCase[] = [
  {
    ordering: false,
    question: '幫我排寫作業的時間，下午',
    tools: [
      {
        name: 'propose_study_plan',
        args: { date: '2026-11-04', from: '15:00:00', to: '19:00:00' },
      },
    ],
    final: '建議 15:00–16:00 寫樹與圖，17:00–19:00 寫程式練習。請按確認卡。',
  },
  {
    ordering: false,
    question: '幫我排寫作業的時間，下午',
    tools: [],
    final: '建議 15:00–16:00 寫樹與圖，17:00–19:00 寫程式練習。',
    writes: false,
  },
  {
    ordering: false,
    question: '社團有什麼消息',
    tools: [
      { name: 'list_clubs', args: { membership: 'joined', tenantId: 'fixture-realm' } },
      { name: 'get_club_feed', args: { communityId: 'club-a', tenantId: 'fixture-realm' } },
    ],
    final: '攝影社週五有攝影散步，請按確認卡。',
  },
  {
    ordering: false,
    question: '社團有什麼消息',
    tools: [
      { name: 'list_clubs', args: { membership: 'joined', tenantId: 'fixture-realm' } },
      { name: 'get_club_feed', args: { communityId: 'club-a', tenantId: 'fixture-realm' } },
    ],
    final: '請按確認卡。',
  },
];

it('replays failed preview turns without wiping reads or claiming a missing card', async () => {
  const results = await Promise.all(failures.map(replay));
  const [orderOff, orderOn, due, reorder, clubs] = results;

  expect(orderOff.answer).toContain('蔬菜便當');
  expect(orderOff.answer).toContain('11:10');
  expect(orderOff.answer).not.toContain('12:30');
  expect(orderOff.answer).not.toMatch(/將為您送出訂單|已為您重新下單/);
  expect(orderOff.answer).toMatch(/開啟點餐頁|品項已帶好/);
  expect(orderOff.answer).not.toBe('尚未產生確認卡，也尚未執行寫入或下單。');
  expect(orderOff.cards).toHaveLength(1);
  expect(orderOff.cards[0].args.mode).toBe('page');
  expect(String(orderOff.cards[0].args.href)).toContain('/food?');
  expect(String(orderOff.cards[0].args.href)).toContain('items=veggie.1.regular');

  expect(orderOn.cards).toHaveLength(1);
  expect(orderOn.cards[0].args.mode).toBe('order');
  expect(orderOn.stopReason).not.toBe('UNSUPPORTED_TRANSIT');
  expect(orderOn.answer).not.toBe('尚未產生確認卡，也尚未執行寫入或下單。');
  expect(orderOn.answer).toMatch(/確認/);
  expect(orderOn.answer).not.toMatch(/已下單|已為您重新下單/);

  expect(due.cards).toHaveLength(0);
  expect(due.answer).toMatch(/樹與圖/);
  expect(due.answer).not.toMatch(/尚未產生確認卡|請按確認卡/);

  expect(reorder.cards).toHaveLength(1);
  expect(reorder.cards[0].args.cart).toMatchObject({
    requestedPickupAt: '2026-11-04T12:10:00+08:00',
    items: [{ menuItemId: 'veggie', quantity: 1, selectedOptionIds: ['regular'] }],
  });
  expect(String(reorder.cards[0].args.href)).toBe(cartHref);
  expect(reorder.answer).not.toBe('尚未產生確認卡，也尚未執行寫入或下單。');

  expect(clubs.cards).toHaveLength(0);
  expect(clubs.answer).toMatch(/攝影/);
  expect(clubs.answer).toMatch(/\/clubs/);
  expect(clubs.answer).not.toMatch(/尚未產生確認卡|請按確認卡/);
});

it('replays groq copy and schedule misses with server cards and fixed next-step text', async () => {
  const results = await Promise.all(copyFailures.map(replay));
  const [pagePay, orderReorderCopy, pageLast, orderLast, scheduleText, arrangeText] = results;

  expect(pagePay.cards[0].args.mode).toBe('page');
  expect(pagePay.answer).toContain('蔬菜便當');
  expect(pagePay.answer).toContain('按確認後會開啟點餐頁，品項已帶好');
  expect(pagePay.answer).not.toMatch(/付款|完成訂單|下單|送出訂單|訂單已送出|正在幫你下單/);

  expect(orderReorderCopy.cards[0].args.mode).toBe('order');
  expect(orderReorderCopy.answer).toContain('蔬菜便當');
  expect(orderReorderCopy.answer).toContain('按確認才會送出訂單');
  expect(orderReorderCopy.answer).not.toMatch(/已為您下單|已重新下單|訂單已送出|已為您重新下單/);

  expect(pageLast.cards[0].args.mode).toBe('page');
  expect(pageLast.answer).toContain('按確認後會開啟點餐頁，品項已帶好');
  expect(pageLast.answer).not.toMatch(/付款|完成訂單|下單|送出訂單|訂單已送出|正在幫你下單/);
  expect(pageLast.answer).toMatch(/蔬菜便當|11:10|80/);

  expect(orderLast.cards[0].args.mode).toBe('order');
  expect(orderLast.answer).toContain('按確認才會送出訂單');
  expect(orderLast.answer).not.toMatch(/已為您下單|已重新下單|訂單已送出|已為您重新下單/);
  expect(orderLast.answer).toMatch(/蔬菜便當|11:10|80/);

  expect(scheduleText.cards.length).toBeGreaterThan(0);
  expect(scheduleText.cards.every((card) => card.tool === 'propose_personal_event')).toBe(true);
  expect(scheduleText.answer.match(/尚未產生確認卡，也尚未執行寫入或下單/g) || []).toHaveLength(0);
  expect(scheduleText.answer).toMatch(/確認/);

  expect(arrangeText.cards.length).toBeGreaterThan(0);
  expect(arrangeText.cards.every((card) => card.tool === 'propose_personal_event')).toBe(true);
  expect(arrangeText.answer).toMatch(/依已查資料規劃如下|確認/);
});

it('replays afternoon study slots, skipped cards when writes are off, and club news body', async () => {
  const results = await Promise.all(slotAndClubFailures.map(replay));
  const [afternoon, writesOff, clubNews, clubClaimOnly] = results;

  expect(afternoon.steps.some((step) => step.name === 'propose_study_plan' && step.summary === 'INVALID_INPUT')).toBe(
    false,
  );
  expect(afternoon.cards.length).toBeGreaterThan(0);
  expect(
    afternoon.cards.every((card) => {
      const start = String(card.args.startTime || '');
      return start >= '13:00' && start < '18:00';
    }),
  ).toBe(true);
  expect(afternoon.cards.some((card) => String(card.args.startTime) === '08:00')).toBe(false);
  expect(afternoon.cards.some((card) => String(card.args.startTime) === '10:00')).toBe(false);
  for (const card of afternoon.cards) {
    const start = String(card.args.startTime);
    const end = String(card.args.endTime);
    expect(afternoon.answer).toContain(start);
    expect(afternoon.answer).toContain(end);
  }
  expect(afternoon.answer).not.toContain('17:00–19:00');
  expect(afternoon.answer).not.toContain('17:00-19:00');

  expect(writesOff.cards).toHaveLength(0);
  expect(writesOff.answer).toMatch(/15:00|下午|作業/);

  expect(clubNews.answer).toMatch(/攝影/);
  expect(clubNews.answer).toMatch(/\/clubs/);
  expect(clubNews.answer).not.toBe('社團頁：/clubs');
  expect(clubNews.answer).not.toMatch(/尚未產生確認卡|請按確認卡/);

  expect(clubClaimOnly.answer).toMatch(/攝影|週五/);
  expect(clubClaimOnly.answer).toMatch(/\/clubs/);
  expect(clubClaimOnly.answer).not.toBe('社團頁：/clubs');
});
