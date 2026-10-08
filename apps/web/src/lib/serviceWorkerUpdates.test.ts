import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activateServiceWorkerUpdate, observeServiceWorkerUpdates } from './serviceWorkerUpdates';

class Worker extends EventTarget {
  state: ServiceWorkerState = 'installing';
  postMessage = vi.fn();

  changeState(state: ServiceWorkerState) {
    this.state = state;
    this.dispatchEvent(new Event('statechange'));
  }
}

class Registration extends EventTarget {
  installing: Worker | null = null;
  waiting: Worker | null = null;
  active: Worker | null = null;
}

class Container extends EventTarget {
  controller: Worker | null = new Worker();
}

let registration: Registration;
let container: Container;
const asRegistration = () => registration as unknown as ServiceWorkerRegistration;

beforeEach(() => {
  registration = new Registration();
  container = new Container();
  vi.stubGlobal('navigator', { serviceWorker: container });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('update discovery', () => {
  it('announces an existing waiting update once and never activates it', () => {
    const worker = new Worker();
    worker.state = 'installed';
    registration.waiting = worker;
    const ready = vi.fn();
    const stop = observeServiceWorkerUpdates(asRegistration(), ready);
    registration.dispatchEvent(new Event('updatefound'));
    expect(ready).toHaveBeenCalledExactlyOnceWith(registration);
    expect(worker.postMessage).not.toHaveBeenCalled();
    stop();
  });

  it.each(['already installing', 'later updatefound'])('observes a worker %s', (timing) => {
    const worker = new Worker();
    if (timing === 'already installing') registration.installing = worker;
    const ready = vi.fn();
    const stop = observeServiceWorkerUpdates(asRegistration(), ready);
    registration.installing = worker;
    registration.dispatchEvent(new Event('updatefound'));
    expect(ready).not.toHaveBeenCalled();
    registration.waiting = worker;
    registration.installing = null;
    worker.changeState('installed');
    worker.dispatchEvent(new Event('statechange'));
    expect(ready).toHaveBeenCalledExactlyOnceWith(registration);
    expect(worker.postMessage).not.toHaveBeenCalled();
    stop();
  });

  it('does not offer an update for the first installation', () => {
    container.controller = null;
    const worker = new Worker();
    registration.installing = worker;
    const ready = vi.fn();
    const stop = observeServiceWorkerUpdates(asRegistration(), ready);
    registration.waiting = worker;
    worker.changeState('installed');
    expect(ready).not.toHaveBeenCalled();
    stop();
  });

  it('removes both registration and worker listeners on cleanup', () => {
    const worker = new Worker();
    registration.installing = worker;
    const ready = vi.fn();
    const stop = observeServiceWorkerUpdates(asRegistration(), ready);
    stop();
    registration.waiting = worker;
    worker.changeState('installed');
    registration.dispatchEvent(new Event('updatefound'));
    expect(ready).not.toHaveBeenCalled();
  });
});

describe('explicit update activation', () => {
  it('waits for the requested worker to control the page, not only activation', async () => {
    vi.useFakeTimers();
    const worker = new Worker();
    worker.state = 'installed';
    registration.waiting = worker;
    const settled = vi.fn();
    const activation = activateServiceWorkerUpdate(asRegistration()).then(settled);
    expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'SKIP_WAITING' });
    worker.changeState('activated');
    container.dispatchEvent(new Event('controllerchange'));
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    container.controller = worker;
    container.dispatchEvent(new Event('controllerchange'));
    await activation;
    expect(settled).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('registers the controller listener before posting the message', async () => {
    const worker = new Worker();
    registration.waiting = worker;
    worker.postMessage.mockImplementation(() => {
      container.controller = worker;
      container.dispatchEvent(new Event('controllerchange'));
    });
    await expect(activateServiceWorkerUpdate(asRegistration())).resolves.toBeUndefined();
  });

  it('allows an explicit reload when another tab already completed activation', async () => {
    registration.waiting = null;
    registration.active = container.controller;
    await expect(activateServiceWorkerUpdate(asRegistration())).resolves.toBeUndefined();
  });

  it('still waits if another tab has started activation but has not claimed this page', async () => {
    const worker = new Worker();
    worker.state = 'activating';
    registration.active = worker;
    const settled = vi.fn();
    const activation = activateServiceWorkerUpdate(asRegistration()).then(settled);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    expect(worker.postMessage).not.toHaveBeenCalled();
    container.controller = worker;
    container.dispatchEvent(new Event('controllerchange'));
    await activation;
    expect(settled).toHaveBeenCalledOnce();
  });

  it('rejects a stalled activation and removes listeners instead of reporting success', async () => {
    vi.useFakeTimers();
    const worker = new Worker();
    registration.waiting = worker;
    const removeContainerListener = vi.spyOn(container, 'removeEventListener');
    const removeWorkerListener = vi.spyOn(worker, 'removeEventListener');
    const failure = expect(activateServiceWorkerUpdate(asRegistration())).rejects.toThrow(
      '更新尚未完成',
    );
    await vi.advanceTimersByTimeAsync(15_000);
    await failure;
    expect(removeContainerListener).toHaveBeenCalledWith('controllerchange', expect.any(Function));
    expect(removeWorkerListener).toHaveBeenCalledWith('statechange', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cleans up when posting the activation message fails', async () => {
    vi.useFakeTimers();
    const worker = new Worker();
    registration.waiting = worker;
    worker.postMessage.mockImplementation(() => {
      throw new Error('worker unavailable');
    });
    const remove = vi.spyOn(container, 'removeEventListener');
    await expect(activateServiceWorkerUpdate(asRegistration())).rejects.toThrow('無法開始更新');
    expect(remove).toHaveBeenCalledWith('controllerchange', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects a worker that becomes redundant before controlling the page', async () => {
    vi.useFakeTimers();
    const worker = new Worker();
    registration.waiting = worker;
    const failure = expect(activateServiceWorkerUpdate(asRegistration())).rejects.toThrow(
      '新版本無法啟用',
    );
    worker.changeState('redundant');
    await failure;
    expect(vi.getTimerCount()).toBe(0);
  });
});
