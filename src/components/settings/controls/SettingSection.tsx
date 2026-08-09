export default function SettingSection({ title, children, open = true }) {
  return (
    <details className="settings-section" open={open}>
      <summary>{title}</summary>
      <div className="settings-content">{children}</div>
    </details>
  );
}
