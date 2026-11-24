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
  revision: number;
  confirmedBy: Source;
};

function availabilityOf(row: NuniMerchantWorkspace) {
  return {
    activated: row.activated,
    merchantStatus: row.merchantStatus,
    locationStatus: row.locationStatus,
    publicAccess: row.publicAccess,
  };
}

export function workspaceDetail({ row, detail }: Confirmation) {
  // Use the confirmed availability with the detail's settings and expected version.
  return detail ? { ...detail, ...availabilityOf(row) } : null;
}

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
    const incomingDetail = 'applicationId' in next ? next : undefined;

    if (current && version < previousVersion) {
      // Keep the newer list/write row for labels, but attach the older
      // successful detail unchanged so settings and expectedVersion stay together.
      if (incomingDetail) {
        const held = current.detail?.readinessVersion ?? -1;
        if (!current.detail || held <= version) {
          const entry = { ...current, detail: incomingDetail };
          entries.set(key, entry);
          return entry;
        }
      }
      return current;
    }

    // At the same version, receipts take precedence over reads, and details
    // take precedence over lists. Request order breaks ties between reads
    // from the same endpoint.
    if (
      current &&
      version === previousVersion &&
      source !== 'write' &&
      (current.confirmedBy === 'write' ||
        (current.confirmedBy === 'read' && source === 'list') ||
        (current.confirmedBy === source && revision < current.revision))
    ) {
      if (!incomingDetail) return current;
      const protectedFields = {
        ...availabilityOf(current.row),
        missingRequirements: current.row.missingRequirements,
      };
      const detail = { ...incomingDetail, ...protectedFields };
      const entry = {
        ...current,
        row: { ...current.row, ...incomingDetail, ...protectedFields },
        detail,
      };
      entries.set(key, entry);
      return entry;
    }

    if (!next.missingRequirements.includes('menu')) menus.add(key);
    const missingRequirements = menus.has(key)
      ? next.missingRequirements.filter((item) => item !== 'menu')
      : next.missingRequirements;
    const row = { ...next, missingRequirements };
    const entry = {
      revision,
      confirmedBy: source,
      row,
      detail: incomingDetail ? { ...incomingDetail, missingRequirements } : current?.detail,
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
    hideWorkspaces() {
      delete lists.workspaces;
    },
    hideLists() {
      delete lists.workspaces;
      delete lists.programs;
    },
    knownWorkspaces(): Array<Pick<NuniMerchantWorkspace, 'tenantId' | 'locationId'> & Partial<NuniMerchantWorkspace>> {
      const found = new Map<string, Pick<NuniMerchantWorkspace, 'tenantId' | 'locationId'> & Partial<NuniMerchantWorkspace>>();
      for (const row of lists.workspaces ?? []) found.set(workspaceKey(row), row);
      for (const [key, entry] of entries) found.set(key, entry.row);
      for (const key of access.keys()) {
        if (found.has(key)) continue;
        const split = key.indexOf(':');
        if (split <= 0) continue;
        found.set(key, { tenantId: key.slice(0, split), locationId: key.slice(split + 1) });
      }
      return [...found.values()];
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
