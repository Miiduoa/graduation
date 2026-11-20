/** An identifier from the authorized campus reader, never a model-supplied URL. */
export interface CampusAssignmentSource {
  kind: 'group-assignment';
  groupId: string;
  assignmentId: string;
}

function supportedId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 &&
    /^[A-Za-z0-9_-]+$/.test(value);
}

/** Older snapshots may omit a source. Malformed sources must not become routes. */
export function parseCampusAssignmentSource(value: unknown): CampusAssignmentSource | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.kind !== 'group-assignment' || !supportedId(row.groupId) ||
      !supportedId(row.assignmentId)) return null;
  return { kind: 'group-assignment', groupId: row.groupId, assignmentId: row.assignmentId };
}
