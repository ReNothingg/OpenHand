import Foundation

@main
struct SerialConnectionSmoke {
    static func main() async {
        let ports = SerialConnection.availablePorts()
        precondition(ports.allSatisfy { $0.path.hasPrefix("/dev/cu.") })
        precondition(ports.allSatisfy {
            !$0.path.localizedCaseInsensitiveContains("Bluetooth-Incoming-Port")
        })

        let connection = SerialConnection()
        do {
            try await withCheckedThrowingContinuation { continuation in
                connection.write(Data([0x18])) { result in
                    continuation.resume(with: result)
                }
            }
            fatalError("Запись без открытого порта не должна завершаться успешно.")
        } catch SerialConnectionError.notOpen {
            // Ожидаемое безопасное поведение.
        } catch {
            fatalError("Неожиданная ошибка записи: \(error)")
        }

        do {
            try await withCheckedThrowingContinuation { continuation in
                connection.setSignals(
                    dataTerminalReady: true,
                    requestToSend: true
                ) { result in
                    continuation.resume(with: result)
                }
            }
            fatalError("Сигналы нельзя менять без открытого порта.")
        } catch SerialConnectionError.notOpen {
            // Ожидаемое безопасное поведение.
        } catch {
            fatalError("Неожиданная ошибка сигналов: \(error)")
        }

        print("SerialConnection smoke: OK")
    }
}
