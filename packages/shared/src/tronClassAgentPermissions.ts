export type TronClassAgentScope = 'readCourseData' | 'downloadMaterials' | 'prepareHomework';

export type TronClassAgentPermissions = Record<TronClassAgentScope, boolean>;

export type TronClassAgentGrant = {
  revision: string;
  version: string | null;
  permissions: TronClassAgentPermissions;
  updatedAt: string | null;
};

export type TronClassRequiredAgentGrant = TronClassAgentGrant & { version: string };

export const TRONCLASS_AGENT_SCOPES: readonly TronClassAgentScope[] = [
  'readCourseData', 'downloadMaterials', 'prepareHomework',
];

export function emptyTronClassAgentPermissions(): TronClassAgentPermissions {
  return { readCourseData: false, downloadMaterials: false, prepareHomework: false };
}
