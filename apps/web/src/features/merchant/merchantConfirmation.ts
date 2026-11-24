import {
  merchantWorkspaceStateLabel,
  type loadMerchantOverview,
  type NuniMerchantApplication,
  type NuniMerchantWorkspace,
  type NuniMerchantWorkspaceListRow,
} from '@campus/shared/src/nuniMerchant';
import type { NuniMerchantWorkspaceDetail } from '@campus/shared/src/nuniMerchantOperations';

export type MerchantOverview = Awaited<ReturnType<typeof loadMerchantOverview>>;

type Observation<T = NuniMerchantWorkspaceListRow> = { value: T; revision: number; version?: number };
export type DetailConfirmation = { detail: NuniMerchantWorkspaceDetail; won: boolean };

type WorkspaceObservations = {
  row?: Observation;
  versionedRow?: Observation;
  detail?: Observation<NuniMerchantWorkspaceDetail>;
};

function workspaceSummary(entry: WorkspaceObservations | undefined): NuniMerchantWorkspace | undefined {
  const row = entry?.row?.value;
  if (!row) return;
  return summarizeRow(row, entry?.versionedRow?.value);
}

function summarizeRow(
  row: NuniMerchantWorkspaceListRow,
  versioned?: NuniMerchantWorkspaceListRow,
): NuniMerchantWorkspace {
  const operating = row.readinessVersion === undefined && versioned ? versioned : row;
  return {
    ...row,
    activated: operating.activated ?? false,
    merchantStatus: operating.merchantStatus,
    locationStatus: operating.locationStatus,
    publicAccess: operating.publicAccess,
    missingRequirements: versioned?.missingRequirements ?? row.missingRequirements ?? [],
  };
}

function mergeReadiness(
  winner: NuniMerchantWorkspaceListRow,
  other: NuniMerchantWorkspaceListRow,
): NuniMerchantWorkspaceListRow {
  if (winner.readinessVersion !== other.readinessVersion) return winner;
  const activated = winner.activated ?? other.activated;
  const missingRequirements = winner.missingRequirements ?? other.missingRequirements;
  return activated === winner.activated && missingRequirements === winner.missingRequirements
    ? winner
    : { ...winner, activated, missingRequirements };
}

function latestRow(current: Observation | undefined, next: NuniMerchantWorkspaceListRow, revision: number) {
  const winner = latestObservation(current, next, revision);
  if (!current) return winner;
  const other = winner.revision === revision ? current.value : next;
  return { ...winner, value: mergeReadiness(winner.value, other) };
}

function latestObservation<T extends NuniMerchantWorkspaceListRow>(
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
    if ((order || revision - current.revision) <= 0) {
      // An older response can establish the version floor of a winning legacy row.
      return current.version === undefined && version !== undefined
        ? { ...current, version }
        : current;
    }
  }
  return { value, revision, version };
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
  const retainedWorkspaceKeys = new Set<string>();
  const receipts = new Map<string, Observation<NuniMerchantApplication>>();
  const entries = new Map<string, WorkspaceObservations>();
  const revokedVersionFloors = new Map<string, number>();
  const workspaceKeysAwaitingConfirmation = new Set<string>();
  let listRevocation = 0;
  let listedRevision = 0;
  const receiptFloors = new Map<string, number>();
  const menuReceiptRevisions = new Map<string, number>();
  const statusReceiptFloors = new Map<string, Map<number, number>>();
  // Store-specific revocations override the list default for stores with newer confirmations.
  const revocations = new Map<string, number>();
  const verified = new Map<string, number>();
  let applicationRevocation = 0;
  let applicationListRevision = 0;
  let request = 0;
  const beginRequest = () => ++request;

  function revokedThrough(key: string) {
    return revocations.get(key) ?? listRevocation;
  }

  function advanceReceiptFloor(key: string, revision: number) {
    receiptFloors.set(key, Math.max(receiptFloors.get(key) ?? 0, revision));
  }

  function discardMenuReceipt(key: string) {
    const draft = drafts.get(key);
    if (draft) draft.menuReceipt = null;
    menuReceiptRevisions.delete(key);
  }

  function discardWorkspaceReceipts(key: string, revision: number) {
    if ((menuReceiptRevisions.get(key) ?? 0) <= revision) discardMenuReceipt(key);
    advanceReceiptFloor(key, revision);
  }

  function discardWorkspace(key: string, revision: number) {
    const version = entries.get(key)?.row?.version;
    if (version !== undefined) revokedVersionFloors.set(key, version);
    entries.delete(key);
    statusReceiptFloors.delete(key);
    discardWorkspaceReceipts(key, revision);
  }

  function accessConfirmationRevision(key: string) {
    return verified.get(key) ?? 0;
  }

  function revoke(key: string, revision: number) {
    const entry = entries.get(key);
    // An unversioned list can update metadata without superseding a detail denial.
    const confirmation = entry?.versionedRow;
    if (revision <= Math.max(
      revokedThrough(key), confirmation?.revision ?? 0, accessConfirmationRevision(key),
    )) return;
    revocations.set(key, revision);
    workspaceKeysAwaitingConfirmation.add(key);
    discardWorkspace(key, revision);
    return revision;
  }

  function listedMembership() {
    // Denial revokes positive membership while a confirmed empty list stays authoritative.
    if (listedRevision > listRevocation || listedWorkspaces?.size === 0) return listedWorkspaces;
  }

  function merge(next: NuniMerchantWorkspaceListRow, revision: number) {
    const key = workspaceKey(next);
    if (revision <= Math.max(listRevocation, revokedThrough(key))) return;
    // A legacy list can update metadata, but only a versioned response can
    // restore the row after a detail denial.
    if (next.readinessVersion === undefined && workspaceKeysAwaitingConfirmation.has(key)) return;
    const entry = entries.get(key) ?? {};
    const floor = revokedVersionFloors.get(key);
    // Revocation removes the data, but a retry still needs a current readiness version.
    if (floor !== undefined && next.readinessVersion !== undefined && next.readinessVersion < floor) {
      return;
    }
    const observation = latestRow(entry.row, next, revision);
    const row = { ...observation, version: observation.version ?? floor };
    if (next.readinessVersion !== undefined) {
      // Versioned operating state keeps its own order when legacy rows update the list.
      const previous = entry.versionedRow;
      const versioned = latestRow(previous, next, revision);
      if (
        versioned.revision === revision &&
        previous &&
        merchantWorkspaceStateLabel(summarizeRow(previous.value)) !==
          merchantWorkspaceStateLabel(summarizeRow(versioned.value))
      ) {
        // A same-version change supersedes receipts through that version. An
        // earlier write can still confirm a higher version and show its receipt.
        if (next.readinessVersion === previous.version) {
          const floors = statusReceiptFloors.get(key) ?? new Map<number, number>();
          floors.set(next.readinessVersion, Math.max(floors.get(next.readinessVersion) ?? 0, revision - 1));
          statusReceiptFloors.set(key, floors);
        } else if (previous.version !== undefined) {
          advanceReceiptFloor(key, revision - 1);
        }
      }
      entry.versionedRow = versioned;
      workspaceKeysAwaitingConfirmation.delete(key);
    }
    // Use the same requirements source for the card and for invalidating receipts.
    const requirementsObservation = entry.versionedRow?.value.missingRequirements === undefined
      ? row
      : entry.versionedRow;
    if (requirementsObservation?.revision === revision && next.missingRequirements?.includes('menu')) {
      discardMenuReceipt(key);
    }
    // A newer list version can supersede the detail without supplying a replacement.
    if (entry.detail && entry.detail.version !== row.version) delete entry.detail;
    entry.row = row;
    entries.set(key, entry);
    return entry;
  }

  function confirmDetail(
    next: NuniMerchantWorkspaceDetail,
    revision: number,
    verifiesAccess: boolean,
  ): DetailConfirmation | null {
    const key = workspaceKey(next);
    const version = entries.get(key)?.row?.version;
    // A stale detail must not confirm access or supersede an outstanding denial.
    if (version !== undefined && next.readinessVersion < version) return null;
    const entry = merge(next, revision);
    if (!entry || next.readinessVersion !== entry.row?.version) return null;
    entry.detail = latestObservation(entry.detail, next, revision);
    // A receipt can win on readiness version even when its request predates
    // the GET that verified access. Keep that GET's revision independently.
    if (verifiesAccess && revision > accessConfirmationRevision(key)) verified.set(key, revision);
    const detail = detailFor(key);
    return detail && {
      detail,
      won: entry.row.revision === revision && entry.detail.revision === revision,
    };
  }

  function hasVerifiedAccess(key: string) {
    return accessConfirmationRevision(key) > revokedThrough(key);
  }

  function detailFor(key: string) {
    const entry = entries.get(key);
    if (!entry?.row || !entry.detail || !hasVerifiedAccess(key)) return null;
    const detail = entry.detail.value;
    // Legacy list metadata is rendered separately. Project the matching
    // versioned row's operating state and requirements together onto the detail.
    const row = entry.versionedRow?.value;
    if (row?.readinessVersion !== detail.readinessVersion) return detail;
    const missingRequirements = row.missingRequirements ?? detail.missingRequirements;
    return {
      ...detail,
      ...row,
      activated: row.activated ?? detail.activated,
      missingRequirements,
      readinessVersion: detail.readinessVersion,
      publishedMenuItems: missingRequirements.includes('menu') ? 0 : detail.publishedMenuItems,
    };
  }

  function confirmMenu(key: string, revision: number, createdItems: number) {
    const draft = drafts.get(key);
    const entry = entries.get(key);
    const row = entry?.row;
    if (
      !draft || !entry || !row ||
      revision <= Math.max(
        row.revision, entry.versionedRow?.revision ?? 0, receiptFloors.get(key) ?? 0,
        accessConfirmationRevision(key),
      )
    ) return false;
    // The receipt has no readiness version. Apply it to the known row in request order.
    const versioned = entry.versionedRow?.value;
    const summary = summarizeRow(row.value, versioned);
    const next = {
      ...summary,
      readinessVersion: versioned?.readinessVersion,
      missingRequirements: summary.missingRequirements.filter((item) => item !== 'menu'),
    };
    if (merge(next, revision)?.row?.value !== next) return false;
    draft.menuReceipt = createdItems;
    menuReceiptRevisions.set(key, revision);
    return true;
  }

  function discardReceiptsThrough(revision: number) {
    for (const [id, receipt] of receipts) {
      if (receipt.revision <= revision) receipts.delete(id);
    }
  }

  function mergeApplications(rows: NuniMerchantApplication[], revision: number) {
    if (revision <= Math.max(applicationRevocation, applicationListRevision)) return;
    applicationListRevision = revision;
    const previous = new Map(lists.applications?.map((row) => [row.applicationId, row]));
    lists.applications = rows.map((row) => {
      const receipt = receipts.get(row.applicationId);
      if (receipt && receipt.revision > revision) return row;
      const current = receipt?.value ?? previous.get(row.applicationId);
      if (!current || current.tenantId !== row.tenantId) return row;
      const older = Date.parse(row.submittedAt) < Date.parse(current.submittedAt);
      const regressedToSubmitted =
        Date.parse(row.submittedAt) === Date.parse(current.submittedAt) &&
        current.state !== 'submitted' &&
        row.state === 'submitted';
      return older || regressedToSubmitted ? current : row;
    });
    // The successful list owns membership through its request revision.
    discardReceiptsThrough(revision);
  }

  return {
    listedWorkspaceTenants() {
      const membership = listedMembership();
      return membership && new Set([...membership.values()].map(({ tenantId }) => tenantId));
    },
    hasApplicationList: () => lists.applications !== undefined,
    detailFor,
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
    mergeWorkspaceList(rows: NuniMerchantWorkspaceListRow[], revision: number) {
      if (revision <= listRevocation) return;
      if (revision > listedRevision) {
        listedRevision = revision;
        includeVerifiedWorkspaces = false;
        retainedWorkspaceKeys.clear();
        listedWorkspaces = new Map(
          rows.map(({ tenantId, locationId }) => {
            const identity = { tenantId, locationId };
            return [workspaceKey(identity), identity];
          }),
        );
        // List omission invalidates receipts only through the list's request revision.
        for (const key of drafts.keys()) {
          if (listedWorkspaces.has(key)) continue;
          discardWorkspaceReceipts(key, revision);
        }
      }
      for (const row of rows) merge(row, revision);
    },
    rejectWorkspaceList(denied: boolean, revision: number) {
      if (denied) {
        if (revision <= Math.max(listedRevision, listRevocation)) return;
        for (const key of new Set([...entries.keys(), ...revocations.keys(), ...drafts.keys()])) {
          // Preserve a newer confirmation and its existing access state.
          if (Math.max(entries.get(key)?.row?.revision ?? 0, accessConfirmationRevision(key)) > revision) {
            revocations.set(key, revokedThrough(key));
            if (listedMembership()?.has(key) || (includeVerifiedWorkspaces && hasVerifiedAccess(key))) {
              retainedWorkspaceKeys.add(key);
            }
          } else {
            if (revocations.has(key)) revocations.set(key, Math.max(revokedThrough(key), revision));
            discardWorkspace(key, revision);
            retainedWorkspaceKeys.delete(key);
          }
        }
        listRevocation = revision;
        includeVerifiedWorkspaces = false;
      } else if (revision > listRevocation) {
        // Direct-entry fallback is available until the first successful list.
        includeVerifiedWorkspaces = listedWorkspaces === undefined;
      }
    },
    workspaceReceiptFloor(key: string, readinessVersion?: number) {
      let floor = receiptFloors.get(key) ?? 0;
      if (readinessVersion !== undefined) {
        for (const [version, revision] of statusReceiptFloors.get(key) ?? []) {
          if (version >= readinessVersion) floor = Math.max(floor, revision);
        }
      }
      return floor;
    },
    workspaceRevocations: () => ({ list: listRevocation, details: new Map(revocations) }),
    mergeApplications,
    rejectApplications(revision: number) {
      if (revision <= Math.max(applicationRevocation, applicationListRevision)) return false;
      applicationRevocation = revision;
      delete lists.applications;
      discardReceiptsThrough(revision);
      return true;
    },
    confirmApplication(receipt: NuniMerchantApplication, revision: number) {
      if (revision <= applicationRevocation) return false;
      const listed = lists.applications?.find((row) => row.applicationId === receipt.applicationId);
      if (revision <= applicationListRevision) return listed?.tenantId === receipt.tenantId;
      const previous = receipts.get(receipt.applicationId);
      const current = previous?.value ?? listed;
      const useCurrent =
        current &&
        current.tenantId === receipt.tenantId &&
        (Date.parse(current.submittedAt) > Date.parse(receipt.submittedAt) ||
          (Date.parse(current.submittedAt) === Date.parse(receipt.submittedAt) &&
            current.state !== 'submitted' &&
            receipt.state === 'submitted'));
      receipts.set(receipt.applicationId, {
        value: useCurrent ? current : receipt,
        revision: Math.max(revision, previous?.revision ?? 0),
      });
      return true;
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
      const membership = listedMembership();
      const keys = new Set(membership?.keys() ?? retainedWorkspaceKeys);
      if (includeVerifiedWorkspaces) {
        for (const [key, entry] of entries) {
          if (entry.row && hasVerifiedAccess(key)) keys.add(key);
        }
      }
      if (!Object.keys(lists).length && !membership && !keys.size && !receipts.size) return null;
      return {
        programs: lists.programs ?? [],
        workspaces: [...keys].flatMap((key) => {
          const row = workspaceSummary(entries.get(key));
          const listedAfterRevocation = membership?.has(key) && listedRevision > revokedThrough(key);
          return row && (listedAfterRevocation || hasVerifiedAccess(key)) ? [row] : [];
        }),
        applications: [
          ...[...receipts.values()].reverse().map(({ value }) => value),
          ...(lists.applications ?? []).filter((row) => !receipts.has(row.applicationId)),
        ],
      };
    },
    verifiedListedRows() {
      const rows = new Map<string, NuniMerchantWorkspace>();
      for (const key of listedMembership()?.keys() ?? []) {
        const row = workspaceSummary(entries.get(key));
        if (row && hasVerifiedAccess(key)) rows.set(key, row);
      }
      return rows;
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
      for (const draft of drafts.values()) draft.menuReceipt = null;
      lists = {};
      listedWorkspaces = undefined;
      includeVerifiedWorkspaces = false;
      listRevocation = 0;
      receiptFloors.clear();
      menuReceiptRevisions.clear();
      statusReceiptFloors.clear();
      listedRevision = 0;
      applicationRevocation = 0;
      applicationListRevision = 0;
      receipts.clear();
      retainedWorkspaceKeys.clear();
      entries.clear();
      revokedVersionFloors.clear();
      workspaceKeysAwaitingConfirmation.clear();
      revocations.clear();
      verified.clear();
    },
  };
}
