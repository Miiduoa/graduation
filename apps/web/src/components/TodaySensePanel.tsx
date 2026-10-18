'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  applySenseAction,
  formatSenseRecord,
  parseSenseState,
  selectSenseCards,
  serializeSenseState,
  SENSE_CANCEL_ACTION,
  SENSE_EMPTY_TEXT,
  SENSE_HANDLE_CONFIRM,
  SENSE_SECTION_NOTE,
  SENSE_SECTION_TITLE,
  SENSE_SNOOZE_CONFIRM,
  SENSE_UNDO_ACTION,
  SENSE_UNSIGNED_TEXT,
  senseStorageKey,
  senseTruncationNote,
  undoLastSenseAction,
  type SenseCard,
  type SenseInputItem,
  type SensePhase,
  type SenseState,
} from '@campus/shared/src/todaySense';
import styles from '../app/home.module.css';

function readSenseState(storageKey: string): SenseState {
  if (!storageKey || typeof window === 'undefined') return parseSenseState(null);
  try {
    return parseSenseState(window.localStorage.getItem(storageKey));
  } catch {
    return parseSenseState(null);
  }
}

export function TodaySensePanel({
  ownerId,
  schoolId,
  items,
  now,
  phase,
}: {
  ownerId: string | null;
  schoolId?: string | null;
  items: SenseInputItem[];
  now: Date | null;
  phase: SensePhase;
}) {
  const storageKey = ownerId ? senseStorageKey(ownerId, schoolId) : '';
  const [state, setState] = useState<SenseState>(() => parseSenseState(null));
  const [loadedKey, setLoadedKey] = useState(storageKey);
  const [hydrated, setHydrated] = useState(false);
  const [pending, setPending] = useState<{ cardId: string; action: 'handle' | 'snooze' } | null>(
    null,
  );
  if (loadedKey !== storageKey) {
    setLoadedKey(storageKey);
    setState(parseSenseState(null));
    setPending(null);
    setHydrated(false);
  }
  useEffect(() => {
    setPending(null);
    setState(readSenseState(storageKey));
    setHydrated(true);
  }, [storageKey]);

  const clock = now ?? null;
  const { cards, hiddenCount } = useMemo(
    () =>
      phase === 'ready' && clock
        ? selectSenseCards({ now: clock, items, state })
        : { cards: [] as SenseCard[], hiddenCount: 0 },
    [phase, clock, items, state],
  );

  if (phase === 'hidden' || phase === 'loading' || phase === 'error' || !clock) return null;
  if (phase === 'ready' && !hydrated) return null;

  const write = (next: SenseState) => {
    setState(next);
    if (!storageKey || typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(storageKey, serializeSenseState(next));
    } catch {
      /* 本機寫入失敗時畫面仍反映這次操作，下次重開會回到讀取結果 */
    }
  };

  const confirm = (card: SenseCard, action: 'handle' | 'snooze') => {
    write(applySenseAction(state, action, card, clock));
    setPending(null);
  };

  const undo = () => {
    const result = undoLastSenseAction(state, clock);
    if (result.ok) write(result.state);
  };

  return (
    <section className={styles.section} aria-labelledby="today-sense-title">
      <div className={styles.sectionHeading}>
        <h2 id="today-sense-title">
          {SENSE_SECTION_TITLE}
          {phase === 'ready' ? <span>{cards.length}</span> : null}
        </h2>
      </div>
      <p className={styles.sectionNote}>{SENSE_SECTION_NOTE}</p>
      {phase === 'unsigned' ? (
        <p className={styles.empty}>{SENSE_UNSIGNED_TEXT}</p>
      ) : cards.length === 0 ? (
        <p className={styles.empty}>{SENSE_EMPTY_TEXT}</p>
      ) : (
        <ul className={styles.senseList}>
          {cards.map((card) => (
            <li key={card.id} className={styles.senseCard}>
              <h3>{card.title}</h3>
              <p className={styles.senseMeta}>{card.courseName}</p>
              <p className={styles.senseWhy}>{card.why}</p>
              {pending?.cardId === card.id ? (
                <div>
                  <p className={styles.sensePreview}>
                    {card.actions.find((action) => action.id === pending.action)?.preview}
                  </p>
                  <div className={styles.senseActions}>
                    <button
                      type="button"
                      className={styles.primary}
                      onClick={() => confirm(card, pending.action)}
                    >
                      {pending.action === 'handle' ? SENSE_HANDLE_CONFIRM : SENSE_SNOOZE_CONFIRM}
                    </button>
                    <button
                      type="button"
                      className={styles.textButton}
                      onClick={() => setPending(null)}
                    >
                      {SENSE_CANCEL_ACTION}
                    </button>
                  </div>
                </div>
              ) : (
                <div className={styles.senseActions}>
                  {card.actions.map((action) =>
                    action.id === 'open' ? (
                      card.href ? (
                        <Link key={action.id} className={styles.primary} href={card.href}>
                          {action.label} <span aria-hidden>→</span>
                        </Link>
                      ) : null
                    ) : (
                      <button
                        key={action.id}
                        type="button"
                        className={styles.textButton}
                        onClick={() =>
                          setPending({
                            cardId: card.id,
                            action: action.id === 'snooze' ? 'snooze' : 'handle',
                          })
                        }
                      >
                        {action.label}
                      </button>
                    ),
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {phase === 'ready' && senseTruncationNote(hiddenCount) ? (
        <p className={styles.sectionNote}>{senseTruncationNote(hiddenCount)}</p>
      ) : null}
      {phase === 'ready' && state.lastRecord ? (
        <p className={styles.senseRecord}>
          {formatSenseRecord(state.lastRecord)}
          {state.lastRecord.reversible ? (
            <>
              {' '}
              <button type="button" className={styles.textButton} onClick={undo}>
                {SENSE_UNDO_ACTION}
              </button>
            </>
          ) : null}
        </p>
      ) : null}
    </section>
  );
}
