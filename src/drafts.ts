export type Draft = { original: Blob; thumb: Blob; requestId: string };

function open() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('afterglow', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('captures');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

async function transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction('captures', mode);
      const operation = action(tx.objectStore('captures'));
      tx.oncomplete = () => resolve(operation.result);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}

export const getDraft = (id: string) => transaction<Draft | undefined>('readonly', (store) => store.get(id));
export const saveDraft = (id: string, draft: Draft) => transaction('readwrite', (store) => store.put(draft, id));
export const clearDraft = (id: string, requestId: string) => transaction('readwrite', (store) => {
  const lookup: IDBRequest<Draft | undefined> = store.get(id);
  lookup.onsuccess = () => {
    if (lookup.result?.requestId === requestId) store.delete(id);
  };
  return lookup;
});
