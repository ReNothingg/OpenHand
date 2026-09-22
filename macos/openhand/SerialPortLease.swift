import CryptoKit
import Darwin
import Foundation

/// Cooperating OpenHand windows/processes hold this lock for the entire port session.
/// Kernel TIOCEXCL and the targeted legacy-owner check cover other serial clients.
final class SerialPortLease {
    private let descriptor: Int32

    private init(descriptor: Int32) { self.descriptor = descriptor }

    static func devicePaths(_ path: String) -> [String] {
        let resolved = URL(fileURLWithPath: path).resolvingSymlinksInPath().path
        var paths = [resolved]
        if resolved.hasPrefix("/dev/cu.") {
            paths.append("/dev/tty." + resolved.dropFirst("/dev/cu.".count))
        } else if resolved.hasPrefix("/dev/tty.") {
            paths.append("/dev/cu." + resolved.dropFirst("/dev/tty.".count))
        }
        return paths
    }

    static var defaultDirectory: URL {
        URL(fileURLWithPath: "/private/tmp/com.renothingg.openhand-port-locks-\(geteuid())", isDirectory: true)
    }

    static func acquire(path: String, directory: URL = SerialPortLease.defaultDirectory) throws -> SerialPortLease {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                                               attributes: [.posixPermissions: 0o700])
        var directoryInfo = stat()
        guard lstat(directory.path, &directoryInfo) == 0,
              directoryInfo.st_mode & S_IFMT == S_IFDIR,
              directoryInfo.st_uid == geteuid(), directoryInfo.st_mode & 0o077 == 0 else {
            throw SerialConnectionError.ownershipCheckFailed(path, EACCES)
        }
        let identity = devicePaths(path).sorted().first!
        let key = SHA256.hash(data: Data(identity.utf8)).map { String(format: "%02x", $0) }.joined()
        let lockPath = directory.appendingPathComponent(key + ".lock").path
        let fd = Darwin.open(lockPath, O_RDWR | O_CREAT | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard fd >= 0 else { throw SerialConnectionError.ownershipCheckFailed(path, errno) }
        guard flock(fd, LOCK_EX | LOCK_NB) == 0 else {
            let code = errno
            Darwin.close(fd)
            if code == EWOULDBLOCK { throw SerialConnectionError.portBusy(path, "другим окном или копией OpenHand") }
            throw SerialConnectionError.ownershipCheckFailed(path, code)
        }
        return SerialPortLease(descriptor: fd)
    }

    static func assertNoOwners(path: String, ignoring ownPID: pid_t? = nil) throws {
        let paths = devicePaths(path)
        for candidate in paths {
            // The matching call-in device is not present for every driver.
            guard candidate == paths[0] || FileManager.default.fileExists(atPath: candidate) else { continue }
            let requested = candidate.withCString {
                proc_listpidspath(UInt32(PROC_ALL_PIDS), 0, $0, UInt32(PROC_LISTPIDSPATH_EXCLUDE_EVTONLY), nil, 0)
            }
            guard requested >= 0 else { throw SerialConnectionError.ownershipCheckFailed(path, errno) }
            var pids = [Int32](repeating: 0, count: max(64, Int(requested) / MemoryLayout<Int32>.size + 64))
            let bytes = pids.withUnsafeMutableBytes { buffer in
                candidate.withCString {
                    proc_listpidspath(UInt32(PROC_ALL_PIDS), 0, $0, UInt32(PROC_LISTPIDSPATH_EXCLUDE_EVTONLY), buffer.baseAddress, Int32(buffer.count))
                }
            }
            guard bytes >= 0 else { throw SerialConnectionError.ownershipCheckFailed(path, errno) }
            guard Int(bytes) < pids.count * MemoryLayout<Int32>.size else {
                throw SerialConnectionError.ownershipCheckFailed(path, EAGAIN)
            }
            for pid in pids.prefix(Int(bytes) / MemoryLayout<Int32>.size) where pid > 0 && pid != ownPID {
                var name = [CChar](repeating: 0, count: 256)
                let length = proc_name(pid, &name, UInt32(name.count))
                let label = length > 0 ? String(cString: name) : "другая программа"
                throw SerialConnectionError.portBusy(path, "\(label) (PID \(pid))")
            }
        }
    }

    deinit {
        // Never unlink lock files: another process may already be waiting on the inode.
        flock(descriptor, LOCK_UN)
        Darwin.close(descriptor)
    }
}
