using System.IO.Ports;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;

namespace OpenHand;

internal sealed class NativeBridge : IDisposable
{
    private readonly Form _owner;
    private readonly CoreWebView2 _webView;
    private readonly Action<bool> _applyWindowTheme;
    private readonly SerialConnection _serial = new();
    private readonly NetworkConnection _network = new();
    private string? _selectedPortPath;
    private bool _emergencyStopped;
    private bool _emergencyInFlight;
    private string? _lastStopFailure;
    private bool _pageTransitionPending;
    private string? _activeTransport;
    private string? _activeConnectionId;
    private bool _transportClosing;
    private string? _lastRequestedTransport;
    private string? _lastProtocol;
    private SerialOpenOptions? _lastSerialOpen;
    private NotifyIcon? _notification;
    private bool _closingRequested;
    private int _openingCount;
    private int _openGeneration;
    private Task? _closeTask;
    public bool NeedsShutdown => _transportClosing || HasActiveConnection || _openingCount > 0 || _emergencyInFlight || _closeTask is { IsCompleted: false };
    public bool NeedsPageTransitionStop => HasActiveConnection || _openingCount > 0 || _emergencyInFlight;

    public async Task PrepareForPageChangeAsync()
    {
        if (_closingRequested) throw new InvalidOperationException("Приложение закрывается.");
        _pageTransitionPending = true;
        if (!NeedsPageTransitionStop) return;
        try { await PrepareForCloseAsync(); }
        catch (Exception error) { _lastStopFailure = error.Message; throw; }
        finally { CancelCloseRequest(); }
    }

    public void FinishPageChange() => _pageTransitionPending = false;


    public NativeBridge(
        Form owner,
        CoreWebView2 webView,
        Action<bool> applyWindowTheme)
    {
        _owner = owner;
        _webView = webView;
        _applyWindowTheme = applyWindowTheme;
        _serial.DataReceived += (connectionId, data) => PostConnectionEvent("receive", connectionId, data);
        _serial.Disconnected += (connectionId, reason) => PostConnectionEvent("disconnected", connectionId, reason);
        _network.DataReceived += (connectionId, data) => PostConnectionEvent("receive", connectionId, data);
        _network.Disconnected += (connectionId, reason) => PostConnectionEvent("disconnected", connectionId, reason);
    }

    public void LatchEmergencyStop() => _emergencyStopped = true;
    public bool HasActiveConnection => _activeTransport is not null;
    private Task? _stopTask;
    private Task<Exception?>? _nativeStopTask;

    public Task<Exception?> StopFromNativeUIAsync()
    {
        if (_nativeStopTask is { IsCompleted: false }) return _nativeStopTask;
        _nativeStopTask = SendNativeStopAsync();
        return _nativeStopTask;
    }

    private async Task<Exception?> SendNativeStopAsync()
    {
        _emergencyStopped = true;
        var token = Guid.NewGuid().ToString();
        // Script notification never gates the transport write.
        NotifyNativeStop("Started", new { token });
        Exception? error = null;
        try { await PerformEmergencyStopAsync(null); }
        catch (Exception failure) { error = failure; }
        finally { NotifyNativeStop("Finished", new { token, error = error?.Message }); }
        return error;
    }

    public void CancelCloseRequest()
    {
        if (_closeTask is not { IsCompleted: false }) _closingRequested = false;
    }

    public Task PrepareForCloseAsync()
    {
        if (_closeTask is { IsCompleted: false }) return _closeTask;
        _closeTask = CloseAfterStopAsync();
        return _closeTask;
    }

    private async Task CloseAfterStopAsync()
    {
        _closingRequested = true;
        _emergencyStopped = true;
        ++_openGeneration;
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(4));
        try
        {
            if (HasActiveConnection || _emergencyInFlight)
            {
                var failure = await StopFromNativeUIAsync().WaitAsync(deadline.Token);
                if (failure is not null) throw failure;
            }
            // No live session: never reopen a remembered device merely to quit.
            deadline.Token.ThrowIfCancellationRequested();
            await _serial.CloseAsync().WaitAsync(deadline.Token);
            deadline.Token.ThrowIfCancellationRequested();
            await _network.CloseAsync().WaitAsync(deadline.Token);
            _activeTransport = null;
            if (_activeConnectionId is { } closedId) PostConnectionEvent("disconnected", closedId, "Соединение закрыто перед выходом.");
        }
        catch (OperationCanceledException)
        {
            _closingRequested = false;
            throw new TimeoutException("Остановка перед закрытием не подтверждена за 4 секунды.");
        }
        catch
        {
            _closingRequested = false;
            throw;
        }
    }

    private async void NotifyNativeStop(string phase, object payload)
    {
        try { await _webView.ExecuteScriptAsync($"window.__openhandNativeStop{phase}?.({JsonSerializer.Serialize(payload)});"); }
        catch (Exception) { /* Native writes remain independent of the web process. */ }
    }

    private Task PerformEmergencyStopAsync(string? profile)
    {
        if (_stopTask is { IsCompleted: false }) return _stopTask;
        _stopTask = SendEmergencyStopAsync(profile);
        return _stopTask;
    }

    private async Task SendEmergencyStopAsync(string? profile)
    {
        _emergencyStopped = true;
        byte[] bytes = (_lastProtocol ?? profile) switch
        {
            "grbl" => new byte[] { 0x85, 0x21, 0x18 },
            "marlin" => System.Text.Encoding.ASCII.GetBytes("M410\n"),
            "ebb" => System.Text.Encoding.ASCII.GetBytes("R\r\n"),
            _ => throw new ArgumentException(_lastStopFailure = "Неизвестный протокол остановки.")
        };
        _emergencyInFlight = true;
        try
        {
            if (_lastRequestedTransport == "network") await _network.WriteAsync(bytes);
            else if (_lastSerialOpen is { } saved)
            {
                try { await _serial.EmergencyWriteAsync(bytes); }
                catch (Exception error) when ((error is IOException or InvalidOperationException) && !_closingRequested && !_pageTransitionPending && !_transportClosing)
                {
                    if (_activeConnectionId is { } oldId) PostConnectionEvent("disconnected", oldId, "Предыдущее соединение закрыто при восстановлении СТОП.");
                    var stopSession = "stop:" + Guid.NewGuid().ToString("N");
                    _activeConnectionId = stopSession;
                    try { await _serial.OpenAsync(saved, stopSession); }
                    catch { if (_activeConnectionId == stopSession) _activeConnectionId = null; throw; }
                    _activeTransport = "serial";
                    await _serial.EmergencyWriteAsync(bytes);
                }
            }
            else throw new InvalidOperationException("USB-порт ещё не выбран. Не удалось передать СТОП.");
            _lastStopFailure = null;
        }
        catch (Exception error) { _lastStopFailure = error.Message; throw; }
        finally { _emergencyInFlight = false; }
    }

    public async void HandleWebMessage(
        object? sender,
        CoreWebView2WebMessageReceivedEventArgs eventArgs)
    {
        try
        {
            using var document = JsonDocument.Parse(eventArgs.WebMessageAsJson);
            var root = document.RootElement;
            var bridge = GetRequiredString(root, "bridge");
            if (bridge == "theme")
            {
                var useSystem = root.TryGetProperty("system", out var system) && system.ValueKind == JsonValueKind.True;
                var isDark = root.TryGetProperty("dark", out var dark) && dark.ValueKind == JsonValueKind.True;
                if (useSystem) {
                    var light = Microsoft.Win32.Registry.GetValue(@"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize", "AppsUseLightTheme", 1);
                    isDark = Convert.ToInt32(light) == 0;
                    await _webView.ExecuteScriptAsync($"window.dispatchEvent(new CustomEvent('openhand:system-theme',{{detail:{{dark:{(isDark ? "true" : "false")}}}}}));");
                }
                _applyWindowTheme(isDark);
                return;
            }
            if (bridge == "file")
            {
                await SaveFileAsync(root);
                return;
            }
            if (bridge == "serial")
            {
                await HandleSerialAsync(root);
            }
        }
        catch (Exception error)
        {
            try
            {
                using var document = JsonDocument.Parse(eventArgs.WebMessageAsJson);
                var root = document.RootElement;
                if (GetOptionalString(root, "bridge", "") == "file" &&
                    root.TryGetProperty("id", out var idElement) && idElement.ValueKind == JsonValueKind.String && idElement.GetString() is { Length: > 0 and <= 128 } id)
                {
                    ResolveFile(id, new { saved = false, error = $"Не удалось сохранить файл: {error.Message}" });
                    return;
                }
            }
            catch
            {
            }
            ShowError($"Ошибка нативного моста: {error.Message}");
        }
    }

    private async Task HandleSerialAsync(JsonElement payload)
    {
        if (!payload.TryGetProperty("id", out var idElement) ||
            idElement.ValueKind != JsonValueKind.String || idElement.GetString() is not { Length: > 0 and <= 128 } id)
        {
            return;
        }

        try
        {
            var action = GetRequiredString(payload, "action");
            if ((_closingRequested || _pageTransitionPending) && action is "open" or "openNetwork" or "write" or "setSignals" or "releaseEmergencyStop" or "requestPort")
                throw new InvalidOperationException("Интерфейс или соединение перезапускается. Новые команды заблокированы.");
            var connectionId = GetOptionalString(payload, "connectionId", "");
            if (action is "open" or "openNetwork" or "write" or "setSignals" or "close")
            {
                if (connectionId.Length is 0 or > 128) throw new InvalidDataException("Не указан идентификатор соединения.");
                if ((action is "write" or "setSignals" or "close") && connectionId != _activeConnectionId)
                {
                    if (action == "close") { Resolve(id, new { closed = true }); return; }
                    throw new IOException("Предыдущее соединение уже закрыто. Подключитесь заново.");
                }
            }
            switch (action)
            {
                case "sessionState":
                    Resolve(id, new { emergencyStopped = _emergencyStopped, stopPending = _emergencyInFlight, stopError = _lastStopFailure ?? "" });
                    break;
                case "enableNotifications":
                    Resolve(id, new { granted = true });
                    break;
                case "notify":
                {
                    if (_notification is null)
                    {
                        _notification = new NotifyIcon { Icon = _owner.Icon ?? System.Drawing.SystemIcons.Information, Text = "OpenHand", Visible = true };
                        _notification.BalloonTipClicked += (_, _) => {
                            if (_owner.IsDisposed) return;
                            if (_owner.WindowState == FormWindowState.Minimized) _owner.WindowState = FormWindowState.Normal;
                            _owner.Show();
                            _owner.Activate();
                        };
                    }
                    var title = GetOptionalString(payload, "title", "OpenHand");
                    var body = GetOptionalString(payload, "body", "");
                    _notification.ShowBalloonTip(15000, title[..Math.Min(title.Length, 63)], body[..Math.Min(body.Length, 500)], ToolTipIcon.Info);
                    Resolve(id, new { delivered = true });
                    break;
                }
                case "requestPort":
                {
                    var port = ChoosePort();
                    _selectedPortPath = port.Path;
                    Resolve(id, new { path = port.Path, name = port.Name });
                    break;
                }
                case "open":
                {
                    if (_emergencyStopped) throw new InvalidOperationException("СТОП: сначала разрешите управление.");
                    if (_transportClosing) throw new InvalidOperationException("Дождитесь закрытия предыдущего соединения.");
                    if (_openingCount != 0) throw new InvalidOperationException("Подключение ещё выполняется.");
                    if (_emergencyInFlight) throw new InvalidOperationException("Остановка ещё выполняется.");
                    var options = new SerialOpenOptions(
                        GetRequiredString(payload, "path"), GetRequiredInt32(payload, "baudRate"),
                        GetOptionalInt32(payload, "dataBits", 8), ParseStopBits(GetOptionalInt32(payload, "stopBits", 1)),
                        ParseParity(GetOptionalString(payload, "parity", "none")),
                        ParseHandshake(GetOptionalString(payload, "flowControl", "none")));
                    var generation = _openGeneration;
                    _activeConnectionId = connectionId;
                    ++_openingCount;
                    try
                    {
                        _lastProtocol = GetOptionalString(payload, "profile", "grbl");
                        await _network.CloseAsync();
                        if (generation != _openGeneration) throw new OperationCanceledException("Подключение отменено закрытием.");
                        _lastSerialOpen = options;
                        _lastRequestedTransport = "serial";
                        await _serial.OpenAsync(options, connectionId);
                        if (generation != _openGeneration || _activeConnectionId != connectionId)
                        {
                            await _serial.CloseAsync(connectionId);
                            throw new OperationCanceledException("Подключение отменено закрытием.");
                        }
                        _activeTransport = "serial";
                        Resolve(id, new { opened = true });
                    }
                    catch { if (_activeConnectionId == connectionId) { _activeConnectionId = null; _activeTransport = null; } throw; }
                    finally { --_openingCount; }
                    break;
                }
                case "openNetwork":
                {
                    if (_emergencyStopped) throw new InvalidOperationException("СТОП: сначала разрешите управление.");
                    if (_transportClosing) throw new InvalidOperationException("Дождитесь закрытия предыдущего соединения.");
                    if (_openingCount != 0) throw new InvalidOperationException("Подключение ещё выполняется.");
                    if (_emergencyInFlight) throw new InvalidOperationException("Остановка ещё выполняется.");
                    var host = GetRequiredString(payload, "host");
                    var port = GetRequiredInt32(payload, "port");
                    var generation = _openGeneration;
                    _activeConnectionId = connectionId;
                    ++_openingCount;
                    try
                    {
                        _lastProtocol = GetOptionalString(payload, "profile", "grbl");
                        await _serial.CloseAsync();
                        if (generation != _openGeneration) throw new OperationCanceledException("Подключение отменено закрытием.");
                        _lastRequestedTransport = "network";
                        await _network.OpenAsync(host, port, connectionId);
                        if (generation != _openGeneration || _activeConnectionId != connectionId)
                        {
                            await _network.CloseAsync(connectionId);
                            throw new OperationCanceledException("Подключение отменено закрытием.");
                        }
                        _activeTransport = "network";
                        Resolve(id, new { opened = true });
                    }
                    catch { if (_activeConnectionId == connectionId) { _activeConnectionId = null; _activeTransport = null; } throw; }
                    finally { --_openingCount; }
                    break;
                }
                case "releaseEmergencyStop":
                    if (_emergencyInFlight) throw new InvalidOperationException("Остановка ещё выполняется.");
                    _emergencyStopped = false;
                    Resolve(id, new { released = true });
                    break;
                case "emergencyStop":
                {
                    await PerformEmergencyStopAsync(GetOptionalString(payload, "profile", ""));
                    Resolve(id, new { sent = true });
                    break;
                }
                case "write":
                {
                    var data = Convert.FromBase64String(
                        GetRequiredString(payload, "data"));
                    if (_emergencyStopped && !(data.Length == 1 && data[0] == 0x3f))
                        throw new InvalidOperationException("СТОП: отправка команд заблокирована.");
                    var written = _activeTransport == "network"
                        ? await _network.WriteAsync(data, connectionId)
                        : await _serial.WriteAsync(data, connectionId);
                    Resolve(id, new { written });
                    break;
                }
                case "setSignals":
                    if (_activeTransport == "serial")
                    {
                        _serial.SetSignals(
                            GetOptionalBoolean(payload, "dataTerminalReady"),
                            GetOptionalBoolean(payload, "requestToSend"), connectionId);
                    }
                    Resolve(id, new { updated = true });
                    break;
                case "close":
                    _transportClosing = true;
                    ++_openGeneration;
                    try
                    {
                        await _serial.CloseAsync(connectionId);
                        await _network.CloseAsync(connectionId);
                        if (_activeConnectionId == connectionId) { _activeTransport = null; _activeConnectionId = null; }
                        Resolve(id, new { closed = true });
                    }
                    finally { _transportClosing = false; }
                    break;
                default:
                    Reject(
                        id,
                        $"Неизвестная операция последовательного порта: {action}.");
                    break;
            }
        }
        catch (OperationCanceledException)
        {
            var selecting = payload.TryGetProperty("action", out var action) && action.GetString() == "requestPort";
            Reject(id, selecting ? "Выбор последовательного порта отменён." : "Операция последовательного порта отменена.");
        }
        catch (Exception error)
        {
            Reject(id, FriendlySerialError(error));
        }
    }

    private SerialPortDescriptor ChoosePort()
    {
        var ports = SerialConnection.AvailablePorts();
        if (ports.Count == 0)
        {
            throw new InvalidOperationException(
                "Последовательные порты не найдены. Подключите устройство и повторите попытку.");
        }

        using var picker = new PortPickerDialog(ports, _selectedPortPath);
        if (picker.ShowDialog(_owner) != DialogResult.OK ||
            picker.SelectedPort is null)
        {
            throw new OperationCanceledException();
        }
        return picker.SelectedPort;
    }

    private async Task SaveFileAsync(JsonElement payload)
    {
        if (!payload.TryGetProperty("id", out var idElement) || idElement.ValueKind != JsonValueKind.String || idElement.GetString() is not { Length: > 0 and <= 128 } id)
        {
            return;
        }
        var proposedName = SanitizeFilename(
            GetOptionalString(payload, "name", "openhand-file"));
        var bytes = Convert.FromBase64String(
            GetRequiredString(payload, "data"));
        var extension = Path.GetExtension(proposedName);

        using var panel = new SaveFileDialog
        {
            FileName = proposedName,
            AddExtension = !string.IsNullOrWhiteSpace(extension),
            DefaultExt = extension.TrimStart('.'),
            Filter = BuildSaveFilter(extension),
            OverwritePrompt = true,
            RestoreDirectory = true
        };

        if (panel.ShowDialog(_owner) != DialogResult.OK)
        {
            ResolveFile(id, new { saved = false, cancelled = true });
            return;
        }

        try
        {
            await File.WriteAllBytesAsync(panel.FileName, bytes);
            ResolveFile(id, new { saved = true, path = panel.FileName });
        }
        catch (Exception error)
        {
            ResolveFile(id, new { saved = false, error = $"Не удалось сохранить файл: {error.Message}" });
        }
    }

    private void ResolveFile(string id, object result)
    {
        PostMessage("file", "resolve", new { id, result });
    }

    private void Resolve(string id, object result)
    {
        PostSerial("resolve", new { id, result });
    }

    private void Reject(string id, string error)
    {
        PostSerial("resolve", new { id, error });
    }

    private void PostConnectionEvent(string type, string connectionId, object value)
    {
        if (_owner.IsDisposed || !_owner.IsHandleCreated) return;
        void Deliver()
        {
            // Check after UI dispatch, not just when the background read completed.
            if (_owner.IsDisposed || _activeConnectionId != connectionId) return;
            if (type == "disconnected") { _activeConnectionId = null; _activeTransport = null; }
            PostSerial(type, type == "receive"
                ? new { connectionId, data = Convert.ToBase64String((byte[])value) } as object
                : new { connectionId, error = (string)value });
        }
        if (_owner.InvokeRequired) _owner.BeginInvoke(Deliver);
        else Deliver();
    }

    private void PostSerial(string type, object payload)
    {
        PostMessage("serial", type, payload);
    }

    private void PostMessage(string bridge, string type, object payload)
    {
        if (_owner.IsDisposed || !_owner.IsHandleCreated)
        {
            return;
        }

        void Post()
        {
            if (!_owner.IsDisposed)
            {
                _webView.PostWebMessageAsJson(JsonSerializer.Serialize(new
                {
                    bridge,
                    type,
                    payload
                }));
            }
        }

        if (_owner.InvokeRequired)
        {
            _owner.BeginInvoke(Post);
        }
        else
        {
            Post();
        }
    }

    private void ShowError(string message)
    {
        if (_owner.IsDisposed)
        {
            return;
        }
        if (_owner.InvokeRequired)
        {
            _owner.BeginInvoke(() => ShowError(message));
            return;
        }
        MessageBox.Show(
            _owner,
            message,
            "OpenHand",
            MessageBoxButtons.OK,
            MessageBoxIcon.Warning);
    }

    private static string FriendlySerialError(Exception error)
    {
        return error switch
        {
            UnauthorizedAccessException =>
                "Нет доступа к порту. Закройте другие программы, использующие устройство, и повторите попытку.",
            IOException =>
                $"Ошибка ввода-вывода последовательного порта: {error.Message}",
            ArgumentOutOfRangeException =>
                $"Устройство или драйвер не поддерживает выбранные параметры порта: {error.Message}",
            _ => error.Message
        };
    }

    private static StopBits ParseStopBits(int value) => value switch
    {
        1 => StopBits.One,
        2 => StopBits.Two,
        _ => throw new ArgumentOutOfRangeException(
            nameof(value),
            "Поддерживается один или два стоп-бита.")
    };

    private static Parity ParseParity(string value) =>
        value.ToLowerInvariant() switch
        {
            "none" => Parity.None,
            "even" => Parity.Even,
            "odd" => Parity.Odd,
            "mark" => Parity.Mark,
            "space" => Parity.Space,
            _ => throw new ArgumentOutOfRangeException(
                nameof(value),
                "Неизвестный режим чётности.")
        };

    private static Handshake ParseHandshake(string value) =>
        value.ToLowerInvariant() switch
        {
            "none" => Handshake.None,
            "hardware" => Handshake.RequestToSend,
            _ => throw new ArgumentOutOfRangeException(
                nameof(value),
                "Неизвестный режим управления потоком.")
        };

    private static string GetRequiredString(JsonElement payload, string property)
    {
        if (payload.TryGetProperty(property, out var value) &&
            value.ValueKind == JsonValueKind.String)
        {
            return value.GetString()!;
        }
        throw new InvalidDataException($"Отсутствует строковый параметр «{property}».");
    }

    private static string GetOptionalString(
        JsonElement payload,
        string property,
        string fallback)
    {
        return payload.TryGetProperty(property, out var value) &&
               value.ValueKind == JsonValueKind.String
            ? value.GetString() ?? fallback
            : fallback;
    }

    private static int GetRequiredInt32(JsonElement payload, string property)
    {
        if (payload.TryGetProperty(property, out var value) &&
            value.TryGetInt32(out var result))
        {
            return result;
        }
        throw new InvalidDataException($"Отсутствует числовой параметр «{property}».");
    }

    private static int GetOptionalInt32(
        JsonElement payload,
        string property,
        int fallback)
    {
        return payload.TryGetProperty(property, out var value) &&
               value.TryGetInt32(out var result)
            ? result
            : fallback;
    }

    private static bool? GetOptionalBoolean(
        JsonElement payload,
        string property)
    {
        if (!payload.TryGetProperty(property, out var value))
        {
            return null;
        }
        return value.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            _ => null
        };
    }

    private static string SanitizeFilename(string value)
    {
        var invalid = Path.GetInvalidFileNameChars().ToHashSet();
        var cleaned = new string(value
            .Select(character => invalid.Contains(character) ? '-' : character)
            .ToArray())
            .Trim();
        return string.IsNullOrWhiteSpace(cleaned) ? "openhand-file" : cleaned;
    }

    private static string BuildSaveFilter(string extension)
    {
        if (string.IsNullOrWhiteSpace(extension))
        {
            return "Все файлы (*.*)|*.*";
        }
        return $"Файл OpenHand (*{extension})|*{extension}|Все файлы (*.*)|*.*";
    }

    public void Dispose()
    {
        _notification?.Dispose();
        _serial.Dispose();
        _network.Dispose();
    }
}
