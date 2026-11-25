'use client';

import { useState } from 'react';
import { useCampusEventShortlist } from '@/lib/campusEventShortlist';
import { replaceServiceListQuery } from '@/lib/serviceListNavigation';
import { useServiceListQuery } from '@/lib/useServiceListQuery';
import { CampusEventSavedSection } from './CampusEventSavedSection';
import { CampusEventShortlistFeedback } from './CampusEventSaveButton';
import { EventList } from './EventList';
import {
  campusEventFilterQuery,
  readCampusEventFilters,
  type CampusEventFilters,
} from './eventPresentation';
import styles from './events.module.css';

/**
 * Switches between live browsing and the device-local saved view. The saved view is selected by
 * `saved=1` in the URL, so a detail page can return to it. It never waits for the browse request.
 */
export function CampusEventsWorkspace({ schoolId, schoolSearch, initialFilters }: {
  schoolId: string;
  schoolSearch: string;
  initialFilters: CampusEventFilters;
}) {
  const shortlist = useCampusEventShortlist(schoolId);
  const currentQuery = useServiceListQuery('/events', schoolId, campusEventFilterQuery(initialFilters));
  const queryKey = `${schoolId}:${currentQuery.toString()}`;
  const filters = readCampusEventFilters(currentQuery);
  const [selection, setSelection] = useState({ queryKey, saved: Boolean(filters.saved) });
  const saved = selection.queryKey === queryKey ? selection.saved : Boolean(filters.saved);
  if (selection.queryKey !== queryKey) setSelection({ queryKey, saved });
  // Browse is fetched on first use and then kept, so returning to it does not lose loaded pages.
  const [browseMounted, setBrowseMounted] = useState(!saved);
  if (!saved && !browseMounted) setBrowseMounted(true);

  function selectView(next: boolean) {
    setSelection({ queryKey, saved: next });
    replaceServiceListQuery('/events', schoolId, ['saved'], new URLSearchParams(next ? { saved: '1' } : {}));
  }

  return (
    <div className={styles.workspace}>
      <div className={styles.viewSwitch} role="group" aria-label="活動檢視">
        <button type="button" aria-pressed={!saved} onClick={() => selectView(false)}>
          瀏覽活動
        </button>
        <button type="button" aria-pressed={saved} onClick={() => selectView(true)}>
          我的收藏
          {shortlist.ready ? <span className={styles.viewCount}>{shortlist.items.length}</span> : null}
        </button>
      </div>
      <CampusEventShortlistFeedback shortlist={shortlist} />
      {saved ? (
        <CampusEventSavedSection
          shortlist={shortlist}
          schoolSearch={schoolSearch}
          filters={{ ...filters, saved: true }}
          onBrowse={() => selectView(false)}
        />
      ) : null}
      {browseMounted ? (
        <div hidden={saved}>
          <EventList
            schoolId={schoolId}
            schoolSearch={schoolSearch}
            initialFilters={{ ...initialFilters, saved: undefined }}
            shortlist={shortlist}
          />
        </div>
      ) : null}
    </div>
  );
}
