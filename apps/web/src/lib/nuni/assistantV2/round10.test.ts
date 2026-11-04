// @vitest-environment node
import { expect, it } from 'vitest';
import { pageArgs } from './actions';
import { bytes } from './contracts';
import { foodHref, foodLink, foodOrderIntent, orderQuantity } from './food';
import { providerError } from './groq';
import { alignFoodCardAnswer, run, toolSummary, unsupportedTransit } from './runner';
import { createTools, selectTools, validateTool } from './tools';
import {
  fixtureAdapter,
  fixtureBinding as binding,
  FIXTURE_NOW as now,
  FIXTURE_SECRET as secret,
} from './fixtures';

const usage = { prompt_tokens: 80, completion_tokens: 20, total_tokens: 100 };
const pickup = '2026-11-04T11:10:00+08:00';

it('food order intent is not an availability question and still matches order phrasing', () => {
  expect(foodOrderIntent('點餐開放了嗎')).toBe(false);
  expect(foodOrderIntent('點餐開了沒')).toBe(false);
  expect(foodOrderIntent('幫我訂便當')).toBe(true);
  expect(foodOrderIntent('點兩份')).toBe(true);
  expect(foodOrderIntent('中午吃什麼？幫我點一份不辣、100 元以內的')).toBe(true);
  expect(orderQuantity('點兩份')).toBe(2);
  expect(selectTools('點餐開放了嗎', false)).not.toContain('propose_food_order');
  expect(selectTools('幫我訂便當', false)).toEqual(
    expect.arrayContaining(['get_food_locations', 'get_food_menu', 'propose_food_order']),
  );
});

it('availability questions do not auto-build a cart', async () => {
  const result = await run({
    question: '點餐開放了嗎',
    history: [],
    binding,
    adapter: fixtureAdapter(false).adapter,
    secret,
    now,
    writes: true,
    signal: new AbortController().signal,
    log: () => {},
    model: async () => ({ message: { role: 'assistant', content: '目前可查菜單。' }, usage }),
  });
  expect(result.cards).toHaveLength(0);
  expect(result.answer).not.toMatch(/送出訂單|已下單/);
});

it('order phrasing without 點一份 still produces a card, including quantity', async () => {
  const bento = await run({
    question: '幫我訂便當',
    history: [],
    binding,
    adapter: fixtureAdapter(false).adapter,
    secret,
    now,
    writes: true,
    signal: new AbortController().signal,
    log: () => {},
    model: async () => ({ message: { role: 'assistant', content: '請核對確認卡。' }, usage }),
  });
  expect(bento.cards).toHaveLength(1);
  expect(bento.cards[0].args.mode).toBe('page');
  expect(String(bento.cards[0].args.href)).toContain('items=veggie.1.regular');
  const two = await run({
    question: '點兩份',
    history: [],
    binding,
    adapter: fixtureAdapter(true).adapter,
    secret,
    now,
    writes: true,
    signal: new AbortController().signal,
    log: () => {},
    model: async () => ({ message: { role: 'assistant', content: '請核對確認卡。' }, usage }),
  });
  expect(two.cards[0].args.cart).toMatchObject({
    items: [{ menuItemId: 'veggie', quantity: 2, selectedOptionIds: ['regular'] }],
  });
  expect(String(two.cards[0].args.href)).toContain('items=veggie.2.regular');
});

it('rewrites pickup time and amount from the food card and page-mode copy', () => {
  const tools = createTools(fixtureAdapter(false).adapter, binding, secret, now, true);
  return tools
    .call('get_food_locations', {})
    .then(() =>
      tools.call('propose_food_order', {
        tenantId: 'fixture-realm',
        locationId: 'dining-a',
        requestedPickupAt: pickup,
        items: [{ menuItemId: 'veggie', quantity: 1, selectedOptionIds: ['regular'] }],
      }),
    )
    .then(() => {
      const answer = alignFoodCardAnswer(
        '建議取餐 12:30，共 99 元。若您同意，我將為您送出訂單。',
        tools.cards,
      );
      expect(answer).toContain('11:10');
      expect(answer).toContain('80 元');
      expect(answer).not.toContain('12:30');
      expect(answer).not.toContain('99 元');
      expect(answer).not.toMatch(/送出訂單|已為您重新下單/);
      expect(answer).toMatch(/開啟點餐頁|品項已帶好/);
      const paid = alignFoodCardAnswer(
        '蔬菜便當可取。請按下方確認卡確認並完成付款，以完成訂單。',
        tools.cards,
      );
      expect(paid).toContain('蔬菜便當');
      expect(paid).toContain('按確認後會開啟點餐頁，品項已帶好');
      expect(paid).not.toMatch(/付款|完成訂單|下單|送出訂單|訂單已送出|正在幫你下單/);
      expect(paid).not.toContain('確認並完成付款');
      expect(paid).not.toContain('以完成訂單');
      const checkout = alignFoodCardAnswer(
        '蔬菜便當可取。請去結帳。提交訂單後就完成。訂單已成立。',
        tools.cards,
      );
      expect(checkout).toContain('蔬菜便當可取');
      expect(checkout).toContain('按確認後會開啟點餐頁，品項已帶好');
      expect(checkout).not.toMatch(/結帳|提交訂單|訂單已成立/);
      const english = alignFoodCardAnswer(
        '蔬菜便當可取. Please complete payment. Go to checkout! I placed the order. Reordered already.',
        tools.cards,
      );
      expect(english).toContain('蔬菜便當可取');
      expect(english).not.toMatch(/payment|checkout|placed the order|reordered/i);
      expect(english).toContain('按確認後會開啟點餐頁，品項已帶好');
    });
});

it('order-mode copy drops completed-order sentences and uses the server next-step', async () => {
  const tools = createTools(fixtureAdapter(true).adapter, binding, secret, now, true);
  await tools.call('get_food_locations', {});
  await tools.call('propose_food_order', {
    tenantId: 'fixture-realm',
    locationId: 'dining-a',
    requestedPickupAt: pickup,
    items: [{ menuItemId: 'veggie', quantity: 1, selectedOptionIds: ['regular'] }],
  });
  const answer = alignFoodCardAnswer('已為您重新下單，請稍候。蔬菜便當準備中。', tools.cards);
  expect(answer).toContain('蔬菜便當');
  expect(answer).toContain('按確認才會送出訂單');
  expect(answer).not.toMatch(/已為您下單|已重新下單|訂單已送出|已為您重新下單/);
  expect(answer).toContain('11:10');
});

it('page-mode model replies keep card pickup and never claim the order was sent', async () => {
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
                    name: 'get_food_locations',
                    arguments: '{"tenantId":"fixture-realm"}',
                  },
                },
              ],
            },
            usage,
          }
        : {
            message: {
              role: 'assistant',
              content:
                '蔬菜便當 80 元。建議取餐 12:30。若您同意，請按下方確認卡，我將為您送出訂單。',
            },
            usage,
          },
  });
  expect(result.cards[0].args.mode).toBe('page');
  expect(result.cards[0].args.summary).toMatchObject({ requestedPickupAt: pickup, totalMinor: 8000 });
  expect(result.answer).toContain('11:10');
  expect(result.answer).not.toContain('12:30');
  expect(result.answer).not.toMatch(/將為您送出訂單|已為您重新下單|已下單/);
  expect(result.answer).toMatch(/開啟點餐頁|品項已帶好/);
});

it('does not treat food pickup timestamps as invented transit', async () => {
  const hallucinated =
    '已備好蔬菜便當，建議取餐 2026-11-04T11:10:00+08:00，約 40 分鐘後可取。請按確認卡。';
  expect(unsupportedTransit(hallucinated, [], '幫我點一份不辣的')).toBe(false);
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
    model: async () => ({ message: { role: 'assistant', content: hallucinated }, usage }),
  });
  expect(result.stopReason).not.toBe('UNSUPPORTED_TRANSIT');
  expect(result.cards[0].args.mode).toBe('order');
  expect(result.answer).not.toContain('部分結果（僅列本題已取得資料）');
  expect(result.answer).toContain('11:10');
  expect(result.answer).not.toMatch(/已為您重新下單|已下單/);
});

it('accepts club page proposals that include a community entity id', async () => {
  expect(pageArgs({ page: 'clubs', entityId: 'club-a' })).toEqual({ page: 'clubs' });
  expect(pageArgs({ page: '/clubs', entityId: 'club-a' })).toEqual({ page: 'clubs' });
  expect(validateTool('propose_open_page', { page: 'clubs', entityId: 'club-a' })).toEqual({
    page: 'clubs',
  });
  expect(() => validateTool('propose_open_page', { page: 'map', entityId: '../a' })).toThrow();
  let calls = 0;
  const result = await run({
    question: '我加入的社團最近有什麼消息',
    history: [],
    binding,
    adapter: fixtureAdapter().adapter,
    secret,
    now,
    writes: true,
    signal: new AbortController().signal,
    log: () => {},
    model: async () => {
      const action = [
        ['list_clubs', { tenantId: 'fixture-realm' }],
        ['get_club_feed', { tenantId: 'fixture-realm', communityId: 'club-a' }],
        ['propose_open_page', { page: 'clubs', entityId: 'club-a' }],
      ][calls++];
      return {
        message: action
          ? {
              role: 'assistant',
              tool_calls: [
                {
                  id: 'c' + calls,
                  type: 'function',
                  function: { name: String(action[0]), arguments: JSON.stringify(action[1]) },
                },
              ],
            }
          : { role: 'assistant', content: '攝影社週五有攝影散步。' },
        usage,
      };
    },
  });
  expect(result.steps.some((s) => s.name === 'propose_open_page' && s.status === 'error')).toBe(
    false,
  );
  expect(result.cards.some((c) => c.tool === 'propose_open_page')).toBe(true);
  expect(result.answer).toMatch(/\/clubs/);
});

it('appends an items link when the priced cart cannot be proposed', async () => {
  const result = await run({
    question: '幫我點一份不辣、1 元以內的',
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
                    name: 'get_food_locations',
                    arguments: '{"tenantId":"fixture-realm"}',
                  },
                },
              ],
            },
            usage,
          }
        : { message: { role: 'assistant', content: '沒有符合預算的餐點。' }, usage },
  });
  expect(result.cards).toHaveLength(0);
  expect(result.answer).toContain('items=veggie.1.regular');
});

it('keeps items on the food page link when proposing a cart fails', () => {
  const evidence = [
    {
      tool: 'get_food_locations',
      result: {
        locations: [{ tenantId: 'fixture-realm', id: 'dining-a', name: '合成蔬食餐廳' }],
        completePageHref: '/food?tenant=fixture-realm',
      },
    },
    {
      tool: 'get_food_menu',
      result: {
        locationId: 'dining-a',
        items: [
          {
            id: 'veggie',
            name: '蔬菜便當',
            amountMinor: 8000,
            groups: [{ min: 1, options: [{ id: 'regular', name: '標準不辣' }] }],
          },
        ],
        completePageHref: '/food?tenant=fixture-realm&location=dining-a',
      },
    },
  ];
  expect(foodLink(evidence, '幫我點一份', now)).toBe(
    foodHref({
      tenantId: 'fixture-realm',
      locationId: 'dining-a',
      requestedPickupAt: pickup,
      items: [{ menuItemId: 'veggie', quantity: 1, selectedOptionIds: ['regular'] }],
    }),
  );
});

it('compacts planning tool results and retries after tool_use_failed', async () => {
  let calls = 0;
  let retried = false;
  const result = await run({
    question: '幫我規劃明天：課、作業、吃飯',
    history: [],
    binding,
    adapter: fixtureAdapter().adapter,
    secret,
    now,
    writes: true,
    signal: new AbortController().signal,
    log: () => {},
    model: async (input) => {
      calls++;
      if (calls === 1)
        return {
          message: {
            role: 'assistant',
            tool_calls: [
              {
                id: 'c1',
                type: 'function',
                function: { name: 'get_day_overview', arguments: '{"date":"2026-11-05"}' },
              },
            ],
          },
          usage,
        };
      if (calls === 2) throw providerError(400, '{"error":{"code":"tool_use_failed"}}');
      retried = JSON.stringify(input.messages).includes('較精簡結果');
      expect(bytes(input.messages)).toBeLessThan(7000);
      return { message: { role: 'assistant', content: '請核對確認卡。' }, usage };
    },
  });
  expect(calls).toBeGreaterThanOrEqual(3);
  expect(retried).toBe(true);
  expect(Buffer.byteLength(toolSummary({ schedule: { classes: [{ title: '英文' }] }, pending: [] }))).toBeLessThanOrEqual(900);
  expect(result.answer).toContain('依已查資料規劃如下');
  expect(result.stopReason).not.toBe('OUTPUT_LIMIT');
  expect(result.cards.length).toBeGreaterThan(0);
});
