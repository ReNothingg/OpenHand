import AppKit
import Foundation
import WebKit

@MainActor
final class NativeBridge: NSObject, WKScriptMessageHandler {
    weak var webView: WKWebView?
    private let serial = SerialConnection()
    private var selectedPort: SerialPortDescriptor?

    override init() {
        super.init()

        serial.onData = { [weak self] data in
            self?.sendSerialData(data)
        }
        serial.onDisconnect = { [weak self] reason in
            self?.sendSerialDisconnect(reason)
        }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        switch message.name {
        case "serialBridge":
            handleSerialMessage(message.body)
        case "fileBridge":
            handleFileMessage(message.body)
        default:
            break
        }
    }

    private func handleSerialMessage(_ body: Any) {
        guard let payload = body as? [String: Any],
              let requestID = payload["id"] as? NSNumber,
              let action = payload["action"] as? String else {
            return
        }

        let id = requestID.intValue
        switch action {
        case "requestPort":
            do {
                let port = try choosePort()
                selectedPort = port
                resolve(id, result: ["path": port.path, "name": port.name])
            } catch {
                reject(id, error: error)
            }

        case "open":
            guard let path = payload["path"] as? String,
                  let baudRate = payload["baudRate"] as? NSNumber else {
                reject(id, message: "Некорректные параметры открытия порта.")
                return
            }

            serial.open(path: path, baudRate: baudRate.intValue) { [weak self] result in
                switch result {
                case .success:
                    self?.resolve(id, result: ["opened": true])
                case let .failure(error):
                    self?.reject(id, error: error)
                }
            }

        case "write":
            guard let encoded = payload["data"] as? String,
                  let data = Data(base64Encoded: encoded) else {
                reject(id, message: "Не удалось декодировать данные для порта.")
                return
            }

            serial.write(data) { [weak self] result in
                switch result {
                case .success:
                    self?.resolve(id, result: ["written": data.count])
                case let .failure(error):
                    self?.reject(id, error: error)
                }
            }

        case "setSignals":
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
                self?.resolve(id, result: ["closed": true])
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
