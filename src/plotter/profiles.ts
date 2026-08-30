import { DEFAULT_PLOTTER_CONFIG } from "./job";

export const PLOTTER_PROFILES_KEY = "openhand.plotter.profiles.v1";
export const LEGACY_PLOTTER_SETTINGS_KEY = "openhand.plotter.settings.v1";
export const PLOTTER_PROFILES_VERSION = 1;

const PROFILE_NAMES = {
  grbl: "GRBL",
  marlin: "Marlin",
  ebb: "EBB / DrawCore",
};

export const PLOTTER_DEVICE_PRESETS = [
  {
    id: "ozon-kdraw-grbl",
    name: "Ozon / KDraw · GRBL",
    description:
      "Профиль купленного плоттера: 115200 бод, серво 12000/18000, ноль слева сверху.",
    config: {
      profile: "grbl",
      connectionType: "serial",
      baudRate: 115200,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      flowControl: "none",
      feedRate: 1500,
      jogSpeed: 2500,
      penMode: "servo",
      penUp: 12000,
      penDown: 18000,
      penUpDelay: 0.2,
      penDownDelay: 0.2,
      startPosition: "left-top",
      swapAxes: false,
      invertX: false,
      invertY: false,
      autoSetOrigin: true,
      returnToOrigin: true,
      workAreaWidth: 330,
      workAreaHeight: 203,
    },
  },
  {
    id: "kdraw-marlin",
    name: "KDraw · Marlin",
    description:
      "Совместимый профиль Marlin: 250000 бод, серво 50/0, ноль слева сверху.",
    config: {
      profile: "marlin",
      connectionType: "serial",
      baudRate: 250000,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      flowControl: "none",
      penMode: "servo",
      penUp: 50,
      penDown: 0,
      startPosition: "left-top",
      autoSetOrigin: true,
      returnToOrigin: true,
    },
  },
  {
    id: "kdraw-ebb",
    name: "KDraw · EBB / DrawCore",
    description:
      "Совместимый относительный профиль EBB со 100 шагами на миллиметр.",
    config: {
      profile: "ebb",
      connectionType: "serial",
      baudRate: 115200,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      flowControl: "none",
      penMode: "servo",
      mmToSteps: 100,
      penUp: 12000,
      penDown: 18000,
      startPosition: "left-top",
      autoSetOrigin: false,
      returnToOrigin: false,
    },
  },
] as const;

function clamp(value: unknown, min: number, max: number, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.min(max, Math.max(min, number))
    : fallback;
}

function boolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function option<T extends string | number>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
) {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function commandText(value: unknown) {
  return typeof value === "string" ? value.slice(0, 8192) : "";
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
  const legacyPenDelay = clamp(
    incoming.penDelay,
    0,
    10,
    DEFAULT_PLOTTER_CONFIG.penDelay,
  );

  return {
    ...DEFAULT_PLOTTER_CONFIG,
    fontId:
      typeof incoming.fontId === "string" && incoming.fontId
        ? incoming.fontId.slice(0, 160)
        : DEFAULT_PLOTTER_CONFIG.fontId,
    profile,
    connectionType: option(
      incoming.connectionType,
      ["serial", "network"],
      DEFAULT_PLOTTER_CONFIG.connectionType,
    ),
    networkHost:
      typeof incoming.networkHost === "string"
        ? incoming.networkHost.trim().slice(0, 253)
        : DEFAULT_PLOTTER_CONFIG.networkHost,
    networkPort: clamp(
      incoming.networkPort,
      1,
      65535,
      DEFAULT_PLOTTER_CONFIG.networkPort,
    ),
    baudRate: [9600, 115200, 250000].includes(Number(incoming.baudRate))
      ? Number(incoming.baudRate)
      : DEFAULT_PLOTTER_CONFIG.baudRate,
    dataBits: option(
      Number(incoming.dataBits),
      [7, 8],
      DEFAULT_PLOTTER_CONFIG.dataBits,
    ),
    stopBits: option(
      Number(incoming.stopBits),
      [1, 2],
      DEFAULT_PLOTTER_CONFIG.stopBits,
    ),
    parity: option(
      incoming.parity,
      ["none", "even", "odd"],
      DEFAULT_PLOTTER_CONFIG.parity,
    ),
    flowControl: option(
      incoming.flowControl,
      ["none", "hardware"],
      DEFAULT_PLOTTER_CONFIG.flowControl,
    ),
    connectionTimeoutMs: clamp(
      incoming.connectionTimeoutMs,
      1000,
      60000,
      DEFAULT_PLOTTER_CONFIG.connectionTimeoutMs,
    ),
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
    penDelay: legacyPenDelay,
    penUpDelay: clamp(
      incoming.penUpDelay,
      0,
      10,
      legacyPenDelay,
    ),
    penDownDelay: clamp(
      incoming.penDownDelay,
      0,
      10,
      legacyPenDelay,
    ),
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
    startPosition: option(
      incoming.startPosition,
      ["left-top", "right-top", "left-bottom", "right-bottom"],
      DEFAULT_PLOTTER_CONFIG.startPosition,
    ),
    swapAxes: boolean(incoming.swapAxes, DEFAULT_PLOTTER_CONFIG.swapAxes),
    invertX: boolean(incoming.invertX, DEFAULT_PLOTTER_CONFIG.invertX),
    invertY: boolean(incoming.invertY, DEFAULT_PLOTTER_CONFIG.invertY),
    autoSetOrigin: boolean(
      incoming.autoSetOrigin,
      DEFAULT_PLOTTER_CONFIG.autoSetOrigin,
    ),
    returnToOrigin: boolean(
      incoming.returnToOrigin,
      DEFAULT_PLOTTER_CONFIG.returnToOrigin,
    ),
    customStartGcode: commandText(incoming.customStartGcode),
    customEndGcode: commandText(incoming.customEndGcode),
    workAreaWidth: clamp(incoming.workAreaWidth, 20, 2000, 330),
    workAreaHeight: clamp(incoming.workAreaHeight, 20, 2000, 203),
    calibrationStep: clamp(incoming.calibrationStep, 0.1, 5, 1),
  };
}

export function configFromDevicePreset(
  presetId: string,
  current: Record<string, any> = {},
) {
  const preset = PLOTTER_DEVICE_PRESETS.find((item) => item.id === presetId);
  if (!preset) throw new Error("Неизвестный профиль совместимости.");
  return normalizePlotterConfig({ ...current, ...preset.config });
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
