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
    private string? _selectedPortPath;

    public NativeBridge(
        Form owner,
        CoreWebView2 webView,
        Action<bool> applyWindowTheme)
    {
        _owner = owner;
        _webView = webView;
        _applyWindowTheme = applyWindowTheme;
        _serial.DataReceived += data => PostSerial("receive", new
        {
            data = Convert.ToBase64String(data)
        });
        _serial.Disconnected += reason => PostSerial("disconnected", new
        {
            error = reason
        });
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
                _applyWindowTheme(
                    root.TryGetProperty("dark", out var dark) &&
                    dark.ValueKind == JsonValueKind.True);
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
                    root.TryGetProperty("id", out var idElement) && idElement.TryGetInt32(out var id))
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
            !idElement.TryGetInt32(out var id))
        {
            return;
        }

        try
        {
            var action = GetRequiredString(payload, "action");
            switch (action)
            {
                case "requestPort":
                {
                    var port = ChoosePort();
                    _selectedPortPath = port.Path;
                    Resolve(id, new { path = port.Path, name = port.Name });
                    break;
                }
                case "open":
                {
                    var options = new SerialOpenOptions(
                        GetRequiredString(payload, "path"),
                        GetRequiredInt32(payload, "baudRate"),
                        GetOptionalInt32(payload, "dataBits", 8),
                        ParseStopBits(GetOptionalInt32(payload, "stopBits", 1)),
                        ParseParity(GetOptionalString(payload, "parity", "none")),
                        ParseHandshake(GetOptionalString(payload, "flowControl", "none")));
                    await _serial.OpenAsync(options);
                    Resolve(id, new { opened = true });
                    break;
                }
                case "write":
                {
                    var data = Convert.FromBase64String(
                        GetRequiredString(payload, "data"));
                    var written = await _serial.WriteAsync(data);
                    Resolve(id, new { written });
                    break;
                }
                case "setSignals":
                    _serial.SetSignals(
                        GetOptionalBoolean(payload, "dataTerminalReady"),
                        GetOptionalBoolean(payload, "requestToSend"));
                    Resolve(id, new { updated = true });
                    break;
                case "close":
                    await _serial.CloseAsync();
                    Resolve(id, new { closed = true });
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
            Reject(id, "Выбор последовательного порта отменён.");
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
        if (!payload.TryGetProperty("id", out var idElement) || !idElement.TryGetInt32(out var id))
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

    private void ResolveFile(int id, object result)
    {
        PostMessage("file", "resolve", new { id, result });
    }

    private void Resolve(int id, object result)
    {
        PostSerial("resolve", new { id, result });
    }

    private void Reject(int id, string error)
    {
        PostSerial("resolve", new { id, error });
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
        _serial.Dispose();
    }
}
