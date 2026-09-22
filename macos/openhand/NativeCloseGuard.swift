import AppKit
import WebKit

/// Keeps the native connection alive until STOP has been delivered and the port closed.
@MainActor
final class NativeCloseGuard: NSObject, NSWindowDelegate {
    weak var downstream: NSWindowDelegate?
    private let bridge: NativeBridge
    private var awaitingClose = false
    private var allowClose = false

    init(bridge: NativeBridge) { self.bridge = bridge }

    func install(on window: NSWindow) {
        guard window.delegate !== self else { return }
        downstream = window.delegate
        window.delegate = self
    }

    override func responds(to selector: Selector!) -> Bool {
        super.responds(to: selector) || downstream?.responds(to: selector) == true
    }

    override func forwardingTarget(for selector: Selector!) -> Any? {
        if downstream?.responds(to: selector) == true { return downstream }
        return super.forwardingTarget(for: selector)
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        if allowClose || !bridge.needsShutdown {
            allowClose = false
            let accepted = downstream?.windowShouldClose?(sender) ?? true
            if !accepted { bridge.cancelCloseRequest() }
            return accepted
        }
        guard !awaitingClose else { return false }
        awaitingClose = true
        bridge.prepareForClose { [self, weak sender] result in
            awaitingClose = false
            guard let sender else { return }
            switch result {
            case .success:
                allowClose = true
                sender.performClose(nil)
            case let .failure(error):
                Self.showFailure(error, window: sender)
            }
        }
        return false
    }

    static func showFailure(_ error: Error, window: NSWindow?) {
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = "Не удалось подтвердить остановку"
        alert.informativeText = error.localizedDescription + "\nПриложение оставлено открытым. Если плоттер движется или визжит, отключите питание и USB."
        alert.addButton(withTitle: "Оставить открытым")
        if let window, window.attachedSheet == nil { alert.beginSheetModal(for: window) }
        else { alert.runModal() }
    }
}

@MainActor
final class OpenHandLifecycle: NSObject, NSApplicationDelegate {
    private var terminating = false
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard !terminating else { return .terminateLater }
        let bridges = NativeBridge.liveBridges.allObjects.filter { $0.needsShutdown }
        guard !bridges.isEmpty else { return .terminateNow }
        terminating = true
        var remaining = bridges.count
        var firstFailure: Error?
        for bridge in bridges {
            bridge.prepareForClose { [self] result in
                if case let .failure(error) = result, firstFailure == nil { firstFailure = error }
                remaining -= 1
                guard remaining == 0 else { return }
                // prepareForClose can finish synchronously for a cancelled open.
                // Reply only after applicationShouldTerminate has returned.
                DispatchQueue.main.async { [self] in
                    terminating = false
                    if let firstFailure {
                        bridges.forEach { $0.cancelCloseRequest() }
                        sender.reply(toApplicationShouldTerminate: false)
                        NativeCloseGuard.showFailure(firstFailure, window: sender.keyWindow)
                    } else {
                        sender.reply(toApplicationShouldTerminate: true)
                    }
                }
            }
        }
        return .terminateLater
    }
}

@MainActor
final class CloseAwareWebView: WKWebView {
    var onWindowReady: ((NSWindow) -> Void)?
    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        guard window != nil else { return }
        DispatchQueue.main.async { [weak self] in
            guard let self, let window = self.window else { return }
            self.onWindowReady?(window)
        }
    }
}
