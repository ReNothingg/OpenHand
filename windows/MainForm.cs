using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace OpenHand;

internal sealed class MainForm : Form
{
    private const string ApplicationHost = "app.openhand.local";
    private const long MaximumDocumentBytes = 64L * 1024 * 1024;
    private const int DwmwaUseImmersiveDarkModeBefore20H1 = 19;
    private const int DwmwaUseImmersiveDarkMode = 20;
    private const int DwmwaBorderColor = 34;
    private const int DwmwaCaptionColor = 35;
    private const int DwmwaTextColor = 36;
    private const int DwmColorDefault = -1;
    private static readonly HashSet<string> SupportedDocumentExtensions =
        new(StringComparer.OrdinalIgnoreCase) { ".gcode", ".nc", ".tap" };

    private readonly WebView2 _webView = new() { Dock = DockStyle.Fill };
    private readonly string? _initialDocument;
    private NativeBridge? _nativeBridge;
    private PendingDocument? _pendingDocument;
    private bool _runtimeReady;
    private bool _loadingErrorShown;

    public MainForm(string? initialDocument)
    {
        _initialDocument = initialDocument;
        Text = "OpenHand";
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(1440, 900);
        MinimumSize = new Size(980, 680);
        AutoScaleMode = AutoScaleMode.Dpi;
        AllowDrop = true;
        Controls.Add(_webView);

        LoadApplicationIcon();
        Shown += async (_, _) => await InitializeWebViewAsync();
        DragEnter += HandleDragEnter;
        DragDrop += HandleDragDrop;
    }

    private async Task InitializeWebViewAsync()
    {
        var webRoot = Path.Combine(AppContext.BaseDirectory, "Web");
        if (!File.Exists(Path.Combine(webRoot, "index.html")))
        {
            ShowFatalError(
                "Не найдены ресурсы OpenHand.\n\n" +
                "Выполните «npm run build:web» в корне проекта и пересоберите Windows-приложение.");
            return;
        }

        try
        {
            var userDataFolder = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "OpenHand",
                "WebView2");
            Directory.CreateDirectory(userDataFolder);
            var environment = await CoreWebView2Environment.CreateAsync(
                userDataFolder: userDataFolder);
            await _webView.EnsureCoreWebView2Async(environment);
        }
        catch (WebView2RuntimeNotFoundException)
        {
            ShowFatalError(
                "Не найден Microsoft Edge WebView2 Runtime.\n\n" +
                "Установите Evergreen WebView2 Runtime и снова запустите OpenHand.");
            return;
        }
        catch (Exception error)
        {
            ShowFatalError($"Не удалось запустить WebView2: {error.Message}");
            return;
        }

        var core = _webView.CoreWebView2;
        ConfigureWebView(core, webRoot);
        _nativeBridge = new NativeBridge(this, core, ApplyWindowTheme);
        core.WebMessageReceived += _nativeBridge.HandleWebMessage;
        await core.AddScriptToExecuteOnDocumentCreatedAsync(
            NativeScripts.SerialShim);
        core.Navigate($"https://{ApplicationHost}/index.html");

        if (_initialDocument is not null)
        {
            await OpenDocumentAsync(_initialDocument);
        }
    }

    private void ConfigureWebView(CoreWebView2 core, string webRoot)
    {
        core.SetVirtualHostNameToFolderMapping(
            ApplicationHost,
            webRoot,
            CoreWebView2HostResourceAccessKind.DenyCors);

        core.Settings.IsScriptEnabled = true;
        core.Settings.AreDefaultScriptDialogsEnabled = true;
        core.Settings.AreDefaultContextMenusEnabled = true;
        core.Settings.IsZoomControlEnabled = true;
#if DEBUG
        core.Settings.AreDevToolsEnabled = true;
#else
        core.Settings.AreDevToolsEnabled = false;
#endif
        core.Settings.IsStatusBarEnabled = false;

        core.NavigationStarting += HandleNavigationStarting;
        core.NavigationCompleted += HandleNavigationCompleted;
        core.NewWindowRequested += HandleNewWindowRequested;
        core.DownloadStarting += HandleDownloadStarting;
        core.ProcessFailed += (_, _) =>
        {
            _runtimeReady = false;
            core.Reload();
        };
    }

    private void HandleNavigationStarting(
        object? sender,
        CoreWebView2NavigationStartingEventArgs eventArgs)
    {
        if (!Uri.TryCreate(eventArgs.Uri, UriKind.Absolute, out var uri))
        {
            eventArgs.Cancel = true;
            return;
        }

        var allowed =
            (uri.Scheme == Uri.UriSchemeHttps &&
             string.Equals(uri.Host, ApplicationHost, StringComparison.OrdinalIgnoreCase)) ||
            uri.Scheme == "about" ||
            uri.Scheme == "blob";
        if (allowed)
        {
            return;
        }

        eventArgs.Cancel = true;
        OpenExternalUri(uri);
    }

    private async void HandleNavigationCompleted(
        object? sender,
        CoreWebView2NavigationCompletedEventArgs eventArgs)
    {
        if (!eventArgs.IsSuccess)
        {
            ShowLoadingError($"Ошибка навигации WebView2: {eventArgs.WebErrorStatus}.");
            return;
        }

        for (var attempt = 0; attempt <= 20; attempt++)
        {
            try
            {
                var encoded = await _webView.CoreWebView2.ExecuteScriptAsync(
                    """
                    JSON.stringify({
                      rootChildren: document.getElementById("root")?.childElementCount ?? 0,
                      serialReady: Boolean(navigator.serial),
                      title: document.title
                    })
                    """);
                var json = JsonSerializer.Deserialize<string>(encoded);
                if (json is not null)
                {
                    using var health = JsonDocument.Parse(json);
                    var root = health.RootElement;
                    var rootReady =
                        root.GetProperty("rootChildren").GetInt32() > 0;
                    var serialReady =
                        root.GetProperty("serialReady").GetBoolean();
                    if (rootReady && serialReady)
                    {
                        _runtimeReady = true;
                        await DeliverPendingDocumentAsync();
                        return;
                    }
                }
            }
            catch when (attempt < 20)
            {
            }

            await Task.Delay(250);
        }

        ShowLoadingError(
            "React-интерфейс или нативный Serial API не инициализировались.");
    }

    private static void HandleNewWindowRequested(
        object? sender,
        CoreWebView2NewWindowRequestedEventArgs eventArgs)
    {
        eventArgs.Handled = true;
        if (Uri.TryCreate(eventArgs.Uri, UriKind.Absolute, out var uri))
        {
            OpenExternalUri(uri);
        }
    }

    private void HandleDownloadStarting(
        object? sender,
        CoreWebView2DownloadStartingEventArgs eventArgs)
    {
        var proposedName = Path.GetFileName(eventArgs.ResultFilePath);
        using var panel = new SaveFileDialog
        {
            FileName = string.IsNullOrWhiteSpace(proposedName)
                ? "openhand-file"
                : proposedName,
            Filter = "Все файлы (*.*)|*.*",
            OverwritePrompt = true,
            RestoreDirectory = true
        };

        if (panel.ShowDialog(this) != DialogResult.OK)
        {
            eventArgs.Cancel = true;
            return;
        }

        eventArgs.ResultFilePath = panel.FileName;
        eventArgs.Handled = true;
    }

    private void HandleDragEnter(object? sender, DragEventArgs eventArgs)
    {
        eventArgs.Effect = TryGetDroppedDocument(eventArgs, out _)
            ? DragDropEffects.Copy
            : DragDropEffects.None;
    }

    private async void HandleDragDrop(object? sender, DragEventArgs eventArgs)
    {
        if (TryGetDroppedDocument(eventArgs, out var path))
        {
            await OpenDocumentAsync(path);
        }
    }

    private static bool TryGetDroppedDocument(
        DragEventArgs eventArgs,
        out string path)
    {
        path = string.Empty;
        if (!eventArgs.Data!.GetDataPresent(DataFormats.FileDrop) ||
            eventArgs.Data.GetData(DataFormats.FileDrop) is not string[] files)
        {
            return false;
        }

        var selected = files.FirstOrDefault(file =>
            File.Exists(file) &&
            SupportedDocumentExtensions.Contains(Path.GetExtension(file)));
        if (selected is null)
        {
            return false;
        }

        path = selected;
        return true;
    }

    private async Task OpenDocumentAsync(string path)
    {
        if (!SupportedDocumentExtensions.Contains(Path.GetExtension(path)))
        {
            MessageBox.Show(
                this,
                "Поддерживаются файлы .gcode, .nc и .tap.",
                "Не удалось открыть G-code",
                MessageBoxButtons.OK,
                MessageBoxIcon.Warning);
            return;
        }

        try
        {
            var fileInfo = new FileInfo(path);
            if (fileInfo.Length > MaximumDocumentBytes)
            {
                MessageBox.Show(
                    this,
                    "Файл G-code больше 64 МБ. Разделите задание на несколько файлов.",
                    "Не удалось открыть G-code",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Warning);
                return;
            }
            var bytes = await File.ReadAllBytesAsync(path);
            if (bytes.LongLength > MaximumDocumentBytes)
            {
                MessageBox.Show(
                    this,
                    "Файл G-code больше 64 МБ. Разделите задание на несколько файлов.",
                    "Не удалось открыть G-code",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Warning);
                return;
            }
            _pendingDocument = new PendingDocument(
                Path.GetFileName(path),
                "text/plain;charset=utf-8",
                Convert.ToBase64String(bytes));
            await DeliverPendingDocumentAsync();
        }
        catch (Exception error)
        {
            MessageBox.Show(
                this,
                $"Не удалось прочитать файл: {error.Message}",
                "Не удалось открыть G-code",
                MessageBoxButtons.OK,
                MessageBoxIcon.Warning);
        }
    }

    private async Task DeliverPendingDocumentAsync()
    {
        if (!_runtimeReady || _pendingDocument is null ||
            _webView.CoreWebView2 is null)
        {
            return;
        }

        var payload = JsonSerializer.Serialize(_pendingDocument);
        var delivered = await _webView.CoreWebView2.ExecuteScriptAsync(
            $"""
             window.__openhandReceiveFile
               ? (window.__openhandReceiveFile({payload}), true)
               : false
             """);
        if (string.Equals(delivered, "true", StringComparison.OrdinalIgnoreCase))
        {
            _pendingDocument = null;
        }
    }

    private void ShowLoadingError(string reason)
    {
        if (_loadingErrorShown)
        {
            return;
        }
        _loadingErrorShown = true;
        ShowFatalError($"Не удалось загрузить OpenHand.\n\n{reason}");
    }

    private void ShowFatalError(string message)
    {
        MessageBox.Show(
            this,
            message,
            "OpenHand",
            MessageBoxButtons.OK,
            MessageBoxIcon.Error);
    }

    private void LoadApplicationIcon()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "app-icon.png");
        if (!File.Exists(path))
        {
            return;
        }

        using var source = new Bitmap(path);
        using var bitmap = new Bitmap(source, new Size(256, 256));
        var handle = bitmap.GetHicon();
        try
        {
            Icon = (Icon)Icon.FromHandle(handle).Clone();
        }
        finally
        {
            DestroyIcon(handle);
        }
    }

    private void ApplyWindowTheme(bool dark)
    {
        if (!IsHandleCreated || IsDisposed)
        {
            return;
        }

        var darkMode = dark ? 1 : 0;
        var darkModeResult = DwmSetWindowAttribute(
            Handle,
            DwmwaUseImmersiveDarkMode,
            ref darkMode,
            sizeof(int));
        if (darkModeResult != 0)
        {
            DwmSetWindowAttribute(
                Handle,
                DwmwaUseImmersiveDarkModeBefore20H1,
                ref darkMode,
                sizeof(int));
        }

        var captionColor = dark
            ? ColorTranslator.ToWin32(Color.FromArgb(23, 23, 23))
            : DwmColorDefault;
        var textColor = dark
            ? ColorTranslator.ToWin32(Color.FromArgb(252, 252, 252))
            : DwmColorDefault;
        var borderColor = dark
            ? ColorTranslator.ToWin32(Color.FromArgb(23, 23, 23))
            : DwmColorDefault;

        DwmSetWindowAttribute(
            Handle,
            DwmwaCaptionColor,
            ref captionColor,
            sizeof(int));
        DwmSetWindowAttribute(
            Handle,
            DwmwaTextColor,
            ref textColor,
            sizeof(int));
        DwmSetWindowAttribute(
            Handle,
            DwmwaBorderColor,
            ref borderColor,
            sizeof(int));

        _webView.DefaultBackgroundColor = dark
            ? Color.FromArgb(17, 17, 17)
            : Color.White;
    }

    private static void OpenExternalUri(Uri uri)
    {
        if (uri.Scheme is not ("http" or "https" or "mailto"))
        {
            return;
        }
        try
        {
            Process.Start(new ProcessStartInfo(uri.AbsoluteUri)
            {
                UseShellExecute = true
            });
        }
        catch
        {
        }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            if (_webView.CoreWebView2 is not null && _nativeBridge is not null)
            {
                _webView.CoreWebView2.WebMessageReceived -=
                    _nativeBridge.HandleWebMessage;
            }
            _nativeBridge?.Dispose();
            _webView.Dispose();
            Icon?.Dispose();
        }
        base.Dispose(disposing);
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool DestroyIcon(IntPtr handle);

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(
        IntPtr window,
        int attribute,
        ref int value,
        int valueSize);

    private sealed record PendingDocument(
        string Name,
        string Type,
        string Data);
}
