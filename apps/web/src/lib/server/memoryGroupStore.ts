type DocData = Record<string, unknown>;

function clone(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(
      Object.entries(value as DocData).map(([key, item]) => [key, clone(item)]),
    );
  }
  return value;
}

let auto = 0;
function autoId(): string {
  auto += 1;
  return `auto-${auto}`;
}

export function createMemoryGroupStore(seed: Array<[string, DocData]> = []) {
  const docs = new Map<string, DocData>(seed.map(([path, data]) => [path, clone(data) as DocData]));
  let failCommit = false;

  function ref(path: string) {
    const id = path.split('/').pop() || '';
    return {
      path,
      id,
      collection: (name: string) => collection(`${path}/${name}`),
    };
  }

  function collection(
    path: string,
    filters: Array<{ field: string; value: unknown }> = [],
    maximum = Infinity,
  ) {
    return {
      path,
      filters,
      maximum,
      doc: (id?: string) => ref(`${path}/${id || autoId()}`),
      where: (field: string, _op: string, value: unknown) =>
        collection(path, [...filters, { field, value }], maximum),
      limit: (count: number) => collection(path, filters, count),
    };
  }

  function snap(reference: { path: string; id: string }, values = docs) {
    const data = values.get(reference.path);
    return {
      id: reference.id,
      ref: ref(reference.path),
      exists: data !== undefined,
      data: () => (data ? (clone(data) as DocData) : {}),
    };
  }

  const db = {
    collection: (name: string) => collection(name),
    async runTransaction<T>(callback: (transaction: any) => Promise<T>): Promise<T> {
      const base = new Map(docs);
      const writes: Array<{ type: 'set' | 'update'; reference: { path: string }; data: DocData }> =
        [];
      const tx = {
        getAll: async (...refs: Array<{ path: string; id: string }>) =>
          refs.map((reference) => snap(reference, base)),
        get: async (query: {
          path: string;
          id?: string;
          filters?: Array<{ field: string; value: unknown }>;
          maximum?: number;
        }) => {
          if (!Array.isArray(query.filters))
            return snap(query as { path: string; id: string }, base);
          const result = [...base]
            .filter(
              ([path, data]) =>
                path.startsWith(`${query.path}/`) &&
                path.slice(query.path.length + 1).indexOf('/') === -1 &&
                query.filters!.every(({ field, value }) => data[field] === value),
            )
            .slice(0, query.maximum ?? Infinity)
            .map(([path]) => snap(ref(path), base));
          return { docs: result, size: result.length, empty: result.length === 0 };
        },
        set: (reference: { path: string }, data: DocData) =>
          writes.push({ type: 'set', reference, data: clone(data) as DocData }),
        update: (reference: { path: string }, data: DocData) =>
          writes.push({ type: 'update', reference, data: clone(data) as DocData }),
      };
      const result = await callback(tx);
      if (failCommit) {
        failCommit = false;
        throw new Error('commit unavailable');
      }
      const committed = new Map(docs);
      for (const write of writes) {
        if (write.type === 'update' && !committed.has(write.reference.path)) {
          throw new Error('missing document');
        }
        committed.set(
          write.reference.path,
          write.type === 'update'
            ? ({ ...committed.get(write.reference.path), ...write.data } as DocData)
            : write.data,
        );
      }
      docs.clear();
      for (const [path, data] of committed) docs.set(path, data);
      return result;
    },
  };

  return {
    db,
    docs,
    failNextCommit: () => {
      failCommit = true;
    },
    resetAutoIds: () => {
      auto = 0;
    },
  };
}
