/** A source selection only. Order details and calendar times always come from
 * the authenticated order service, never from this client-controlled value.
 */
export type AssistantFoodPickupTarget = {
  tenantId: string;
  orderId: string;
  durationMinutes?: number;
};

export function parseAssistantFoodPickupTarget(raw: unknown): Required<AssistantFoodPickupTarget> {
  const invalid = (): never => { throw new Error('INVALID_FOOD_PICKUP_TARGET'); };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return invalid();
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).some(key => !['tenantId', 'orderId', 'durationMinutes'].includes(key)))
    return invalid();
  if (typeof value.tenantId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value.tenantId) ||
      typeof value.orderId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value.orderId))
    return invalid();
  const durationMinutes = value.durationMinutes === undefined ? 15 : value.durationMinutes;
  if (typeof durationMinutes !== 'number' || !Number.isSafeInteger(durationMinutes) ||
      durationMinutes < 5 || durationMinutes > 120) return invalid();
  return { tenantId: value.tenantId, orderId: value.orderId, durationMinutes };
}
