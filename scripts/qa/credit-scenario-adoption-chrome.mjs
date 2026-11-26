import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export async function waitForChromePort(child, profile) {
  // Hosted Chrome cold starts can exceed 10 seconds. Keep this bounded startup
  // allowance separate from the browser script's UI assertion waits.
  const timeoutMs = 30000;
  const startedAt = Date.now();
  let startupError;
  const onError = (error) => {
    startupError = new Error(`Chrome 啟動失敗：${error.message}`, { cause: error });
  };
  const onExit = (code, signal) => {
    startupError ??= new Error(`Chrome 在 CDP 就緒前結束：exit=${code}, signal=${signal || 'none'}`);
  };
  child.once('error', onError);
  child.once('exit', onExit);
  try {
    while (Date.now() - startedAt < timeoutMs) {
      if (startupError) throw startupError;
      if (child.exitCode !== null || child.signalCode !== null) {
        onExit(child.exitCode, child.signalCode);
        throw startupError;
      }
      try {
        const port = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0].trim();
        if (/^\d+$/.test(port) && Number(port) > 0 && Number(port) <= 65535) return port;
      } catch (error) {
        if (error.code !== 'ENOENT') throw new Error(`讀取 Chrome CDP 連接埠失敗：${error.message}`, { cause: error });
      }
      await delay(100);
    }
    if (startupError) throw startupError;
    throw new Error(`等待失敗：Chrome 啟動（${timeoutMs}ms 未收到有效 DevToolsActivePort；pid=${child.pid}, exit=${child.exitCode}, signal=${child.signalCode || 'none'}）`);
  } finally {
    child.removeListener('error', onError);
    child.removeListener('exit', onExit);
  }
}
