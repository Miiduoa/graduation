import React from "react";

import { getDataSource, type DataSource } from "../data";
import { useAuth } from "../state/auth";

/**
 * Hook to get the current DataSource instance.
 * NOTE: DataSource is a singleton that rarely changes during app lifecycle.
 * If hot-swapping is needed in the future, consider using a Context instead.
 */
export function useDataSource() {
  const auth = useAuth();
  const authKey = auth.user?.uid ?? "__guest__";

  return React.useMemo(() => {
    void authKey;
    const source = getDataSource();
    return new Proxy(source, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as DataSource;
  }, [authKey]);
}
