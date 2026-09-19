import { useEffect, useState } from "react";

export function readAppearance() {
  try {
    const value = localStorage.getItem("openhand.appearance");
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

export default function AppearanceControl() {
  const [value, setValue] = useState(readAppearance);
  useEffect(() => {
    const sync = (event: Event) => {
      const next = (event as CustomEvent).detail;
      setValue(next === "light" || next === "dark" ? next : "system");
    };
    window.addEventListener("openhand:appearance", sync);
    return () => window.removeEventListener("openhand:appearance", sync);
  }, []);
  return (
    <select
      className="appearance-control"
      aria-label="Оформление интерфейса"
      title="Оформление интерфейса"
      value={value}
      onChange={(event) => {
        const next = event.target.value;
        setValue(next);
        try {
          localStorage.setItem("openhand.appearance", next);
        } catch {
          /* session theme still applies */
        }
        window.dispatchEvent(
          new CustomEvent("openhand:appearance", { detail: next }),
        );
      }}
    >
      <option value="system">Как в системе</option>
      <option value="light">Светлая тема</option>
      <option value="dark">Тёмная тема</option>
    </select>
  );
}
