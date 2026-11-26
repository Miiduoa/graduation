import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { waitForChromePort } from './credit-scenario-adoption-chrome.mjs';

async function fixture(t, code, binary = process.execPath) {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'credit-chrome-startup-test-'));
  const child = spawn(binary, ['-e', code, profile], { stdio: 'ignore' });
  t.after(async () => {
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      const closed = once(child, 'close');
      child.kill('SIGTERM');
      await closed;
    }
    await rm(profile, { recursive: true, force: true });
  });
  return { child, profile };
}

await test('Chrome startup remains bounded and reports process failures', { concurrency: 4 }, async (t) => {
  await Promise.all([
    t.test('accepts a valid port published after the former 10-second deadline', { timeout: 20000 }, async (t) => {
      const { child, profile } = await fixture(t, `
        const fs = require('node:fs');
        const path = require('node:path');
        setTimeout(() => fs.writeFileSync(path.join(process.argv[1], 'DevToolsActivePort'), '43210\\n/devtools/browser/fixture\\n'), 11000);
        setInterval(() => {}, 1000);
      `);
      assert.equal(await waitForChromePort(child, profile), '43210');
    }),
    t.test('reports a missing executable without waiting for the startup deadline', { timeout: 5000 }, async (t) => {
      const { child, profile } = await fixture(t, '', '/does-not-exist/credit-adoption-chrome');
      await assert.rejects(waitForChromePort(child, profile), /Chrome 啟動失敗：.*ENOENT/);
    }),
    t.test('reports an early exit code without waiting for the startup deadline', { timeout: 5000 }, async (t) => {
      const { child, profile } = await fixture(t, 'process.exit(42)');
      await assert.rejects(waitForChromePort(child, profile), /CDP 就緒前結束：exit=42, signal=none/);
    }),
    t.test('fails closed after 30 seconds when a live process never publishes a port', { timeout: 35000 }, async (t) => {
      const { child, profile } = await fixture(t, 'setInterval(() => {}, 1000)');
      const startedAt = Date.now();
      await assert.rejects(waitForChromePort(child, profile), /Chrome 啟動（30000ms 未收到有效 DevToolsActivePort/);
      assert.ok(Date.now() - startedAt >= 30000);
      assert.equal(child.exitCode, null);
    }),
  ]);
});
