const LOCK_WAIT_MS = 10_000;

/** Serialize device-local shortlist mutations across same-origin tabs. */
export async function withCampusEventShortlistLock<T>(
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  if (navigator.locks?.request) return navigator.locks.request(key, operation);

  // A readwrite transaction is exclusive across connections to the same object store.
  // This database contains no user data; the list itself stays in the existing localStorage key.
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('nuni-campus-event-shortlist-locks', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('write-lock');
    let abandoned = false;
    const timeout = setTimeout(() => {
      abandoned = true;
      reject(new Error('Event shortlist database open timed out'));
    }, LOCK_WAIT_MS);
    request.onblocked = () => {
      abandoned = true;
      clearTimeout(timeout);
      reject(new Error('Event shortlist database upgrade blocked'));
    };
    request.onsuccess = () => {
      clearTimeout(timeout);
      const connection = request.result;
      if (abandoned) {
        // A rejected open can still succeed later; never leave that connection open.
        connection.close();
        return;
      }
      connection.onversionchange = () => connection.close();
      resolve(connection);
    };
    request.onerror = () => {
      clearTimeout(timeout);
      reject(request.error);
    };
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction('write-lock', 'readwrite');
      const lock = tx.objectStore('write-lock');
      const first = lock.get(0);
      let value: T;
      let acquired = false;
      let abandoned = false;
      const timeout = setTimeout(() => {
        abandoned = true;
        reject(new Error('Event shortlist lock acquisition timed out'));
        try { tx.abort(); } catch { /* The transaction may already be inactive. */ }
      }, LOCK_WAIT_MS);
      tx.oncomplete = () => {
        clearTimeout(timeout);
        if (acquired) resolve(value);
        else reject(new Error('Event shortlist lock completed before acquisition'));
      };
      tx.onabort = () => {
        abandoned = true;
        clearTimeout(timeout);
        reject(tx.error ?? new Error('Could not acquire the event shortlist lock'));
      };

      // The first successful request means this tab has acquired the transaction.
      first.onsuccess = () => {
        if (abandoned) return;
        acquired = true;
        // Once the operation starts, do not time out a write that may already have committed.
        clearTimeout(timeout);
        let done = false;
        function hold() {
          if (!done) lock.get(0).onsuccess = hold;
        }
        hold();
        Promise.resolve()
          .then(operation)
          .then(
            (result) => {
              value = result;
              done = true;
            },
            (error: unknown) => {
              done = true;
              reject(error);
            },
          );
      };
    });
  } finally {
    db.close();
  }
}
