import Darwin
import Foundation

struct SerialPortDescriptor {
    let path: String
    let name: String
}

struct SerialOpenOptions {
    let baudRate: Int
    let dataBits: Int
    let stopBits: Int
    let parity: String
    let flowControl: String

    var description: String {
        let parityName = ["none": "N", "even": "E", "odd": "O"][parity] ?? parity
        return "\(baudRate) бод, \(dataBits)\(parityName)\(stopBits), поток: \(flowControl == "hardware" ? "RTS/CTS" : "нет")"
    }
}

enum SerialConnectionError: LocalizedError {
    case noPorts
    case notOpen
    case portBusy(String, String)
    case ownershipCheckFailed(String, Int32)
    case openFailed(String, Int32)
    case configurationFailed(String)
    case driverRejected(String, String, String, Int32)
    case unsupportedBaudRate(Int)
    case writeFailed(Int32)
    case outputDrainFailed(Int32)
    case outputDrainTimedOut

    var errorDescription: String? {
        switch self {
        case .noPorts:
            return "Последовательные порты не найдены. Подключите устройство и повторите попытку."
        case .notOpen:
            return "Последовательный порт не открыт."
        case let .portBusy(path, owner):
            return "Порт \(path) занят: \(owner). Отключите порт в этой программе или закройте её, затем повторите подключение."
        case let .ownershipCheckFailed(path, code):
            return "Не удалось проверить, свободен ли порт \(path): \(String(cString: strerror(code))). Подключение отменено."
        case let .openFailed(path, code):
            if code == EBUSY { return "Порт \(path) занят другой программой. Закройте её подключение и повторите попытку." }
            return "Не удалось открыть \(path): \(String(cString: strerror(code)))."
        case let .configurationFailed(message):
            return "Не удалось настроить порт: \(message)."
        case let .driverRejected(path, stage, settings, code):
            let recovery = code == EINVAL || code == EIO || code == ENXIO || code == 83
                ? "Отключите USB-кабель от Mac и подключите снова, затем выберите порт заново. Если ошибка повторится, проверьте параметры порта."
                : "Проверьте подключение и параметры порта."
            return "Драйвер не настроил \(path) (\(settings)). \(recovery) Этап: \(stage); \(String(cString: strerror(code))) [\(code)]."
        case let .unsupportedBaudRate(value):
            return "Скорость \(value) бод не поддерживается."
        case let .writeFailed(code):
            return "Ошибка записи в порт: \(String(cString: strerror(code)))."
        case let .outputDrainFailed(code):
            return "Не удалось проверить передачу данных перед закрытием порта: \(String(cString: strerror(code)))."
        case .outputDrainTimedOut:
            return "Передача данных перед закрытием порта не завершилась за 2 секунды. Соединение оставлено открытым."
        }
    }
}

final class SerialConnection: @unchecked Sendable {
    typealias DataHandler = @MainActor @Sendable (String, Data) -> Void
    typealias DisconnectHandler = @MainActor @Sendable (String, String) -> Void
    typealias Completion = @MainActor @Sendable (Result<Void, Error>) -> Void
    typealias CloseCompletion = @MainActor @Sendable () -> Void

    private let queue = DispatchQueue(label: "com.renothingg.openhand.serial", qos: .userInitiated)
    private var descriptor: Int32 = -1
    private var portLease: SerialPortLease?
    private var readSource: DispatchSourceRead?
    private var manuallyClosing = false
    private var connectionGeneration: UInt64 = 0
    private var sessionID: String?

    var onData: DataHandler?
    var onDisconnect: DisconnectHandler?

    static func availablePorts() -> [SerialPortDescriptor] {
        let names = (try? FileManager.default.contentsOfDirectory(atPath: "/dev")) ?? []
        let callout = names
            .filter { $0.hasPrefix("cu.") }
            .filter { !$0.localizedCaseInsensitiveContains("Bluetooth-Incoming-Port") && $0 != "cu.debug-console" }
            .sorted { $0.localizedStandardCompare($1) == .orderedAscending }

        return callout.map { device in
            SerialPortDescriptor(
                path: "/dev/\(device)",
                name: friendlyName(for: device)
            )
        }
    }

    private static func friendlyName(for device: String) -> String {
        let identifier = String(device.dropFirst(3))
        let lowercased = identifier.lowercased()
        let kind: String

        if lowercased.contains("usbmodem") {
            kind = "USB modem"
        } else if lowercased.contains("usbserial") || lowercased.contains("wchusb") {
            kind = "USB Serial"
        } else if lowercased.contains("slab_usbtouart") {
            kind = "Silicon Labs USB UART"
        } else if lowercased.contains("bluetooth") {
            kind = "Bluetooth"
        } else {
            kind = "Последовательный порт"
        }

        return "\(kind) — \(identifier)"
    }

    func open(path: String, options: SerialOpenOptions, sessionID: String = UUID().uuidString, completion: @escaping Completion) {
        queue.async { [weak self] in
            guard let self else { return }
            self.closeLocked(notify: false)

            do {
                let lease = try SerialPortLease.acquire(path: path)
                try SerialPortLease.assertNoOwners(path: path)
                let fileDescriptor = Darwin.open(path, O_RDWR | O_NOCTTY | O_NONBLOCK | O_CLOEXEC)
                guard fileDescriptor >= 0 else { throw SerialConnectionError.openFailed(path, errno) }
                do {
                    guard ioctl(fileDescriptor, UInt(TIOCEXCL)) == 0 else {
                        throw SerialConnectionError.openFailed(path, errno)
                    }
                    // TIOCEXCL prevents future opens, but does not evict an older client.
                    try SerialPortLease.assertNoOwners(path: path, ignoring: getpid())
                    try self.configure(fileDescriptor, path: path, options: options)
                    self.descriptor = fileDescriptor
                    self.sessionID = sessionID
                    self.portLease = lease
                    self.manuallyClosing = false
                    self.startReading(fileDescriptor, sessionID: sessionID)
                    self.complete(.success(()), completion)
                } catch {
                    Darwin.close(fileDescriptor)
                    throw error
                }
            } catch {
                self.complete(.failure(error), completion)
            }
        }
    }

    func write(_ data: Data, sessionID: String? = nil, completion: @escaping Completion) {
        queue.async { [weak self] in
            guard let self else { return }
            guard self.descriptor >= 0, sessionID == nil || sessionID == self.sessionID else {
                self.complete(.failure(SerialConnectionError.notOpen), completion)
                return
            }

            var result: Result<Void, Error> = .success(())
            data.withUnsafeBytes { rawBuffer in
                guard let baseAddress = rawBuffer.baseAddress else { return }
                var offset = 0

                while offset < rawBuffer.count {
                    let written = Darwin.write(
                        self.descriptor,
                        baseAddress.advanced(by: offset),
                        rawBuffer.count - offset
                    )
                    if written > 0 {
                        offset += written
                    } else if written < 0 && errno == EINTR {
                        continue
                    } else {
                        result = .failure(SerialConnectionError.writeFailed(errno))
                        break
                    }
                }
            }
            self.complete(result, completion)
        }
    }

    /// A successful write means queued bytes. Closing a tty before they drain can discard STOP.
    func closeAfterDraining(requireOpen: Bool, completion: @escaping Completion) {
        queue.async { [weak self] in
            guard let self else { return }
            if self.descriptor < 0 {
                self.complete(requireOpen ? .failure(SerialConnectionError.notOpen) : .success(()), completion)
                return
            }
            self.drainAndClose(generation: self.connectionGeneration,
                               deadline: DispatchTime.now().uptimeNanoseconds + 2_000_000_000, completion: completion)
        }
    }

    private func drainAndClose(generation: UInt64, deadline: UInt64, completion: @escaping Completion) {
        guard descriptor >= 0, connectionGeneration == generation else {
            complete(.failure(SerialConnectionError.notOpen), completion)
            return
        }
        var queued: Int32 = 0
        guard ioctl(descriptor, UInt(TIOCOUTQ), &queued) == 0 else {
            complete(.failure(SerialConnectionError.outputDrainFailed(errno)), completion)
            return
        }
        if queued == 0 {
            manuallyClosing = true
            closeLocked(notify: false)
            complete(.success(()), completion)
        } else if DispatchTime.now().uptimeNanoseconds >= deadline {
            complete(.failure(SerialConnectionError.outputDrainTimedOut), completion)
        } else {
            // Keep the serial queue responsive instead of blocking indefinitely in tcdrain.
            queue.asyncAfter(deadline: .now() + 0.01) { [weak self] in
                self?.drainAndClose(generation: generation, deadline: deadline, completion: completion)
            }
        }
    }

    func setSignals(dataTerminalReady: Bool?, requestToSend: Bool?, sessionID: String? = nil, completion: @escaping Completion) {
        queue.async { [weak self] in
            guard let self else { return }
            guard self.descriptor >= 0, sessionID == nil || sessionID == self.sessionID else {
                self.complete(.failure(SerialConnectionError.notOpen), completion)
                return
            }

            if let dataTerminalReady {
                self.setModemBit(Int32(TIOCM_DTR), enabled: dataTerminalReady)
            }
            if let requestToSend {
                self.setModemBit(Int32(TIOCM_RTS), enabled: requestToSend)
            }
            self.complete(.success(()), completion)
        }
    }

    func close(sessionID: String? = nil, completion: CloseCompletion? = nil) {
        queue.async { [weak self] in
            guard let self else { return }
            if let sessionID, self.sessionID != sessionID {
                if let completion { DispatchQueue.main.async(execute: completion) }
                return
            }
            self.manuallyClosing = true
            self.closeLocked(notify: false)
            guard let completion else { return }
            DispatchQueue.main.async(execute: completion)
        }
    }

    private func configure(_ fileDescriptor: Int32, path: String, options serialOptions: SerialOpenOptions) throws {
        func driverError(_ stage: String) -> SerialConnectionError {
            let code = errno
            return .driverRejected(path, stage, serialOptions.description, code)
        }
        var options = termios()
        guard tcgetattr(fileDescriptor, &options) == 0 else {
            throw driverError("tcgetattr")
        }

        cfmakeraw(&options)
        options.c_cflag |= tcflag_t(CLOCAL | CREAD)
        options.c_cflag &= ~tcflag_t(PARENB | PARODD | CSTOPB | CSIZE | CCTS_OFLOW | CRTS_IFLOW)
        options.c_iflag &= ~tcflag_t(IXON | IXOFF | IXANY | INPCK)

        switch serialOptions.dataBits {
        case 7:
            options.c_cflag |= tcflag_t(CS7)
        case 8:
            options.c_cflag |= tcflag_t(CS8)
        default:
            throw SerialConnectionError.configurationFailed("поддерживаются только 7 или 8 бит данных")
        }

        switch serialOptions.stopBits {
        case 1:
            break
        case 2:
            options.c_cflag |= tcflag_t(CSTOPB)
        default:
            throw SerialConnectionError.configurationFailed("поддерживаются только 1 или 2 стоп-бита")
        }

        switch serialOptions.parity {
        case "none":
            break
        case "even":
            options.c_cflag |= tcflag_t(PARENB)
            options.c_iflag |= tcflag_t(INPCK)
        case "odd":
            options.c_cflag |= tcflag_t(PARENB | PARODD)
            options.c_iflag |= tcflag_t(INPCK)
        default:
            throw SerialConnectionError.configurationFailed("неизвестный режим чётности")
        }

        switch serialOptions.flowControl {
        case "none":
            break
        case "hardware":
            options.c_cflag |= tcflag_t(CCTS_OFLOW | CRTS_IFLOW)
        default:
            throw SerialConnectionError.configurationFailed("неизвестный режим управления потоком")
        }

        let standardSpeed: speed_t
        switch serialOptions.baudRate {
        case 9_600:
            standardSpeed = speed_t(B9600)
        case 115_200:
            standardSpeed = speed_t(B115200)
        case 250_000:
            standardSpeed = speed_t(B115200)
        default:
            throw SerialConnectionError.unsupportedBaudRate(serialOptions.baudRate)
        }

        guard cfsetispeed(&options, standardSpeed) == 0 else {
            throw driverError("скорость приёма")
        }
        guard cfsetospeed(&options, standardSpeed) == 0 else {
            throw driverError("скорость передачи")
        }
        guard tcsetattr(fileDescriptor, TCSANOW, &options) == 0 else {
            throw driverError("tcsetattr")
        }

        if serialOptions.baudRate == 250_000 {
            var customSpeed = speed_t(serialOptions.baudRate)
            // IOSSIOSPEED = _IOW('T', 2, speed_t). Darwin speed_t is 64-bit
            // on both supported architectures; 0x80045402 is the 32-bit ABI.
            let iossiospeed = UInt(0x80000000) | (UInt(MemoryLayout<speed_t>.size) << 16)
                | (UInt(0x54) << 8) | 2
            guard ioctl(fileDescriptor, iossiospeed, &customSpeed) >= 0 else {
                throw driverError("IOSSIOSPEED")
            }
        }

        // A stalled UART must not block this serial queue and strand STOP
        // behind a blocking read/write. DispatchSource handles read readiness.
        guard fcntl(fileDescriptor, F_SETFL, O_NONBLOCK) >= 0 else {
            throw driverError("режим чтения порта")
        }

        tcflush(fileDescriptor, TCIOFLUSH)
    }

    private func setModemBit(_ bit: Int32, enabled: Bool) {
        var value = bit
        let request = enabled ? UInt(TIOCMBIS) : UInt(TIOCMBIC)
        _ = ioctl(descriptor, request, &value)
    }

    private func startReading(_ fileDescriptor: Int32, sessionID: String) {
        let source = DispatchSource.makeReadSource(fileDescriptor: fileDescriptor, queue: queue)
        source.setEventHandler { [weak self, weak source] in
            guard let self, let source, self.descriptor == fileDescriptor, self.sessionID == sessionID else { return }
            let suggestedSize = max(1, min(Int(source.data), 65_536))
            var buffer = [UInt8](repeating: 0, count: suggestedSize)
            let count = Darwin.read(fileDescriptor, &buffer, buffer.count)

            if count > 0 {
                let data = Data(buffer.prefix(count))
                if let handler = self.onData {
                    DispatchQueue.main.async {
                        handler(sessionID, data)
                    }
                }
            } else if count == 0 {
                self.closeLocked(notify: !self.manuallyClosing)
            } else if count < 0 && errno != EAGAIN && errno != EINTR {
                let message = String(cString: strerror(errno))
                self.closeLocked(notify: !self.manuallyClosing, reason: message)
            }
        }
        readSource = source
        source.resume()
    }

    private func closeLocked(notify: Bool, reason: String = "Устройство отключено.") {
        let closedSessionID = sessionID
        sessionID = nil
        connectionGeneration &+= 1
        let oldDescriptor = descriptor
        descriptor = -1

        if let source = readSource {
            source.setEventHandler(handler: nil)
            source.cancel()
            readSource = nil
        }
        if oldDescriptor >= 0 {
            Darwin.close(oldDescriptor)
        }

        portLease = nil

        if notify, let closedSessionID, let handler = onDisconnect {
            DispatchQueue.main.async {
                handler(closedSessionID, reason)
            }
        }
    }

    private func complete(
        _ result: Result<Void, Error>,
        _ completion: @escaping Completion
    ) {
        DispatchQueue.main.async {
            completion(result)
        }
    }

    deinit {
        queue.sync {
            closeLocked(notify: false)
        }
    }
}
