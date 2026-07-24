import SwiftUI

struct ContentView: View {
    var body: some View {
        OpenHandWebView()
            .frame(minWidth: 980, minHeight: 680)
            .ignoresSafeArea(.container, edges: .bottom)
    }
}
