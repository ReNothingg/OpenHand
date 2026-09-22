import AppKit
import Foundation
import WebKit
import UserNotifications

@MainActor
final class NativeBridge: NSObject, WKScriptMessageHandler {
    weak var webView: WKWebView?
    private let serial = SerialConnection()
    private let tcp = TcpConnection()
    private var selectedPort: SerialPortDescriptor?
    private var lastSerialOpen: (path: String, options: SerialOpenOptions)?
    private var lastRequestedTransport: String?
    private var lastProtocol: String?
    private var emergencyStopped = false
    private var emergencyInFlight = false
    private var activeTransport: String?
    static let liveBridges = NSHashTable<NativeBridge>.weakObjects()
    private var closingRequested = false
    private var closeWaiters: [SerialConnection.Completion] = []
    private var closeInFlight = false
    private var closeGeneration = 0
    private var openingCount = 0
    private var openGeneration = 0
    var needsShutdown: Bool { activeTransport != nil || openingCount > 0 || emergencyInFlight || closeInFlight }


    override init() {
        super.init()
        Self.liveBridges.add(self)
        if let saved = UserDefaults.standard.dictionary(forKey: "OpenHandLastSerialPort"),
           let path = saved["path"] as? String, path.hasPrefix("/dev/cu."), path != "/dev/cu.debug-console",
           let baud = saved["baudRate"] as? Int {
            lastSerialOpen = (path, SerialOpenOptions(
                baudRate: baud, dataBits: saved["dataBits"] as? Int ?? 8,
                stopBits: saved["stopBits"] as? Int ?? 1,
                parity: saved["parity"] as? String ?? "none",
                flowControl: saved["flowControl"] as? String ?? "none"))
            lastRequestedTransport = UserDefaults.standard.string(forKey: "OpenHandLastTransport")
            lastProtocol = saved["profile"] as? String
        }

        serial.onData = { [weak self] data in
            self?.sendSerialData(data)
        }
        serial.onDisconnect = { [weak self] reason in
            self?.activeTransport = nil
            self?.sendSerialDisconnect(reason)
        }
        tcp.onData = { [weak self] data in
            self?.sendSerialData(data)
        }
        tcp.onDisconnect = { [weak self] reason in
            self?.activeTransport = nil
            self?.sendSerialDisconnect(reason)
        }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        switch message.name {
        case "serialBridge":
            handleSerialMessage(message.body)
        case "fileBridge":
            handleFileMessage(message.body)
        case "menuBridge":
            if let payload = message.body as? [String: Any] {
                NotificationCenter.default.post(name: Notification.Name("OpenHandMenuState"), object: nil, userInfo: payload)
            }
        case "themeBridge":
            if let payload = message.body as? [String: Any], let dark = payload["dark"] as? Bool {
                let appearance: NSAppearance? = payload["system"] as? Bool == true ? nil : NSAppearance(named: dark ? .darkAqua : .aqua)
                webView?.appearance = appearance
                webView?.window?.appearance = appearance
                if payload["system"] as? Bool == true {
                    let systemDark = NSApp.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
                    webView?.evaluateJavaScript("window.dispatchEvent(new CustomEvent('openhand:system-theme',{detail:{dark:\(systemDark ? "true" : "false")}}));", completionHandler: nil)
                }
            }
        default:
            break
        }
    }

    private var stopWaiters: [SerialConnection.Completion] = []
    private var nativeStopInFlight = false
    private var nativeStopWaiters: [SerialConnection.Completion] = []
    private var escapeMonitor: Any?
    var hasActiveConnection: Bool { activeTransport != nil }

    func installEmergencyKeys() {
        guard escapeMonitor == nil else { return }
        escapeMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self, self.hasActiveConnection, event.keyCode == 53,
                  let owner = self.webView?.window else { return event }
            var window = event.window
            while let parent = window?.sheetParent { window = parent }
            guard window === owner else { return event }
            if !event.isARepeat { self.stopFromNativeUI() }
            return nil
        }
    }

    func removeEmergencyKeys() {
        if let escapeMonitor { NSEvent.removeMonitor(escapeMonitor) }
        escapeMonitor = nil
    }

    func stopFromNativeUI(completion: SerialConnection.Completion? = nil) {
        if let completion { nativeStopWaiters.append(completion) }
        guard !nativeStopInFlight else { return }
        nativeStopInFlight = true
        // Block writes synchronously, before waiting for the web process.
        emergencyStopped = true
        let token = UUID().uuidString
        callJavaScript(function: "window.__openhandNativeStopStarted", payload: ["token": token])
        performEmergencyStop(profile: nil) { [weak self] result in
            guard let self else { return }
            self.nativeStopInFlight = false
            var payload: [String: Any] = ["token": token]
            if case let .failure(error) = result { payload["error"] = error.localizedDescription }
            self.callJavaScript(function: "window.__openhandNativeStopFinished", payload: payload)
            let waiters = self.nativeStopWaiters
            self.nativeStopWaiters.removeAll()
            waiters.forEach { $0(result) }
        }
    }

    private func performEmergencyStop(profile: String?, completion: @escaping SerialConnection.Completion) {
        if emergencyInFlight { stopWaiters.append(completion); return }
        let data: Data
        switch lastProtocol ?? profile {
        case "grbl": data = Data([0x85, 0x21, 0x18])
        case "marlin": data = Data("M410\n".utf8)
        case "ebb": data = Data("R\r\n".utf8)
        default: completion(.failure(NSError(domain: "OpenHand", code: 1, userInfo: [NSLocalizedDescriptionKey: "Неизвестный протокол остановки."]))); return
        }
        emergencyStopped = true
        emergencyInFlight = true
        stopWaiters.append(completion)
        let finish: SerialConnection.Completion = { [weak self] result in
            guard let self else { return }
            self.emergencyInFlight = false
            let waiters = self.stopWaiters
            self.stopWaiters.removeAll()
            waiters.forEach { $0(result) }
        }
        if lastRequestedTransport == "network" {
            tcp.write(data, completion: finish)
        } else if let saved = lastSerialOpen {
            serial.write(data) { [weak self] result in
                guard let self else { return }
                if case .success = result { finish(result); return }
                // Recover only the explicitly selected port. No discovery,
                // configuration commands, DTR pulse, homing or job replay.
                self.serial.open(path: saved.path, options: saved.options) { [weak self] opened in
                    guard let self else { return }
                    if case .failure = opened { finish(opened); return }
                    self.activeTransport = "serial"
                    self.serial.write(data, completion: finish)
                }
            }
        } else {
            finish(.failure(NSError(domain: "OpenHand", code: 2, userInfo: [NSLocalizedDescriptionKey: "USB-порт ещё не выбран. Не удалось передать СТОП."])))
        }
    }

    func cancelCloseRequest() {
        if !closeInFlight { closingRequested = false }
    }

    func prepareForClose(completion: @escaping SerialConnection.Completion) {
        closeWaiters.append(completion)
        guard !closeInFlight else { return }
        closeInFlight = true
        closeGeneration += 1
        let generation = closeGeneration
        closingRequested = true
        emergencyStopped = true
        openGeneration += 1
        let finish: SerialConnection.Completion = { [self] result in
            guard closeInFlight && closeGeneration == generation else { return }
            closeInFlight = false
            if case .failure = result { closingRequested = false }
            let waiters = closeWaiters
            closeWaiters.removeAll()
            waiters.forEach { $0(result) }
        }
        let timer = DispatchWorkItem { [self] in
            guard closeInFlight && closeGeneration == generation else { return }
            finish(.failure(NSError(domain: "OpenHand", code: 3, userInfo: [NSLocalizedDescriptionKey:
                "Остановка перед закрытием не подтверждена за 4 секунды. Если механизм движется, отключите питание и USB."])))
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 4, execute: timer)
        let closePorts: SerialConnection.Completion = { [self] stopped in
            guard closeInFlight && closeGeneration == generation else { return }
            if case .failure = stopped { timer.cancel(); finish(stopped); return }
            serial.close { [self] in
                guard closeInFlight && closeGeneration == generation else { return }
                tcp.close { [self] in
                    guard closeInFlight && closeGeneration == generation else { return }
                    timer.cancel()
                    activeTransport = nil
                    sendSerialDisconnect("Соединение закрыто перед выходом.")
                    finish(.success(()))
                }
            }
        }
        if activeTransport != nil || emergencyInFlight {
            stopFromNativeUI(completion: closePorts)
        } else {
            // No live session: never reopen a remembered device merely to quit.
            closePorts(.success(()))
        }
    }

    private func handleSerialMessage(_ body: Any) {
        guard let payload = body as? [String: Any],
              let requestID = payload["id"] as? NSNumber,
              let action = payload["action"] as? String else {
            return
        }

        let id = requestID.intValue
        if closingRequested && ["open", "openNetwork", "write", "setSignals", "releaseEmergencyStop", "requestPort"].contains(action) {
            reject(id, message: "Соединение закрывается. Новые команды заблокированы.")
            return
        }
        switch action {
        case "enableNotifications":
            Task {
                do {
                    let granted = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])
                    resolve(id, result: ["granted": granted])
                } catch { resolve(id, result: ["granted": false]) }
            }
        case "notify":
            let title = String((payload["title"] as? String ?? "OpenHand").prefix(160))
            let body = String((payload["body"] as? String ?? "").prefix(500))
            NSApp.requestUserAttention(.informationalRequest)
            let content = UNMutableNotificationContent()
            content.title = title
            content.body = body
            content.sound = .default
            UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "openhand-paper", content: content, trigger: nil)) { [weak self] error in
                Task { @MainActor in self?.resolve(id, result: ["delivered": error == nil]) }
            }
        case "requestPort":
            do {
                let port = try choosePort()
                selectedPort = port
                resolve(id, result: ["path": port.path, "name": port.name])
            } catch {
                reject(id, error: error)
            }

        case "open":
            guard openingCount == 0 else { reject(id, message: "Подключение ещё выполняется."); return }
            guard !emergencyInFlight else { reject(id, message: "Остановка ещё выполняется."); return }
            guard let path = payload["path"] as? String,
                  let baudRate = payload["baudRate"] as? NSNumber else {
                reject(id, message: "Некорректные параметры открытия порта.")
                return
            }

            let options = SerialOpenOptions(
                baudRate: baudRate.intValue,
                dataBits: (payload["dataBits"] as? NSNumber)?.intValue ?? 8,
                stopBits: (payload["stopBits"] as? NSNumber)?.intValue ?? 1,
                parity: payload["parity"] as? String ?? "none",
                flowControl: payload["flowControl"] as? String ?? "none"
            )
            lastProtocol = payload["profile"] as? String
            lastSerialOpen = (path, options)
            lastRequestedTransport = "serial"
            UserDefaults.standard.set("serial", forKey: "OpenHandLastTransport")
            UserDefaults.standard.set([
                "path": path, "baudRate": options.baudRate, "dataBits": options.dataBits,
                "profile": lastProtocol ?? "grbl",
                "stopBits": options.stopBits, "parity": options.parity,
                "flowControl": options.flowControl
            ], forKey: "OpenHandLastSerialPort")
            openingCount += 1
            let generation = openGeneration
            tcp.close { [weak self] in
                guard let self else { return }
                guard generation == self.openGeneration else {
                    self.openingCount -= 1; self.reject(id, message: "Подключение отменено закрытием."); return
                }
                self.serial.open(path: path, options: options) { [weak self] result in
                    guard let self else { return }
                    guard generation == self.openGeneration else {
                        self.serial.close { [weak self] in
                            self?.openingCount -= 1
                            self?.reject(id, message: "Подключение отменено закрытием.")
                        }
                        return
                    }
                    self.openingCount -= 1
                    switch result {
                    case .success:
                        self.activeTransport = "serial"
                        self.resolve(id, result: ["opened": true])
                    case let .failure(error):
                        self.reject(id, error: error)
                    }
                }
            }

        case "openNetwork":
            guard openingCount == 0 else { reject(id, message: "Подключение ещё выполняется."); return }
            guard !emergencyInFlight else { reject(id, message: "Остановка ещё выполняется."); return }
            lastProtocol = payload["profile"] as? String
            guard let host = payload["host"] as? String,
                  let port = payload["port"] as? NSNumber else {
                reject(id, message: "Некорректные параметры TCP-подключения.")
                return
            }
            lastRequestedTransport = "network"
            UserDefaults.standard.set("network", forKey: "OpenHandLastTransport")
            openingCount += 1
            let generation = openGeneration
            serial.close { [weak self] in
                guard let self else { return }
                guard generation == self.openGeneration else {
                    self.openingCount -= 1; self.reject(id, message: "Подключение отменено закрытием."); return
                }
                self.tcp.open(host: host, port: port.intValue) { [weak self] result in
                    guard let self else { return }
                    guard generation == self.openGeneration else {
                        self.tcp.close { [weak self] in
                            self?.openingCount -= 1
                            self?.reject(id, message: "Подключение отменено закрытием.")
                        }
                        return
                    }
                    self.openingCount -= 1
                    switch result {
                    case .success:
                        self.activeTransport = "network"
                        self.resolve(id, result: ["opened": true])
                    case let .failure(error):
                        self.reject(id, error: error)
                    }
                }
            }

        case "write":
            guard let encoded = payload["data"] as? String,
                  let data = Data(base64Encoded: encoded) else {
                reject(id, message: "Не удалось декодировать данные для порта.")
                return
            }

            if emergencyStopped && data != Data([0x3f]) {
                reject(id, message: "СТОП: отправка команд заблокирована.")
                return
            }
            let completion: SerialConnection.Completion = { [weak self] result in
                switch result {
                case .success:
                    self?.resolve(id, result: ["written": data.count])
                case let .failure(error):
                    self?.reject(id, error: error)
                }
            }
            if activeTransport == "network" {
                tcp.write(data, completion: completion)
            } else {
                serial.write(data, completion: completion)
            }

        case "releaseEmergencyStop":
            guard !emergencyInFlight else { reject(id, message: "Остановка ещё выполняется."); return }
            emergencyStopped = false
            resolve(id, result: ["released": true])

        case "emergencyStop":
            performEmergencyStop(profile: payload["profile"] as? String) { [weak self] result in
                switch result {
                case .success: self?.resolve(id, result: ["sent": true])
                case let .failure(error): self?.reject(id, error: error)
                }
            }

        case "setSignals":
            if activeTransport == "network" {
                resolve(id, result: ["updated": true])
                return
            }
            serial.setSignals(
                dataTerminalReady: payload["dataTerminalReady"] as? Bool,
                requestToSend: payload["requestToSend"] as? Bool
            ) { [weak self] result in
                switch result {
                case .success:
                    self?.resolve(id, result: ["updated": true])
                case let .failure(error):
                    self?.reject(id, error: error)
                }
            }

        case "close":
            serial.close { [weak self] in
                self?.tcp.close { [weak self] in
                    self?.activeTransport = nil
                    self?.resolve(id, result: ["closed": true])
                }
            }

        default:
            reject(id, message: "Неизвестная операция последовательного порта: \(action).")
        }
    }

    private func choosePort() throws -> SerialPortDescriptor {
        let ports = SerialConnection.availablePorts()
        guard !ports.isEmpty else {
            throw SerialConnectionError.noPorts
        }

        let alert = NSAlert()
        alert.alertStyle = .informational
        alert.messageText = "Выберите последовательный порт"
        alert.informativeText = "OpenHand подключится к устройству напрямую через macOS."
        alert.addButton(withTitle: "Подключить")
        alert.addButton(withTitle: "Отмена")

        let popup = NSPopUpButton(frame: NSRect(x: 0, y: 0, width: 430, height: 28))
        ports.forEach { popup.addItem(withTitle: "\($0.name)  (\($0.path))") }
        if let selectedPort,
           let selectedIndex = ports.firstIndex(where: { $0.path == selectedPort.path }) {
            popup.selectItem(at: selectedIndex)
        }
        alert.accessoryView = popup

        guard alert.runModal() == .alertFirstButtonReturn else {
            throw CocoaError(.userCancelled)
        }
        return ports[popup.indexOfSelectedItem]
    }

    private func handleFileMessage(_ body: Any) {
        guard let payload = body as? [String: Any],
              let requestID = payload["id"] as? NSNumber,
              let encoded = payload["data"] as? String,
              let data = Data(base64Encoded: encoded) else {
            showError("Не удалось подготовить файл к сохранению.")
            return
        }

        let id = requestID.intValue

        let proposedName = sanitizedFilename(payload["name"] as? String ?? "openhand-file")
        let panel = NSSavePanel()
        panel.nameFieldStringValue = proposedName
        panel.canCreateDirectories = true
        panel.isExtensionHidden = false

        guard panel.runModal() == .OK, let url = panel.url else {
            resolveFile(id, result: ["saved": false, "cancelled": true])
            return
        }
        do {
            try data.write(to: url, options: .atomic)
            resolveFile(id, result: ["saved": true, "path": url.path])
        } catch {
            resolveFile(id, result: ["saved": false, "error": "Не удалось сохранить файл: \(error.localizedDescription)"])
        }
    }

    private func sanitizedFilename(_ value: String) -> String {
        let invalid = CharacterSet(charactersIn: "/:")
        return value.components(separatedBy: invalid).joined(separator: "-")
    }

    private func sendSerialData(_ data: Data) {
        callJavaScript(
            function: "window.__openhandSerialBridge?.receive",
            payload: ["data": data.base64EncodedString()]
        )
    }

    private func sendSerialDisconnect(_ reason: String) {
        callJavaScript(
            function: "window.__openhandSerialBridge?.disconnected",
            payload: ["error": reason]
        )
    }

    private func resolve(_ id: Int, result: Any) {
        callJavaScript(
            function: "window.__openhandSerialBridge?.resolve",
            payload: ["id": id, "result": result]
        )
    }

    private func reject(_ id: Int, error: Error) {
        reject(id, message: error.localizedDescription)
    }

    private func reject(_ id: Int, message: String) {
        callJavaScript(
            function: "window.__openhandSerialBridge?.resolve",
            payload: ["id": id, "error": message]
        )
    }

    private func resolveFile(_ id: Int, result: Any) {
        callJavaScript(
            function: "window.__openhandFileBridge?.resolve",
            payload: ["id": id, "result": result]
        )
    }

    private func callJavaScript(function: String, payload: Any) {
        guard JSONSerialization.isValidJSONObject(payload),
              let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else {
            return
        }
        webView?.evaluateJavaScript("\(function)(\(json));")
    }

    private func showError(_ message: String) {
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = "OpenHand"
        alert.informativeText = message
        alert.runModal()
    }
}
