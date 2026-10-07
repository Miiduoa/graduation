function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && Object.getPrototypeOf(value) === Object.prototype)
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  return value;
}
function transactionStore(seed = []) {
  const docs = new Map(seed);
  let failCommit = false;
  function ref(path) {
    return { path, id: path.split('/').pop(), collection: (name) => collection(`${path}/${name}`) };
  }
  function collection(path, filters = [], maximum = Infinity) {
    return {
      path,
      filters,
      maximum,
      doc: (id) => ref(`${path}/${id}`),
      where: (field, operator, value) =>
        collection(path, [...filters, { field, operator, value }], maximum),
      limit: (count) => collection(path, filters, count),
    };
  }
  function snap(reference, values = docs) {
    const data = values.get(reference.path);
    return { id: reference.id, ref: reference, exists: data !== undefined, data: () => data };
  }
  const db = {
    collection,
    async runTransaction(callback) {
      const base = new Map(docs);
      const writes = [];
      const tx = {
        getAll: async (...refs) => refs.map((reference) => snap(reference, base)),
        get: async (query) => {
          const result = [...base]
            .filter(
              ([path, data]) =>
                path.startsWith(`${query.path}/`) &&
                path.slice(query.path.length + 1).indexOf('/') === -1 &&
                query.filters.every(
                  ({ field, operator, value }) => operator === '==' && data[field] === value,
                ),
            )
            .slice(0, query.maximum)
            .map(([path]) => snap(ref(path), base));
          return { docs: result, size: result.length, empty: result.length === 0 };
        },
        set: (reference, data) => writes.push({ type: 'set', reference, data }),
        create: (reference, data) => writes.push({ type: 'create', reference, data }),
        update: (reference, data) => writes.push({ type: 'update', reference, data }),
      };
      const result = await callback(tx);
      if (failCommit) {
        failCommit = false;
        throw new Error('commit unavailable');
      }
      const committed = new Map(docs);
      for (const write of writes) {
        if (write.type === 'create' && committed.has(write.reference.path))
          throw new Error('already exists');
        if (write.type === 'update' && !committed.has(write.reference.path))
          throw new Error('missing document');
        committed.set(
          write.reference.path,
          write.type === 'update'
            ? clone({ ...committed.get(write.reference.path), ...write.data })
            : clone(write.data),
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
  };
}
module.exports = { transactionStore };
