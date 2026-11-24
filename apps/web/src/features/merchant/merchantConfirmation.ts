import type {
  loadMerchantOverview,
  NuniMerchantApplication,
  NuniMerchantWorkspace,
} from '@campus/shared/src/nuniMerchant';
import type { NuniMerchantWorkspaceDetail } from '@campus/shared/src/nuniMerchantOperations';

export type MerchantOverview = Awaited<ReturnType<typeof loadMerchantOverview>>;

type Source = 'list' | 'read' | 'write';
type Confirmation = {
  row: NuniMerchantWorkspace;
  detail?: NuniMerchantWorkspaceDetail;
  availabilityConfirmed: boolean;
  revision: number;
};

export const workspaceKey = ({
  tenantId,
  locationId,
}: Pick<NuniMerchantWorkspace, 'tenantId' | 'locationId'>) => `${tenantId}:${locationId}`;

export function createMerchantConfirmations() {
  let lists: Partial<MerchantOverview> = {};
  const receipts = new Map<string, NuniMerchantApplication>();
  const entries = new Map<string, Confirmation>();
  const access = new Map<string, { request: number; denied: boolean }>();
  const menus = new Set<string>();
  let request = 0;

  function verify(key: string, revision: number, denied: boolean) {
    if (revision < (access.get(key)?.request ?? 0)) return;
    access.set(key, { request: revision, denied });
  }

  function merge(
    next: NuniMerchantWorkspace | NuniMerchantWorkspaceDetail,
    source: Source,
    revision = ++request,
  ): Confirmation {
    const key = workspaceKey(next);
    const current = entries.get(key);
    const version = next.readinessVersion ?? 0;
    const previousVersion = current?.row.readinessVersion ?? 0;
    if (
      current &&
      (version < previousVersion ||
        (version === previousVersion &&
          (revision < current.revision || (source === 'list' && current.detail))))
    )
      return current;

    const detail = 'applicationId' in next ? next : undefined;
    // Availability writes can share a readiness version with an older snapshot.
    // A same-version read can still refresh stock counts and other live details.
    const keepAvailability =
      current &&
      version === previousVersion &&
      source !== 'write' &&
      current.availabilityConfirmed &&
      next.merchantStatus !== 'suspended' &&
      next.locationStatus !== 'suspended';
    const availability = keepAvailability
      ? {
          activated: current.row.activated,
          merchantStatus: current.row.merchantStatus,
          locationStatus: current.row.locationStatus,
          publicAccess: current.row.publicAccess,
        }
      : {
          activated: next.activated,
          merchantStatus: next.merchantStatus,
          locationStatus: next.locationStatus,
          publicAccess: next.publicAccess,
        };
    if (!next.missingRequirements.includes('menu')) menus.add(key);
    const missingRequirements = menus.has(key)
      ? next.missingRequirements.filter((item) => item !== 'menu')
      : next.missingRequirements;
    const row = { ...next, ...availability, missingRequirements };
    const entry = {
      revision,
      row,
      detail: detail && { ...detail, ...availability, missingRequirements },
      availabilityConfirmed:
        source === 'write' ||
        !!keepAvailability ||
        (version > 0 && source === 'list' && next.activated) ||
        (next.activated &&
          (next.merchantStatus === 'suspended' || next.locationStatus === 'suspended')),
    };
    entries.set(key, entry);
    return entry;
  }

  function confirmMenu(key: string) {
    menus.add(key);
    const current = entries.get(key);
    if (!current) return;
    current.row = {
      ...current.row,
      missingRequirements: current.row.missingRequirements.filter((item) => item !== 'menu'),
    };
    if (current.detail)
      current.detail = { ...current.detail, missingRequirements: current.row.missingRequirements };
  }

  function mergeApplications(rows: NuniMerchantApplication[]) {
    const previous = new Map(lists.applications?.map((row) => [row.applicationId, row]));
    lists.applications = rows.map((row) => {
      const receipt = receipts.get(row.applicationId);
      const current = receipt ?? previous.get(row.applicationId);
      if (!current || current.tenantId !== row.tenantId) return row;
      const older = Date.parse(row.submittedAt) < Date.parse(current.submittedAt);
      const regressedToSubmitted =
        Date.parse(row.submittedAt) === Date.parse(current.submittedAt) &&
        current.state !== 'submitted' &&
        row.state === 'submitted';
      const merged = older || regressedToSubmitted ? current : row;
      if (receipt) receipts.set(row.applicationId, merged);
      return merged;
    });
  }

  return {
    hasApplicationList: () => lists.applications !== undefined,
    setPrograms(programs?: MerchantOverview['programs']) {
      if (programs) lists.programs = programs;
      else delete lists.programs;
    },
    mergeWorkspaceList(rows: NuniMerchantWorkspace[], revision: number) {
      lists.workspaces = rows;
      for (const row of rows) merge(row, 'list', revision);
    },
    mergeApplications,
    confirmApplication(receipt: NuniMerchantApplication) {
      const current =
        receipts.get(receipt.applicationId) ??
        lists.applications?.find((row) => row.applicationId === receipt.applicationId);
      const useCurrent =
        current &&
        current.tenantId === receipt.tenantId &&
        (Date.parse(current.submittedAt) > Date.parse(receipt.submittedAt) ||
          (Date.parse(current.submittedAt) === Date.parse(receipt.submittedAt) &&
            current.state !== 'submitted' &&
            receipt.state === 'submitted'));
      receipts.set(receipt.applicationId, useCurrent ? current : receipt);
    },
    hideApplications() {
      delete lists.applications;
      receipts.clear();
    },
    hideLists() {
      lists = {};
    },
    overview(): MerchantOverview | null {
      if (!Object.keys(lists).length) return null;
      return {
        programs: lists.programs ?? [],
        workspaces: (lists.workspaces ?? []).flatMap((row) => {
          const key = workspaceKey(row);
          return access.get(key)?.denied ? [] : [entries.get(key)?.row ?? row];
        }),
        applications: [
          ...[...receipts.values()].reverse(),
          ...(lists.applications ?? []).filter((row) => !receipts.has(row.applicationId)),
        ],
      };
    },
    merge,
    confirmMenu,
    beginRead: () => ++request,
    verify,
    denied: (key: string) => access.get(key)?.denied === true,
    needsAccessRefresh: (key: string) => access.has(key) || !!entries.get(key)?.detail,
    clear() {
      lists = {};
      receipts.clear();
      entries.clear();
      access.clear();
      menus.clear();
    },
  };
}
