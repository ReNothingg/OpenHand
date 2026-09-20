import { useState } from "react";
export default function usePanelWidth(key: string) {
  const [width, setWidth] = useState(() => {
    try { const value = Number(localStorage.getItem(key)); return value >= 260 && value <= 600 ? value : 320; } catch { return 320; }
  });
  return [width, (value: number) => {
    setWidth(value);
    try { localStorage.setItem(key, String(value)); } catch { /* Optional preference. */ }
  }] as const;
}
