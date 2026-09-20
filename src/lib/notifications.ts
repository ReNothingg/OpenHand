export async function enablePlotterNotifications(): Promise<boolean> {
  if (window.__openhandNotificationBridge) {
    const result = await window.__openhandNotificationBridge.enable();
    return Boolean(result.granted);
  }
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const permission = await new Promise<NotificationPermission>((resolve, reject) => {
    // Older Safari exposes the callback API; newer browsers return a Promise.
    const request = Notification.requestPermission(resolve);
    request?.then(resolve, reject);
  });
  return permission === "granted";
}

export async function notifyPlotter(title: string, body: string) {
  if (window.__openhandNotificationBridge) {
    await window.__openhandNotificationBridge.show(title, body);
  } else if (
    "Notification" in window &&
    Notification.permission === "granted"
  ) {
    new Notification(title, {
      body,
      tag: "openhand-paper",
      requireInteraction: true,
    });
  }
}
