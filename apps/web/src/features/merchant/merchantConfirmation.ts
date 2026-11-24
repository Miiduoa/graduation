import {
  merchantWorkspaceStateLabel,
  type loadMerchantOverview,
  type NuniMerchantApplication,
  type NuniMerchantWorkspace,
} from '@campus/shared/src/nuniMerchant';
import type { NuniMerchantWorkspaceDetail } from '@campus/shared/src/nuniMerchantOperations';

export type MerchantOverview = Awaited<ReturnType<typeof loadMerchantOverview>>;

type Observation<T = NuniMerchantWorkspace> = { value: T; revision: number; version?: number };
type WorkspaceObservations = {
  row?: Observation;
  detail?: Observation<NuniMerchantWorkspaceDetail>;
};
type Confirmation = {
  row: NuniMerchantWorkspace;
  detail?: NuniMerchantWorkspaceDetail;
};

function latestObservation<T extends NuniMerchantWorkspace>(
  current: Observation<T> | undefined,
  value: T,
  revision: number,
): Observation<T> {
  // Legacy rows can update availability by request order without lowering the known version.
  const version = value.readinessVersion ?? current?.version;
  if (current) {
    const order = version !== undefined && current.version !== undefined
      ? version - current.version
      : 0;
    if ((order || revision - current.revision) <= 0) return current;
  }
  return { value, revision, version };
}

function availabilityOf(row: NuniMerchantWorkspace) {
  return {
    activated: row.activated,
    merchantStatus: row.merchantStatus,
    locationStatus: row.locationStatus,
    publicAccess: row.publicAccess,
  };
}

function workspaceDetail({ row, detail }: Confirmation) {
  if (!detail) return null;
  // A list at a different version can confirm availability while settings still use the detail version.
  return row.readinessVersion === detail.readinessVersion
    ? { ...detail, ...row }
    : { ...detail, ...availabilityOf(row) };
}

export const workspaceKey = ({
  tenantId,
  locationId,
}: Pick<NuniMerchantWorkspace, 'tenantId' | 'locationId'>) => `${tenantId}:${locationId}`;

export function createMerchantConfirmations(drafts: ReadonlyMap<string, { menuReceipt: number | null }>) {
  let lists: Partial<Omit<MerchantOverview, 'workspaces'>> = {};
  // Keep list membership separate from the revocable observations used to render rows.
  let listedWorkspaces: Map<string, Pick<NuniMerchantWorkspace, 'tenantId' | 'locationId'>> | undefined;
  let includeVerifiedWorkspaces = false;
  const receipts = new Map<string, NuniMerchantApplication>();
  const entries = new Map<string, WorkspaceObservations>();
  let listRevocation = 0;
  let listRevision = 0;
  const revocations = new Map<string, number>();
  const verified = new Map<string, number>();
  const menus = new Set<string>();
  let request = 0;
  const beginRequest = () => ++request;

  function revokedThrough(key: string) {
    return Math.max(listRevocation, revocations.get(key) ?? 0);
  }

  function revoke(key?: string) {
    // A denial invalidates data already observed and every request issued before it arrived.
    if (key === undefined) {
      listRevocation = request;
      entries.clear();
      menus.clear();
      for (const draft of drafts.values()) draft.menuReceipt = null;
    } else {
      revocations.set(key, request);
      entries.delete(key);
      menus.delete(key);
      const draft = drafts.get(key);
      if (draft) draft.menuReceipt = null;
    }
  }

  function withMenu<T extends NuniMerchantWorkspace>(key: string, row: T): T {
    return menus.has(key) || drafts.get(key)?.menuReceipt != null
      ? { ...row, missingRequirements: row.missingRequirements.filter((item) => item !== 'menu') }
      : row;
  }

  function merge(next: NuniMerchantWorkspace, revision: number) {
    const key = workspaceKey(next);
    if (revision <= revokedThrough(key)) return;
    const entry = entries.get(key) ?? {};
    entry.row = latestObservation(entry.row, next, revision);
    entries.set(key, entry);
    if (!entry.row.value.missingRequirements.includes('menu')) menus.add(key);
    return entry;
  }

  function confirmDetail(next: NuniMerchantWorkspaceDetail, revision: number, verifiesAccess: boolean) {
    const key = workspaceKey(next);
    const entry = merge(next, revision);
    if (entry) {
      entry.detail = latestObservation(entry.detail, next, revision);
      if (verifiesAccess && revision > (verified.get(key) ?? 0)) verified.set(key, revision);
    }
    return detailFor(key);
  }

  function hasVerifiedAccess(key: string) {
    return (verified.get(key) ?? 0) > revokedThrough(key);
  }

  function detailFor(key: string) {
    const entry = entries.get(key);
    if (!entry?.row || !hasVerifiedAccess(key)) return null;
    const detail = entry.detail?.value;
    return workspaceDetail({
      row: withMenu(key, entry.row.value),
      detail: detail && withMenu(key, detail),
    });
  }

  function confirmMenu(key: string, revision: number, createdItems: number) {
    const draft = drafts.get(key);
    if (!draft || revision <= revokedThrough(key)) return false;
    draft.menuReceipt = createdItems;
    return true;
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
    verifiedDetails() {
      const details = new Map<string, NuniMerchantWorkspaceDetail>();
      for (const key of entries.keys()) {
        const detail = detailFor(key);
        if (detail) details.set(key, detail);
      }
      return details;
    },
    setPrograms(programs?: MerchantOverview['programs']) {
      if (programs) lists.programs = programs;
      else delete lists.programs;
    },
    mergeWorkspaceList(rows: NuniMerchantWorkspace[], revision: number) {
      if (revision <= listRevocation) return;
      if (revision > listRevision) {
        listRevision = revision;
        includeVerifiedWorkspaces = false;
        listedWorkspaces = new Map(
          rows.map(({ tenantId, locationId }) => {
            const identity = { tenantId, locationId };
            return [workspaceKey(identity), identity];
          }),
        );
      }
      for (const row of rows) merge(row, revision);
    },
    rejectWorkspaceList(denied: boolean, revision: number) {
      if (denied) {
        includeVerifiedWorkspaces = false;
        listedWorkspaces = undefined;
        revoke();
      } else if (revision > Math.max(listRevision, listRevocation)) {
        listRevision = revision;
        includeVerifiedWorkspaces = true;
      }
    },
    workspaceListRevocation: () => listRevocation,
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
    knownWorkspaces(): Array<Pick<NuniMerchantWorkspace, 'tenantId' | 'locationId'> & Partial<NuniMerchantWorkspace>> {
      const found = new Map<string, Pick<NuniMerchantWorkspace, 'tenantId' | 'locationId'> & Partial<NuniMerchantWorkspace>>();
      for (const [key, row] of listedWorkspaces ?? []) found.set(key, row);
      for (const [key, entry] of entries) {
        if (entry.row) found.set(key, entry.row.value);
      }
      for (const key of new Set([...verified.keys(), ...revocations.keys()])) {
        if (found.has(key)) continue;
        const split = key.indexOf(':');
        if (split <= 0) continue;
        found.set(key, { tenantId: key.slice(0, split), locationId: key.slice(split + 1) });
      }
      return [...found.values()];
    },
    overview(): MerchantOverview | null {
      const keys = new Set(listedWorkspaces?.keys());
      if (includeVerifiedWorkspaces) {
        for (const [key, entry] of entries) {
          if (entry.row && hasVerifiedAccess(key)) keys.add(key);
        }
      }
      if (!Object.keys(lists).length && !listedWorkspaces && !keys.size) return null;
      return {
        programs: lists.programs ?? [],
        workspaces: [...keys].flatMap((key) => {
          const row = entries.get(key)?.row?.value;
          if (!row || (revocations.has(key) && !hasVerifiedAccess(key))) return [];
          return [withMenu(key, row)];
        }),
        applications: [
          ...[...receipts.values()].reverse(),
          ...(lists.applications ?? []).filter((row) => !receipts.has(row.applicationId)),
        ],
      };
    },
    listedStatuses() {
      const statuses = new Map<string, string>();
      for (const key of listedWorkspaces?.keys() ?? []) {
        const row = entries.get(key)?.row?.value;
        if (row && hasVerifiedAccess(key)) statuses.set(key, merchantWorkspaceStateLabel(row));
      }
      return statuses;
    },
    confirmDetail,
    confirmMenu,
    beginRequest,
    revoke,
    needsAccessRefresh(key: string) {
      const entry = entries.get(key);
      return verified.has(key) || revocations.has(key) || !!entry?.detail;
    },
    clear() {
      lists = {};
      listedWorkspaces = undefined;
      includeVerifiedWorkspaces = false;
      listRevocation = 0;
      listRevision = 0;
      receipts.clear();
      entries.clear();
      revocations.clear();
      verified.clear();
      menus.clear();
    },
  };
}
