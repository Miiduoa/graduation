'use client';

import { useSyncExternalStore } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

type InstallResult = 'idle' | 'accepted' | 'dismissed' | 'failed' | 'installed';
type InstallSnapshot = {
  ready: boolean;
  isIOS: boolean;
  installed: boolean;
  canPrompt: boolean;
  busy: boolean;
  dismissed: boolean;
  result: InstallResult;
};

const DISMISSED_KEY = 'pwa-install-dismissed';
const initial: InstallSnapshot = {
  ready: false,
  isIOS: false,
  installed: false,
  canPrompt: false,
  busy: false,
  dismissed: false,
  result: 'idle',
};

// Only browser capability and the one-use install event are shared. Keep them
// across route changes; installation preferences contain no account data.
let snapshot = initial;
let deferred: BeforeInstallPromptEvent | null = null;
let request = 0;
let stopListening: (() => void) | null = null;
const consumed = new WeakSet<BeforeInstallPromptEvent>();
const listeners = new Set<() => void>();

function update(change: Partial<InstallSnapshot>) {
  snapshot = { ...snapshot, ...change };
  listeners.forEach((listener) => listener());
}

function wasDismissed() {
  try {
    return Boolean(window.localStorage.getItem(DISMISSED_KEY));
  } catch {
    return false;
  }
}

function markInstalled() {
  request += 1;
  deferred = null;
  update({ installed: true, canPrompt: false, busy: false, result: 'installed' });
}

function listen() {
  const standalone = window.matchMedia?.('(display-mode: standalone)');
  const installed =
    snapshot.installed ||
    standalone?.matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const isIOS =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (installed && !snapshot.installed) {
    request += 1;
    deferred = null;
  }
  update({
    ready: true,
    isIOS,
    dismissed: snapshot.dismissed || wasDismissed(),
    installed,
    ...(installed ? { canPrompt: false, busy: false, result: 'installed' as const } : {}),
  });

  const onPrompt = (event: Event) => {
    const candidate = event as BeforeInstallPromptEvent;
    if (typeof candidate.prompt !== 'function' || !candidate.userChoice) return;
    event.preventDefault();
    if (snapshot.installed || consumed.has(candidate)) return;
    deferred = candidate;
    update({ canPrompt: true, result: snapshot.busy ? snapshot.result : 'idle' });
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === DISMISSED_KEY && event.newValue) update({ dismissed: true });
  };
  const onDisplayMode = (event: MediaQueryListEvent) => {
    if (event.matches) markInstalled();
  };
  window.addEventListener('beforeinstallprompt', onPrompt);
  window.addEventListener('appinstalled', markInstalled);
  window.addEventListener('storage', onStorage);
  standalone?.addEventListener?.('change', onDisplayMode);
  return () => {
    window.removeEventListener('beforeinstallprompt', onPrompt);
    window.removeEventListener('appinstalled', markInstalled);
    window.removeEventListener('storage', onStorage);
    standalone?.removeEventListener?.('change', onDisplayMode);
  };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!stopListening) stopListening = listen();
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      stopListening?.();
      stopListening = null;
    }
  };
}

function getSnapshot() {
  return snapshot;
}

function getServerSnapshot() {
  return initial;
}

export function dismissInstallSuggestion() {
  update({ dismissed: true });
  try {
    window.localStorage.setItem(DISMISSED_KEY, 'true');
  } catch {
    // Still respect the choice during this visit when storage is unavailable.
  }
}

export async function requestPwaInstallation() {
  const event = deferred;
  if (!event || snapshot.busy || snapshot.installed) return;
  const current = ++request;
  deferred = null;
  consumed.add(event);
  update({ busy: true, canPrompt: false, result: 'idle' });
  try {
    // Invoke prompt synchronously within the user's click. Both promises are
    // observed together, including browsers that reject either operation.
    const [, choice] = await Promise.all([event.prompt(), event.userChoice]);
    if (current !== request || snapshot.installed) return;
    update({ busy: false, canPrompt: Boolean(deferred), result: choice.outcome });
    dismissInstallSuggestion();
  } catch {
    if (current !== request || snapshot.installed) return;
    update({ busy: false, canPrompt: Boolean(deferred), result: 'failed' });
  }
}

export function usePwaInstallation() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
