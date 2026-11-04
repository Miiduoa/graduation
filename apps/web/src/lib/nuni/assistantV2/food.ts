import type { NuniFoodMenuProjection } from '@campus/shared/src/nuniFood';
import { date, fail, id, object, text, type Obj } from './contracts';
export type FoodCart = {
  tenantId: string;
  locationId: string;
  requestedPickupAt: string;
  items: { menuItemId: string; quantity: number; selectedOptionIds: string[] }[];
};
export function cartArgs(raw: unknown): FoodCart {
  const a = object(raw, ['tenantId', 'locationId', 'requestedPickupAt', 'items']);
  const requestedPickupAt = text(a.requestedPickupAt, 40);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00(?:Z|\+08:00)$/.test(requestedPickupAt) ||
    !Number.isFinite(Date.parse(requestedPickupAt))
  )
    return fail();
  date(requestedPickupAt.slice(0, 10));
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
export function foodCardArgs(raw: unknown): Obj {
  const a = object(raw, ['cart', 'summary', 'mode', 'href', 'reason']);
  const cart = cartArgs(a.cart);
  if (!['order', 'page'].includes(String(a.mode))) return fail();
  const href =
    '/food?tenant=' +
    encodeURIComponent(cart.tenantId) +
    '&location=' +
    encodeURIComponent(cart.locationId);
  if (a.href !== href) return fail();
  return { cart, summary: object(a.summary), mode: a.mode, href, reason: text(a.reason, 120) };
}
