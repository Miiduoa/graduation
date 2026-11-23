import { subscribeMediaQuery } from './subscribeMediaQuery';

const INSET_PROPERTY = '--mobile-nav-measured-offset';

type RootInset = {
  observers: number;
  heights: Map<object, number>;
  previous: { value: string; priority: string } | null;
  applied: string | null;
};

// More than one shell can briefly exist during navigation. The remaining shell
// must keep its space when the outgoing one releases its measurement.
const rootInsets = new WeakMap<HTMLElement, RootInset>();

function publishInset(root: HTMLElement, state: RootInset) {
  if (state.heights.size) {
    if (!state.previous) {
      state.previous = {
        value: root.style.getPropertyValue(INSET_PROPERTY),
        priority: root.style.getPropertyPriority(INSET_PROPERTY),
      };
    }
    const value = `${Math.max(...state.heights.values())}px`;
    if (
      root.style.getPropertyValue(INSET_PROPERTY) !== value ||
      root.style.getPropertyPriority(INSET_PROPERTY)
    ) {
      root.style.setProperty(INSET_PROPERTY, value);
    }
    state.applied = value;
    return;
  }

  if (
    state.previous &&
    root.style.getPropertyValue(INSET_PROPERTY) === state.applied &&
    !root.style.getPropertyPriority(INSET_PROPERTY)
  ) {
    if (state.previous.value) {
      root.style.setProperty(INSET_PROPERTY, state.previous.value, state.previous.priority);
    } else {
      root.style.removeProperty(INSET_PROPERTY);
    }
  }
  state.previous = null;
  state.applied = null;
}

/** Reserve the mounted mobile bar's whole border box, including its safe area. */
export function observeMobileNavigationInset(navigation: HTMLElement): () => void {
  const root = navigation.ownerDocument.documentElement;
  const view = navigation.ownerDocument.defaultView;
  if (!view) return () => {};

  const media =
    typeof view.matchMedia === 'function' ? view.matchMedia('(max-width: 760px)') : null;
  let state = rootInsets.get(root);
  if (!state) {
    state = { observers: 0, heights: new Map(), previous: null, applied: null };
    rootInsets.set(root, state);
  }
  const inset = state;
  inset.observers += 1;
  const owner = {};
  let active = true;
  let observer: ResizeObserver | undefined;
  let unsubscribeMedia: (() => void) | undefined;

  const update = () => {
    if (!active) return;
    const mobile = media?.matches ?? view.innerWidth <= 760;
    const height = mobile && navigation.isConnected ? navigation.getBoundingClientRect().height : 0;
    if (Number.isFinite(height) && height > 0) {
      // Round outward so fractional CSS pixels never leave content under the bar.
      inset.heights.set(owner, Math.ceil(height));
    } else {
      inset.heights.delete(owner);
    }
    publishInset(root, inset);
  };

  const release = () => {
    if (!active) return;
    active = false;
    view.removeEventListener('resize', update);
    observer?.disconnect();
    unsubscribeMedia?.();
    inset.heights.delete(owner);
    publishInset(root, inset);
    inset.observers -= 1;
    if (!inset.observers) rootInsets.delete(root);
  };

  try {
    // Border-box observation also catches padding and safe-area changes.
    if (typeof ResizeObserver === 'function') {
      observer = new ResizeObserver(update);
      observer.observe(navigation, { box: 'border-box' });
    }
    view.addEventListener('resize', update);
    unsubscribeMedia = subscribeMediaQuery(media, update);
  } catch {
    release();
    return release;
  }
  update();
  return release;
}
