import { serializePlotterGcode } from "../../gcode/penModel";
import { useMemo, useState } from "react";
import { calibrationMode, createPenCalibration } from "../../plotter/penCalibration";
import { downloadFile } from "../../lib/files";

export default function PenCalibrationSheet({ workspace }) {
  const [selected, setSelected] = useState("");
  const [notice, setNotice] = useState("");
  const { config } = workspace;
  const sheet = useMemo(() => config.penMode === "laser" ? null : createPenCalibration(config), [config]);
  if (!sheet) return null;
  const candidate = sheet.candidates.find((c) => c.id === selected);
  const mode = calibrationMode(config);
  const variablePressure = mode !== "speed";
  return (
    <section className="device-card" id="device-tuning" aria-labelledby="device-tuning-title">
            <h2 id="device-tuning-title">Подобрать перо и скорость</h2>
      <div className="pen-calibration-body">
        <p className="pen-calibration-intro">
          Выполните тестовый лист и выберите образец с самой чистой линией.
        </p>
        <figure className="pen-calibration-figure">
          <svg
            className="calibration-sheet-preview"
            viewBox="0 0 104 78"
            role="img"
            aria-label="Предпросмотр тестового листа"
          >
            <g fill="none" stroke="currentColor" strokeWidth=".35">
              {sheet.strokes.map((stroke, i) => (
                <path
                  key={i}
                  d={stroke
                    .map((p, j) => `${j ? "L" : "M"}${p.x} ${p.y}`)
                    .join(" ")}
                />
              ))}
            </g>
            {sheet.candidates.map((c) => (
              <text
                key={c.id}
                x={8 + c.col * 32}
                y={7 + c.row * 24}
                fontSize="3"
              >
                {c.id}
              </text>
            ))}
          </svg>
          <figcaption>
            {mode === "servo"
              ? "Строки — скорость. Столбцы — прижим пера."
              : mode === "stepper" ? "Строки — скорость. Столбцы — прижим ниже касания."
              : "Сравнивается скорость. Чтобы сравнить и прижим, отметьте касание бумаги в настройке пера."}
          </figcaption>
        </figure>
        <button
          className="button primary" data-plotter-motion=""
          type="button"
          disabled={!workspace.deviceReadiness.canStart || !sheet.withinWorkArea}
          onClick={async () => {
            setNotice("");
            const success = await workspace.runPenCalibration(sheet);
            setNotice(success
              ? "Проба завершена. Выберите лучший образец на бумаге."
              : "Проба не завершена. Проверьте сообщение и готовность плоттера.");
          }}
        >
          Написать пробу на плоттере
        </button>
        <button
          className="button"
          type="button"
          disabled={!sheet.withinWorkArea}
          onClick={() =>
            downloadFile(
              config.profile === "ebb"
                ? "pen-calibration.ebb"
                : "pen-calibration.gcode",
              serializePlotterGcode(sheet.commands, sheet.checkConfig || config),
              "text/plain",
            )
          }
        >
          Скачать тестовое задание
        </button>
        {!sheet.withinWorkArea && (
          <p className="plotter-error" role="alert">
            Лист выходит за рабочую область. Проверьте размеры и направление
            осей.
          </p>
        )}
        <label className="field">
          <span>Лучший образец</span>
          <select
            value={selected}
            onChange={(e) => {
              setSelected(e.target.value);
              setNotice("");
            }}
          >
            <option value="">Выберите после проверки</option>
            {sheet.candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.id} · {c.feedRate} мм/мин
                {mode === "stepper" ? ` · прижим ${c.pressureMm.toLocaleString("ru-RU")} мм`
                  : variablePressure ? ` · прижим ${Math.round(c.pressure * 100)}%`
                  : ""}
              </option>
            ))}
          </select>
        </label>
        <button
          className="button primary"
          type="button"
          disabled={
            !candidate || workspace.running || workspace.calibrationActive
          }
          onClick={() => {
            if (!candidate) return;
            workspace.updateConfig("feedRate", candidate.feedRate);
            if (mode === "servo")
              workspace.updateConfig("penDown", candidate.penDown);
            if (mode === "stepper")
              void workspace.adjustPenGeometry({ pressure: candidate.pressureMm });
            setSelected("");
            setNotice("Параметры сохранены в профиле плоттера.");
          }}
        >
          Применить к профилю
        </button>
        {notice && (
          <p className="pen-calibration-notice" role="status">
            {notice}
          </p>
        )}
      </div>
    </section>
  );
}
