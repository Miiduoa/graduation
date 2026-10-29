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

function incrementAmount(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as { incrementBy?: unknown; operand?: unknown; isEqual?: unknown };
  if (typeof record.incrementBy === 'number') return record.incrementBy;
  if (typeof record.operand === 'number' && typeof record.isEqual === 'function') {
    return record.operand;
  }
  const name = (value as { constructor?: { name?: string } }).constructor?.name;
  if (name === 'NumericIncrementTransform' && typeof record.operand === 'number') {
    return record.operand;
  }
  return null;
}

function applyFields(existing: DocData, data: DocData): DocData {
  const next: DocData = { ...existing };
  for (const [key, value] of Object.entries(data)) {
    const amount = incrementAmount(value);
    next[key] =
      amount === null ? clone(value) : (typeof next[key] === 'number' ? next[key] : 0) + amount;
  }
  return next;
}

let auto = 0;
function autoId(): string {
  auto += 1;
  return `auto-${auto}`;
}

type QueryFilter = { field: string; op: string; value: unknown };
type QueryOrder = { field: string; direction: string };

function fieldMatches(data: DocData, filter: QueryFilter): boolean {
  if (filter.op === 'array-contains') {
    const current = data[filter.field];
    return Array.isArray(current) && current.includes(filter.value);
  }
  return data[filter.field] === filter.value;
}

function sortValue(value: unknown): number {
  if (typeof value === 'number') return value;
  if (value instanceof Date) return value.getTime();
  if (value && typeof value === 'object' && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
    return (value as { toMillis: () => number }).toMillis();
  }
  if (typeof value === 'string') return Date.parse(value) || 0;
  return 0;
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
      get: async () => snap({ path, id }),
      set: async (data: DocData, options?: { merge?: boolean }) => {
        const existing = options?.merge ? docs.get(path) || {} : {};
        docs.set(path, applyFields(existing, data));
      },
      delete: async () => {
        docs.delete(path);
      },
    };
  }

  function queryDocs(
    path: string,
    filters: QueryFilter[],
    maximum: number,
    order: QueryOrder | null,
    values: Map<string, DocData>,
  ) {
    const rows = [...values]
      .filter(
        ([docPath, data]) =>
          docPath.startsWith(`${path}/`) &&
          docPath.slice(path.length + 1).indexOf('/') === -1 &&
          filters.every((filter) => fieldMatches(data, filter)),
      )
      .map(([docPath]) => snap(ref(docPath), values));
    if (order) {
      const direction = order.direction === 'desc' ? -1 : 1;
      rows.sort(
        (left, right) =>
          direction * (sortValue(left.data()[order.field]) - sortValue(right.data()[order.field])),
      );
    }
    return rows.slice(0, maximum);
  }

  function collection(
    path: string,
    filters: QueryFilter[] = [],
    maximum = Infinity,
    order: QueryOrder | null = null,
  ) {
    return {
      path,
      filters,
      maximum,
      order,
      doc: (id?: string) => ref(`${path}/${id || autoId()}`),
      where: (field: string, op: string, value: unknown) =>
        collection(path, [...filters, { field, op, value }], maximum, order),
      orderBy: (field: string, direction = 'asc') =>
        collection(path, filters, maximum, { field, direction }),
      limit: (count: number) => collection(path, filters, count, order),
      async get() {
        const result = queryDocs(path, filters, maximum, order, docs);
        return { docs: result, size: result.length, empty: result.length === 0 };
      },
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
    doc: (path: string) => ref(path),
    collection: (name: string) => collection(name),
    async runTransaction<T>(callback: (transaction: any) => Promise<T>): Promise<T> {
      const base = new Map(docs);
      const writes: Array<{
        type: 'set' | 'update' | 'create';
        reference: { path: string };
        data: DocData;
        merge?: boolean;
      }> = [];
      const tx = {
        getAll: async (...refs: Array<{ path: string; id: string }>) =>
          refs.map((reference) => snap(reference, base)),
        get: async (query: {
          path: string;
          id?: string;
          filters?: QueryFilter[];
          maximum?: number;
          order?: QueryOrder | null;
        }) => {
          if (!Array.isArray(query.filters))
            return snap(query as { path: string; id: string }, base);
          const result = queryDocs(
            query.path,
            query.filters,
            query.maximum ?? Infinity,
            query.order ?? null,
            base,
          );
          return { docs: result, size: result.length, empty: result.length === 0 };
        },
        set: (reference: { path: string }, data: DocData, options?: { merge?: boolean }) =>
          writes.push({
            type: 'set',
            reference,
            data: clone(data) as DocData,
            merge: options?.merge === true,
          }),
        create: (reference: { path: string }, data: DocData) =>
          writes.push({ type: 'create', reference, data: clone(data) as DocData }),
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
        if (write.type === 'create' && committed.has(write.reference.path)) {
          throw new Error('already exists');
        }
        if (write.type === 'update' && !committed.has(write.reference.path)) {
          throw new Error('missing document');
        }
        const mergeBase =
          write.type === 'set' && write.merge
            ? committed.get(write.reference.path) || {}
            : write.type === 'set' || write.type === 'create'
              ? {}
              : committed.get(write.reference.path) || {};
        committed.set(write.reference.path, applyFields(mergeBase, write.data));
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
