/** Lifecycle shared by all native dialogs. Each document owns one scroll lock. */
type ScrollState = {
  dialogs: HTMLDialogElement[];
  overflow: string;
  overflowPriority: string;
};

const sessions = new WeakMap<Document, ScrollState>();

export function openModalSession(dialog: HTMLDialogElement, initialFocus?: HTMLElement | null) {
  const doc = dialog.ownerDocument;
  const previousFocus = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
  // showModal supplies the top layer, focus containment and an inert background.
  // Do not fall back to an open attribute: it would silently make this non-modal.
  dialog.showModal();
  let state = sessions.get(doc);
  if (!state) {
    state = {
      dialogs: [],
      overflow: doc.body.style.getPropertyValue('overflow'),
      overflowPriority: doc.body.style.getPropertyPriority('overflow'),
    };
    sessions.set(doc, state);
    doc.body.style.setProperty('overflow', 'hidden');
  }
  state.dialogs.push(dialog);
  if (initialFocus && dialog.contains(initialFocus)) initialFocus.focus({ preventScroll: true });

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const current = sessions.get(doc);
    const wasTop = current?.dialogs.at(-1) === dialog;
    const active = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
    if (current) current.dialogs = current.dialogs.filter((item) => item !== dialog);
    if (dialog.open) dialog.close();
    if (current && current.dialogs.length === 0) {
      doc.body.style.setProperty('overflow', current.overflow, current.overflowPriority);
      sessions.delete(doc);
    }
    // Removing a lower layer must not steal focus from the active dialog.
    const restore = wasTop ? previousFocus : active;
    const top = current?.dialogs.at(-1);
    if (restore?.isConnected && !restore.closest('dialog:not([open])') && (!top || top.contains(restore))) {
      restore.focus({ preventScroll: true });
    }
  };
}

/** A click that starts inside a dialog and ends outside is not a dismissal. */
export function isOutsideDialog(dialog: HTMLDialogElement, clientX: number, clientY: number) {
  const bounds = dialog.getBoundingClientRect();
  return clientX < bounds.left || clientX > bounds.right || clientY < bounds.top || clientY > bounds.bottom;
}
