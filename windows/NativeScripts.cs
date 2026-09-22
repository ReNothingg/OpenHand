namespace OpenHand;

internal static class NativeScripts
{
    public const string SerialShim = """
        (() => {
          if (window.__openhandSerialBridge) return;

          const host = window.chrome?.webview;
          if (!host) return;

          const pending = new Map();
          const pendingFiles = new Map();
          let nextRequestID = 1;
          const pageToken = Array.from(crypto.getRandomValues(new Uint32Array(4)), value => value.toString(16).padStart(8, "0")).join("");
          let activePort = null;
          let stopPending = null;
          let writesStopped = false;
          let stopGeneration = 0;
          const nativeStops = new Map();

          function bytesToBase64(bytes) {
            let binary = "";
            const chunkSize = 0x8000;
            for (let offset = 0; offset < bytes.length; offset += chunkSize) {
              binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
            }
            return btoa(binary);
          }

          function base64ToBytes(value) {
            const binary = atob(value);
            const bytes = new Uint8Array(binary.length);
            for (let index = 0; index < binary.length; index += 1) {
              bytes[index] = binary.charCodeAt(index);
            }
            return bytes;
          }

          function post(bridge, payload) {
            host.postMessage({ bridge, ...payload });
          }

          window.addEventListener("openhand:menu-state", event => post("menu", event.detail));
          window.addEventListener("openhand:menu-appearance", event => post("menu", { appearance: event.detail }));
          const colorScheme = matchMedia("(prefers-color-scheme: dark)");
          const syncWindowTheme = () =>
            post("theme", { dark: colorScheme.matches });
          colorScheme.addEventListener("change", syncWindowTheme);
          window.addEventListener("openhand:theme", (event) =>
            post("theme", { dark: Boolean(event.detail?.dark), system: Boolean(event.detail?.system) }));
          syncWindowTheme();

          const bridge = {
            call(action, payload = {}) {
              const id = `${pageToken}:${nextRequestID++}`;
              return new Promise((resolve, reject) => {
                pending.set(id, { resolve, reject });
                post("serial", { id, action, ...payload });
              });
            },
            resolve(message) {
              const request = pending.get(message.id);
              if (!request) return;
              pending.delete(message.id);
              if (message.error) request.reject(new Error(message.error));
              else request.resolve(message.result);
            },
            receive(message) {
              if (!activePort || message.connectionId !== activePort._connectionId) return;
              activePort?._receive(base64ToBytes(message.data));
            },
            disconnected(message) {
              if (!activePort || message.connectionId !== activePort._connectionId) return;
              activePort?._disconnect(message.error || "Устройство отключено.");
              activePort = null;
              serial.dispatchEvent(new Event("disconnect"));
            },
          };

          const fileBridge = {
            save(payload) {
              const id = `${pageToken}:${nextRequestID++}`;
              return new Promise((resolve, reject) => {
                pendingFiles.set(id, { resolve, reject });
                post("file", { id, ...payload });
              });
            },
            resolve(message) {
              const request = pendingFiles.get(message.id);
              if (!request) return;
              pendingFiles.delete(message.id);
              if (message.error) request.reject(new Error(message.error));
              else request.resolve(message.result || { saved: false });
            },
          };

          class NativeSerialPort {
            constructor(info) {
              this.info = info;
              this.readable = null;
              this.writable = null;
              this._readController = null;
              this._writeController = null;
              this._queuedInput = [];
              this._opened = false;
              this._connectionId = null;
              this._opening = false;
            }

            getInfo() {
              return {};
            }

            async open(options) {
              if (this._opened || this._opening || activePort?._opened || activePort?._opening)
                throw new DOMException("Сначала закройте предыдущее соединение.", "InvalidStateError");
              const connectionId = `${pageToken}:connection:${nextRequestID++}`;
              this._connectionId = connectionId;
              this._opening = true;
              this._queuedInput = [];
              activePort = this;
              try {
                if (this.info.network) {
                  await bridge.call("openNetwork", {
                    connectionId,
                    host: this.info.host,
                    port: this.info.port,
                    profile: options.profile,
                  });
                } else {
                  await bridge.call("open", {
                    connectionId,
                    path: this.info.path,
                    profile: options.profile,
                    baudRate: Number(options.baudRate),
                    dataBits: options.dataBits ?? 8,
                    stopBits: options.stopBits ?? 1,
                    parity: options.parity ?? "none",
                    flowControl: options.flowControl ?? "none",
                  });
                }
                if (this._connectionId !== connectionId) {
                  await bridge.call("close", { connectionId });
                  throw new DOMException("Подключение отменено.", "AbortError");
                }
              } catch (error) {
                if (activePort === this && this._connectionId === connectionId) activePort = null;
                throw error;
              } finally {
                if (this._connectionId === connectionId) this._opening = false;
              }

              this._opened = true;
              this.readable = new ReadableStream({
                start: (controller) => {
                  this._readController = controller;
                  this._queuedInput.splice(0).forEach((chunk) => controller.enqueue(chunk));
                },
                cancel: () => {
                  if (this._connectionId === connectionId) this._readController = null;
                },
              });
              this.writable = new WritableStream({
                start: (controller) => {
                  this._writeController = controller;
                },
                write: (chunk) => {
                  const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
                  if (writesStopped && !(bytes.length === 1 && bytes[0] === 0x3f))
                    throw new Error("СТОП: отправка команд заблокирована.");
                  return bridge.call("write", { connectionId, data: bytesToBase64(bytes) });
                },
              });
              if (writesStopped) this._interruptWrites();
            }

            async setSignals(signals) {
              if (!this._opened) {
                throw new DOMException("Порт не открыт.", "InvalidStateError");
              }
              if (this.info.network) return;
              return bridge.call("setSignals", {
                connectionId: this._connectionId,
                dataTerminalReady: signals.dataTerminalReady,
                requestToSend: signals.requestToSend,
              });
            }

            async close() {
              const connectionId = this._connectionId;
              if (stopPending) { try { await stopPending; } catch {} }
              if ((!this._opened && !this._opening) || this._connectionId !== connectionId) return;
              this._interruptWrites();
              await bridge.call("close", { connectionId });
              if (this._connectionId !== connectionId) return;
              this._opened = false;
              this._opening = false;
              this._connectionId = null;
              if (activePort === this) activePort = null;
              try { this._readController?.close(); } catch {}
              this._readController = null;
              this._writeController = null;
              this._queuedInput = [];
              this.readable = null;
              this.writable = null;
            }

            _interruptWrites() {
              try { this._writeController?.error(new DOMException("Предыдущая очередь отменена СТОП.", "AbortError")); } catch {}
            }

            _receive(bytes) {
              if (this._readController) this._readController.enqueue(bytes);
              else this._queuedInput.push(bytes);
            }

            _disconnect(reason) {
              this._opened = false;
              this._opening = false;
              this._connectionId = null;
              this._queuedInput = [];
              const error = new DOMException(reason, "NetworkError");
              try { this._readController?.error(error); } catch {}
              try { this._writeController?.error(error); } catch {}
              this._readController = null;
              this._writeController = null;
              this.readable = null;
              this.writable = null;
            }
          }

          const serial = new EventTarget();
          serial.requestPort = async (options = {}) => {
            const network = options.openhandNetwork;
            return network
              ? new NativeSerialPort({ network: true, host: network.host, port: network.port })
              : new NativeSerialPort(await bridge.call("requestPort"));
          };
          serial.getPorts = async () => [];

          Object.defineProperty(window, "__openhandNativeStopStarted", { value: ({ token }) => {
            writesStopped = true;
            activePort?._interruptWrites();
            ++stopGeneration;
            if (!stopPending) {
              let resolve, reject;
              const request = new Promise((yes, no) => { resolve = yes; reject = no; });
              stopPending = request;
              nativeStops.set(token, { resolve, reject });
              const clear = () => { if (stopPending === request) stopPending = null; nativeStops.delete(token); };
              request.then(clear, clear);
            }
            window.dispatchEvent(new Event("openhand:native-stop"));
          } });
          Object.defineProperty(window, "__openhandNativeStopFinished", { value: ({ token, error }) => {
            const request = nativeStops.get(token);
            if (error) request?.reject(new Error(error));
            else request?.resolve({ sent: true });
          } });
          Object.defineProperty(window, "__openhandEmergencyStop", { value: profile => {
            writesStopped = true;
            activePort?._interruptWrites();
            ++stopGeneration;
            if (stopPending) return stopPending;
            const request = bridge.call("emergencyStop", { profile });
            stopPending = request;
            const clear = () => { if (stopPending === request) stopPending = null; };
            request.then(clear, clear);
            return request;
          } });
          Object.defineProperty(window, "__openhandReleaseEmergencyStop", { value: async () => {
            if (stopPending) throw new Error("Остановка ещё выполняется.");
            const generation = stopGeneration;
            await bridge.call("releaseEmergencyStop");
            if (generation !== stopGeneration) throw new Error("Запрошен новый СТОП.");
            if (stopPending) throw new Error("Остановка ещё выполняется.");
            writesStopped = false;
            ++stopGeneration;
          } });
          Object.defineProperty(window, "__openhandGetSessionState", { value: async () => {
            const generation = stopGeneration;
            const state = await bridge.call("sessionState");
            if (generation === stopGeneration) writesStopped = writesStopped || Boolean(state.emergencyStopped);
            return state;
          } });
          Object.defineProperty(window, "__openhandRequestStatus", { value: () => {
            if (!activePort?._opened) return Promise.reject(new Error("Порт не открыт."));
            return bridge.call("write", { connectionId: activePort._connectionId, data: bytesToBase64(new Uint8Array([0x3f])) });
          } });
          Object.defineProperty(window, "__openhandBridgeVersion", { value: 8 });
          Object.defineProperty(window, "__openhandNativePlatform", {
            value: "windows",
            configurable: false,
            writable: false,
          });
          Object.defineProperty(window, "__openhandSerialBridge", {
            value: bridge,
            configurable: false,
            writable: false,
          });
          Object.defineProperty(window, "__openhandNotificationBridge", {
            value: {
              enable: () => bridge.call("enableNotifications"),
              show: (title, body) => bridge.call("notify", { title, body }),
            },
          });
          Object.defineProperty(window, "__openhandFileBridge", {
            value: fileBridge,
            configurable: false,
            writable: false,
          });
          Object.defineProperty(navigator, "serial", {
            value: serial,
            configurable: true,
            enumerable: true,
            writable: false,
          });

          const webkit = window.webkit || {};
          webkit.messageHandlers = webkit.messageHandlers || {};
          webkit.messageHandlers.serialBridge = {
            postMessage: (message) => post("serial", message),
          };
          webkit.messageHandlers.fileBridge = {
            postMessage: (message) => post("file", message),
          };
          Object.defineProperty(window, "webkit", {
            value: webkit,
            configurable: true,
            writable: false,
          });

          host.addEventListener("message", (event) => {
            const message = event.data;
            if (!message) return;
            if (message.bridge === "file" && message.type === "resolve") {
              fileBridge.resolve(message.payload);
              return;
            }
            if (message.bridge !== "serial") return;
            if (message.type === "resolve") bridge.resolve(message.payload);
            else if (message.type === "receive") bridge.receive(message.payload);
            else if (message.type === "disconnected") bridge.disconnected(message.payload);
          });
        })();
        """;
}
