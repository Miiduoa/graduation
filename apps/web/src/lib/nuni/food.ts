import type { NextRequest } from 'next/server';
import { NuniError } from '@campus/shared/src/nuni';
import { createNuniFoodClient } from '@campus/shared/src/nuniFood';
import { boundedJson, jsonResponse, platformRequest, requireSession } from './server';

/** Only these food resources may receive query parameters or reach the food proxy. */
export function isFoodResource(parts: string[]): boolean {
  return (
    (parts.length === 1 && ['realms', 'food-order-realms'].includes(parts[0])) ||
    (parts[0] === 'realms' && parts[2] === 'food') ||
    (parts[0] === 'merchant-workspaces' &&
      ['orders', 'shift', 'kitchen-tickets'].includes(parts[3]))
  );
}

export async function handleFood(request: NextRequest, parts: string[]) {
  const session = requireSession(request);
  const client = createNuniFoodClient((path, input, query) =>
    platformRequest(path, session, input, query),
  );
  const method = request.method;
  const query: Record<string, string> = {};
  for (const [key, value] of request.nextUrl.searchParams) {
    if (Object.hasOwn(query, key) || !/^[A-Za-z][A-Za-z0-9]{0,31}$/.test(key) || value.length > 500)
      throw new NuniError(400, 'INVALID_INPUT');
    query[key] = value;
  }
  const hasQuery = Object.keys(query).length > 0;
  const isList =
    (parts[0] === 'realms' && parts.length === 4 && ['locations', 'orders'].includes(parts[3])) ||
    (parts[0] === 'merchant-workspaces' && parts.length === 4 && parts[3] === 'orders');
  if (hasQuery && (method !== 'GET' || !isList)) throw new NuniError(400, 'INVALID_INPUT');
  if (method === 'GET' && parts.length === 1) {
    if (parts[0] === 'realms') return jsonResponse({ realms: await client.listRealms() });
    if (parts[0] === 'food-order-realms')
      return jsonResponse({ realms: await client.listOrderRealms() });
  }
  const tenantId = parts[1];
  if (parts[0] === 'realms') {
    if (method === 'GET') {
      if (parts.length === 4 && parts[3] === 'locations')
        return jsonResponse(await client.listLocations(tenantId, query));
      if (parts.length === 4 && parts[3] === 'orders')
        return jsonResponse(await client.listOrders(tenantId, query));
      if (parts.length === 5 && parts[3] === 'orders')
        return jsonResponse(await client.getOrder(tenantId, parts[4]));
      if (parts.length === 6 && parts[3] === 'locations') {
        if (parts[5] === 'menu') return jsonResponse(await client.getMenu(tenantId, parts[4]));
        if (parts[5] === 'payment-methods')
          return jsonResponse(await client.getPaymentMethods(tenantId, parts[4]));
      }
    }
    if (method === 'POST') {
      const input = await boundedJson(request, 32 * 1024);
      if (parts.length === 4 && parts[3] === 'quotes')
        return jsonResponse(await client.createQuote(tenantId, input), 201);
      if (parts.length === 4 && parts[3] === 'orders')
        return jsonResponse(await client.createOrder(tenantId, input), 201);
      if (parts.length === 6 && parts[3] === 'orders') {
        if (parts[5] === 'cancel')
          return jsonResponse(await client.cancelOrder(tenantId, parts[4], input));
        if (parts[5] === 'payment-session')
          return jsonResponse(await client.createPaymentSession(tenantId, parts[4], input), 201);
      }
    }
  }
  if (parts[0] === 'merchant-workspaces') {
    const locationId = parts[2];
    if (method === 'GET' && parts.length === 4) {
      if (parts[3] === 'orders')
        return jsonResponse(await client.listMerchantOrders(tenantId, locationId, query));
      if (parts[3] === 'shift') return jsonResponse(await client.getShift(tenantId, locationId));
    }
    if (method === 'POST') {
      const input = await boundedJson(request, 4096);
      if (parts.length === 4 && parts[3] === 'shift')
        return jsonResponse(await client.openShift(tenantId, locationId, input), 201);
      if (parts.length === 5 && parts[3] === 'shift' && parts[4] === 'handover')
        return jsonResponse(await client.handoverShift(tenantId, locationId, input));
      if (parts.length === 6 && parts[3] === 'orders') {
        const orderId = parts[4];
        switch (parts[5]) {
          case 'counter-payment':
            return jsonResponse(
              await client.recordCounterPayment(tenantId, locationId, orderId, input),
            );
          case 'accept':
            return jsonResponse(await client.acceptOrder(tenantId, locationId, orderId, input));
          case 'reject':
            return jsonResponse(await client.rejectOrder(tenantId, locationId, orderId, input));
          case 'cancel-accepted':
            return jsonResponse(
              await client.cancelAcceptedOrder(tenantId, locationId, orderId, input),
            );
          case 'confirm-counter-refund':
            return jsonResponse(
              await client.confirmCounterRefund(tenantId, locationId, orderId, input),
            );
          case 'fulfill':
            return jsonResponse(await client.fulfillOrder(tenantId, locationId, orderId, input));
        }
      }
      if (parts.length === 6 && parts[3] === 'kitchen-tickets') {
        if (parts[5] === 'start')
          return jsonResponse(
            await client.startTicket(tenantId, locationId, undefined, parts[4], input),
          );
        if (parts[5] === 'ready')
          return jsonResponse(
            await client.readyTicket(tenantId, locationId, undefined, parts[4], input),
          );
      }
    }
  }
  throw new NuniError(405, 'METHOD_NOT_ALLOWED');
}
