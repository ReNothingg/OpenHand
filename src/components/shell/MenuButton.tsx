import { useEffect, useId, useRef, useState } from "react";
import Icon from "../Icon";

export interface MenuItem {
  label: string;
  onSelect: () => unknown;
  disabled?: boolean;
  hint?: string;
  danger?: boolean;
}

/** A small popup menu: closes on selection, Escape and outside clicks. */
export default function MenuButton({
  label,
  icon,
  items,
  className = "",
  align = "start",
  iconOnly = false,
  disabled = false,
}: {
  label: string;
  icon?: string;
  items: MenuItem[];
  className?: string;
  align?: "start" | "end";
  iconOnly?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();
  useEffect(() => {
    if (!open) return undefined;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    // Escape keeps propagating: it is also the plotter's emergency stop key.
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);
  return (
    <div className={`oh-menu ${className}`.trim()} ref={rootRef}>
      <button
        type="button"
        className={iconOnly ? "oh-icon-button" : "oh-button"}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={iconOnly ? label : undefined}
        title={iconOnly ? label : undefined}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        {icon && <Icon name={icon} />}
        {!iconOnly && <span>{label}</span>}
        {!iconOnly && <Icon name="chevron-down" className="oh-menu-caret" />}
      </button>
      {open && (
        <div className={`oh-menu-popup align-${align}`} role="menu" id={menuId}>
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={item.danger ? "is-danger" : ""}
              disabled={item.disabled}
              title={item.disabled ? item.hint : undefined}
              onClick={() => {
                setOpen(false);
                void item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
