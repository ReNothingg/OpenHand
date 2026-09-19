import { useEffect } from "react";

/** Keep native details semantics while animating both opening and closing. */
export function useDisclosureMotion() {
  useEffect(() => {
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const active = new Map<
      HTMLDetailsElement,
      { animation: Animation; finish: () => void; target: boolean }
    >();
    const click = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        reduced.matches
      )
        return;
      const summary = (event.target as Element)?.closest?.("summary");
      if (
        (event.target as Element)?.closest?.(
          "button, a, input, select, textarea",
        )
      )
        return;
      const details = summary?.parentElement;
      if (!(details instanceof HTMLDetailsElement) || !details.animate) return;
      const current = active.get(details);
      const opening = current ? !current.target : !details.open;
      const start = details.getBoundingClientRect().height;
      if (current) {
        current.animation.cancel();
        current.finish();
      }
      const oldOverflow = details.style.overflow;
      details.open = opening;
      const end = details.getBoundingClientRect().height;
      details.open = true;
      details.style.overflow = "hidden";
      event.preventDefault();
      const animation = details.animate(
        [{ height: `${start}px` }, { height: `${end}px` }],
        { duration: 220, easing: "cubic-bezier(.2,.65,.3,1)" },
      );
      const finish = () => {
        details.open = opening;
        details.style.overflow = oldOverflow;
        active.delete(details);
      };
      active.set(details, { animation, finish, target: opening });
      animation.onfinish = finish;
    };
    const finishAll = () => {
      for (const { animation, finish } of [...active.values()]) {
        animation.cancel();
        finish();
      }
    };
    document.addEventListener("click", click);
    reduced.addEventListener("change", finishAll);
    return () => {
      document.removeEventListener("click", click);
      reduced.removeEventListener("change", finishAll);
      finishAll();
    };
  }, []);
}
