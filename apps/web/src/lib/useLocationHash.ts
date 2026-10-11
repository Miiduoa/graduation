'use client';

import { useSyncExternalStore } from 'react';

function subscribe(onChange: () => void) {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

function currentHash() {
  return window.location.hash;
}

function serverHash() {
  return '';
}

export function useLocationHash() {
  return useSyncExternalStore(subscribe, currentHash, serverHash);
}
