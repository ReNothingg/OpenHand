export default function Icon({
  name,
  className = "",
}: {
  name: string;
  className?: string;
}) {
  return (
    <span
      className={`svg-icon ${className}`.trim()}
      style={{
        "--icon-url": `url("${new URL(`${import.meta.env.BASE_URL}icons/${name}.svg`, document.baseURI).href}")`,
      }}
      aria-hidden="true"
    />
  );
}
