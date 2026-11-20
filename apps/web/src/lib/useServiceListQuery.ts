'use client';

import { useCallback, useSyncExternalStore } from 'react';
import {
  isCurrentServiceList,
  subscribeServiceListQuery,
  type ServiceListQuery,
} from './serviceListNavigation';

/** Native history can restore a cached Next page whose server props are older than its URL. */
export function useServiceListQuery(
  pathname: string,
  schoolId: string,
  initialQuery?: ServiceListQuery,
): URLSearchParams {
  const initialSearch =
    initialQuery instanceof URLSearchParams
      ? initialQuery.toString()
      : new URLSearchParams(
          Object.entries(initialQuery ?? {}).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string',
          ),
        ).toString();
  const serverSnapshot = useCallback(() => initialSearch, [initialSearch]);
  const browserSnapshot = useCallback(
    () =>
      isCurrentServiceList(pathname, schoolId)
        ? window.location.search.replace(/^\?/, '')
        : initialSearch,
    [initialSearch, pathname, schoolId],
  );
  return new URLSearchParams(
    useSyncExternalStore(subscribeServiceListQuery, browserSnapshot, serverSnapshot),
  );
}
