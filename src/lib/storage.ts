type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function availableStorage(): StorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadStoredObject<T extends Record<string, unknown>>(
  key: string,
  fallback: T,
  storage: StorageLike | null = availableStorage(),
): T {
  try {
    const stored = storage?.getItem(key);
    const value = stored ? JSON.parse(stored) : null;
    return value && typeof value === "object" && !Array.isArray(value)
      ? { ...fallback, ...value }
      : fallback;
  } catch {
    return fallback;
  }
}

export function loadStoredText(
  key: string,
  fallback: string,
  storage: StorageLike | null = availableStorage(),
) {
  try {
    return storage?.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

export function saveStoredValues(
  values: Record<string, string>,
  storage: StorageLike | null = availableStorage(),
) {
  if (!storage) return false;
  try {
    Object.entries(values).forEach(([key, value]) => storage.setItem(key, value));
    return true;
  } catch {
    return false;
  }
}

export function removeStoredValue(
  key: string,
  storage: StorageLike | null = availableStorage(),
) {
  if (!storage) return false;
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
