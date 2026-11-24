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
    let blocked = false;
    request.onblocked = () => {
      blocked = true;
      reject(new Error('Event shortlist database upgrade blocked'));
    };
    request.onsuccess = () => {
      const connection = request.result;
      if (blocked) {
        // A rejected open can still succeed later; never leave that connection open.
        connection.close();
        return;
      }
      connection.onversionchange = () => connection.close();
      resolve(connection);
    };
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction('write-lock', 'readwrite');
      const lock = tx.objectStore('write-lock');
      let value: T;
      tx.oncomplete = () => resolve(value);
      tx.onabort = () =>
        reject(tx.error ?? new Error('Could not acquire the event shortlist lock'));

      // The first successful request means this tab has acquired the transaction.
      lock.get(0).onsuccess = () => {
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
