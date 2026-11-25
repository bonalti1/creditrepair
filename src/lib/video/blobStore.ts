"use client";

// The demo's file store (no database): the clips, pictures, music and
// exports a person adds stay in THIS browser (IndexedDB), under keys like
// "idb:md_…". Nothing is uploaded. If the browser blocks storage (a private
// window), files last for this visit only (an in-memory map), and the screen
// says so where it matters.

const DB_NAME = "credalti-video-studio";
const STORE = "files";
const memory = new Map<string, Blob>();

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function putBlob(key: string, blob: Blob): Promise<"kept" | "memory"> {
  memory.set(key, blob);
  const db = await open();
  if (!db) return "memory";
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(blob, key);
      tx.oncomplete = () => resolve("kept");
      tx.onerror = () => resolve("memory");
      tx.onabort = () => resolve("memory");
    } catch {
      resolve("memory");
    }
  });
}

export async function getBlob(key: string): Promise<Blob | null> {
  const known = memory.get(key);
  if (known) return known;
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      request.onsuccess = () => {
        const value = request.result as Blob | undefined;
        if (value) memory.set(key, value);
        resolve(value ?? null);
      };
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function deleteBlob(key: string): Promise<void> {
  memory.delete(key);
  const db = await open();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** Forget every file of the demo (the demo's reset). */
export async function clearBlobs(): Promise<void> {
  memory.clear();
  const db = await open();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}
