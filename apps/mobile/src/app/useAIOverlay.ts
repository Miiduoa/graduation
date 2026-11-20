/**
 * useAIOverlay — 全域 AI 覆蓋層狀態
 * ═══════════════════════════════════════════════════════════════════════
 * AI 球（FAB）+ AI Chat Overlay + 長按面板 共用同一個 singleton store。
 * 任何畫面都能呼叫 openAIOverlay({ prompt }) 直接帶 prompt 開啟。
 */

import { useEffect, useState } from 'react';

export type AIOverlayMode = 'chat' | 'quick' | 'insights';

export interface AIOverlayState {
  visible: boolean;
  mode: AIOverlayMode;
  initialPrompt?: string;
  /** 推播「AI 主動」等：對應 AIChatScreen route.params.proactiveReportId */
  proactiveReportId?: string;
  /** 開啟原因（埋點用） */
  source?: string;
}

type Listener = (state: AIOverlayState) => void;

const state: AIOverlayState = {
  visible: false,
  mode: 'chat',
  initialPrompt: undefined,
  proactiveReportId: undefined,
  source: undefined,
};

const listeners = new Set<Listener>();

function notify() {
  for (const l of listeners) {
    try {
      l({ ...state });
    } catch (err) {
      console.warn('[useAIOverlay] listener failed:', err);
    }
  }
}

export const aiOverlay = {
  open(opts?: {
    mode?: AIOverlayMode;
    prompt?: string;
    source?: string;
    proactiveReportId?: string;
  }) {
    state.visible = true;
    state.mode = opts?.mode ?? 'chat';
    state.initialPrompt = opts?.prompt;
    state.proactiveReportId = opts?.proactiveReportId;
    state.source = opts?.source;
    notify();
  },
  close() {
    state.visible = false;
    state.initialPrompt = undefined;
    state.proactiveReportId = undefined;
    state.source = undefined;
    notify();
  },
  toggle(opts?: { mode?: AIOverlayMode; prompt?: string; proactiveReportId?: string }) {
    if (state.visible) {
      this.close();
    } else {
      this.open(opts);
    }
  },
  setMode(mode: AIOverlayMode) {
    state.mode = mode;
    notify();
  },
  getState(): AIOverlayState {
    return { ...state };
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    listener({ ...state });
    return () => listeners.delete(listener);
  },
};

export function useAIOverlay(): AIOverlayState & {
  open: typeof aiOverlay.open;
  close: typeof aiOverlay.close;
  setMode: typeof aiOverlay.setMode;
} {
  const [snapshot, setSnapshot] = useState<AIOverlayState>(() => aiOverlay.getState());

  useEffect(() => {
    return aiOverlay.subscribe(setSnapshot);
  }, []);

  return {
    ...snapshot,
    open: aiOverlay.open.bind(aiOverlay),
    close: aiOverlay.close.bind(aiOverlay),
    setMode: aiOverlay.setMode.bind(aiOverlay),
  };
}
