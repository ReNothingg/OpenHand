using System.Net.Sockets;

namespace OpenHand;

internal sealed class NetworkConnection : IDisposable
{
    private readonly object _sync = new();
    private readonly SemaphoreSlim _writeLock = new(1, 1);
    private TcpClient? _client;
    private NetworkStream? _stream;
    private CancellationTokenSource? _readCancellation;
    private bool _disposed;
    private long _connectionEpoch;
    private string? _connectionId;
    private string? _openingId;
    private CancellationTokenSource? _openCancellation;

    public event Action<string, byte[]>? DataReceived;
    public event Action<string, string>? Disconnected;

    public async Task OpenAsync(string host, int port, string? connectionId = null)
    {
        ThrowIfDisposed();
        if (string.IsNullOrWhiteSpace(host) || port is < 1 or > 65535)
            throw new ArgumentException("Некорректный IP/хост или TCP-порт плоттера.");
        connectionId ??= Guid.NewGuid().ToString("N");
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        long epoch;
        lock (_sync)
        {
            epoch = ++_connectionEpoch;
            _openCancellation?.Cancel();
            _openCancellation = timeout;
            _openingId = connectionId;
        }
        var client = new TcpClient { NoDelay = true };
        var adopted = false;
        try
        {
            await CloseCurrentAsync(expectedOpen: epoch);
            await client.ConnectAsync(host, port, timeout.Token);
            var stream = client.GetStream();
            var cancellation = new CancellationTokenSource();
            var readToken = cancellation.Token;
            lock (_sync)
            {
                if (_disposed || epoch != _connectionEpoch) { cancellation.Dispose(); throw new OperationCanceledException("Предыдущее подключение отменено."); }
                _client = client;
                _stream = stream;
                _connectionId = connectionId;
                _readCancellation = cancellation;
                adopted = true;
            }
            _ = Task.Run(() => ReadLoopAsync(client, stream, connectionId, readToken));
        }
        finally
        {
            lock (_sync)
            {
                if (ReferenceEquals(_openCancellation, timeout)) { _openCancellation = null; _openingId = null; }
            }
            if (!adopted) client.Dispose();
        }
    }

    public async Task<int> WriteAsync(byte[] data, string? connectionId = null)
    {
        ThrowIfDisposed();
        NetworkStream stream;
        long epoch;
        lock (_sync)
        {
            stream = _stream ?? throw new InvalidOperationException("TCP-соединение не открыто.");
            epoch = _connectionEpoch;
            if (connectionId is not null && connectionId != _connectionId) throw new IOException("Предыдущее соединение уже закрыто.");
        }
        await _writeLock.WaitAsync();
        try
        {
            lock (_sync)
            {
                if (epoch != _connectionEpoch || !ReferenceEquals(stream, _stream))
                    throw new IOException("Запись относится к предыдущему соединению.");
            }
            await stream.WriteAsync(data);
            await stream.FlushAsync();
            return data.Length;
        }
        finally
        {
            _writeLock.Release();
        }
    }

    public Task CloseAsync(string? connectionId = null) => CloseCurrentAsync(connectionId: connectionId);

    private Task CloseCurrentAsync(long? expectedOpen = null, string? connectionId = null)
    {
        TcpClient? client;
        NetworkStream? stream;
        CancellationTokenSource? cancellation;
        lock (_sync)
        {
            if (expectedOpen is { } epoch && epoch != _connectionEpoch) throw new OperationCanceledException("Предыдущее подключение отменено.");
            if (connectionId is not null && connectionId != _connectionId && connectionId != _openingId) return Task.CompletedTask;
            if (expectedOpen is null) { ++_connectionEpoch; _openCancellation?.Cancel(); _openingId = null; }
            _connectionId = null;
            client = _client;
            stream = _stream;
            cancellation = _readCancellation;
            _client = null;
            _stream = null;
            _readCancellation = null;
        }
        cancellation?.Cancel();
        cancellation?.Dispose();
        stream?.Dispose();
        client?.Dispose();
        return Task.CompletedTask;
    }

    private async Task ReadLoopAsync(
        TcpClient client,
        NetworkStream stream,
        string connectionId,
        CancellationToken cancellationToken)
    {
        var buffer = new byte[64 * 1024];
        try
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                var count = await stream.ReadAsync(buffer, cancellationToken);
                if (count == 0) throw new IOException("Плоттер закрыл TCP-соединение.");
                var received = new byte[count];
                Buffer.BlockCopy(buffer, 0, received, 0, count);
                lock (_sync) { if (!ReferenceEquals(client, _client) || cancellationToken.IsCancellationRequested) return; }
                DataReceived?.Invoke(connectionId, received);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
        catch (Exception error)
        {
            if (DetachIfCurrent(client))
            {
                Disconnected?.Invoke(connectionId,
                    string.IsNullOrWhiteSpace(error.Message)
                        ? "TCP-соединение с плоттером закрыто."
                        : error.Message);
            }
        }
    }

    private bool DetachIfCurrent(TcpClient client)
    {
        NetworkStream? stream = null;
        CancellationTokenSource? cancellation = null;
        lock (_sync)
        {
            if (!ReferenceEquals(_client, client)) return false;
            _connectionId = null;
            ++_connectionEpoch;
            _client = null;
            stream = _stream;
            _stream = null;
            cancellation = _readCancellation;
            _readCancellation = null;
        }
        cancellation?.Cancel();
        cancellation?.Dispose();
        stream?.Dispose();
        client.Dispose();
        return true;
    }

    private void ThrowIfDisposed()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        lock (_sync) { ++_connectionEpoch; _openCancellation?.Cancel(); _openingId = null; _connectionId = null; }
        TcpClient? client;
        NetworkStream? stream;
        CancellationTokenSource? cancellation;
        lock (_sync)
        {
            client = _client;
            stream = _stream;
            cancellation = _readCancellation;
            _client = null;
            _stream = null;
            _readCancellation = null;
        }
        cancellation?.Cancel();
        cancellation?.Dispose();
        stream?.Dispose();
        client?.Dispose();
        _writeLock.Dispose();
    }
}
