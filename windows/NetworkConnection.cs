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

    public event Action<byte[]>? DataReceived;
    public event Action<string>? Disconnected;

    public async Task OpenAsync(string host, int port)
    {
        ThrowIfDisposed();
        if (string.IsNullOrWhiteSpace(host) || port is < 1 or > 65535)
        {
            throw new ArgumentException("Некорректный IP/хост или TCP-порт плоттера.");
        }

        await CloseAsync();
        var client = new TcpClient { NoDelay = true };
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        try
        {
            await client.ConnectAsync(host, port, timeout.Token);
        }
        catch
        {
            client.Dispose();
            throw;
        }

        var stream = client.GetStream();
        var cancellation = new CancellationTokenSource();
        lock (_sync)
        {
            ThrowIfDisposed();
            _client = client;
            _stream = stream;
            _readCancellation = cancellation;
        }
        _ = Task.Run(() => ReadLoopAsync(client, stream, cancellation.Token));
    }

    public async Task<int> WriteAsync(byte[] data)
    {
        ThrowIfDisposed();
        await _writeLock.WaitAsync();
        try
        {
            NetworkStream stream;
            lock (_sync)
            {
                stream = _stream ?? throw new InvalidOperationException("TCP-соединение не открыто.");
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

    public Task CloseAsync()
    {
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
        return Task.CompletedTask;
    }

    private async Task ReadLoopAsync(
        TcpClient client,
        NetworkStream stream,
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
                DataReceived?.Invoke(received);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
        catch (Exception error)
        {
            if (DetachIfCurrent(client))
            {
                Disconnected?.Invoke(
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
