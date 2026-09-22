using System.IO.Ports;

namespace OpenHand;

internal sealed record SerialPortDescriptor(string Path, string Name)
{
    public override string ToString() => $"{Name}  ({Path})";
}

internal sealed record SerialOpenOptions(
    string Path,
    int BaudRate,
    int DataBits,
    StopBits StopBits,
    Parity Parity,
    Handshake Handshake);

internal sealed class SerialConnection : IDisposable
{
    private readonly object _sync = new();
    private readonly SemaphoreSlim _writeLock = new(1, 1);
    private SerialPort? _port;
    private CancellationTokenSource? _readCancellation;
    private bool _disposed;
    private long _connectionEpoch;
    private string? _connectionId;
    private string? _openingId;
    private long _writeEpoch;
    private CancellationTokenSource? _writeCancellation;

    public event Action<string, byte[]>? DataReceived;
    public event Action<string, string>? Disconnected;

    public static IReadOnlyList<SerialPortDescriptor> AvailablePorts()
    {
        return SerialPort.GetPortNames()
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(PortSortKey)
            .Select(path => new SerialPortDescriptor(
                path,
                $"Последовательный порт {path}"))
            .ToArray();
    }

    public async Task OpenAsync(SerialOpenOptions options, string? connectionId = null)
    {
        ThrowIfDisposed();
        connectionId ??= Guid.NewGuid().ToString("N");
        long epoch;
        lock (_sync) { epoch = ++_connectionEpoch; _openingId = connectionId; }
        try { await CloseCurrentAsync(expectedOpen: epoch); }
        catch { lock (_sync) { if (epoch == _connectionEpoch) _openingId = null; } throw; }
        lock (_sync) { if (epoch != _connectionEpoch) throw new OperationCanceledException("Предыдущее подключение отменено."); }

        var port = new SerialPort(
            options.Path,
            options.BaudRate,
            options.Parity,
            options.DataBits,
            options.StopBits)
        {
            Handshake = options.Handshake,
            Encoding = System.Text.Encoding.UTF8,
            ReadBufferSize = 64 * 1024,
            WriteBufferSize = 64 * 1024,
            ReadTimeout = 1_000,
            WriteTimeout = 5_000
        };

        try
        {
            await Task.Run(port.Open);
        }
        catch (UnauthorizedAccessException error)
        {
            lock (_sync) { if (epoch == _connectionEpoch) _openingId = null; }
            port.Dispose();
            throw new IOException($"Порт {options.Path} занят другой программой или доступ запрещён. Отключите порт в другой копии OpenHand, UGS или другом приложении и повторите попытку.", error);
        }
        catch (Exception error) when (error is IOException or ArgumentException)
        {
            lock (_sync) { if (epoch == _connectionEpoch) _openingId = null; }
            port.Dispose();
            throw new IOException(
                $"Не удалось настроить {options.Path} ({options.BaudRate} бод, " +
                $"{options.DataBits} бит, чётность {options.Parity}, стоп-биты {options.StopBits}, поток {options.Handshake}). " +
                "Отключите USB-кабель и подключите снова, затем выберите порт заново. " +
                $"Если ошибка повторится, проверьте параметры порта. Драйвер: {error.Message}", error);
        }
        catch
        {
            lock (_sync) { if (epoch == _connectionEpoch) _openingId = null; }
            port.Dispose();
            throw;
        }

        var cancellation = new CancellationTokenSource();
        var readToken = cancellation.Token;
        lock (_sync)
        {
            if (_disposed || epoch != _connectionEpoch)
            {
                cancellation.Dispose();
                port.Dispose();
                throw new OperationCanceledException("Предыдущее подключение отменено.");
            }
            _openingId = null;
            _connectionId = connectionId;
            _port = port;
            _readCancellation = cancellation;
        }

        _ = Task.Run(() => ReadLoopAsync(port, connectionId, readToken));
    }

    public async Task<int> WriteAsync(byte[] data, string? connectionId = null)
    {
        ThrowIfDisposed();
        var epoch = Interlocked.Read(ref _writeEpoch);
        await _writeLock.WaitAsync();
        CancellationTokenSource? cancellation = null;
        try
        {
            var port = GetOpenPort();
            lock (_sync)
            {
                if (epoch != _writeEpoch || (connectionId is not null && connectionId != _connectionId))
                    throw new IOException("Запись отменена остановкой или относится к предыдущему соединению.");
                cancellation = new CancellationTokenSource();
                _writeCancellation = cancellation;
            }
            await port.BaseStream.WriteAsync(data, cancellation.Token);
            await port.BaseStream.FlushAsync(cancellation.Token);
            return data.Length;
        }
        finally
        {
            lock (_sync) { if (ReferenceEquals(_writeCancellation, cancellation)) _writeCancellation = null; }
            cancellation?.Dispose();
            _writeLock.Release();
        }
    }

    public async Task EmergencyWriteAsync(byte[] data)
    {
        SerialPort port;
        long connectionEpoch;
        // Cancel the current overlapped write before waiting for its lock.
        // Any already queued ordinary writer belongs to the previous epoch.
        lock (_sync)
        {
            port = _port ?? throw new InvalidOperationException("Последовательный порт не открыт.");
            connectionEpoch = _connectionEpoch;
            ++_writeEpoch;
            _writeCancellation?.Cancel();
        }
        await _writeLock.WaitAsync();
        try
        {
            lock (_sync)
            {
                if (connectionEpoch != _connectionEpoch || !ReferenceEquals(port, _port))
                    throw new IOException("Соединение изменилось до отправки СТОП.");
            }
            port.DiscardOutBuffer();
            await port.BaseStream.WriteAsync(data);
            await port.BaseStream.FlushAsync();
        }
        finally { _writeLock.Release(); }
    }

    public void SetSignals(bool? dataTerminalReady, bool? requestToSend, string? connectionId = null)
    {
        var port = GetOpenPort();
        lock (_sync) { if (connectionId is not null && connectionId != _connectionId) throw new IOException("Предыдущее соединение уже закрыто."); }
        if (dataTerminalReady.HasValue)
        {
            port.DtrEnable = dataTerminalReady.Value;
        }
        if (requestToSend.HasValue)
        {
            port.RtsEnable = requestToSend.Value;
        }
    }

    public Task CloseAsync(string? connectionId = null) => CloseCurrentAsync(connectionId: connectionId);

    private Task CloseCurrentAsync(long? expectedOpen = null, string? connectionId = null)
    {
        SerialPort? port;
        CancellationTokenSource? cancellation;
        lock (_sync)
        {
            if (expectedOpen is { } epoch && epoch != _connectionEpoch) throw new OperationCanceledException("Предыдущее подключение отменено.");
            if (connectionId is not null && connectionId != _connectionId && connectionId != _openingId) return Task.CompletedTask;
            if (expectedOpen is null) { ++_connectionEpoch; _openingId = null; }
            _connectionId = null;
            port = _port;
            cancellation = _readCancellation;
            _port = null;
            _readCancellation = null;
            ++_writeEpoch;
            _writeCancellation?.Cancel();
        }

        cancellation?.Cancel();
        cancellation?.Dispose();
        if (port is null)
        {
            return Task.CompletedTask;
        }

        return Task.Run(() =>
        {
            try
            {
                if (port.IsOpen)
                {
                    port.Close();
                }
            }
            finally
            {
                port.Dispose();
            }
        });
    }

    private async Task ReadLoopAsync(SerialPort port, string connectionId, CancellationToken cancellationToken)
    {
        var buffer = new byte[64 * 1024];
        try
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                var count = await port.BaseStream.ReadAsync(buffer, cancellationToken);
                if (count == 0)
                {
                    throw new IOException("Устройство закрыло соединение.");
                }

                var received = new byte[count];
                Buffer.BlockCopy(buffer, 0, received, 0, count);
                lock (_sync) { if (!ReferenceEquals(port, _port) || cancellationToken.IsCancellationRequested) return; }
                DataReceived?.Invoke(connectionId, received);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
        catch (Exception error)
        {
            if (DetachIfCurrent(port))
            {
                Disconnected?.Invoke(connectionId,
                    string.IsNullOrWhiteSpace(error.Message)
                        ? "Устройство отключено."
                        : error.Message);
            }
        }
    }

    private bool DetachIfCurrent(SerialPort port)
    {
        CancellationTokenSource? cancellation = null;
        lock (_sync)
        {
            if (!ReferenceEquals(_port, port))
            {
                return false;
            }
            _port = null;
            _connectionId = null;
            ++_connectionEpoch;
            ++_writeEpoch;
            cancellation = _readCancellation;
            _readCancellation = null;
        }

        cancellation?.Cancel();
        cancellation?.Dispose();
        port.Dispose();
        return true;
    }

    private SerialPort GetOpenPort()
    {
        ThrowIfDisposed();
        lock (_sync)
        {
            if (_port is null || !_port.IsOpen)
            {
                throw new InvalidOperationException("Последовательный порт не открыт.");
            }
            return _port;
        }
    }

    private void ThrowIfDisposed()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
    }

    private static (string Prefix, int Number, string Original) PortSortKey(string path)
    {
        var index = path.Length;
        while (index > 0 && char.IsDigit(path[index - 1]))
        {
            index--;
        }
        var number = int.TryParse(path[index..], out var parsed) ? parsed : int.MaxValue;
        return (path[..index], number, path);
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }
        _disposed = true;
        lock (_sync) { ++_connectionEpoch; _openingId = null; _connectionId = null; }

        SerialPort? port;
        CancellationTokenSource? cancellation;
        lock (_sync)
        {
            port = _port;
            cancellation = _readCancellation;
            _port = null;
            _readCancellation = null;
            ++_writeEpoch;
            _writeCancellation?.Cancel();
        }

        cancellation?.Cancel();
        cancellation?.Dispose();
        try
        {
            port?.Dispose();
        }
        catch
        {
        }
        _writeLock.Dispose();
    }
}
