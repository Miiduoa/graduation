const ACTIVATION_TIMEOUT_MS = 15_000;

export function observeServiceWorkerUpdates(
  registration: ServiceWorkerRegistration,
  onReady: (registration: ServiceWorkerRegistration) => void,
): () => void {
  const announced = new WeakSet<ServiceWorker>();
  const listeners = new Map<ServiceWorker, () => void>();

  const checkWaiting = () => {
    const worker = registration.waiting;
    if (!worker || !navigator.serviceWorker.controller || announced.has(worker)) return;
    announced.add(worker);
    onReady(registration);
  };
  const observeInstalling = () => {
    const worker = registration.installing;
    if (worker && !listeners.has(worker)) {
      const onStateChange = () => {
        checkWaiting();
        if (worker.state === 'activated' || worker.state === 'redundant') {
          worker.removeEventListener('statechange', onStateChange);
          listeners.delete(worker);
        }
      };
      listeners.set(worker, onStateChange);
      worker.addEventListener('statechange', onStateChange);
    }
    checkWaiting();
  };

  registration.addEventListener('updatefound', observeInstalling);
  observeInstalling();
  return () => {
    registration.removeEventListener('updatefound', observeInstalling);
    for (const [worker, listener] of listeners) worker.removeEventListener('statechange', listener);
    listeners.clear();
  };
}

/** Activate only after the user chooses to update; callers decide whether to reload. */
export function activateServiceWorkerUpdate(
  registration: ServiceWorkerRegistration,
): Promise<void> {
  const waiting = registration.waiting;
  const worker = waiting ?? registration.active;
  // Another tab may have started or completed the update while the banner was visible.
  if (!worker) return Promise.resolve();
  const container = navigator.serviceWorker;
  if (container.controller === worker) return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer);
      container.removeEventListener('controllerchange', onControllerChange);
      worker.removeEventListener('statechange', onStateChange);
      if (error) reject(error);
      else resolve();
    };
    const onControllerChange = () => {
      if (container.controller === worker) finish();
    };
    const onStateChange = () => {
      if (worker.state === 'redundant') finish(new Error('新版本無法啟用，請稍後再試。'));
    };
    const timer = setTimeout(
      () => finish(new Error('更新尚未完成，請稍後再試。')),
      ACTIVATION_TIMEOUT_MS,
    );

    container.addEventListener('controllerchange', onControllerChange);
    worker.addEventListener('statechange', onStateChange);
    if (worker.state === 'redundant') {
      onStateChange();
      return;
    }
    try {
      if (waiting) worker.postMessage({ type: 'SKIP_WAITING' });
    } catch {
      finish(new Error('無法開始更新，請稍後再試。'));
    }
  });
}
