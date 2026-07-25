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

    public event Action<byte[]>? DataReceived;
    public event Action<string>? Disconnected;

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

    public async Task OpenAsync(SerialOpenOptions options)
    {
        ThrowIfDisposed();
        await CloseAsync();

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
        catch
        {
            port.Dispose();
            throw;
        }

        var cancellation = new CancellationTokenSource();
        lock (_sync)
        {
            ThrowIfDisposed();
            _port = port;
            _readCancellation = cancellation;
        }

        _ = Task.Run(() => ReadLoopAsync(port, cancellation.Token));
    }

    public async Task<int> WriteAsync(byte[] data)
    {
        ThrowIfDisposed();
        await _writeLock.WaitAsync();
        try
        {
            var port = GetOpenPort();
            await port.BaseStream.WriteAsync(data);
            await port.BaseStream.FlushAsync();
            return data.Length;
        }
        finally
        {
            _writeLock.Release();
        }
    }

    public void SetSignals(bool? dataTerminalReady, bool? requestToSend)
    {
        var port = GetOpenPort();
        if (dataTerminalReady.HasValue)
        {
            port.DtrEnable = dataTerminalReady.Value;
        }
        if (requestToSend.HasValue)
        {
            port.RtsEnable = requestToSend.Value;
        }
    }

    public Task CloseAsync()
    {
        SerialPort? port;
        CancellationTokenSource? cancellation;
        lock (_sync)
        {
            port = _port;
            cancellation = _readCancellation;
            _port = null;
            _readCancellation = null;
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

    private async Task ReadLoopAsync(SerialPort port, CancellationToken cancellationToken)
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
                DataReceived?.Invoke(received);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
        catch (Exception error)
        {
            if (DetachIfCurrent(port))
            {
                Disconnected?.Invoke(
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

        SerialPort? port;
        CancellationTokenSource? cancellation;
        lock (_sync)
        {
            port = _port;
            cancellation = _readCancellation;
            _port = null;
            _readCancellation = null;
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
