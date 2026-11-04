import type { NuniFoodMenuProjection } from '@campus/shared/src/nuniFood';
import { date, fail, id, object, taipeiDate, text, type Obj } from './contracts';
export function pickupAt(now: number, raw?: unknown, question = ''): string {
  const fromClock = (hour: string, minute: string) => {
    const h = hour.padStart(2, '0');
    if (Number(h) > 23 || Number(minute) > 59) return '';
    return `${taipeiDate(now)}T${h}:${minute}:00+08:00`;
  };
  const fromQuestion = () => {
    const time = question.match(/(\d{1,2})[:：](\d{2})/);
    return time ? fromClock(time[1], time[2]) : '';
  };
  const fromRaw = () => {
    if (typeof raw !== 'string' || !raw.trim()) return '';
    const clock = raw.trim().match(/^(\d{1,2})[:：](\d{2})$/);
    if (clock) return fromClock(clock[1], clock[2]);
    if (
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::[0-5]\d(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})$/.test(raw) &&
      Number.isFinite(Date.parse(raw))
    )
      return new Date(Date.parse(raw) + 28800000)
        .toISOString()
        .replace(/Z$/, '+08:00')
        .replace('.000+', '+');
    return '';
  };
  return (
    fromQuestion() ||
    fromRaw() ||
    new Date(now + 40 * 60000 + 28800000)
      .toISOString()
      .replace(/Z$/, '+08:00')
      .replace('.000+', '+')
  );
}
function unwrap(result: unknown): Obj {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return {};
  const row = result as Obj;
  return row.data && typeof row.data === 'object' && !Array.isArray(row.data) ? (row.data as Obj) : row;
}
export function pickFoodCart(
  evidence: { tool: string; result: unknown }[],
  question: string,
  now: number,
): Obj | undefined {
  const budgetMatch = question.match(/(\d+)\s*元/);
  const budgetMinor = budgetMatch ? Number(budgetMatch[1]) * 100 : Number.POSITIVE_INFINITY;
  const mild = /不辣/.test(question);
  let tenantId = '';
  let locationId = '';
  let items: Obj[] = [];
  for (const entry of evidence) {
    const row = unwrap(entry.result);
    if (entry.tool === 'get_food_locations' && Array.isArray(row.locations) && row.locations[0]) {
      const first = row.locations[0];
      if (first && typeof first === 'object' && !Array.isArray(first)) {
        const loc = first as Obj;
        if (typeof loc.tenantId === 'string') tenantId ||= loc.tenantId;
        if (typeof loc.id === 'string') locationId ||= loc.id;
      }
    }
    if (typeof row.completePageHref === 'string') {
      const tenant = /[?&]tenant=([^&]+)/.exec(row.completePageHref);
      if (tenant) tenantId ||= decodeURIComponent(tenant[1]);
    }
    if (entry.tool === 'get_food_menu' && Array.isArray(row.items)) {
      if (typeof row.locationId === 'string') locationId = row.locationId;
      items = row.items as Obj[];
    }
  }
  if (!locationId || !items.length) return;
  const picked = items.find((item) => {
    const price = Number(item.amountMinor);
    if (!Number.isFinite(price) || price > budgetMinor) return false;
    if (mild && !JSON.stringify(item).includes('不辣')) return false;
    return typeof item.id === 'string';
  });
  if (!picked) return;
  const selectedOptionIds: string[] = [];
  for (const group of Array.isArray(picked.groups) ? picked.groups : []) {
    if (!group || typeof group !== 'object' || Array.isArray(group)) continue;
    const spec = group as Obj;
    const options = Array.isArray(spec.options)
      ? spec.options.flatMap((option) =>
          option && typeof option === 'object' && !Array.isArray(option) ? [option as Obj] : [],
        )
      : [];
    const preferred =
      (mild ? options.find((option) => String(option.name).includes('不辣')) : undefined) || options[0];
    if (preferred && typeof preferred.id === 'string' && Number(spec.min) >= 1)
      selectedOptionIds.push(preferred.id);
  }
  return {
    ...(tenantId ? { tenantId } : {}),
    locationId,
    requestedPickupAt: pickupAt(now, undefined, question),
    items: [{ menuItemId: picked.id, quantity: 1, selectedOptionIds }],
  };
}
export type FoodCart = {
  tenantId: string;
  locationId: string;
  requestedPickupAt: string;
  items: { menuItemId: string; quantity: number; selectedOptionIds: string[] }[];
};
export function cartArgs(raw: unknown): FoodCart {
  const a = object(raw, ['tenantId', 'locationId', 'requestedPickupAt', 'items']);
  const supplied = text(a.requestedPickupAt, 40);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::[0-5]\d(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})$/.test(supplied) ||
    !Number.isFinite(Date.parse(supplied))
  )
    return fail();
  date(supplied.slice(0, 10));
  const requestedPickupAt = new Date(Date.parse(supplied) + 28800000).toISOString().replace(/Z$/, '+08:00').replace('.000+', '+');
  if (!Array.isArray(a.items) || !a.items.length || a.items.length > 5) return fail();
  return {
    tenantId: id(a.tenantId),
    locationId: id(a.locationId),
    requestedPickupAt,
    items: a.items.map((raw) => {
      const line = object(raw, ['menuItemId', 'quantity', 'selectedOptionIds']);
      if (
        !Number.isInteger(line.quantity) ||
        Number(line.quantity) < 1 ||
        Number(line.quantity) > 20 ||
        !Array.isArray(line.selectedOptionIds) ||
        line.selectedOptionIds.length > 20
      )
        return fail();
      const selectedOptionIds = line.selectedOptionIds.map(id);
      if (new Set(selectedOptionIds).size !== selectedOptionIds.length) return fail();
      return {
        menuItemId: id(line.menuItemId),
        quantity: Number(line.quantity),
        selectedOptionIds,
      };
    }),
  };
}
export function priceCart(cart: FoodCart, menu: NuniFoodMenuProjection) {
  if (menu.location.id !== cart.locationId || menu.location.state !== 'open')
    return fail('FOOD_LOCATION_UNAVAILABLE');
  let totalMinor = 0;
  const lines = cart.items.map((line) => {
    const item = menu.sections.flatMap((s) => s.items).find((i) => i.id === line.menuItemId);
    if (!item?.available) return fail('INVALID_MENU_ITEM');
    const allowed = item.optionGroups.flatMap((g) => g.options);
    const options = line.selectedOptionIds.map((key) => {
      const option = allowed.find((o) => o.id === key && o.available);
      if (!option) return fail('INVALID_MENU_OPTION');
      return option;
    });
    for (const group of item.optionGroups) {
      const count = options.filter((o) => group.options.some((v) => v.id === o.id)).length;
      if (count < group.minimumSelections || count > group.maximumSelections)
        return fail('INVALID_MENU_OPTION');
    }
    const unitMinor =
      item.basePrice.amountMinor + options.reduce((n, o) => n + o.priceDelta.amountMinor, 0);
    totalMinor += unitMinor * line.quantity;
    return {
      name: item.name,
      quantity: line.quantity,
      options: options.map((o) => o.name),
      unitMinor,
    };
  });
  if (!Number.isSafeInteger(totalMinor) || totalMinor < 0) return fail();
  return {
    store: menu.location.name,
    lines,
    totalMinor,
    currency: 'TWD',
    pickupMethod: '自取',
    requestedPickupAt: cart.requestedPickupAt,
  };
}
export function foodHref(cart: FoodCart): string {
  const items = cart.items
    .map((line) => [line.menuItemId, String(line.quantity), ...line.selectedOptionIds].join('.'))
    .join(',');
  return (
    '/food?tenant=' +
    encodeURIComponent(cart.tenantId) +
    '&location=' +
    encodeURIComponent(cart.locationId) +
    '&items=' +
    encodeURIComponent(items)
  );
}
export function parseFoodItems(raw: unknown): FoodCart['items'] {
  if (typeof raw !== 'string' || !raw || raw.length > 400) return [];
  return raw.split(',').flatMap((entry) => {
    const [menuItemId, qty, ...selectedOptionIds] = entry.split('.');
    const quantity = Number(qty);
    if (
      !menuItemId ||
      !/^[A-Za-z0-9_-]{1,100}$/.test(menuItemId) ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > 20 ||
      selectedOptionIds.length > 20 ||
      selectedOptionIds.some((option) => !/^[A-Za-z0-9_-]{1,100}$/.test(option)) ||
      new Set(selectedOptionIds).size !== selectedOptionIds.length
    )
      return [];
    return [{ menuItemId, quantity, selectedOptionIds }];
  }).slice(0, 5);
}
export function foodCardArgs(raw: unknown): Obj {
  const a = object(raw, ['cart', 'summary', 'mode', 'href', 'reason']);
  const cart = cartArgs(a.cart);
  if (!['order', 'page'].includes(String(a.mode))) return fail();
  const href = foodHref(cart);
  if (a.href !== href) return fail();
  return { cart, summary: object(a.summary), mode: a.mode, href, reason: text(a.reason, 120) };
}
