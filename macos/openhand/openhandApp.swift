import Combine
import SwiftUI

@MainActor
private final class OpenHandAppState: ObservableObject {
    @Published var documentRequest: OpenDocumentRequest?
}

@main
struct openhandApp: App {
    @StateObject private var state = OpenHandAppState()

    var body: some Scene {
        WindowGroup("OpenHand", id: "main") {
            ContentView(documentRequest: state.documentRequest)
                .onOpenURL { url in
                    state.documentRequest = OpenDocumentRequest(url: url)
                }
        }
        .defaultSize(width: 1440, height: 900)
        .commands {
            CommandGroup(replacing: .newItem) { }
            CommandMenu("Рабочее пространство") {
                Button("Документ") {
                    NotificationCenter.default.post(name: Notification.Name("OpenHandWorkspace"), object: "document")
                }.keyboardShortcut("1", modifiers: [.command, .shift])
                Button("Мастерская плоттера") {
                    NotificationCenter.default.post(name: Notification.Name("OpenHandWorkspace"), object: "workshop")
                }.keyboardShortcut("2", modifiers: [.command, .shift])
            }
        }
    }
}
