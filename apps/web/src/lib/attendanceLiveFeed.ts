export type AttendanceFeedState = 'connecting' | 'live' | 'error';
type Stop = () => void;
export type AttendanceFeedSource<S, R> = {
  sessions: (next: (value: S[] | null) => void, error: () => void) => Stop;
  receipt: (id: string, next: (value: R | null) => void, error: () => void) => Stop;
};

/** 合併場次與本人收據；null 代表尚未取得伺服器確認，不是沒有出席。 */
export function startAttendanceFeed<S extends { id: string }, R>(options: {
  source: AttendanceFeedSource<S, R>;
  includeReceipts: boolean;
  onChange: (rows: { session: S; receipt: R | null }[]) => void;
  onState: (state: AttendanceFeedState) => void;
}): Stop {
  let stopped = false;
  let reconciling = false;
  let confirmed = false;
  let sessions: S[] = [];
  let stopSessions: Stop | undefined;
  let state: AttendanceFeedState | undefined;
  type Entry = { stop?: Stop; value: R | null };
  const receipts = new Map<string, Entry>();
  function report(next: AttendanceFeedState) {
    if (state !== next) { state = next; options.onState(next); }
  }
  function stop() {
    if (stopped) return;
    stopped = true;
    stopSessions?.();
    for (const entry of receipts.values()) entry.stop?.();
    receipts.clear();
  }
  function fail() {
    if (stopped) return;
    stop();
    report('error');
  }
  function emit() {
    if (stopped || reconciling) return;
    if (!confirmed || (options.includeReceipts && sessions.some((item) => receipts.get(item.id)?.value == null))) {
      report('connecting');
      return;
    }
    options.onChange(sessions.map((session) => ({
      session, receipt: receipts.get(session.id)?.value ?? null,
    })));
    report('live');
  }
  report('connecting');
  try {
    const unsubscribe = options.source.sessions((value) => {
      if (stopped) return;
      if (!value) { confirmed = false; emit(); return; }
      if (value.length > 50 || new Set(value.map((item) => item.id)).size !== value.length) {
        fail(); return;
      }
      confirmed = true;
      sessions = value;
      reconciling = true;
      const wanted = new Set(value.map((item) => item.id));
      for (const [id, entry] of receipts) {
        if (!wanted.has(id)) {
          receipts.delete(id);
          entry.stop?.();
        }
      }
      try {
        if (options.includeReceipts) for (const item of value) {
          if (stopped) break;
          if (receipts.has(item.id)) continue;
          const entry: Entry = { value: null };
          receipts.set(item.id, entry);
          const unsubscribeReceipt = options.source.receipt(item.id, (receipt) => {
            if (stopped || receipts.get(item.id) !== entry) return;
            entry.value = receipt;
            emit();
          }, () => { if (receipts.get(item.id) === entry) fail(); });
          // 同步回呼也可能立刻失敗，這時不能留下已失去管理者的監聽器。
          if (stopped || receipts.get(item.id) !== entry) unsubscribeReceipt();
          else entry.stop = unsubscribeReceipt;
        }
      } catch { fail(); }
      finally { reconciling = false; }
      emit();
    }, fail);
    if (stopped) unsubscribe();
    else stopSessions = unsubscribe;
  } catch { fail(); }
  return stop;
}
