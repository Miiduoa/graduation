/** Same-origin Next.js callables hosted at `/api/fn/{name}`. Keep this list tiny. */
export const HOSTED_WEB_CALLABLES = [
  'joinGroupByCode',
  'leaveGroup',
  'createTimetableShare',
  'revokeTimetableShare',
] as const;

export type HostedWebCallable = (typeof HOSTED_WEB_CALLABLES)[number];

export function isHostedWebCallable(name: string): name is HostedWebCallable {
  return (HOSTED_WEB_CALLABLES as readonly string[]).includes(name);
}

export function hostedWebCallablePath(name: string): string {
  return `/api/fn/${name}`;
}
