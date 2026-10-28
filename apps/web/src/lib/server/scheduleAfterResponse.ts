import { after } from 'next/server';

/** 用 Next.js `after()` 在回應送出後跑背景工作，而不是 `void promise`。 */
export function scheduleAfterResponse(task: () => void | Promise<void>): void {
  after(async () => {
    try {
      await task();
    } catch {
      // 背景工作失敗不可影響已送出的回應。
    }
  });
}
