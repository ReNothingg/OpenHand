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
        }
    }
}
