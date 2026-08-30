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

interface Window {
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
