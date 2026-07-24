import AppKit
import SwiftUI
import UniformTypeIdentifiers
import WebKit

private let serialShim = #"""
(() => {
  if (navigator.serial || window.__openhandSerialBridge) return;

  const pending = new Map();
  let nextRequestID = 1;
  let activePort = null;

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

  const bridge = {
    call(action, payload = {}) {
      const id = nextRequestID++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        window.webkit.messageHandlers.serialBridge.postMessage({ id, action, ...payload });
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
      if (this._opened) throw new DOMException("Порт уже открыт.", "InvalidStateError");
      activePort = this;
      try {
        await bridge.call("open", {
          path: this.info.path,
          baudRate: Number(options.baudRate),
          dataBits: options.dataBits ?? 8,
          stopBits: options.stopBits ?? 1,
          parity: options.parity ?? "none",
          flowControl: options.flowControl ?? "none",
        });
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
          return bridge.call("write", { data: bytesToBase64(bytes) });
        },
      });
    }

    async setSignals(signals) {
      if (!this._opened) throw new DOMException("Порт не открыт.", "InvalidStateError");
      return bridge.call("setSignals", {
        dataTerminalReady: signals.dataTerminalReady,
        requestToSend: signals.requestToSend,
      });
    }

    async close() {
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
  serial.requestPort = async () => new NativeSerialPort(await bridge.call("requestPort"));
  serial.getPorts = async () => [];

  Object.defineProperty(window, "__openhandSerialBridge", {
    value: bridge,
    configurable: false,
    writable: false,
  });
  Object.defineProperty(navigator, "serial", {
    value: serial,
    configurable: false,
    enumerable: true,
    writable: false,
  });
})();
"""#

struct OpenHandWebView: NSViewRepresentable {
    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.userContentController.addUserScript(
            WKUserScript(
                source: serialShim,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            )
        )
        configuration.userContentController.add(context.coordinator.bridge, name: "serialBridge")
        configuration.userContentController.add(context.coordinator.bridge, name: "fileBridge")
        configuration.setURLSchemeHandler(
            context.coordinator.assetHandler,
            forURLScheme: "openhand"
        )

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        if #available(macOS 13.3, *) {
            webView.isInspectable = true
        }

        context.coordinator.bridge.webView = webView
        context.coordinator.webView = webView
        context.coordinator.loadApplication()
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) { }

    static func dismantleNSView(_ webView: WKWebView, coordinator: Coordinator) {
        let controller = webView.configuration.userContentController
        controller.removeScriptMessageHandler(forName: "serialBridge")
        controller.removeScriptMessageHandler(forName: "fileBridge")
    }

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        let bridge = NativeBridge()
        let assetHandler = LocalAssetSchemeHandler()
        weak var webView: WKWebView?

        func loadApplication() {
            guard let webView,
                  Bundle.main.url(
                    forResource: "index",
                    withExtension: "html",
                    subdirectory: "Web"
                  ) != nil,
                  let applicationURL = URL(string: "openhand://app/index.html") else {
                showMissingResources()
                return
            }
            webView.load(URLRequest(url: applicationURL))
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard let url = navigationAction.request.url else {
                decisionHandler(.cancel)
                return
            }

            if url.scheme == "openhand" || url.scheme == "about" || url.scheme == "blob" {
                decisionHandler(.allow)
            } else {
                NSWorkspace.shared.open(url)
                decisionHandler(.cancel)
            }
        }

        func webView(
            _ webView: WKWebView,
            runOpenPanelWith parameters: WKOpenPanelParameters,
            initiatedByFrame frame: WKFrameInfo,
            completionHandler: @escaping ([URL]?) -> Void
        ) {
            let panel = NSOpenPanel()
            panel.allowsMultipleSelection = parameters.allowsMultipleSelection
            panel.canChooseDirectories = parameters.allowsDirectories
            panel.canChooseFiles = true
            panel.begin { response in
                completionHandler(response == .OK ? panel.urls : nil)
            }
        }

        func webView(
            _ webView: WKWebView,
            runJavaScriptAlertPanelWithMessage message: String,
            initiatedByFrame frame: WKFrameInfo,
            completionHandler: @escaping () -> Void
        ) {
            let alert = NSAlert()
            alert.messageText = "OpenHand"
            alert.informativeText = message
            alert.addButton(withTitle: "OK")
            alert.runModal()
            completionHandler()
        }

        func webView(
            _ webView: WKWebView,
            runJavaScriptConfirmPanelWithMessage message: String,
            initiatedByFrame frame: WKFrameInfo,
            completionHandler: @escaping (Bool) -> Void
        ) {
            let alert = NSAlert()
            alert.messageText = "OpenHand"
            alert.informativeText = message
            alert.addButton(withTitle: "OK")
            alert.addButton(withTitle: "Отмена")
            completionHandler(alert.runModal() == .alertFirstButtonReturn)
        }

        func webView(
            _ webView: WKWebView,
            runJavaScriptTextInputPanelWithPrompt prompt: String,
            defaultText: String?,
            initiatedByFrame frame: WKFrameInfo,
            completionHandler: @escaping (String?) -> Void
        ) {
            let alert = NSAlert()
            alert.messageText = prompt
            alert.addButton(withTitle: "OK")
            alert.addButton(withTitle: "Отмена")

            let input = NSTextField(frame: NSRect(x: 0, y: 0, width: 360, height: 24))
            input.stringValue = defaultText ?? ""
            alert.accessoryView = input
            completionHandler(alert.runModal() == .alertFirstButtonReturn ? input.stringValue : nil)
        }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            webView.reload()
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            NSLog("OpenHand document finished loading")
            verifyRuntime(in: webView, attemptsRemaining: 20)
        }

        private func verifyRuntime(in webView: WKWebView, attemptsRemaining: Int) {
            let healthCheck = """
            ({
              rootChildren: document.getElementById('root')?.childElementCount ?? 0,
              serialReady: Boolean(navigator.serial),
              title: document.title
            })
            """
            webView.evaluateJavaScript(healthCheck) { [weak self] result, error in
                if let error {
                    if attemptsRemaining > 0 {
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
                            self?.verifyRuntime(in: webView, attemptsRemaining: attemptsRemaining - 1)
                        }
                    } else {
                        self?.showLoadingError(error.localizedDescription)
                    }
                    return
                }
                let state = result as? [String: Any]
                let rootReady = (state?["rootChildren"] as? NSNumber)?.intValue ?? 0 > 0
                let serialReady = (state?["serialReady"] as? NSNumber)?.boolValue == true
                if rootReady, serialReady {
                    NSLog("OpenHand runtime ready")
                    return
                }
                if attemptsRemaining > 0 {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
                        self?.verifyRuntime(in: webView, attemptsRemaining: attemptsRemaining - 1)
                    }
                } else {
                    NSLog("OpenHand health state: %@", String(describing: result))
                    self?.showLoadingError("React-интерфейс или нативный Serial API не инициализировались.")
                }
            }
        }

        func webView(
            _ webView: WKWebView,
            didFail navigation: WKNavigation!,
            withError error: Error
        ) {
            showLoadingError(error.localizedDescription)
        }

        func webView(
            _ webView: WKWebView,
            didFailProvisionalNavigation navigation: WKNavigation!,
            withError error: Error
        ) {
            showLoadingError(error.localizedDescription)
        }

        private func showMissingResources() {
            let alert = NSAlert()
            alert.alertStyle = .critical
            alert.messageText = "Не найдены ресурсы OpenHand"
            alert.informativeText = "Запустите «npm run macos:sync» в корне проекта и пересоберите приложение."
            alert.runModal()
        }

        private func showLoadingError(_ reason: String) {
            NSLog("OpenHand loading error: %@", reason)
            let alert = NSAlert()
            alert.alertStyle = .critical
            alert.messageText = "Не удалось загрузить OpenHand"
            alert.informativeText = reason
            alert.runModal()
        }
    }
}
