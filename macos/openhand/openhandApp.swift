import Combine
import SwiftUI

@MainActor
private final class OpenHandAppState: ObservableObject {
    @Published var documentRequest: OpenDocumentRequest?
    @Published var workspace = "document"
    @Published var editor = true
    @Published var settings = true
    @Published var appearance = "system"
    @Published var locked = false
    @Published var ready = false
    func receive(_ payload: [AnyHashable: Any]) {
        if let value = payload["workspace"] as? String { workspace = value; ready = true }
        if let value = payload["editor"] as? Bool { editor = value }
        if let value = payload["settings"] as? Bool { settings = value }
        if let value = payload["locked"] as? Bool { locked = value }
        if let value = payload["appearance"] as? String { appearance = value }
    }
    func command(_ action: String) {
        NotificationCenter.default.post(name: Notification.Name("OpenHandMenuCommand"), object: action)
    }
    func select(_ mode: String) {
        NotificationCenter.default.post(name: Notification.Name("OpenHandWorkspace"), object: mode)
    }
}

@main
struct openhandApp: App {
    @StateObject private var state = OpenHandAppState()
    var body: some Scene {
        WindowGroup("OpenHand", id: "main") {
            ContentView(documentRequest: state.documentRequest)
                .onOpenURL { state.documentRequest = OpenDocumentRequest(url: $0) }
                .onReceive(NotificationCenter.default.publisher(for: Notification.Name("OpenHandMenuState"))) {
                    state.receive($0.userInfo ?? [:])
                }
        }
        .defaultSize(width: 1440, height: 900)
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("Открыть G-code…") { state.command("open") }
                    .keyboardShortcut("o").disabled(!state.ready || state.locked)
            }
            CommandGroup(replacing: .printItem) {
                Button("Печать…") { state.command("print") }.keyboardShortcut("p")
                    .disabled(!state.ready || state.workspace != "document")
            }
            CommandMenu("Рабочее пространство") {
                Toggle("Документ", isOn: Binding(get: { state.workspace == "document" }, set: { _ in state.select("document") }))
                    .keyboardShortcut("1", modifiers: [.command, .shift]).disabled(!state.ready || state.locked)
                Toggle("Мастерская плоттера", isOn: Binding(get: { state.workspace == "workshop" }, set: { _ in state.select("workshop") }))
                    .keyboardShortcut("2", modifiers: [.command, .shift]).disabled(!state.ready || state.locked)
                Divider()
                Toggle("Редактор текста", isOn: Binding(get: { state.editor }, set: { _ in state.command("editor") }))
                    .keyboardShortcut("e", modifiers: [.command, .option]).disabled(!state.ready || state.locked || state.workspace != "document")
                Toggle("Панель настроек", isOn: Binding(get: { state.settings }, set: { _ in state.command("settings") }))
                    .keyboardShortcut("s", modifiers: [.command, .option]).disabled(!state.ready || state.locked || state.workspace != "document")
                Divider()
                Menu("Оформление") {
                    Toggle("Как в системе", isOn: Binding(get: { state.appearance == "system" }, set: { _ in state.command("appearance:system") }))
                    Toggle("Светлое", isOn: Binding(get: { state.appearance == "light" }, set: { _ in state.command("appearance:light") }))
                    Toggle("Тёмное", isOn: Binding(get: { state.appearance == "dark" }, set: { _ in state.command("appearance:dark") }))
                }
            }
        }
    }
}
