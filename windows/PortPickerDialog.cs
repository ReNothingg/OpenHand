namespace OpenHand;

internal sealed class PortPickerDialog : Form
{
    private readonly ComboBox _ports = new();

    public PortPickerDialog(
        IReadOnlyList<SerialPortDescriptor> ports,
        string? previouslySelectedPath)
    {
        Text = "Выберите последовательный порт";
        AutoScaleMode = AutoScaleMode.Dpi;
        ClientSize = new Size(500, 148);
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.CenterParent;

        var label = new Label
        {
            AutoSize = true,
            Location = new Point(16, 18),
            Text = "OpenHand подключится к устройству напрямую через Windows."
        };

        _ports.DropDownStyle = ComboBoxStyle.DropDownList;
        _ports.Location = new Point(16, 49);
        _ports.Size = new Size(468, 28);
        _ports.DataSource = ports.ToArray();

        var selectedIndex = ports
            .Select((port, index) => (port, index))
            .FirstOrDefault(item =>
                string.Equals(
                    item.port.Path,
                    previouslySelectedPath,
                    StringComparison.OrdinalIgnoreCase))
            .index;
        _ports.SelectedIndex = selectedIndex;

        var connect = new Button
        {
            Text = "Подключить",
            DialogResult = DialogResult.OK,
            Location = new Point(274, 100),
            Size = new Size(100, 32)
        };
        var cancel = new Button
        {
            Text = "Отмена",
            DialogResult = DialogResult.Cancel,
            Location = new Point(384, 100),
            Size = new Size(100, 32)
        };

        AcceptButton = connect;
        CancelButton = cancel;
        Controls.AddRange([label, _ports, connect, cancel]);
    }

    public SerialPortDescriptor? SelectedPort =>
        _ports.SelectedItem as SerialPortDescriptor;
}
