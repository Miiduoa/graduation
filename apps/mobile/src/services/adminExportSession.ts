export type AdminExportIdentity = {
  uid: string;
  schoolId: string;
  /** School editor/admin fence for Firebase school administration reads. */
  allowed: boolean;
};

/** Snapshot taken when presenting a chooser or starting an export click. */
export type AdminExportOrigin = AdminExportIdentity & {
  generation: number;
  schoolCode: string;
};

export type AdminExportToken = {
  key: string;
  generation: number;
  controller: AbortController;
  captured: AdminExportIdentity & { schoolCode: string };
};

/**
 * Fences admin CSV export work across account/school/role/loading changes and unmount.
 * Old finally blocks must not clear a newer export's busy/controller ownership.
 * Alert callbacks must pass the origin captured when the chooser was shown.
 */
export class AdminExportSession {
  private generation = 0;
  private mounted = true;
  private identity: AdminExportIdentity;
  private controllers = new Map<
    string,
    { controller: AbortController; generation: number; captured: AdminExportToken['captured'] }
  >();

  constructor(identity: AdminExportIdentity) {
    this.identity = normalizeIdentity(identity);
  }

  getIdentity(): AdminExportIdentity {
    return this.identity;
  }

  getGeneration(): number {
    return this.generation;
  }

  setIdentity(next: AdminExportIdentity): boolean {
    const normalized = normalizeIdentity(next);
    if (
      normalized.uid === this.identity.uid &&
      normalized.schoolId === this.identity.schoolId &&
      normalized.allowed === this.identity.allowed
    ) {
      return false;
    }
    this.invalidate();
    this.identity = normalized;
    return true;
  }

  invalidate(): void {
    this.generation += 1;
    for (const entry of this.controllers.values()) {
      entry.controller.abort();
    }
    this.controllers.clear();
  }

  unmount(): void {
    this.mounted = false;
    this.invalidate();
  }

  /**
   * Capture the origin fence for a native Alert / delayed callback.
   * Returns null when export is not currently authorized.
   */
  captureOrigin(schoolCode: string): AdminExportOrigin | null {
    if (!this.canBegin()) return null;
    return {
      generation: this.generation,
      uid: this.identity.uid,
      schoolId: this.identity.schoolId,
      allowed: this.identity.allowed,
      schoolCode,
    };
  }

  /**
   * Begin export only if the caller's captured origin still matches the live fence.
   * Rejects stale Alert callbacks that would otherwise attach old rows to a new identity.
   */
  begin(key: string, origin: AdminExportOrigin): AdminExportToken | null {
    if (!this.canBegin()) return null;
    if (!originMatches(this, origin)) return null;

    const previous = this.controllers.get(key);
    previous?.controller.abort();

    const controller = new AbortController();
    const captured = {
      uid: origin.uid,
      schoolId: origin.schoolId,
      allowed: origin.allowed,
      schoolCode: origin.schoolCode,
    };
    const token: AdminExportToken = {
      key,
      generation: this.generation,
      controller,
      captured,
    };
    this.controllers.set(key, {
      controller,
      generation: this.generation,
      captured,
    });
    return token;
  }

  /** True only while this token still owns the slot under the captured fence. */
  isCurrent(token: AdminExportToken): boolean {
    if (!this.mounted) return false;
    if (token.controller.signal.aborted) return false;
    if (token.generation !== this.generation) return false;
    const current = this.controllers.get(token.key);
    if (!current || current.controller !== token.controller) return false;
    if (!this.identity.allowed) return false;
    return (
      this.identity.uid === token.captured.uid &&
      this.identity.schoolId === token.captured.schoolId &&
      this.identity.allowed === token.captured.allowed &&
      Boolean(token.captured.uid) &&
      Boolean(token.captured.schoolId)
    );
  }

  /**
   * Release ownership. Returns true only if this token still owned the slot
   * and should clear its busy flag (retry/cancel must not clear a newer export).
   */
  end(token: AdminExportToken): boolean {
    const current = this.controllers.get(token.key);
    if (!current || current.controller !== token.controller) {
      return false;
    }
    this.controllers.delete(token.key);
    return token.generation === this.generation;
  }

  cancel(key: string): boolean {
    const current = this.controllers.get(key);
    if (!current) return false;
    current.controller.abort();
    this.controllers.delete(key);
    return current.generation === this.generation;
  }

  private canBegin(): boolean {
    return (
      this.mounted &&
      this.identity.allowed &&
      Boolean(this.identity.uid) &&
      Boolean(this.identity.schoolId)
    );
  }
}

function normalizeIdentity(identity: AdminExportIdentity): AdminExportIdentity {
  return {
    uid: typeof identity.uid === 'string' ? identity.uid.trim() : '',
    schoolId: typeof identity.schoolId === 'string' ? identity.schoolId.trim() : '',
    allowed: identity.allowed === true,
  };
}

function originMatches(session: AdminExportSession, origin: AdminExportOrigin): boolean {
  const identity = session.getIdentity();
  return (
    origin.generation === session.getGeneration() &&
    origin.uid === identity.uid &&
    origin.schoolId === identity.schoolId &&
    origin.allowed === identity.allowed &&
    origin.allowed === true &&
    Boolean(origin.uid) &&
    Boolean(origin.schoolId) &&
    Boolean(origin.schoolCode)
  );
}

/** Shared gate used after deferred file/share awaits. */
export function assertExportStillCurrent(session: AdminExportSession, token: AdminExportToken): void {
  if (!session.isCurrent(token)) {
    throw new DOMException('Aborted', 'AbortError');
  }
}
