export function loadStoredObject(key, fallback) {
  try {
    const stored = localStorage.getItem(key)
    return stored ? { ...fallback, ...JSON.parse(stored) } : fallback
  } catch {
    return fallback
  }
}

export function loadStoredText(key, fallback) {
  return localStorage.getItem(key) || fallback
}
