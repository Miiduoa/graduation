/** 限制整次讀取的等待時間，包含身分驗證與回應解析。 */
export async function withSchoolDataDeadline<T>(
  read: (signal: AbortSignal) => Promise<T>,
  parentSignal?: AbortSignal,
): Promise<T> {
  const cancelled = () => new DOMException('校務資料讀取已取消。', 'AbortError');
  if (parentSignal?.aborted) throw cancelled();
  const controller = new AbortController();
  let rejectStop!: (error: Error) => void;
  const stopped = new Promise<never>((_, reject) => { rejectStop = reject; });
  const stop = (error: Error) => {
    // 先決定這次讀取的結果，再中止傳輸；不讓 fetch 的 AbortError 蓋掉逾時原因。
    rejectStop(error);
    controller.abort(error);
  };
  const abort = () => stop(cancelled());
  parentSignal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => stop(new Error('校務資料讀取逾時。')), 45_000);
  try {
    const result = await Promise.race([
      Promise.resolve().then(() => {
        if (controller.signal.aborted) throw controller.signal.reason;
        return read(controller.signal);
      }),
      stopped,
    ]);
    if (controller.signal.aborted) throw controller.signal.reason;
    return result;
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', abort);
  }
}
