'use client';

import {
  PERSONAL_IMPORT_IMAGE_UNREADABLE,
  PERSONAL_IMPORT_OCR_CORE,
  PERSONAL_IMPORT_OCR_LANG,
  PERSONAL_IMPORT_OCR_LANGUAGES,
  PERSONAL_IMPORT_OCR_SCRIPT,
  PERSONAL_IMPORT_OCR_WORKER,
} from '@campus/shared';

type Worker = {
  recognize: (file: File) => Promise<{ data: { text: string } }>;
  setParameters: (parameters: Record<string, string>) => Promise<unknown>;
  terminate: () => Promise<unknown>;
};
type Engine = {
  createWorker: (
    language: string,
    engine: number,
    options: {
      logger: (entry: { status: string; progress: number }) => void;
      workerPath: string;
      corePath: string;
      langPath: string;
      workerBlobURL: boolean;
    },
  ) => Promise<Worker>;
};
let enginePromise: Promise<Engine> | null = null;

function loadEngine(): Promise<Engine> {
  if (enginePromise) return enginePromise;
  enginePromise = new Promise<Engine>((resolve, reject) => {
    const script = document.createElement('script');
    const timer = setTimeout(() => {
      script.remove();
      reject(new Error('辨識工具下載逾時，請確認網路後重試。'));
    }, 25_000);
    script.src = PERSONAL_IMPORT_OCR_SCRIPT;
    script.onload = () => {
      clearTimeout(timer);
      const engine = (window as unknown as { Tesseract?: Engine }).Tesseract;
      if (engine?.createWorker) resolve(engine);
      else reject(new Error('辨識工具未能啟動，請改貼文字或重試。'));
    };
    script.onerror = () => {
      clearTimeout(timer);
      script.remove();
      reject(new Error('辨識工具下載失敗，請確認網路後重試。'));
    };
    document.head.append(script);
  }).catch((error) => {
    enginePromise = null;
    throw error;
  });
  return enginePromise;
}

export async function recognizePersonalImportImage(
  file: File,
  signal: AbortSignal,
  progress: (message: string) => void,
): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
    throw new Error('請選 PNG、JPEG 或 WebP 圖片。');
  if (file.size > 10 * 1024 * 1024) throw new Error('圖片超過 10 MB，請裁切後再選一次。');
  let worker: Worker | null = null;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;
  let onAbort: () => void = () => {};
  const stop = new Promise<never>((_, reject) => {
    onAbort = () => {
      stopped = true;
      reject(new Error('已取消讀取，草稿沒有改變。'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => {
      stopped = true;
      reject(new Error('辨識超過兩分鐘，請裁切圖片或改貼文字。'));
    }, 120_000);
    if (signal.aborted) onAbort();
  });
  const recognize = async () => {
    try {
      const bitmap = await createImageBitmap(file);
      const pixels = bitmap.width * bitmap.height;
      bitmap.close();
      if (pixels > 24_000_000) throw new Error('圖片尺寸太大，請裁切到需要的表格後再試。');
    } catch (error) {
      if (error instanceof Error && error.message.includes('圖片尺寸太大')) throw error;
      throw new Error(PERSONAL_IMPORT_IMAGE_UNREADABLE);
    }
    if (stopped) throw new Error('已取消');
    progress('正在準備辨識工具…');
    const engine = await loadEngine();
    if (stopped) throw new Error('已取消');
    const created = await engine.createWorker(PERSONAL_IMPORT_OCR_LANGUAGES, 1, {
      workerPath: PERSONAL_IMPORT_OCR_WORKER,
      corePath: PERSONAL_IMPORT_OCR_CORE,
      langPath: PERSONAL_IMPORT_OCR_LANG,
      workerBlobURL: false,
      logger: (entry) => {
        if (!stopped && entry.status === 'recognizing text')
          progress(`正在讀取文字 ${Math.round(entry.progress * 100)}%`);
      },
    });
    if (stopped) {
      await created.terminate();
      throw new Error('已取消');
    }
    worker = created;
    await worker.setParameters({ preserve_interword_spaces: '1' });
    const result = await worker.recognize(file);
    return result.data.text;
  };
  try {
    return await Promise.race([recognize(), stop]);
  } finally {
    stopped = true;
    clearTimeout(timer!);
    signal.removeEventListener('abort', onAbort);
    if (worker) await (worker as Worker).terminate().catch(() => {});
  }
}
