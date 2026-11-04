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
    writes: true,
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
