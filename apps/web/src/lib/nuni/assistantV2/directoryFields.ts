import { fail } from './contracts';

/** Reject accessors and unexpected fields before reading any caller values. */
export function ownFields(raw: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      ![null, Object.prototype].includes(Object.getPrototypeOf(raw))) return fail();
  const out: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(raw)) {
    if (typeof key !== 'string' || !keys.includes(key)) return fail();
    const descriptor = Object.getOwnPropertyDescriptor(raw, key)!;
    if (!descriptor.enumerable || !('value' in descriptor) || descriptor.value === undefined) return fail();
    out[key] = descriptor.value;
  }
  return out;
}

export function directorySchoolScope(raw: unknown): string {
  if (typeof raw !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(raw)) return fail();
  return raw;
}
