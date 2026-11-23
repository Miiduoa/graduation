/** Subscribe only when the browser supplies a matching removal method. */
export function subscribeMediaQuery(
  media: MediaQueryList | null,
  listener: (event: MediaQueryListEvent) => void,
): () => void {
  if (!media) return () => {};

  if (
    typeof media.addEventListener === 'function' &&
    typeof media.removeEventListener === 'function'
  ) {
    return subscribe(
      () => media.addEventListener('change', listener),
      () => media.removeEventListener('change', listener),
    );
  }
  if (typeof media.addListener === 'function' && typeof media.removeListener === 'function') {
    return subscribe(
      () => media.addListener(listener),
      () => media.removeListener(listener),
    );
  }
  return () => {};
}

function subscribe(add: () => void, remove: () => void): () => void {
  try {
    add();
  } catch (error) {
    remove();
    throw error;
  }
  return remove;
}
