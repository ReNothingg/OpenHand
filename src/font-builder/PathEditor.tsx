import { useState } from "react";
import type { LetterForm, JoinAnchor } from "./letterForms";

export default function PathEditor({
  form,
  onChange,
}: {
  form: LetterForm;
  onChange: (form: LetterForm) => void;
}) {
  const [selected, setSelected] = useState<{
    stroke: number;
    point: number;
  } | null>(null);
  const [drag, setDrag] = useState<LetterForm | null>(null);
  const shown = drag || form;
  const point = selected && shown.strokes[selected.stroke]?.[selected.point];
  const commit = (strokes: LetterForm["strokes"]) => {
    onChange({ ...form, strokes, entry: undefined, exit: undefined });
    setSelected(null);
  };
  const anchorValue = (a?: JoinAnchor) => (a ? `${a.stroke}:${a.end}` : "");
  const anchorSelect = (kind: "entry" | "exit", label: string) => (
    <label>
      {label}
      <select
        value={anchorValue(form[kind])}
        onChange={(e) => {
          const [stroke, end] = e.target.value.split(":");
          onChange({
            ...form,
            [kind]: e.target.value
              ? { stroke: Number(stroke), end }
              : undefined,
          });
        }}
      >
        <option value="">Автоматически</option>
        {form.strokes.flatMap((_, i) =>
          ["start", "end"].map((end) => (
            <option key={`${i}:${end}`} value={`${i}:${end}`}>
              Штрих {i + 1}, {end === "start" ? "начало" : "конец"}
            </option>
          )),
        )}
      </select>
    </label>
  );
  return (
    <details className="studio-detail">
      <summary>Точки и соединения</summary>
      <p>
        Выберите узел и переместите его. Вход и выход задаются на концах
        штрихов; цветные метки показывают выбранные соединения.
      </p>
      <svg
        className="path-editor"
        viewBox="-40 -340 540 440"
        aria-label="Редактор узлов буквы"
        onPointerMove={(e) => {
          if (!drag || !selected) return;
          const matrix = e.currentTarget.getScreenCTM();
          if (!matrix) return;
          const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(
            matrix.inverse(),
          );
          setDrag({
            ...drag,
            strokes: drag.strokes.map((s, si) =>
              s.map((v, pi) =>
                si === selected.stroke && pi === selected.point
                  ? {
                      ...v,
                      x: Math.max(-40, Math.min(500, p.x)),
                      y: Math.max(-340, Math.min(100, p.y)),
                    }
                  : v,
              ),
            ),
          });
        }}
        onPointerUp={() => {
          if (drag) onChange(drag);
          setDrag(null);
        }}
        onPointerCancel={() => setDrag(null)}
        onLostPointerCapture={() => setDrag(null)}
      >
        <line x1="-40" x2="500" y1="0" y2="0" stroke="#d5dcd8" />
        {shown.strokes.map((s, si) => (
          <g key={si}>
            <path
              d={s.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ")}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            />
            {s.map((p, pi) => (
              <circle
                key={pi}
                cx={p.x}
                cy={p.y}
                r={selected?.stroke === si && selected?.point === pi ? 5 : 2.7}
                className="path-node"
                tabIndex={0}
                role="button"
                aria-label={`Штрих ${si + 1}, узел ${pi + 1}`}
                onFocus={() => setSelected({ stroke: si, point: pi })}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.currentTarget.setPointerCapture(e.pointerId);
                  setSelected({ stroke: si, point: pi });
                  setDrag(form);
                }}
              />
            ))}
          </g>
        ))}
        {(["entry", "exit"] as const).map((kind) => {
          const a = shown[kind];
          const s = a && shown.strokes[a.stroke];
          const p = s && (a.end === "start" ? s[0] : s.at(-1));
          return (
            p && (
              <circle
                key={kind}
                cx={p.x}
                cy={p.y}
                r="8"
                fill="none"
                stroke={kind === "entry" ? "#248a3d" : "#a26524"}
                strokeWidth="2"
                pointerEvents="none"
              />
            )
          );
        })}
      </svg>
      <div className="studio-control-row">
        {anchorSelect("entry", "Вход")}
        {anchorSelect("exit", "Выход")}
      </div>
      {point && selected && (
        <div className="studio-control-row">
          {(["x", "y"] as const).map((key) => (
            <label key={key}>
              {key.toUpperCase()}
              <input
                type="number"
                step="0.5"
                value={Math.round(point[key] * 100) / 100}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n))
                    onChange({
                      ...form,
                      strokes: form.strokes.map((s, si) =>
                        s.map((p, pi) =>
                          si === selected.stroke && pi === selected.point
                            ? { ...p, [key]: n }
                            : p,
                        ),
                      ),
                    });
                }}
              />
            </label>
          ))}
          <button
            type="button"
            onClick={() =>
              commit(
                form.strokes
                  .map((s, si) =>
                    si === selected.stroke
                      ? s.filter((_, pi) => pi !== selected.point)
                      : s,
                  )
                  .filter((s) => s.length > 1),
              )
            }
          >
            Удалить узел
          </button>
          <button
            type="button"
            disabled={
              !selected.point ||
              selected.point === form.strokes[selected.stroke].length - 1
            }
            onClick={() =>
              commit(
                form.strokes.flatMap((s, si) =>
                  si === selected.stroke
                    ? [s.slice(0, selected.point + 1), s.slice(selected.point)]
                    : [s],
                ),
              )
            }
          >
            Разделить здесь
          </button>
          <button
            type="button"
            disabled={selected.stroke >= form.strokes.length - 1}
            onClick={() =>
              commit(
                form.strokes.flatMap((s, si) =>
                  si === selected.stroke
                    ? [[...s, ...form.strokes[si + 1]]]
                    : si === selected.stroke + 1
                      ? []
                      : [s],
                ),
              )
            }
          >
            Соединить со следующим
          </button>
          <button
            type="button"
            onClick={() =>
              commit(
                form.strokes.map((s, si) =>
                  si === selected.stroke ? [...s].reverse() : s,
                ),
              )
            }
          >
            Развернуть штрих
          </button>
        </div>
      )}
    </details>
  );
}
