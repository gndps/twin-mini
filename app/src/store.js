// Photos and picture stickers are kept in this browser's IndexedDB so a reload brings them back.
// Every call fails quietly (private windows, storage off): the app then just forgets them.

let dbp = null;
function db() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open('twinmini', 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('photos');
        req.result.createObjectStore('assets');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).catch(() => null);
  }
  return dbp;
}
async function run(store, mode, fn) {
  try {
    const d = await db();
    if (!d) return null;
    return await new Promise((resolve, reject) => {
      const tx = d.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(req?.result ?? null);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch { return null; }
}

export const putBlob = (store, key, value) => run(store, 'readwrite', (s) => s.put(value, key));
export const deleteBlob = (store, key) => run(store, 'readwrite', (s) => s.delete(key));
export const getBlob = (store, key) => run(store, 'readonly', (s) => s.get(key));
export const allKeys = (store) => run(store, 'readonly', (s) => s.getAllKeys());
