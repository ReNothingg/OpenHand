/** Time requested by an explicit dwell is not a lost acknowledgement. */
export function acknowledgementTimeout(command: string, profile: string, base: number): number {
  if (!/(?:^|[^0-9.])G0?4(?=[^0-9.]|$)/i.test(command)) return base;
  const p = /P\s*([+]?(?:\d+(?:\.\d*)?|\.\d+))/i.exec(command);
  const s = /S\s*([+]?(?:\d+(?:\.\d*)?|\.\d+))/i.exec(command);
  const duration = profile === "marlin" ? (s ? Number(s[1]) * 1000 : Number(p?.[1] || 0)) : Number(p?.[1] || 0) * 1000;
  return Number.isFinite(duration) ? Math.min(2_147_000_000, Math.max(base, duration + 5000)) : base;
}

export function controllerStillBusy(report: { state: string; receivedAt: number } | null, now = Date.now()): boolean {
  return Boolean(report && now - report.receivedAt <= 3000 && /^(Run|Jog|Home|Hold(?::\d+)?|Door(?::\d+)?)$/.test(report.state));
}
