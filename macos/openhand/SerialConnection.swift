import Darwin
import Foundation

struct SerialPortDescriptor {
    let path: String
    let name: String
}

enum SerialConnectionError: LocalizedError {
    case noPorts
    case notOpen
    case openFailed(String, Int32)
    case configurationFailed(String)
    case unsupportedBaudRate(Int)
    case writeFailed(Int32)

    var errorDescription: String? {
        switch self {
        case .noPorts:
            return "Последовательные порты не найдены. Подключите устройство и повторите попытку."
        case .notOpen:
            return "Последовательный порт не открыт."
        case let .openFailed(path, code):
            return "Не удалось открыть \(path): \(String(cString: strerror(code)))."
        case let .configurationFailed(message):
            return "Не удалось настроить порт: \(message)."
        case let .unsupportedBaudRate(value):
            return "Скорость \(value) бод не поддерживается."
        case let .writeFailed(code):
            return "Ошибка записи в порт: \(String(cString: strerror(code)))."
        }
    }
}

final class SerialConnection: @unchecked Sendable {
    typealias DataHandler = @MainActor @Sendable (Data) -> Void
    typealias DisconnectHandler = @MainActor @Sendable (String) -> Void
    typealias Completion = @MainActor @Sendable (Result<Void, Error>) -> Void
    typealias CloseCompletion = @MainActor @Sendable () -> Void

    private let queue = DispatchQueue(label: "com.renothingg.openhand.serial", qos: .userInitiated)
    private var descriptor: Int32 = -1
    private var readSource: DispatchSourceRead?
    private var manuallyClosing = false

    var onData: DataHandler?
    var onDisconnect: DisconnectHandler?

    static func availablePorts() -> [SerialPortDescriptor] {
        let names = (try? FileManager.default.contentsOfDirectory(atPath: "/dev")) ?? []
        let callout = names
            .filter { $0.hasPrefix("cu.") }
            .filter { !$0.localizedCaseInsensitiveContains("Bluetooth-Incoming-Port") }
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

    func open(path: String, baudRate: Int, completion: @escaping Completion) {
        queue.async { [weak self] in
            guard let self else { return }
            self.closeLocked(notify: false)

            let fileDescriptor = Darwin.open(path, O_RDWR | O_NOCTTY | O_NONBLOCK)
            guard fileDescriptor >= 0 else {
                self.complete(.failure(SerialConnectionError.openFailed(path, errno)), completion)
                return
            }

            do {
                try self.configure(fileDescriptor, baudRate: baudRate)
                self.descriptor = fileDescriptor
                self.manuallyClosing = false
                self.startReading(fileDescriptor)
                self.complete(.success(()), completion)
            } catch {
                Darwin.close(fileDescriptor)
                self.complete(.failure(error), completion)
            }
        }
    }

    func write(_ data: Data, completion: @escaping Completion) {
        queue.async { [weak self] in
            guard let self else { return }
            guard self.descriptor >= 0 else {
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

    func setSignals(dataTerminalReady: Bool?, requestToSend: Bool?, completion: @escaping Completion) {
        queue.async { [weak self] in
            guard let self else { return }
            guard self.descriptor >= 0 else {
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

    func close(completion: CloseCompletion? = nil) {
        queue.async { [weak self] in
            guard let self else { return }
            self.manuallyClosing = true
            self.closeLocked(notify: false)
            guard let completion else { return }
            DispatchQueue.main.async(execute: completion)
        }
    }

    private func configure(_ fileDescriptor: Int32, baudRate: Int) throws {
        var options = termios()
        guard tcgetattr(fileDescriptor, &options) == 0 else {
            throw SerialConnectionError.configurationFailed(String(cString: strerror(errno)))
        }

        cfmakeraw(&options)
        options.c_cflag |= tcflag_t(CLOCAL | CREAD)
        options.c_cflag &= ~tcflag_t(PARENB | CSTOPB | CSIZE)
        options.c_cflag |= tcflag_t(CS8)
        options.c_iflag &= ~tcflag_t(IXON | IXOFF | IXANY)

        let standardSpeed: speed_t
        switch baudRate {
        case 9_600:
            standardSpeed = speed_t(B9600)
        case 115_200:
            standardSpeed = speed_t(B115200)
        case 250_000:
            standardSpeed = speed_t(B115200)
        default:
            throw SerialConnectionError.unsupportedBaudRate(baudRate)
        }

        guard cfsetispeed(&options, standardSpeed) == 0,
              cfsetospeed(&options, standardSpeed) == 0,
              tcsetattr(fileDescriptor, TCSANOW, &options) == 0 else {
            throw SerialConnectionError.configurationFailed(String(cString: strerror(errno)))
        }

        if baudRate == 250_000 {
            var customSpeed = speed_t(baudRate)
            let iossiospeed = UInt(0x80045402)
            guard ioctl(fileDescriptor, iossiospeed, &customSpeed) >= 0 else {
                throw SerialConnectionError.configurationFailed(
                    "драйвер устройства не принял нестандартную скорость 250000 бод"
                )
            }
        }

        guard fcntl(fileDescriptor, F_SETFL, 0) >= 0 else {
            throw SerialConnectionError.configurationFailed(String(cString: strerror(errno)))
        }

        tcflush(fileDescriptor, TCIOFLUSH)
    }

    private func setModemBit(_ bit: Int32, enabled: Bool) {
        var value = bit
        let request = enabled ? UInt(TIOCMBIS) : UInt(TIOCMBIC)
        _ = ioctl(descriptor, request, &value)
    }

    private func startReading(_ fileDescriptor: Int32) {
        let source = DispatchSource.makeReadSource(fileDescriptor: fileDescriptor, queue: queue)
        source.setEventHandler { [weak self, weak source] in
            guard let self, let source, self.descriptor == fileDescriptor else { return }
            let suggestedSize = max(1, min(Int(source.data), 65_536))
            var buffer = [UInt8](repeating: 0, count: suggestedSize)
            let count = Darwin.read(fileDescriptor, &buffer, buffer.count)

            if count > 0 {
                let data = Data(buffer.prefix(count))
                if let handler = self.onData {
                    DispatchQueue.main.async {
                        handler(data)
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

        if notify, let handler = onDisconnect {
            DispatchQueue.main.async {
                handler(reason)
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
