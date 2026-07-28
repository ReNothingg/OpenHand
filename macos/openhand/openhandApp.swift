import SwiftUI

@main
struct openhandApp: App {
    @State private var documentRequest: OpenDocumentRequest?

    var body: some Scene {
        WindowGroup("OpenHand", id: "main") {
            ContentView(documentRequest: documentRequest)
                .onOpenURL { url in
                    documentRequest = OpenDocumentRequest(url: url)
                }
        }
        .defaultSize(width: 1440, height: 900)
        .commands {
            CommandGroup(replacing: .newItem) { }
        }
    }
}
