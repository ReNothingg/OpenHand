namespace OpenHand;

internal static class Program
{
    private static readonly HashSet<string> SupportedDocumentExtensions =
        new(StringComparer.OrdinalIgnoreCase) { ".gcode", ".nc", ".tap" };

    [STAThread]
    private static void Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new MainForm(FindInitialDocument(args)));
    }

    private static string? FindInitialDocument(IEnumerable<string> args)
    {
        return args
            .Select(Path.GetFullPath)
            .FirstOrDefault(path =>
                File.Exists(path) &&
                SupportedDocumentExtensions.Contains(Path.GetExtension(path)));
    }
}
