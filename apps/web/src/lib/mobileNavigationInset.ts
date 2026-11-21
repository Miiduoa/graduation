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

  let state = rootInsets.get(root);
  if (!state) {
    state = { observers: 0, heights: new Map(), previous: null, applied: null };
    rootInsets.set(root, state);
  }
  const inset = state;
  inset.observers += 1;
  const owner = {};
  const media =
    typeof view.matchMedia === 'function' ? view.matchMedia('(max-width: 760px)') : null;
  let active = true;

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

  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
  // Border-box observation also catches padding/safe-area changes, while label
  // wrapping and text preferences change the bar's natural height.
  observer?.observe(navigation, { box: 'border-box' });
  view.addEventListener('resize', update);
  media?.addEventListener('change', update);
  update();

  return () => {
    if (!active) return;
    active = false;
    observer?.disconnect();
    view.removeEventListener('resize', update);
    media?.removeEventListener('change', update);
    inset.heights.delete(owner);
    publishInset(root, inset);
    inset.observers -= 1;
    if (!inset.observers) rootInsets.delete(root);
  };
}
