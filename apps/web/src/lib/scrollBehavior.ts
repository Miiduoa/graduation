/** Read both preferences at the moment an action scrolls, without caching either. */
export function preferredScrollBehavior(): ScrollBehavior {
  if (typeof window === 'undefined' || typeof document === 'undefined') return 'instant';

  const reduced =
    document.documentElement.dataset.reducedMotion === 'true' ||
    (typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // `auto` can inherit CSS scroll-behavior: smooth from the scrolling element.
  // An explicit instant scroll also respects reduced motion in nested containers.
  return reduced ? 'instant' : 'smooth';
}
