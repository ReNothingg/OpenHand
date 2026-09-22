export const GRBL_SETTINGS_REQUIRED = [1, 2, 3, 4, 13, 100, 101, 102];
const AXIS_KEYS = [2, 3, 4, 20, 21, 22, 23, 35, 100, 101, 110, 111, 120, 121, 130, 131];
const PEN_KEYS = [1, 2, 3, 4, 35, 102, 112, 122, 132];

/** Read-only compatibility marker, never a command to change firmware settings. */
export function controllerFingerprint(profile: string, settings: Record<number, number>, complete: boolean, kind: "axes" | "pen"): string | null {
  if (profile !== "grbl") return `${profile}:manual-v1`;
  if (!complete) return null;
  const required = kind === "axes" ? [2, 3, 4, 100, 101] : [1, 2, 3, 4, 102];
  if (required.some(key => !Number.isFinite(settings[key]))) return null;
  const keys = kind === "axes" ? AXIS_KEYS : PEN_KEYS;
  return `grbl:${kind}:v1:` + keys.map(key => `${key}=${Number.isFinite(settings[key]) ? settings[key] : "absent"}`).join(";");
}

export function matchesControllerCalibration(profile: any, key: string | null): boolean {
  if (!profile.calibratedAt) return false;
  if (profile.config.profile !== "grbl") return true;
  return key !== null && profile.calibrationControllerKey === key;
}
