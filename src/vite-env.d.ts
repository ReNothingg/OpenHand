/// <reference types="vite/client" />

interface OpenHandFilePayload {
  content?: string;
  data?: string;
  name?: string;
  path?: string;
}

interface OpenHandSaveResult {
  saved?: boolean;
  cancelled?: boolean;
  name?: string;
  error?: string;
}

declare const __OPENHAND_BUILD__: { revision: string; modified: boolean; builtAt: string };

interface Window {
  __openhandBridgeVersion?: number;
  __openhandGetSessionState?: () => Promise<{ emergencyStopped: boolean; stopPending?: boolean; stopError?: string }>;
  __openhandReleaseEmergencyStop?: () => Promise<unknown>;
  __openhandEmergencyStop?: (profile: string) => Promise<{ sent: boolean }>;
  __openhandNotificationBridge?: {
    enable: () => Promise<{ granted: boolean }>;
    show: (title: string, body: string) => Promise<unknown>;
  };
  __openhandNativePlatform?: "macos" | "windows";
  __openhandFileBridge?: {
    save?: (file: {
      name: string;
      type: string;
      data: string;
    }) => Promise<OpenHandSaveResult>;
  };
  __openhandPendingFile?: OpenHandFilePayload | null;
  __openhandReceiveFile?: (payload: OpenHandFilePayload) => void;
  webkit?: {
    messageHandlers?: {
      serialBridge?: unknown;
      [name: string]: unknown;
    };
  };
}

interface Navigator {
  serial: {
    requestPort(options?: {
      openhandNetwork?: { host: string; port: number };
    }): Promise<any>;
    addEventListener(type: string, listener: EventListener): void;
    removeEventListener(type: string, listener: EventListener): void;
  };
}

interface WindowEventMap {
  "openhand:open-file": CustomEvent<OpenHandFilePayload>;
  "openhand:save-result": CustomEvent<OpenHandSaveResult>;
}
