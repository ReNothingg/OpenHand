import Darwin
import Foundation

enum SmokeTestError: LocalizedError {
    case pseudoTerminal
    case noData
    case wrongData(String)

    var errorDescription: String? {
        switch self {
        case .pseudoTerminal:
            return "Не удалось создать тестовый псевдотерминал."
        case .noData:
            return "Последовательный мост не передал данные."
        case let .wrongData(value):
            return "Получены неожиданные данные: \(value)"
        }
    }
}

@main
struct SerialConnectionSmoke {
    @MainActor
    static func main() async throws {
        var master: Int32 = -1
        var slave: Int32 = -1
        var pathBuffer = [CChar](repeating: 0, count: 1_024)

        guard openpty(&master, &slave, &pathBuffer, nil, nil) == 0 else {
            throw SmokeTestError.pseudoTerminal
        }
        Darwin.close(slave)
        defer { Darwin.close(master) }

        let path = String(cString: pathBuffer)
        let connection = SerialConnection()
        let incoming = AsyncStream<Data> { continuation in
            connection.onData = { data in
                continuation.yield(data)
            }
        }
        var incomingIterator = incoming.makeAsyncIterator()

        let openResult = await withCheckedContinuation { continuation in
            connection.open(path: path, baudRate: 9_600) {
                continuation.resume(returning: $0)
            }
        }
        try openResult.get()

        let controllerReply = Data("ok\r\n".utf8)
        _ = controllerReply.withUnsafeBytes {
            Darwin.write(master, $0.baseAddress, $0.count)
        }
        guard let received = await incomingIterator.next() else {
            throw SmokeTestError.noData
        }
        guard received == controllerReply else {
            throw SmokeTestError.wrongData(String(decoding: received, as: UTF8.self))
        }

        let command = Data("G0 X1 Y2\n".utf8)
        let writeResult = await withCheckedContinuation { continuation in
            connection.write(command) {
                continuation.resume(returning: $0)
            }
        }
        try writeResult.get()

        var output = [UInt8](repeating: 0, count: 128)
        let outputCount = Darwin.read(master, &output, output.count)
        guard outputCount > 0 else {
            throw SmokeTestError.noData
        }
        let transmitted = Data(output.prefix(outputCount))
        guard transmitted == command else {
            throw SmokeTestError.wrongData(String(decoding: transmitted, as: UTF8.self))
        }

        await withCheckedContinuation { continuation in
            connection.close {
                continuation.resume()
            }
        }
        print("SerialConnection smoke test: OK")
    }
}
