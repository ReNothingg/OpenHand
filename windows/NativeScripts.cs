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
              const id = nextRequestID++;
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
              activePort?._receive(base64ToBytes(message.data));
            },
            disconnected(message) {
              activePort?._disconnect(message.error || "Устройство отключено.");
              activePort = null;
              serial.dispatchEvent(new Event("disconnect"));
            },
          };

          const fileBridge = {
            save(payload) {
              const id = nextRequestID++;
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
            }

            getInfo() {
              return {};
            }

            async open(options) {
              if (this._opened) {
                throw new DOMException("Порт уже открыт.", "InvalidStateError");
              }
              activePort = this;
              try {
                if (this.info.network) {
                  await bridge.call("openNetwork", {
                    host: this.info.host,
                    port: this.info.port,
                    profile: options.profile,
                  });
                } else {
                  await bridge.call("open", {
                    path: this.info.path,
                    profile: options.profile,
                    baudRate: Number(options.baudRate),
                    dataBits: options.dataBits ?? 8,
                    stopBits: options.stopBits ?? 1,
                    parity: options.parity ?? "none",
                    flowControl: options.flowControl ?? "none",
                  });
                }
              } catch (error) {
                if (activePort === this) activePort = null;
                throw error;
              }

              this._opened = true;
              this.readable = new ReadableStream({
                start: (controller) => {
                  this._readController = controller;
                  this._queuedInput.splice(0).forEach((chunk) => controller.enqueue(chunk));
                },
                cancel: () => {
                  this._readController = null;
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
                  return bridge.call("write", { data: bytesToBase64(bytes) });
                },
              });
            }

            async setSignals(signals) {
              if (!this._opened) {
                throw new DOMException("Порт не открыт.", "InvalidStateError");
              }
              if (this.info.network) return;
              return bridge.call("setSignals", {
                dataTerminalReady: signals.dataTerminalReady,
                requestToSend: signals.requestToSend,
              });
            }

            async close() {
              if (stopPending) { try { await stopPending; } catch {} }
              if (!this._opened) return;
              await bridge.call("close");
              this._opened = false;
              if (activePort === this) activePort = null;
              this._readController = null;
              this._writeController = null;
              this.readable = null;
              this.writable = null;
            }

            _receive(bytes) {
              if (this._readController) this._readController.enqueue(bytes);
              else this._queuedInput.push(bytes);
            }

            _disconnect(reason) {
              this._opened = false;
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
          } });
          Object.defineProperty(window, "__openhandBridgeVersion", { value: 4 });
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
