import { DEFAULT_PLOTTER_CONFIG } from "./job";

export const PLOTTER_PROFILES_KEY = "openhand.plotter.profiles.v1";
export const LEGACY_PLOTTER_SETTINGS_KEY = "openhand.plotter.settings.v1";
export const PLOTTER_PROFILES_VERSION = 1;

const PROFILE_NAMES = {
  grbl: "GRBL",
  marlin: "Marlin",
  ebb: "EBB / DrawCore",
};

function clamp(value: unknown, min: number, max: number, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.min(max, Math.max(min, number))
    : fallback;
}

function boolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function profileId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `plotter-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function normalizePlotterConfig(incoming: Record<string, any> = {}) {
  const profile = ["grbl", "marlin", "ebb"].includes(incoming.profile)
    ? incoming.profile
    : DEFAULT_PLOTTER_CONFIG.profile;
  const penModes =
    profile === "ebb"
      ? ["servo"]
      : profile === "marlin"
        ? ["servo", "stepper", "estepper"]
        : ["servo", "stepper", "laser"];
  const servoMax = profile === "marlin" ? 180 : 32767;
  const fallbackPenUp =
    profile === "marlin" ? 50 : DEFAULT_PLOTTER_CONFIG.penUp;
  const fallbackPenDown =
    profile === "marlin" ? 0 : DEFAULT_PLOTTER_CONFIG.penDown;

  return {
    ...DEFAULT_PLOTTER_CONFIG,
    profile,
    baudRate: [9600, 115200, 250000].includes(Number(incoming.baudRate))
      ? Number(incoming.baudRate)
      : DEFAULT_PLOTTER_CONFIG.baudRate,
    feedRate: clamp(
      incoming.feedRate,
      1,
      10000,
      DEFAULT_PLOTTER_CONFIG.feedRate,
    ),
    jogSpeed: clamp(
      incoming.jogSpeed,
      1,
      10000,
      DEFAULT_PLOTTER_CONFIG.jogSpeed,
    ),
    jogDistance: clamp(
      incoming.jogDistance,
      0.1,
      50,
      DEFAULT_PLOTTER_CONFIG.jogDistance,
    ),
    penMode: penModes.includes(incoming.penMode) ? incoming.penMode : "servo",
    penUp: clamp(incoming.penUp, 0, servoMax, fallbackPenUp),
    penDown: clamp(incoming.penDown, 0, servoMax, fallbackPenDown),
    zUp: clamp(incoming.zUp, -50, 50, DEFAULT_PLOTTER_CONFIG.zUp),
    zDown: clamp(incoming.zDown, -50, 50, DEFAULT_PLOTTER_CONFIG.zDown),
    zSpeed: clamp(incoming.zSpeed, 1, 10000, DEFAULT_PLOTTER_CONFIG.zSpeed),
    laserPower: clamp(
      incoming.laserPower,
      0,
      1000,
      DEFAULT_PLOTTER_CONFIG.laserPower,
    ),
    mmToSteps: clamp(
      incoming.mmToSteps,
      1,
      1000,
      DEFAULT_PLOTTER_CONFIG.mmToSteps,
    ),
    penDelay: clamp(incoming.penDelay, 0, 10, DEFAULT_PLOTTER_CONFIG.penDelay),
    letterSpacing: clamp(
      incoming.letterSpacing,
      0,
      20,
      DEFAULT_PLOTTER_CONFIG.letterSpacing,
    ),
    optimizePath: boolean(
      incoming.optimizePath,
      DEFAULT_PLOTTER_CONFIG.optimizePath,
    ),
    workAreaWidth: clamp(incoming.workAreaWidth, 20, 2000, 330),
    workAreaHeight: clamp(incoming.workAreaHeight, 20, 2000, 203),
    calibrationStep: clamp(incoming.calibrationStep, 0.1, 5, 1),
  };
}

export function createPlotterProfile(
  name: unknown,
  config: Record<string, any> = {},
  options: Record<string, any> = {},
) {
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const normalizedConfig = normalizePlotterConfig(config);
  return {
    id: typeof options.id === "string" && options.id ? options.id : profileId(),
    name:
      String(name || PROFILE_NAMES[normalizedConfig.profile] || "Плоттер")
        .trim()
        .slice(0, 64) || "Плоттер",
    config: normalizedConfig,
    calibratedAt: Number.isFinite(options.calibratedAt)
      ? options.calibratedAt
      : null,
    createdAt: Number.isFinite(options.createdAt) ? options.createdAt : now,
    updatedAt: Number.isFinite(options.updatedAt) ? options.updatedAt : now,
  };
}

export function normalizePlotterProfile(
  incoming: Record<string, any>,
  options: Record<string, any> = {},
) {
  if (!incoming || typeof incoming !== "object") {
    throw new Error("Файл не содержит профиль плоттера.");
  }
  const config =
    incoming.config && typeof incoming.config === "object"
      ? incoming.config
      : incoming;
  return createPlotterProfile(incoming.name, config, {
    ...options,
    calibratedAt: incoming.calibratedAt,
    createdAt: incoming.createdAt,
    updatedAt: incoming.updatedAt,
  });
}

export function createPlotterProfileStore(
  rawStore: any,
  legacyConfig: any,
  options: Record<string, any> = {},
) {
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  if (
    rawStore?.version === PLOTTER_PROFILES_VERSION &&
    Array.isArray(rawStore.profiles) &&
    rawStore.profiles.length
  ) {
    const profiles = rawStore.profiles.map((profile) =>
      normalizePlotterProfile(profile, {
        id: typeof profile?.id === "string" ? profile.id : undefined,
        now,
      }),
    );
    const activeProfileId = profiles.some(
      (profile) => profile.id === rawStore.activeProfileId,
    )
      ? rawStore.activeProfileId
      : profiles[0].id;
    return { version: PLOTTER_PROFILES_VERSION, activeProfileId, profiles };
  }

  const profile = createPlotterProfile("Текущий плоттер", legacyConfig || {}, {
    now,
  });
  return {
    version: PLOTTER_PROFILES_VERSION,
    activeProfileId: profile.id,
    profiles: [profile],
  };
}

type ProfileStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function browserStorage(): ProfileStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadPlotterProfileStore(
  storage: ProfileStorage | null = browserStorage(),
) {
  let rawStore = null;
  let legacyConfig = null;
  try {
    rawStore = JSON.parse(storage.getItem(PLOTTER_PROFILES_KEY) || "null");
  } catch {
    rawStore = null;
  }
  try {
    legacyConfig = JSON.parse(
      storage.getItem(LEGACY_PLOTTER_SETTINGS_KEY) || "null",
    );
  } catch {
    legacyConfig = null;
  }

  const store = createPlotterProfileStore(rawStore, legacyConfig);
  if (!storage) return store;
  try {
    storage.setItem(PLOTTER_PROFILES_KEY, JSON.stringify(store));
    storage.removeItem(LEGACY_PLOTTER_SETTINGS_KEY);
  } catch {
    // The app remains usable in private mode or after local storage is full.
  }
  return store;
}

export function serializePlotterProfile(profile) {
  return JSON.stringify(
    {
      format: "openhand-plotter-profile",
      version: PLOTTER_PROFILES_VERSION,
      profile,
    },
    null,
    2,
  );
}

export function parsePlotterProfile(value) {
  const document = typeof value === "string" ? JSON.parse(value) : value;
  if (
    document?.format !== "openhand-plotter-profile" ||
    document?.version !== PLOTTER_PROFILES_VERSION
  ) {
    throw new Error("Это не профиль плоттера OpenHand версии 1.");
  }
  return normalizePlotterProfile(document.profile);
}

export function safeProfileFilename(name) {
  const safe = String(name || "plotter")
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60);
  return `${safe || "plotter"}.openhand-plotter.json`;
}
