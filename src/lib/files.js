function bytesToBase64(bytes) {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

export async function downloadBlob(blob, name) {
  const nativeBridge = window.webkit?.messageHandlers?.fileBridge
  if (nativeBridge) {
    const bytes = new Uint8Array(await blob.arrayBuffer())
    nativeBridge.postMessage({
      name,
      type: blob.type || 'application/octet-stream',
      data: bytesToBase64(bytes),
    })
    return
  }

  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

export function downloadFile(name, contents, type) {
  return downloadBlob(new Blob([contents], { type }), name)
}
