import Foundation
import Network

final class TcpConnection: @unchecked Sendable {
    typealias DataHandler = @MainActor @Sendable (Data) -> Void
    typealias DisconnectHandler = @MainActor @Sendable (String) -> Void
    typealias Completion = @MainActor @Sendable (Result<Void, Error>) -> Void
    typealias CloseCompletion = @MainActor @Sendable () -> Void

    private let queue = DispatchQueue(label: "com.renothingg.openhand.tcp", qos: .userInitiated)
    private var connection: NWConnection?
    private var openCompletion: Completion?
    private var manuallyClosing = false

    var onData: DataHandler?
    var onDisconnect: DisconnectHandler?

    func open(host: String, port: Int, completion: @escaping Completion) {
        queue.async { [weak self] in
            guard let self else { return }
            self.closeLocked()
            guard !host.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  let networkPort = NWEndpoint.Port(rawValue: UInt16(clamping: port)),
                  port > 0,
                  port <= 65_535 else {
                self.complete(
                    .failure(self.error("Некорректный IP/хост или TCP-порт плоттера.")),
                    completion
                )
                return
            }

            let connection = NWConnection(
                host: NWEndpoint.Host(host),
                port: networkPort,
                using: .tcp
            )
            self.connection = connection
            self.openCompletion = completion
            self.manuallyClosing = false
            connection.stateUpdateHandler = { [weak self, weak connection] state in
                guard let self, let connection else { return }
                self.handleState(state, for: connection)
            }
            connection.start(queue: self.queue)
        }
    }

    func write(_ data: Data, completion: @escaping Completion) {
        queue.async { [weak self] in
            guard let self else { return }
            guard let connection = self.connection else {
                self.complete(.failure(self.error("TCP-соединение не открыто.")), completion)
                return
            }
            connection.send(content: data, completion: .contentProcessed { [weak self] error in
                guard let self else { return }
                if let error {
                    self.complete(.failure(error), completion)
                } else {
                    self.complete(.success(()), completion)
                }
            })
        }
    }

    func close(completion: CloseCompletion? = nil) {
        queue.async { [weak self] in
            guard let self else { return }
            self.manuallyClosing = true
            self.closeLocked()
            guard let completion else { return }
            DispatchQueue.main.async(execute: completion)
        }
    }

    private func handleState(_ state: NWConnection.State, for candidate: NWConnection) {
        guard connection === candidate else { return }
        switch state {
        case .ready:
            if let completion = openCompletion {
                openCompletion = nil
                complete(.success(()), completion)
            }
            receiveNext(from: candidate)
        case let .failed(error):
            fail(candidate, error: error)
        case .cancelled:
            if !manuallyClosing {
                fail(candidate, error: error("TCP-соединение с плоттером закрыто."))
            }
        default:
            break
        }
    }

    private func receiveNext(from candidate: NWConnection) {
        candidate.receive(
            minimumIncompleteLength: 1,
            maximumLength: 65_536
        ) { [weak self, weak candidate] data, _, complete, error in
            guard let self, let candidate, self.connection === candidate else { return }
            if let data, !data.isEmpty, let handler = self.onData {
                DispatchQueue.main.async { handler(data) }
            }
            if let error {
                self.fail(candidate, error: error)
            } else if complete {
                self.fail(
                    candidate,
                    error: self.error("Плоттер закрыл TCP-соединение.")
                )
            } else {
                self.receiveNext(from: candidate)
            }
        }
    }

    private func fail(_ candidate: NWConnection, error: Error) {
        guard connection === candidate else { return }
        connection = nil
        candidate.stateUpdateHandler = nil
        candidate.cancel()
        if let completion = openCompletion {
            openCompletion = nil
            complete(.failure(error), completion)
        } else if !manuallyClosing, let handler = onDisconnect {
            DispatchQueue.main.async { handler(error.localizedDescription) }
        }
    }

    private func closeLocked() {
        let candidate = connection
        connection = nil
        candidate?.stateUpdateHandler = nil
        candidate?.cancel()
        if let completion = openCompletion {
            openCompletion = nil
            complete(
                .failure(error("TCP-подключение отменено.")),
                completion
            )
        }
    }

    private func complete(
        _ result: Result<Void, Error>,
        _ completion: @escaping Completion
    ) {
        DispatchQueue.main.async { completion(result) }
    }

    private func error(_ message: String) -> NSError {
        NSError(
            domain: "OpenHand.TCP",
            code: 1,
            userInfo: [NSLocalizedDescriptionKey: message]
        )
    }

    deinit {
        queue.sync { closeLocked() }
    }
}
