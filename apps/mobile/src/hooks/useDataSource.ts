import { getDataSource } from "../data";

/**
 * Hook to get the current DataSource instance.
 * NOTE: DataSource is a singleton that rarely changes during app lifecycle.
 * If hot-swapping is needed in the future, consider using a Context instead.
 */
export function useDataSource() {
  return getDataSource();
}
