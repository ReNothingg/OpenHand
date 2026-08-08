function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

export async function downloadBlob(blob: Blob, name: string) {
  const nativeBridge = window.__openhandFileBridge
  if (nativeBridge?.save) {
    const bytes = new Uint8Array(await blob.arrayBuffer())
    try {
      const result = await nativeBridge.save({
        name, type: blob.type || 'application/octet-stream', data: bytesToBase64(bytes),
      })
      window.dispatchEvent(new CustomEvent('openhand:save-result', { detail: { name, ...result } }))
    } catch (error) {
      window.dispatchEvent(new CustomEvent('openhand:save-result', {
        detail: { name, saved: false, error: error instanceof Error ? error.message : 'Не удалось сохранить файл.' },
      }))
    }
    return
  }

  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
  window.dispatchEvent(new CustomEvent('openhand:save-result', { detail: { name, saved: true } }))
}

export function downloadFile(name: string, contents: string, type: string) {
  return downloadBlob(new Blob([contents], { type }), name)
}
