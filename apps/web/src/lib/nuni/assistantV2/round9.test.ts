// @vitest-environment node
import { expect, it } from 'vitest';
import { foodHref, pickupAt } from './food';
import { foodOrderIntent, run, verifyProposalAnswer, writeIntent } from './runner';
import { createTools } from './tools';
import {
  fixtureAdapter,
  fixtureBinding as binding,
  FIXTURE_NOW as now,
  FIXTURE_SECRET as secret,
} from './fixtures';

const usage = { prompt_tokens: 80, completion_tokens: 20, total_tokens: 100 };
const cart = {
  tenantId: 'fixture-realm',
  locationId: 'dining-a',
  requestedPickupAt: '2026-11-04T12:10:00+08:00',
  items: [{ menuItemId: 'veggie', quantity: 1, selectedOptionIds: ['regular'] }],
};

it('keeps read replies from tool results and only mentions missing cards on write questions', () => {
  expect(writeIntent('這禮拜有什麼要交的')).toBe(false);
  expect(writeIntent('我加入的社團最近有什麼消息')).toBe(false);
  expect(writeIntent('幫我點一份不辣的')).toBe(true);
  expect(foodOrderIntent('中午吃什麼？幫我點一份不辣、100 元以內的')).toBe(true);
  expect(foodOrderIntent('點餐開放了嗎')).toBe(false);
  expect(foodOrderIntent('幫我訂便當')).toBe(true);
  expect(foodOrderIntent('點兩份')).toBe(true);
  const read = verifyProposalAnswer(
    '這週要交樹與圖作業與程式練習。請按下方確認卡。',
    [],
    '這禮拜有什麼要交的',
  );
  expect(read).toContain('樹與圖作業');
  expect(read).not.toMatch(/尚未產生確認卡|請按.*卡/);
  expect(verifyProposalAnswer('請按下方「確認」卡，我將送出訂單。', [], '幫我點一份')).toContain(
    '尚未產生確認卡',
  );
});

it('fills reorder pickup from HH:mm and from the question clock', async () => {
  expect(pickupAt(now, '12:10')).toBe('2026-11-04T12:10:00+08:00');
  expect(pickupAt(now, '99:99', '12:10 去拿')).toBe('2026-11-04T12:10:00+08:00');
  const tools = createTools(fixtureAdapter().adapter, binding, secret, now, true, true, '');
  await tools.call('reorder_last_food_order', { requestedPickupAt: '12:10', tenantId: 'fixture-realm' });
  expect(tools.cards[0].args.cart).toMatchObject({
    locationId: 'dining-a',
    requestedPickupAt: '2026-11-04T12:10:00+08:00',
    items: [{ menuItemId: 'veggie', quantity: 1, selectedOptionIds: ['regular'] }],
  });
});

it('produces a food card when the reply claims a card after only reading the menu', async () => {
  let calls = 0;
  const result = await run({
    question: '中午吃什麼？幫我點一份不辣、100 元以內的',
    history: [],
    binding,
    adapter: fixtureAdapter(false).adapter,
    secret,
    now,
    writes: true,
    signal: new AbortController().signal,
    log: () => {},
    model: async () => {
      calls++;
      if (calls === 1)
        return {
          message: {
            role: 'assistant',
            tool_calls: [
              {
                id: 'c1',
                type: 'function',
                function: {
                  name: 'get_food_locations',
                  arguments: '{"tenantId":"fixture-realm"}',
                },
              },
            ],
          },
          usage,
        };
      if (calls === 2)
        return {
          message: {
            role: 'assistant',
            tool_calls: [
              {
                id: 'c2',
                type: 'function',
                function: {
                  name: 'get_food_menu',
                  arguments: '{"locationId":"dining-a","tenantId":"fixture-realm"}',
                },
              },
            ],
          },
          usage,
        };
      return {
        message: {
          role: 'assistant',
          content:
            '蔬菜便當 80 元，不辣。若您同意，請按下方「確認」卡，我將為您送出訂單。',
        },
        usage,
      };
    },
  });
  expect(result.cards).toHaveLength(1);
  expect(result.cards[0].args.mode).toBe('page');
  expect(String(result.cards[0].args.href)).toBe(foodHref(cart));
  expect(result.answer).toContain('蔬菜便當');
  expect(result.answer).not.toBe('尚未產生確認卡，也尚未執行寫入或下單。');
});

it('server-fills an order card when no food tools were called', async () => {
  const result = await run({
    question: '幫我點一份不辣、100 元以內的',
    history: [],
    binding,
    adapter: fixtureAdapter(true).adapter,
    secret,
    now,
    writes: true,
    signal: new AbortController().signal,
    log: () => {},
    model: async () => ({
      message: { role: 'assistant', content: '請按下方確認卡。' },
      usage,
    }),
  });
  expect(result.cards[0].args.mode).toBe('order');
  expect(result.steps.map((s) => s.name)).toEqual(
    expect.arrayContaining(['get_food_locations', 'get_food_menu', 'propose_food_order']),
  );
  expect(result.answer).toMatch(/確認/);
});

it('retries reorder after a clock-only pickup value and keeps the question time', async () => {
  const result = await run({
    question: '跟上次一樣再點一次，12:10 去拿',
    history: [],
    binding,
    adapter: fixtureAdapter(false).adapter,
    secret,
    now,
    writes: true,
    signal: new AbortController().signal,
    log: () => {},
    model: async (input) =>
      input.tools?.length
        ? {
            message: {
              role: 'assistant',
              tool_calls: [
                {
                  id: 'c',
                  type: 'function',
                  function: {
                    name: 'reorder_last_food_order',
                    arguments: '{"requestedPickupAt":"12:10","tenantId":"fixture-realm"}',
                  },
                },
              ],
            },
            usage,
          }
        : { message: { role: 'assistant', content: '請核對確認卡。' }, usage },
  });
  expect(result.steps.some((s) => s.name === 'reorder_last_food_order' && s.status === 'error')).toBe(
    false,
  );
  expect(result.cards[0].args.cart).toMatchObject({
    requestedPickupAt: '2026-11-04T12:10:00+08:00',
    items: [{ menuItemId: 'veggie', quantity: 1, selectedOptionIds: ['regular'] }],
  });
  expect(result.cards[0].args.mode).toBe('page');
});
