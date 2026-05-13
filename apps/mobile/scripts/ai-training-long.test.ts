/**
 * 離線 AI 代理長時壓力訓練（僅手動執行；見 package.json「ai:train:long」）。
 * 預設 jest testMatch 不包含 scripts/，故一般 CI / pnpm test 不會跑此檔。
 *
 * 環境變數：
 * - AI_TRAINING_MS — 時間上限（毫秒）。預設 3600000（1 小時）。設為 0 改為輪數模式。
 * - AI_TRAINING_ROUNDS — 輪數上限（僅當 AI_TRAINING_MS=0 時必填／有意義）。預設 500。
 * - AI_TRAINING_PROGRESS_SEC — 進度輸出間隔（秒），預設 30。
 * - AI_TRAINING_CHUNK_ROUNDS — 固定每批次輪數（覆寫自動推算；非自動時不限 200–500）。
 * - AI_TRAINING_CHUNK_MS — 自動推算每批輪數時的目標批次時長（毫秒），預設 8000。
 * - AI_TRAINING_MAX_CHUNK_ROUNDS — 自動推算時單批輪數上限（200–500），預設 400。
 * - AI_TRAINING_CALIB_ROUNDS — 開場校正輪數；預設 120，設 0 略過校正（校正耗時不計入 AI_TRAINING_MS）。
 * - AI_TRAINING_SEED — 種子，預設 411211325。
 * - AI_TRAINING_MAX_FAILURES_PER_CHUNK — 單批次允許例外數後中止該批次，預設 2147483647。
 * - AI_TRAINING_VERBOSE_AGENT_LOGS — 設為 1 時輸出 aiLocalAgent 的詳細 console（預設會抑制以降低長時輸出量）。
 *
 * 執行時請設定離線／快速模式（已由 npm script 帶入）：
 * EXPO_PUBLIC_AI_PROVIDER=offline EXPO_PUBLIC_AI_TEST_FAST=1
 *
 * package.json 的 ai:train:long 使用 NODE_OPTIONS=--max-old-space-size=8192 --expose-gc
 * 以降低長時壓測 OOM；每批結束後若 V8 有 expose-gc 則會 global.gc()。
 */

jest.mock('../src/firebase', () => ({
  getFirebaseApp: jest.fn(() => ({})),
  hasUsableFirebaseConfig: jest.fn(() => false),
}));

import { runAISelfDialogEvaluation } from '../src/services/aiSelfDialog';

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function parseEnvMs(): { mode: 'time'; ms: number } | { mode: 'rounds'; rounds: number } {
  const raw = process.env.AI_TRAINING_MS;
  const ms = raw === undefined || raw === '' ? 3600000 : Number(raw);
  if (Number.isFinite(ms) && ms === 0) {
    const rounds = Math.max(1, Math.floor(Number(process.env.AI_TRAINING_ROUNDS ?? 500)));
    return { mode: 'rounds', rounds };
  }
  if (!Number.isFinite(ms) || ms < 0) {
    throw new Error('[訓練] AI_TRAINING_MS 無效');
  }
  return { mode: 'time', ms };
}

describe('AI long-run offline stress (manual)', () => {
  it(
    'chunked runAISelfDialogEvaluation until time or round budget',
    async () => {
      process.env.EXPO_PUBLIC_AI_PROVIDER = 'offline';
      process.env.EXPO_PUBLIC_AI_TEST_FAST = '1';

      const verboseAgent = process.env.AI_TRAINING_VERBOSE_AGENT_LOGS === '1';
      const origLog = console.log.bind(console);
      if (!verboseAgent) {
        const noise = ['[AI Agent]', '[AI Learn]', '[Skill Acquired]', '[Skill'];
        console.log = (...args: unknown[]) => {
          const head = typeof args[0] === 'string' ? args[0] : '';
          if (noise.some((p) => head.startsWith(p))) return;
          origLog(...args);
        };
      }

      try {
      const progressSec = Math.max(5, Number(process.env.AI_TRAINING_PROGRESS_SEC ?? 30));
      const progressMs = progressSec * 1000;
      const baseSeed = Number(process.env.AI_TRAINING_SEED ?? 411211325) >>> 0;
      const maxFailuresPerChunk = Math.max(
        1,
        Math.floor(Number(process.env.AI_TRAINING_MAX_FAILURES_PER_CHUNK ?? 2147483647)),
      );
      const fixedChunk =
        process.env.AI_TRAINING_CHUNK_ROUNDS !== undefined &&
        process.env.AI_TRAINING_CHUNK_ROUNDS !== ''
          ? Math.max(1, Math.floor(Number(process.env.AI_TRAINING_CHUNK_ROUNDS)))
          : null;

      const targetChunkMs = Math.max(500, Math.floor(Number(process.env.AI_TRAINING_CHUNK_MS ?? 8000)));
      const maxChunkRounds = clamp(
        Math.floor(Number(process.env.AI_TRAINING_MAX_CHUNK_ROUNDS ?? 400)),
        200,
        500,
      );

      const budget = parseEnvMs();

      let roundsPerMs: number | null = null;
      const calibN = Number(process.env.AI_TRAINING_CALIB_ROUNDS ?? 120);
      if (fixedChunk === null && calibN > 0) {
        const c0 = Date.now();
        await runAISelfDialogEvaluation({
          rounds: calibN,
          seed: baseSeed,
          maxFailures: calibN,
        });
        if (typeof global.gc === 'function') global.gc();
        const calibDt = Math.max(1, Date.now() - c0);
        roundsPerMs = calibN / calibDt;
        const rpm = roundsPerMs * 60000;
        console.log(`[校正] 約 ${rpm.toFixed(0)} 輪／分鐘（${calibN} 輪／${calibDt} ms）`);
      }

      const tGlobal = Date.now();
      let chunkRounds =
        fixedChunk ??
        (roundsPerMs !== null
          ? clamp(Math.round(roundsPerMs * targetChunkMs), 200, maxChunkRounds)
          : Math.min(200, maxChunkRounds));

      let cumulativeAttempts = 0;
      let cumulativePassed = 0;
      let cumulativeFailed = 0;
      let chunkIdx = 0;
      let lastProgressAt = Date.now();
      const failureHints: string[] = [];

      console.log(
        budget.mode === 'time'
          ? `[訓練] 開始｜時間上限 ${(budget.ms / 60000).toFixed(1)} 分鐘｜批次約 ${chunkRounds} 輪｜目標批次 ${targetChunkMs} ms`
          : `[訓練] 開始｜輪數上限 ${budget.rounds}｜批次約 ${chunkRounds} 輪｜目標批次 ${targetChunkMs} ms`,
      );

      while (true) {
        if (budget.mode === 'time') {
          if (Date.now() - tGlobal >= budget.ms) break;
        } else if (cumulativeAttempts >= budget.rounds) {
          break;
        }

        let thisChunk = chunkRounds;
        if (budget.mode === 'rounds') {
          const left = budget.rounds - cumulativeAttempts;
          if (left <= 0) break;
          thisChunk = Math.min(thisChunk, left);
        }

        const seed = (baseSeed + chunkIdx * 100003) >>> 0;
        {
          const report = await runAISelfDialogEvaluation({
            rounds: thisChunk,
            seed,
            maxFailures: maxFailuresPerChunk,
          });

          cumulativePassed += report.passed;
          cumulativeFailed += report.failed;
          cumulativeAttempts += report.passed + report.failed;

          for (const f of report.failures.slice(0, 3)) {
            const line = `${f.scenarioId}: ${f.reason} — ${String(f.actual).slice(0, 120)}`;
            if (failureHints.length < 12 && !failureHints.includes(line)) failureHints.push(line);
          }
        }

        if (typeof global.gc === 'function') {
          global.gc();
        }

        const now = Date.now();
        if (now - lastProgressAt >= progressMs) {
          const elapsedMin = (now - tGlobal) / 60000;
          const rate = elapsedMin > 0 ? cumulativeAttempts / elapsedMin : 0;
          const pct =
            cumulativeAttempts > 0
              ? ((100 * cumulativePassed) / cumulativeAttempts).toFixed(2)
              : '0.00';
          console.log(
            `[進度] 累計 ${cumulativeAttempts} 輪｜通過 ${cumulativePassed}｜失敗 ${cumulativeFailed}｜成功率 ${pct}%｜約 ${rate.toFixed(0)} 輪／分鐘｜已跑 ${(elapsedMin * 60).toFixed(0)} 秒`,
          );
          lastProgressAt = now;
        }

        chunkIdx += 1;

        if (budget.mode === 'time' && Date.now() - tGlobal >= budget.ms) break;
      }

      const durationMs = Date.now() - tGlobal;
      const pctAll =
        cumulativeAttempts > 0
          ? ((100 * cumulativePassed) / cumulativeAttempts).toFixed(2)
          : '0.00';
      const rpmAll = durationMs > 0 ? (cumulativeAttempts / durationMs) * 60000 : 0;

      console.log('\n========== 訓練結束 ==========');
      console.log(`總時長：${(durationMs / 1000).toFixed(1)} 秒`);
      console.log(`總輪數：${cumulativeAttempts}（通過 ${cumulativePassed}／失敗 ${cumulativeFailed}）`);
      console.log(`整體成功率：${pctAll}%`);
      console.log(`平均吞吐：約 ${rpmAll.toFixed(0)} 輪／分鐘`);
      if (failureHints.length > 0) {
        console.log('若干失敗摘要（最多 12 則）：');
        failureHints.forEach((l) => console.log(`  - ${l}`));
      }

      expect(cumulativeAttempts).toBeGreaterThan(0);
      } finally {
        if (!verboseAgent) console.log = origLog;
      }
    },
    Math.min(
      43200000,
      Math.max(
        120000,
        (() => {
          const b = parseEnvMs();
          if (b.mode === 'time') return b.ms + 300000;
          const est = Math.max(600000, b.rounds * 40);
          return est;
        })(),
      ),
    ),
  );
});
