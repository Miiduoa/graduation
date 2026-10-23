'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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
  SENSE_SAVE_FAILED_TEXT,
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
import {
  AGENT_CANCEL_DOWNLOAD_ACTION,
  AGENT_DECLINE_ACTION,
  AGENT_DOWNLOAD_ACTION,
  AGENT_DOWNLOAD_NOTE,
  AGENT_LOADING_TEXT,
  AGENT_MODEL_EVENT,
  AGENT_PLAN_NOTE,
  AGENT_PLAN_TITLE,
  agentConsentStorageKey,
  assembleAgentPlan,
  canOfferOnDeviceAgent,
  formatAgentDownloadProgress,
  notifyAgentModelChanged,
  orderedSenseCards,
  parseAgentConsent,
  serializeAgentConsent,
  type AgentConsent,
  type AgentJudgement,
} from '@campus/shared/src/todaySenseAgent';
import {
  downloadTodaySenseModel,
  hasWebGpu,
  inferTodaySenseOrder,
  type AgentDownload,
  type AgentInfer,
} from '@/lib/todaySenseAgentRuntime';
import styles from '../app/home.module.css';

function readSenseState(storageKey: string): SenseState {
  if (!storageKey || typeof window === 'undefined') return parseSenseState(null);
  try {
    return parseSenseState(window.localStorage.getItem(storageKey));
  } catch {
    return parseSenseState(null);
  }
}

function readConsent(storageKey: string): AgentConsent {
  if (!storageKey || typeof window === 'undefined') return parseAgentConsent(null);
  try {
    return parseAgentConsent(window.localStorage.getItem(storageKey));
  } catch {
    return parseAgentConsent(null);
  }
}

export function TodaySensePanel({
  ownerId,
  schoolId,
  items,
  now,
  phase,
  hideWhenEmpty = false,
  inferAgent = inferTodaySenseOrder,
  downloadAgent = downloadTodaySenseModel,
  gpu,
}: {
  ownerId: string | null;
  schoolId?: string | null;
  items: SenseInputItem[];
  now: Date | null;
  phase: SensePhase;
  hideWhenEmpty?: boolean;
  inferAgent?: AgentInfer;
  downloadAgent?: AgentDownload;
  gpu?: unknown;
}) {
  const storageKey = ownerId ? senseStorageKey(ownerId, schoolId) : '';
  const consentKey = ownerId ? agentConsentStorageKey(ownerId, schoolId) : '';
  const [state, setState] = useState<SenseState>(() => parseSenseState(null));
  const [consent, setConsent] = useState<AgentConsent>('unset');
  const [gpuReady, setGpuReady] = useState(false);
  const [judgement, setJudgement] = useState<AgentJudgement | null>(null);
  const [agentLoading, setAgentLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const downloadAbort = useRef<AbortController | null>(null);
  const [loadedKey, setLoadedKey] = useState(storageKey);
  const [hydrated, setHydrated] = useState(false);
  const [pending, setPending] = useState<{ cardId: string; action: 'handle' | 'snooze' } | null>(
    null,
  );
  const [saveError, setSaveError] = useState(false);
  if (loadedKey !== storageKey) {
    setLoadedKey(storageKey);
    setState(parseSenseState(null));
    setConsent('unset');
    setJudgement(null);
    setAgentLoading(false);
    setDownloading(false);
    setDownloadProgress(0);
    setPending(null);
    setSaveError(false);
    setHydrated(false);
  }
  useEffect(() => {
    setPending(null);
    setSaveError(false);
    setJudgement(null);
    setState(readSenseState(storageKey));
    setConsent(readConsent(consentKey));
    setHydrated(true);
  }, [storageKey, consentKey]);
  useEffect(() => {
    setGpuReady(gpu !== undefined ? Boolean(gpu) : hasWebGpu());
  }, [gpu]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const refresh = () => {
      const next = readConsent(consentKey);
      setConsent(next);
      if (next !== 'accepted') {
        setJudgement(null);
        setAgentLoading(false);
      }
    };
    window.addEventListener(AGENT_MODEL_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(AGENT_MODEL_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, [consentKey]);

  const clock = now ?? null;
  const { cards, hiddenCount } = useMemo(
    () =>
      phase === 'ready' && clock
        ? selectSenseCards({ now: clock, items, state })
        : { cards: [] as SenseCard[], hiddenCount: 0 },
    [phase, clock, items, state],
  );
  const cardIds = cards.map((card) => card.id).join('|');

  useEffect(() => {
    if (phase !== 'ready' || !clock || consent !== 'accepted' || cards.length < 2) {
      setJudgement(null);
      setAgentLoading(false);
      return;
    }
    let cancelled = false;
    setAgentLoading(true);
    inferAgent(cards, clock).then((next) => {
      if (cancelled) return;
      setJudgement(next);
      setAgentLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [phase, clock, consent, cardIds, inferAgent, cards.length]);

  if (phase === 'hidden' || phase === 'loading' || phase === 'error' || !clock) return null;
  if (phase === 'ready' && !hydrated) return null;
  if (phase === 'ready' && hideWhenEmpty && cards.length === 0) return null;

  const write = (next: SenseState) => {
    if (!storageKey || typeof window === 'undefined') return false;
    try {
      window.localStorage.setItem(storageKey, serializeSenseState(next));
    } catch {
      setSaveError(true);
      return false;
    }
    setState(next);
    setSaveError(false);
    return true;
  };

  const writeConsent = (next: Exclude<AgentConsent, 'unset'>) => {
    if (!consentKey || typeof window === 'undefined') {
      setConsent(next);
      return;
    }
    try {
      window.localStorage.setItem(consentKey, serializeAgentConsent(next));
    } catch {
      setConsent(next);
      notifyAgentModelChanged();
      return;
    }
    setConsent(next);
    notifyAgentModelChanged();
    if (next === 'refused') {
      setJudgement(null);
      setAgentLoading(false);
    }
  };

  const startDownload = () => {
    const controller = new AbortController();
    downloadAbort.current = controller;
    setDownloading(true);
    setDownloadProgress(0);
    void downloadAgent({
      signal: controller.signal,
      onProgress: (info) => {
        const percent = Number.isFinite(info.progress)
          ? Math.max(0, Math.min(100, Math.round(info.progress)))
          : 0;
        setDownloadProgress(percent);
      },
    })
      .then((ok) => {
        if (downloadAbort.current !== controller) return;
        if (controller.signal.aborted || !ok) {
          setDownloading(false);
          setDownloadProgress(0);
          return;
        }
        writeConsent('accepted');
        setDownloading(false);
      })
      .catch(() => {
        if (downloadAbort.current !== controller) return;
        setDownloading(false);
        setDownloadProgress(0);
      })
      .finally(() => {
        if (downloadAbort.current === controller) downloadAbort.current = null;
      });
  };

  const cancelDownload = () => {
    downloadAbort.current?.abort();
    setDownloading(false);
    setDownloadProgress(0);
  };

  const confirm = (card: SenseCard, action: 'handle' | 'snooze') => {
    write(applySenseAction(state, action, card, clock));
    setPending(null);
  };

  const undo = () => {
    const result = undoLastSenseAction(state, clock);
    if (result.ok) write(result.state);
  };

  const offerDownload =
    phase === 'ready' &&
    canOfferOnDeviceAgent(gpuReady || gpu, cards.length) &&
    consent === 'unset' &&
    !downloading;
  const plan =
    phase === 'ready' && clock && judgement ? assembleAgentPlan(cards, judgement, clock) : null;
  const visibleCards = plan ? orderedSenseCards(cards, judgement) : cards;

  return (
    <section className={styles.section} aria-labelledby="today-sense-title">
      <div className={styles.sectionHeading}>
        <h2 id="today-sense-title">
          {SENSE_SECTION_TITLE}
          {phase === 'ready' ? <span>{cards.length}</span> : null}
        </h2>
      </div>
      <p className={styles.sectionNote}>{SENSE_SECTION_NOTE}</p>
      {saveError ? (
        <p className={styles.senseSaveError} role="alert">
          {SENSE_SAVE_FAILED_TEXT}
        </p>
      ) : null}
      {offerDownload ? (
        <div className={styles.senseAgent}>
          <p className={styles.senseWhy}>{AGENT_DOWNLOAD_NOTE}</p>
          <div className={styles.senseActions}>
            <button type="button" className={styles.primary} onClick={startDownload}>
              {AGENT_DOWNLOAD_ACTION}
            </button>
            <button type="button" className={styles.textButton} onClick={() => writeConsent('refused')}>
              {AGENT_DECLINE_ACTION}
            </button>
          </div>
        </div>
      ) : null}
      {downloading ? (
        <div className={styles.senseAgent}>
          <p className={styles.sectionNote} role="status">
            {formatAgentDownloadProgress(downloadProgress)}
          </p>
          <progress max={100} value={downloadProgress} aria-label={formatAgentDownloadProgress(downloadProgress)} />
          <div className={styles.senseActions}>
            <button type="button" className={styles.textButton} onClick={cancelDownload}>
              {AGENT_CANCEL_DOWNLOAD_ACTION}
            </button>
          </div>
        </div>
      ) : null}
      {consent === 'accepted' && agentLoading ? (
        <p className={styles.sectionNote}>{AGENT_LOADING_TEXT}</p>
      ) : null}
      {plan && plan.length > 0 ? (
        <div className={styles.senseAgent}>
          <p className={styles.senseMeta}>{AGENT_PLAN_TITLE}</p>
          <p className={styles.sectionNote}>{AGENT_PLAN_NOTE}</p>
          <ol className={styles.sensePlan}>
            {plan.map((row) => (
              <li key={row.card.id}>
                <strong>
                  {row.card.title} · {row.card.courseName}
                </strong>
                <span>{row.reasonText}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      {phase === 'unsigned' ? (
        <p className={styles.empty}>{SENSE_UNSIGNED_TEXT}</p>
      ) : cards.length === 0 ? (
        <p className={styles.empty}>{SENSE_EMPTY_TEXT}</p>
      ) : (
        <ul className={styles.senseList}>
          {visibleCards.map((card) => (
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
