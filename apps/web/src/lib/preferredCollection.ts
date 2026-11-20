type Source<T> = {
  key: string;
  subscribe: (next: (rows: T[]) => void, fail: (error: unknown) => void) => () => void;
};

/** A later source is eligible only after every earlier source confirms an empty result. */
export function subscribePreferredCollection<T>(
  sources: Source<T>[],
  onData: (rows: T[]) => void,
  onError: (error: unknown) => void,
): () => void {
  const states = new Map<string, { rows: T[] } | { error: unknown }>();
  const stops: Array<() => void> = [];
  let active = true;
  function emit() {
    if (!active) return;
    for (const source of sources) {
      const state = states.get(source.key);
      if (!state) return;
      if ('error' in state) {
        onError(state.error);
        return;
      }
      if (state.rows.length) {
        onData(state.rows);
        return;
      }
    }
    onData([]);
  }
  for (const source of sources) {
    const fail = (error: unknown) => {
      if (!active) return;
      states.set(source.key, { error });
      emit();
    };
    try {
      stops.push(
        source.subscribe((rows) => {
          if (!active) return;
          states.set(source.key, { rows });
          emit();
        }, fail),
      );
    } catch (error) {
      fail(error);
    }
  }
  return () => {
    active = false;
    states.clear();
    stops.forEach((stop) => stop());
  };
}
