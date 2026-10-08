export function eventRegistrationCount(event: {
  registrationPolicy?: { version?: unknown };
  appRegistrationCount?: unknown;
  registeredCount?: unknown;
}): number | null {
  const count =
    event.registrationPolicy?.version === 1 ? event.appRegistrationCount : event.registeredCount;
  return typeof count === 'number' && Number.isSafeInteger(count) && count >= 0 ? count : null;
}
