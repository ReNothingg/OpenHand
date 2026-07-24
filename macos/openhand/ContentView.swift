import SwiftUI

struct ContentView: View {
    let documentRequest: OpenDocumentRequest?

    var body: some View {
        OpenHandWebView(documentRequest: documentRequest)
            .frame(minWidth: 980, minHeight: 680)
            .ignoresSafeArea(.container, edges: .bottom)
    }
}
