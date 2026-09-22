import AppKit
import SwiftUI
import UniformTypeIdentifiers
import WebKit

struct OpenDocumentRequest: Equatable {
    let id = UUID()
    let url: URL
}

private let serialShim = #"""
(() => {
  window.addEventListener("openhand:menu-state", event => window.webkit.messageHandlers.menuBridge.postMessage(event.detail));
  window.addEventListener("openhand:menu-appearance", event => window.webkit.messageHandlers.menuBridge.postMessage({ appearance: event.detail }));
  window.addEventListener("openhand:theme", (event) => {
    window.webkit.messageHandlers.themeBridge.postMessage({ dark: Boolean(event.detail?.dark), system: Boolean(event.detail?.system) });
  });
  if (navigator.serial || window.__openhandSerialBridge) return;

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

  const bridge = {
    call(action, payload = {}) {
      const id = `${pageToken}:${nextRequestID++}`;
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

  const fileBridge = {
    save(payload) {
      const id = `${pageToken}:${nextRequestID++}`;
      return new Promise((resolve, reject) => {
        pendingFiles.set(id, { resolve, reject });
        window.webkit.messageHandlers.fileBridge.postMessage({ id, ...payload });
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
      if (this._opened) throw new DOMException("Порт уже открыт.", "InvalidStateError");
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
      if (!this._opened) throw new DOMException("Порт не открыт.", "InvalidStateError");
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
    ++stopGeneration;
  } });
  Object.defineProperty(window, "__openhandGetSessionState", { value: async () => {
    const generation = stopGeneration;
    const state = await bridge.call("sessionState");
    if (generation === stopGeneration) writesStopped = writesStopped || Boolean(state.emergencyStopped);
    return state;
  } });
  Object.defineProperty(window, "__openhandBridgeVersion", { value: 7 });
  Object.defineProperty(window, "__openhandNativePlatform", {
    value: "macos",
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
    configurable: false,
    enumerable: true,
    writable: false,
  });
})();
"""#

struct OpenHandWebView: NSViewRepresentable {
    let documentRequest: OpenDocumentRequest?

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
        configuration.userContentController.add(context.coordinator.bridge, name: "themeBridge")
        configuration.userContentController.add(context.coordinator.bridge, name: "menuBridge")
        configuration.setURLSchemeHandler(
            context.coordinator.assetHandler,
            forURLScheme: "openhand"
        )

        let webView = CloseAwareWebView(frame: .zero, configuration: configuration)
        webView.onWindowReady = { [weak coordinator = context.coordinator] window in
            coordinator?.attachCloseGuard(to: window)
        }
        // The document canvas owns pinch zoom; never magnify the surrounding UI.
        webView.allowsMagnification = false
        webView.magnification = 1
        webView.pageZoom = 1
        webView.underPageBackgroundColor = NSColor(
            name: nil,
            dynamicProvider: { appearance in
                let match = appearance.bestMatch(from: [.darkAqua, .aqua])
                if match == .darkAqua {
                    return NSColor(calibratedWhite: 17.0 / 255.0, alpha: 1)
                }
                return NSColor(calibratedWhite: 1, alpha: 1)
            }
        )
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
#if DEBUG
        if #available(macOS 13.3, *) {
            webView.isInspectable = true
        }
#endif

        context.coordinator.bridge.webView = webView
        context.coordinator.bridge.installEmergencyKeys()
        context.coordinator.webView = webView
        NotificationCenter.default.addObserver(context.coordinator, selector: #selector(Coordinator.changeWorkspace(_:)), name: Notification.Name("OpenHandWorkspace"), object: nil)
        NotificationCenter.default.addObserver(context.coordinator, selector: #selector(Coordinator.menuCommand(_:)), name: Notification.Name("OpenHandMenuCommand"), object: nil)
        NotificationCenter.default.addObserver(context.coordinator, selector: #selector(Coordinator.windowReady(_:)), name: NSWindow.didBecomeKeyNotification, object: nil)
        context.coordinator.loadApplication()
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        if let documentRequest {
            context.coordinator.openDocument(documentRequest)
        }
    }

    static func dismantleNSView(_ webView: WKWebView, coordinator: Coordinator) {
        NotificationCenter.default.removeObserver(coordinator, name: Notification.Name("OpenHandWorkspace"), object: nil)
        NotificationCenter.default.removeObserver(coordinator, name: Notification.Name("OpenHandMenuCommand"), object: nil)
        NotificationCenter.default.removeObserver(coordinator, name: NSWindow.didBecomeKeyNotification, object: nil)
        coordinator.bridge.removeEmergencyKeys()
        let controller = webView.configuration.userContentController
        controller.removeScriptMessageHandler(forName: "serialBridge")
        controller.removeScriptMessageHandler(forName: "fileBridge")
        controller.removeScriptMessageHandler(forName: "themeBridge")
        controller.removeScriptMessageHandler(forName: "menuBridge")
    }

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        private static let maximumDocumentBytes = 64 * 1024 * 1024
        let bridge = NativeBridge()
        let assetHandler = LocalAssetSchemeHandler()
        private lazy var closeGuard = NativeCloseGuard(bridge: bridge)

        @objc func windowReady(_ notification: Notification) {
            guard let window = webView?.window, notification.object as? NSWindow === window else { return }
            attachCloseGuard(to: window)
        }

        func attachCloseGuard(to window: NSWindow) { closeGuard.install(on: window) }
        weak var webView: WKWebView?
        private var lastDocumentRequestID: UUID?
        private var pendingDocument: [String: Any]?
        private var pageRecoveryInFlight = false
        private var permittedNavigationURL: URL?
        private var recoveryNavigation: WKNavigation?

        private func replacePage(afterStopping request: URLRequest? = nil) {
            guard !pageRecoveryInFlight, !bridge.isClosing, let webView else { return }
            pageRecoveryInFlight = true
            recoveryNavigation = nil
            let nextRequest = request ?? URLRequest(url: webView.url ?? URL(string: "openhand://app/index.html")!)
            bridge.prepareForPageChange { [weak self] result in
                guard let self, let webView = self.webView else { return }
                guard !self.bridge.isClosing else { self.pageRecoveryInFlight = false; return }
                if case let .failure(error) = result {
                    // The restored page inherits the native STOP latch and error.
                    // Keep the UI available for another STOP even if delivery failed.
                    NSLog("OpenHand stop before page recovery failed: %@", error.localizedDescription)
                }
                self.permittedNavigationURL = nextRequest.url
                self.recoveryNavigation = webView.load(nextRequest)
                if self.recoveryNavigation == nil {
                    self.pageRecoveryInFlight = false
                    self.permittedNavigationURL = nil
                    self.bridge.finishPageChange()
                    self.showLoadingError("Не удалось начать восстановление интерфейса. Перезапустите OpenHand.")
                }
            }
        }

        @objc func changeWorkspace(_ notification: Notification) {
            guard let webView, webView.window?.isKeyWindow == true,
                  let mode = notification.object as? String,
                  mode == "document" || mode == "workshop" || mode == "device" else { return }
            webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent('openhand:workspace', { detail: '\(mode)' }))", completionHandler: nil)
        }

        @objc func menuCommand(_ notification: Notification) {
            guard let webView, let window = webView.window, (window.isKeyWindow || window.attachedSheet?.isKeyWindow == true),
                  let action = notification.object as? String else { return }
            if action == "stop" {
                bridge.stopFromNativeUI()
            } else if action == "open" {
                let panel = NSOpenPanel()
                panel.allowedContentTypes = ["gcode", "nc", "tap"].compactMap { UTType(filenameExtension: $0) }
                panel.allowsMultipleSelection = false
                panel.beginSheetModal(for: window) { [weak self] response in
                    if response == .OK, let url = panel.url { self?.openDocument(OpenDocumentRequest(url: url)) }
                }
            } else if action == "print" {
                webView.printOperation(with: NSPrintInfo.shared).run()
            } else if ["editor", "settings", "appearance:system", "appearance:light", "appearance:dark"].contains(action) {
                webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent('openhand:menu-command',{detail:'\(action)'}));", completionHandler: nil)
            }
        }

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

        func openDocument(_ request: OpenDocumentRequest) {
            guard request.id != lastDocumentRequestID else { return }
            lastDocumentRequestID = request.id

            let allowedExtensions = Set(["gcode", "nc", "tap"])
            guard allowedExtensions.contains(request.url.pathExtension.lowercased()) else {
                showDocumentError("Поддерживаются файлы .gcode, .nc и .tap.")
                return
            }

            let hasAccess = request.url.startAccessingSecurityScopedResource()
            defer {
                if hasAccess {
                    request.url.stopAccessingSecurityScopedResource()
                }
            }

            do {
                let values = try request.url.resourceValues(forKeys: [.fileSizeKey])
                if let fileSize = values.fileSize,
                   fileSize > Self.maximumDocumentBytes {
                    showDocumentError(
                        "Файл G-code больше 64 МБ. Разделите задание на несколько файлов."
                    )
                    return
                }
                let data = try Data(contentsOf: request.url, options: .mappedIfSafe)
                if data.count > Self.maximumDocumentBytes {
                    showDocumentError(
                        "Файл G-code больше 64 МБ. Разделите задание на несколько файлов."
                    )
                    return
                }
                pendingDocument = [
                    "name": request.url.lastPathComponent,
                    "type": "text/plain;charset=utf-8",
                    "data": data.base64EncodedString()
                ]
                deliverPendingDocument()
            } catch {
                showDocumentError("Не удалось прочитать файл: \(error.localizedDescription)")
            }
        }

        private func deliverPendingDocument() {
            guard let webView,
                  let pendingDocument,
                  JSONSerialization.isValidJSONObject(pendingDocument),
                  let data = try? JSONSerialization.data(withJSONObject: pendingDocument),
                  let json = String(data: data, encoding: .utf8) else {
                return
            }
            let script = """
            window.__openhandReceiveFile
              ? (window.__openhandReceiveFile(\(json)), true)
              : false
            """
            webView.evaluateJavaScript(script) { [weak self] result, error in
                guard error == nil, (result as? NSNumber)?.boolValue == true else { return }
                self?.pendingDocument = nil
            }
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

            let scheme = url.scheme?.lowercased()
            let isApplicationURL = scheme == "openhand" && url.host == "app"
            let isInternalURL = isApplicationURL || scheme == "about" || scheme == "blob"
            if isInternalURL {
                if navigationAction.targetFrame?.isMainFrame == true {
                    if permittedNavigationURL == url {
                        permittedNavigationURL = nil
                        decisionHandler(.allow)
                        return
                    }
                    if pageRecoveryInFlight { decisionHandler(.cancel); return }
                    var current = webView.url.flatMap { URLComponents(url: $0, resolvingAgainstBaseURL: false) }
                    var next = URLComponents(url: url, resolvingAgainstBaseURL: false)
                    let differentFragment = current?.fragment != next?.fragment
                    current?.fragment = nil
                    next?.fragment = nil
                    let fragmentOnly = navigationAction.navigationType != .reload && differentFragment && current?.url == next?.url
                    if bridge.needsPageTransitionStop && !fragmentOnly {
                        decisionHandler(.cancel)
                        replacePage(afterStopping: navigationAction.request)
                        return
                    }
                }
                decisionHandler(.allow)
            } else if ["http", "https", "mailto"].contains(scheme ?? "") {
                NSWorkspace.shared.open(url)
                decisionHandler(.cancel)
            } else {
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
            if pageRecoveryInFlight {
                // Coalesce duplicate failure events while the native STOP is pending.
                guard recoveryNavigation != nil else { return }
                pageRecoveryInFlight = false
                permittedNavigationURL = nil
                recoveryNavigation = nil
                bridge.finishPageChange()
                showLoadingError("Интерфейс снова завершился во время восстановления. Перезапустите OpenHand.")
                return
            }
            replacePage()
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            if pageRecoveryInFlight && (recoveryNavigation == nil || navigation !== recoveryNavigation) { return }
            pageRecoveryInFlight = false
            permittedNavigationURL = nil
            recoveryNavigation = nil
            bridge.finishPageChange()
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
                    self?.deliverPendingDocument()
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
            if (error as NSError).code == NSURLErrorCancelled { return }
            if pageRecoveryInFlight && (recoveryNavigation == nil || navigation !== recoveryNavigation) { return }
            pageRecoveryInFlight = false
            permittedNavigationURL = nil
            recoveryNavigation = nil
            bridge.finishPageChange()
            showLoadingError(error.localizedDescription)
        }

        func webView(
            _ webView: WKWebView,
            didFailProvisionalNavigation navigation: WKNavigation!,
            withError error: Error
        ) {
            if (error as NSError).code == NSURLErrorCancelled { return }
            if pageRecoveryInFlight && (recoveryNavigation == nil || navigation !== recoveryNavigation) { return }
            pageRecoveryInFlight = false
            permittedNavigationURL = nil
            recoveryNavigation = nil
            bridge.finishPageChange()
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

        private func showDocumentError(_ reason: String) {
            let alert = NSAlert()
            alert.alertStyle = .warning
            alert.messageText = "Не удалось открыть G-code"
            alert.informativeText = reason
            alert.runModal()
        }
    }
}
