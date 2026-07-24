import SwiftUI

struct ContentView: View {
    var body: some View {
        ZStack {
            Rectangle()
                .fill(.ultraThinMaterial)
                .ignoresSafeArea()

            OpenHandWebView()
                .frame(minWidth: 980, minHeight: 680)
        }
        .ignoresSafeArea(.container, edges: .bottom)
    }
}
