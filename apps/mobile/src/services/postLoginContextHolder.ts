import type { PostLoginContext } from '../data/postLoginTypes';

let inMemory: PostLoginContext | null = null;

/** 登入後由 syncPostLoginContextFromCaches 寫入；登出時清空。 */
export function setInMemoryPostLoginContext(ctx: PostLoginContext | null): void {
  inMemory = ctx;
}

export function getInMemoryPostLoginContext(): PostLoginContext | null {
  return inMemory;
}
