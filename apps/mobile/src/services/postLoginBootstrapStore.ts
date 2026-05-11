import type { UserRole } from '../data/types';

/** 各引擎 initFromPostLoginContext 使用的精簡 payload（不依賴 firebase，供 holder / sync 安全載入） */
export type PostLoginEngineBootstrap = {
  uid: string;
  schoolId?: string | null;
  primaryRole: UserRole;
  runId?: string | null;
  postLoginRoles?: string[];
  courseLiteCount?: number;
  finalizeOk?: boolean;
  finalizeFailed?: boolean;
  finalizeSkipped?: boolean;
  errorCode?: string | null;
  errorMessage?: string | null;
  bootstrapAt?: string;
};

let lastBootstrap: PostLoginEngineBootstrap | null = null;

export function getLastPostLoginEngineBootstrap(): PostLoginEngineBootstrap | null {
  return lastBootstrap;
}

export function setLastPostLoginEngineBootstrap(b: PostLoginEngineBootstrap | null): void {
  lastBootstrap = b;
}
