/** Page-lifetime consent follows the account across platform context changes. */
export function createTronClassBindingConsent() {
  const verified = new Map<string, { revision: string | null; changed: boolean }>();
  return {
    permits(owner: string, revision: string | null) {
      const source = verified.get(owner);
      if (!source) return true;
      if (source.changed || source.revision !== revision) {
        source.changed = true;
        return false;
      }
      return true;
    },
    accept(owner: string, revision: string | null) {
      verified.set(owner, { revision, changed: false });
    },
    changed(owner: string, revision: string | null) {
      verified.set(owner, { revision, changed: true });
    },
  };
}

export type TronClassBindingConsent = ReturnType<typeof createTronClassBindingConsent>;
