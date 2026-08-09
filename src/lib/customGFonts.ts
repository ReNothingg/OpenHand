const DATABASE_NAME = "openhand-font-library";
const DATABASE_VERSION = 1;
const STORE_NAME = "gfonts";

interface StoredGFont {
  id: string;
  name: string;
  size: number;
  updatedAt: number;
  buffer: ArrayBuffer;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadStoredGFonts(): Promise<StoredGFont[]> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const records = await requestResult<StoredGFont[]>(
      transaction.objectStore(STORE_NAME).getAll(),
    );
    return records.sort((left, right) => right.updatedAt - left.updatedAt);
  } finally {
    database.close();
  }
}

export async function saveStoredGFont(
  name: string,
  buffer: ArrayBuffer,
): Promise<StoredGFont> {
  const existing = (await loadStoredGFonts()).find(
    (record) =>
      record.name.toLocaleLowerCase("ru") === name.toLocaleLowerCase("ru"),
  );
  const generatedId =
    globalThis.crypto?.randomUUID?.() ||
    `font-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const record = {
    id: existing?.id || generatedId,
    name,
    size: buffer.byteLength,
    updatedAt: Date.now(),
    buffer,
  };
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(record);
    await transactionDone(transaction);
    return record;
  } finally {
    database.close();
  }
}
