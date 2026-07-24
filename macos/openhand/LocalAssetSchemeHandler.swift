import Foundation
import UniformTypeIdentifiers
import WebKit

final class LocalAssetSchemeHandler: NSObject, WKURLSchemeHandler {
    private let rootURL: URL?

    override init() {
        rootURL = Bundle.main.resourceURL?.appendingPathComponent("Web", isDirectory: true)
        super.init()
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let requestURL = urlSchemeTask.request.url,
              requestURL.scheme == "openhand",
              let rootURL else {
            fail(urlSchemeTask, code: .fileNoSuchFile)
            return
        }

        let relativePath = requestURL.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let resourcePath = relativePath.isEmpty ? "index.html" : relativePath
        let fileURL = rootURL.appendingPathComponent(resourcePath).standardizedFileURL
        let normalizedRoot = rootURL.standardizedFileURL.path + "/"

        guard fileURL.path.hasPrefix(normalizedRoot),
              FileManager.default.fileExists(atPath: fileURL.path) else {
            fail(urlSchemeTask, code: .fileNoSuchFile)
            return
        }

        do {
            let data = try Data(contentsOf: fileURL, options: .mappedIfSafe)
            let mimeType = UTType(filenameExtension: fileURL.pathExtension)?.preferredMIMEType
                ?? "application/octet-stream"
            let encoding = mimeType.hasPrefix("text/") || mimeType == "application/javascript"
                ? "utf-8"
                : nil
            let response = URLResponse(
                url: requestURL,
                mimeType: mimeType,
                expectedContentLength: data.count,
                textEncodingName: encoding
            )
            urlSchemeTask.didReceive(response)
            urlSchemeTask.didReceive(data)
            urlSchemeTask.didFinish()
        } catch {
            urlSchemeTask.didFailWithError(error)
        }
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) { }

    private func fail(_ task: WKURLSchemeTask, code: CocoaError.Code) {
        task.didFailWithError(CocoaError(code))
    }
}
