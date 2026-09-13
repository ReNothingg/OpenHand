// Local browser smoke fixture. Synthetic pen events test the React/canvas pipeline,
// not the physical latency or sensor quality of an Apple Pencil.
import React, { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import FontCanvas from "../src/font-builder/FontCanvas";
import FontPreview from "../src/font-builder/FontPreview";
import { DEFAULT_PEN_SETTINGS, type FontStroke } from "../src/font-builder/penInput";

const settle = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
function Fixture() {
  const [strokes, setStrokes] = useState<FontStroke[]>([]);
  const [settings, setSettings] = useState(DEFAULT_PEN_SETTINGS);
  const [character, setCharacter] = useState("А");
  const [result, setResult] = useState("Ожидание проверки");
  const penSeen = useRef(false);
  const commits = useRef<FontStroke[][]>([]);
  const current = useRef<FontStroke[]>([]);
  const previous = useRef<FontStroke[]>([]);
  const emit = (type: string, x: number, y: number, extra: PointerEventInit = {}, additions = {}) => {
    const canvas = document.querySelector("canvas")!;
    const bounds = canvas.getBoundingClientRect();
    const event = new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 51, pointerType: "pen", isPrimary: false,
      buttons: type === "pointerup" ? 0 : 1, button: 0, clientX: bounds.left + x * bounds.width / 640,
      clientY: bounds.top + y * bounds.height / 520, pressure: 0.5, tiltX: 25, tiltY: -15, ...extra });
    Object.entries(additions).forEach(([key, value]) => Object.defineProperty(event, key, { value }));
    canvas.dispatchEvent(event);
    return event;
  };
  const reset = async () => {
    flushSync(() => { setStrokes([]); setSettings(DEFAULT_PEN_SETTINGS); setCharacter("А"); });
    commits.current = []; current.current = []; penSeen.current = false;
    await settle();
  };
  const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
  const run = async () => {
    const passed: string[] = [];
    try {
      await reset();
      assert(document.querySelector("canvas")!.getContext("2d")!.getImageData(0, 0, 1, 1).data[3] === 255, "Холст не отрисовался после mount");
      passed.push("Холст отрисовывается в StrictMode");
      emit("pointerdown", 150, 200, { pressure: 0.1 });
      emit("pointermove", 170, 205, { pressure: 0.9 });
      assert(commits.current.length === 0, "Промежуточный штрих попал в историю");
      emit("pointerup", 175, 210, { pressure: 0 }); await settle();
      assert(commits.current.length === 1 && Math.abs(current.current[0][0].pressure - 0.1) < 0.001 && Math.abs(current.current[0].at(-1)?.pressure - 0.9) < 0.001, "Нажим или endpoint потерян");
      assert(current.current[0][0].tiltX === 25, "Наклон потерян");
      passed.push("Нажим, наклон, endpoint и один commit на штрих");
      const widths = [...document.querySelectorAll(".font-preview-svg path")].map(el => (el as SVGElement).style.strokeWidth);
      assert(new Set(widths).size > 1, "Нажим не меняет толщину предпросмотра");
      passed.push("Толщина SVG-предпросмотра меняется по нажиму");
      emit("pointerdown", 200, 200); emit("pointermove", 220, 220); emit("pointercancel", 220, 220); await settle();
      assert(commits.current.length === 1, "pointercancel сохранил штрих");
      emit("pointerdown", 200, 200); emit("lostpointercapture", 200, 200); emit("pointerup", 210, 210); await settle();
      assert(commits.current.length === 1, "Потеря захвата сохранила штрих");
      passed.push("Отмена и потеря захвата отбрасывают незаконченный штрих");
      await reset();
      emit("pointerdown", 120, 200, { pointerId: 1, pointerType: "touch", isPrimary: true });
      emit("pointermove", 140, 220, { pointerId: 1, pointerType: "touch", isPrimary: true });
      emit("pointerdown", 300, 200); emit("pointermove", 320, 220); emit("pointerup", 325, 225); await settle();
      emit("pointerup", 140, 220, { pointerId: 1, pointerType: "touch", isPrimary: true });
      assert(current.current.length === 1 && current.current[0][0].x > 180, "Ладонь не уступила перу");
      passed.push("Перо вытесняет касание ладонью без лишнего штриха");
      flushSync(() => setSettings({ ...DEFAULT_PEN_SETTINGS, inputMode: "pen" })); await settle();
      const count = commits.current.length;
      emit("pointerdown", 200, 200, { pointerType: "touch", isPrimary: true }); emit("pointerup", 205, 205, { pointerType: "touch", isPrimary: true });
      assert(commits.current.length === count, "Режим только перо принял палец");
      passed.push("Режим только перо блокирует палец");
      await reset();
      emit("pointerdown", 200, 200); emit("pointerup", 200, 200); await settle();
      assert(current.current[0].length === 2, "Точка не сохранена");
      emit("pointerdown", 200, 200, { button: 5, buttons: 32 }); emit("pointerup", 200, 200, { button: 5 }); await settle();
      assert(current.current.length === 0 && previous.current.length === 1, "Ластик или история повреждены");
      passed.push("Точки и аппаратный ластик с сохранением предыдущего состояния");
      await reset();
      emit("pointerdown", 150, 200);
      const bounds = document.querySelector("canvas")!.getBoundingClientRect();
      const sample = (x: number, pressure: number) => new PointerEvent("pointermove", { clientX: bounds.left + x * bounds.width / 640, clientY: bounds.top + 205 * bounds.height / 520, pressure, tiltX: 12, tiltY: 2 });
      emit("pointermove", 190, 205, {}, { getCoalescedEvents: () => [sample(170, 0.2), sample(190, 0.8)], getPredictedEvents: () => { const predicted = sample(500, 1); Object.defineProperty(predicted, "timeStamp", { value: performance.now() + 10 }); return [predicted]; } });
      emit("pointerup", 195, 210); await settle();
      assert(current.current[0].some(p => Math.abs(p.pressure - 0.2) < 0.001) && current.current[0].some(p => Math.abs(p.pressure - 0.8) < 0.001), "Coalesced-точки потеряны");
      assert(Math.max(...current.current[0].map(p => p.x)) < 120, "Предсказанные точки сохранены");
      passed.push("Coalesced-точки сохранены, предсказания не экспортируются");
      const before = commits.current.length;
      emit("pointerdown", 300, 300); emit("pointermove", 320, 320);
      flushSync(() => setCharacter("Б")); await settle(); emit("pointerup", 320, 320); await settle();
      assert(commits.current.length === before, "Штрих попал в другой символ");
      passed.push("Смена символа во время рисования не смешивает глифы");
      setResult(`PASS: ${passed.length}\n${passed.join("\n")}`);
    } catch (error) { setResult(`FAIL: ${error.message}\n${passed.join("\n")}`); }
  };
  return <main><h1>Проверка ввода пера</h1><button onClick={run}>Проверить перо</button><pre role="status">{result}</pre>
    <div style={{ width: 640, maxWidth: "100%" }}><FontCanvas key={character} character={character} strokes={strokes} settings={settings} tool="pen" penSeenRef={penSeen}
      onChange={(next, options) => { commits.current.push(next); current.current = next; previous.current = options?.previous || []; setStrokes(next); }} /></div>
    <FontPreview text="А" glyphs={{ А: strokes }} />
  </main>;
}
createRoot(document.getElementById("root")!).render(<React.StrictMode><Fixture /></React.StrictMode>);
