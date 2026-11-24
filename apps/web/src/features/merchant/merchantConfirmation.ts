import type {
  loadMerchantOverview,
  NuniMerchantApplication,
  NuniMerchantWorkspace,
} from '@campus/shared/src/nuniMerchant';
import type { NuniMerchantWorkspaceDetail } from '@campus/shared/src/nuniMerchantOperations';

export type MerchantOverview = Awaited<ReturnType<typeof loadMerchantOverview>>;

type Source = 'list' | 'read' | 'write';
type Observation<T = NuniMerchantWorkspace> = { value: T; revision: number };
type WorkspaceObservations = {
  list?: Observation;
  read?: Observation<NuniMerchantWorkspaceDetail>;
  write?: Observation<NuniMerchantWorkspaceDetail>;
};
type Confirmation = {
  row: NuniMerchantWorkspace;
  detail?: NuniMerchantWorkspaceDetail;
};

function versionOf(observation?: Observation) {
  return observation ? (observation.value.readinessVersion ?? 0) : -1;
}

function isNewer(next: Observation, current?: Observation) {
  const nextVersion = versionOf(next);
  const currentVersion = versionOf(current);
  return (
    nextVersion > currentVersion ||
    (nextVersion === currentVersion && next.revision >= (current?.revision ?? 0))
  );
}

function latestObservation<T extends Observation>(...observations: (T | undefined)[]) {
  return observations.reduce<T | undefined>(
    (latest, observation) => observation && isNewer(observation, latest) ? observation : latest,
    undefined,
  );
}

function confirmedRow({ list, read, write }: WorkspaceObservations) {
  return latestObservation(list, read, write)!.value;
}

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
  let includeVerifiedWorkspaces = false;
  const receipts = new Map<string, NuniMerchantApplication>();
  const entries = new Map<string, WorkspaceObservations>();
  let listDenialRevision = 0;
  const access = new Map<string, { request: number; denied: boolean }>();
  const menus = new Set<string>();
  let request = 0;

  function verify(key: string, revision: number, denied: boolean) {
    if (revision < (access.get(key)?.request ?? 0)) return;
    access.set(key, { request: revision, denied });
  }

  function withMenu<T extends NuniMerchantWorkspace>(key: string, row: T): T {
    return menus.has(key)
      ? { ...row, missingRequirements: row.missingRequirements.filter((item) => item !== 'menu') }
      : row;
  }

  function merge(next: NuniMerchantWorkspace, source: 'list', revision: number): Confirmation;
  function merge(
    next: NuniMerchantWorkspaceDetail,
    source: 'read' | 'write',
    revision: number,
  ): Confirmation;
  function merge(
    next: NuniMerchantWorkspace | NuniMerchantWorkspaceDetail,
    source: Source,
    revision: number,
  ): Confirmation {
    const key = workspaceKey(next);
    const entry = entries.get(key) ?? {};
    const observation = { value: next, revision };
    if (isNewer(observation, entry[source])) {
      if (source === 'list') entry.list = observation;
      else if ('applicationId' in next) entry[source] = { value: next, revision };
    }
    entries.set(key, entry);

    const row = confirmedRow(entry);
    if (!row.missingRequirements.includes('menu')) menus.add(key);
    const detail = latestObservation(entry.read, entry.write)?.value;
    return { row: withMenu(key, row), detail: detail && withMenu(key, detail) };
  }

  function hasVerifiedAccess(key: string) {
    const verification = access.get(key);
    return !!verification && !verification.denied && verification.request > listDenialRevision;
  }

  function detailFor(key: string) {
    const entry = entries.get(key);
    if (!entry || !hasVerifiedAccess(key)) return null;
    const detail = latestObservation(entry.read, entry.write)?.value;
    return workspaceDetail({
      row: confirmedRow(entry),
      detail: detail && withMenu(key, detail),
    });
  }

  function confirmMenu(key: string) {
    menus.add(key);
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
      includeVerifiedWorkspaces = false;
      lists.workspaces = rows;
      for (const row of rows) merge(row, 'list', revision);
    },
    rejectWorkspaceList(revision: number, denied: boolean) {
      includeVerifiedWorkspaces = !denied;
      if (denied) {
        delete lists.workspaces;
        listDenialRevision = revision;
      }
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
    knownWorkspaces(): Array<Pick<NuniMerchantWorkspace, 'tenantId' | 'locationId'> & Partial<NuniMerchantWorkspace>> {
      const found = new Map<string, Pick<NuniMerchantWorkspace, 'tenantId' | 'locationId'> & Partial<NuniMerchantWorkspace>>();
      for (const row of lists.workspaces ?? []) found.set(workspaceKey(row), row);
      for (const [key, entry] of entries) found.set(key, confirmedRow(entry));
      for (const key of access.keys()) {
        if (found.has(key)) continue;
        const split = key.indexOf(':');
        if (split <= 0) continue;
        found.set(key, { tenantId: key.slice(0, split), locationId: key.slice(split + 1) });
      }
      return [...found.values()];
    },
    overview(): MerchantOverview | null {
      const workspaces = new Map((lists.workspaces ?? []).map((row) => [workspaceKey(row), row]));
      if (includeVerifiedWorkspaces) {
        for (const [key, entry] of entries) {
          if (hasVerifiedAccess(key))
            workspaces.set(key, confirmedRow(entry));
        }
      }
      if (!Object.keys(lists).length && !workspaces.size) return null;
      return {
        programs: lists.programs ?? [],
        workspaces: [...workspaces].flatMap(([key, row]) => {
          const entry = entries.get(key);
          return access.get(key)?.denied ? [] : [withMenu(key, entry ? confirmedRow(entry) : row)];
        }),
        applications: [
          ...[...receipts.values()].reverse(),
          ...(lists.applications ?? []).filter((row) => !receipts.has(row.applicationId)),
        ],
      };
    },
    merge,
    confirmMenu,
    beginRequest: () => ++request,
    verify,
    detailFor,
    needsAccessRefresh(key: string) {
      const entry = entries.get(key);
      return access.has(key) || !!entry?.read || !!entry?.write;
    },
    clear() {
      lists = {};
      includeVerifiedWorkspaces = false;
      listDenialRevision = 0;
      receipts.clear();
      entries.clear();
      access.clear();
      menus.clear();
    },
  };
}
