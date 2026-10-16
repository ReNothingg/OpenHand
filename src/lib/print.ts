/** Desktop shells print through their own dialogs; the browser uses window.print. */
export function requestPrint() {
  const platform = window.__openhandNativePlatform;
  if (platform === "macos" || platform === "windows") {
    window.dispatchEvent(new CustomEvent("openhand:print"));
    return;
  }
  window.print();
}
