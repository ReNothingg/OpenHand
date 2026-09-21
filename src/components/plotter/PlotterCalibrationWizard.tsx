import { useEffect, useReducer, useRef } from "react";
import { createPortal } from "react-dom";
import {
  CALIBRATION_CHECKS,
  calibrationCanContinue,
  calibrationReducer,
  createCalibrationState,
  currentCalibrationStep,
} from "../../plotter/calibrationModel";

const STEP_TEXT = {
  connect:
    "Подключите выбранный профиль. OpenHand отправит безопасную команду идентификации и дождётся ответа.",
  "axis-x-negative":
    "Каретка должна сместиться на небольшой шаг в направлении X−.",
  "axis-x-positive":
    "Каретка должна вернуться на такой же шаг в направлении X+.",
  "axis-y-negative":
    "Каретка должна сместиться на небольшой шаг в направлении Y−.",
  "axis-y-positive":
    "Каретка должна вернуться на такой же шаг в направлении Y+.",
  "pen-up": "Перо должно подняться без упора сервопривода или оси.",
  "pen-reference": "Ручка должна быть снята или поднята над бумагой. Эта кнопка не двигает механизм: она принимает текущую высоту за положение «перо поднято». Следующая проверка опускания будет двигаться от этой высоты. Если механизм упирается в ограничитель, сначала устраните упор.",
  "pen-down": "Перо должно мягко коснуться бумаги без чрезмерного прижима.",
  "pen-safe": "Перед позиционированием нуля листа снова поднимите перо.",
  origin:
    "Кнопками переместите поднятое перо в левый верхний угол рабочей области, затем установите ноль.",

};

const ORIGIN_LABELS = {
  "left-top": "левый верхний",
  "right-top": "правый верхний",
  "left-bottom": "левый нижний",
  "right-bottom": "правый нижний",
};

function actionLabel(step, connected) {
  if (step.kind === "connect")
    return connected ? "Проверить ответ" : "Подключить и проверить";
  if (step.kind === "origin") return "Установить ноль";
  if (step.action === "pen-reference") return "Принять текущую высоту за поднятое перо";
  if (step.action === "pen-up") return "Поднять перо";
  if (step.action === "pen-down") return "Опустить перо";
  return "Выполнить движение";
}

export default function PlotterCalibrationWizard({ workspace }) {
  const [state, dispatch] = useReducer(
    calibrationReducer,
    workspace.config,
    createCalibrationState,
  );
  const wasConnected = useRef(workspace.connected);
  const actionInFlight = useRef(false);
  const step = currentCalibrationStep(state);
  const running = state.phase === "running";
  const stepText =
    step.id === "origin"
      ? `Кнопками переместите поднятое перо в ${ORIGIN_LABELS[workspace.config.startPosition] || "выбранный"} угол рабочей области, затем установите ноль.`
      : STEP_TEXT[step.id];

  useEffect(() => {
    if (wasConnected.current && !workspace.connected)
      dispatch({ type: "disconnect" });
    wasConnected.current = workspace.connected;
  }, [workspace.connected]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        void workspace.cancelCalibration({
          emergency: state.phase === "running",
        });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [state.phase, workspace]);

  const close = () => {
    void workspace.cancelCalibration({ emergency: running });
  };

  const runStep = async () => {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    dispatch({ type: "action-start" });
    try {
      if (step.kind === "connect" && !workspace.connected) {
        await workspace.connectCalibration();
      }
      await workspace.performCalibrationAction(step.action);
      dispatch({ type: "action-success" });
      if (step.kind === "connect") {
        dispatch({ type: "verify-pass" });
        dispatch({ type: "continue" });
      }
    } catch (reason) {
      dispatch({
        type: "action-error",
        error:
          reason instanceof Error ? reason.message : "Проверка не выполнена.",
      });
    } finally {
      actionInFlight.current = false;
    }
  };

  const verify = (passed) => {
    dispatch({ type: passed ? "verify-pass" : "verify-fail" });
    if (passed) dispatch({ type: "continue" });
  };

  const jog = async (dx, dy) => {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    dispatch({ type: "action-start" });
    try {
      await workspace.calibrationJog(dx, dy);
      dispatch({ type: "settings-changed" });
    } catch (reason) {
      dispatch({ type: "action-error", error: reason instanceof Error ? reason.message : "Перемещение не выполнено." });
    } finally {
      actionInFlight.current = false;
    }
  };

  const adjust = (key, value) => {
    if (actionInFlight.current) return;
    workspace.updateCalibrationConfig(key, value);
    dispatch({ type: "settings-changed", axes: ["invertX", "invertY", "swapAxes"].includes(key) });
  };
  const axisStep = step.id.startsWith("axis-");
  const penStep = step.id.startsWith("pen-");
  const axisDescription = axisStep
    ? `Перо должно переместиться на ${workspace.config.calibrationStep} мм ${
      step.id.includes("-x-")
        ? (step.id.endsWith("positive") ? "вправо" : "влево")
        : (step.id.endsWith("positive") ? "вниз" : "вверх")
    }. Если направление неверное, измените переключатели ниже.`
    : stepText;

  return createPortal(
    <div className="calibration-backdrop" role="presentation">
      <section
        className="calibration-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="calibration-title"
      >
        <header>
          <div>
            <small>
              Калибровка · шаг {state.index + 1} из {state.steps.length}
            </small>
            <h2 id="calibration-title">{step.title}</h2>
          </div>
          <button
            type="button"
            aria-label="Закрыть мастер калибровки"
            onClick={close}
          >
            ×
          </button>
        </header>

        <div className="calibration-step-track" aria-hidden="true">
          <i
            style={{
              width: `${(state.index / (state.steps.length - 1)) * 100}%`,
            }}
          />
        </div>

        <div className="calibration-content">
          {step.kind === "checklist" ? (
            <>
              <p>Подтвердите каждый пункт перед первой командой движения.</p>
              <div className="calibration-checklist">
                {CALIBRATION_CHECKS.map((check) => (
                  <label key={check.id}>
                    <input
                      type="checkbox"
                      checked={state.checks[check.id]}
                      onChange={(event) =>
                        dispatch({
                          type: "toggle-check",
                          id: check.id,
                          checked: event.target.checked,
                        })
                      }
                    />
                    <span>{check.label}</span>
                  </label>
                ))}
              </div>
              <button
                className="button primary"
                type="button"
                disabled={!calibrationCanContinue(state)}
                onClick={() => dispatch({ type: "continue" })}
              >
                Перейти к движениям
              </button>
            </>
          ) : step.kind === "area" ? (
            <>
              <p>Измерьте область, доступную от выбранного угла нуля. Ноль листа должен находиться в этом углу, а не посередине механики. Автоматического движения к краям не будет.</p>
              {[["workAreaWidth", "Ширина, мм"], ["workAreaHeight", "Высота, мм"]].map(([key, label]) => (
                <label className="field" key={key}>
                  <span>{label}</span>
                  <input type="number" min="20" max="2000" value={workspace.config[key]} onChange={(event) => {
                    if (event.target.value && Number.isFinite(event.target.valueAsNumber)) adjust(key, event.target.valueAsNumber);
                  }} />
                </label>
              ))}
              <button className="button primary" type="button" onClick={() => verify(true)}>Размеры измерены, ноль находится в выбранном углу</button>
            </>
          ) : step.kind === "summary" ? (
            <>
              <div className="calibration-success" aria-hidden="true">
                ✓
              </div>
              <p>
                Направления, перо и ноль подтверждены вами. Размеры области записаны по вашим измерениям; автоматический объезд не выполнялся. Профиль «
                {workspace.activeProfile.name}» будет отмечен как
                откалиброванный.
              </p>
              <p className="calibration-note">
                Перед реальной работой отдельно подтвердите перо и ноль в панели
                запуска.
              </p>
              <button
                className="button primary"
                type="button"
                onClick={workspace.completeCalibration}
              >
                Сохранить калибровку
              </button>
            </>
          ) : (
            <>
              <p>{axisDescription}</p>
              {axisStep && (
                <fieldset disabled={running} className="calibration-checklist">
                  <legend>Направление осей</legend>
                  {[["invertX", "Развернуть мотор X"], ["invertY", "Развернуть мотор Y"], ["swapAxes", "Поменять оси X и Y местами"]].map(([key, label]) => (
                    <label key={key}>
                      <input type="checkbox" checked={workspace.config[key]} onChange={(event) => adjust(key, event.target.checked)} />
                      <span>{label}</span>
                    </label>
                  ))}
                </fieldset>
              )}
              {(axisStep || step.kind === "origin") && (
                <label className="field">
                  <span>Шаг перемещения, мм</span>
                  <select disabled={running} value={workspace.config.calibrationStep} onChange={(event) => adjust("calibrationStep", Number(event.target.value))}>
                    {[...new Set([0.1, 0.5, 1, 2, 5, workspace.config.calibrationStep])].sort((a, b) => a - b).map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                </label>
              )}
              {penStep && step.id !== "pen-reference" && workspace.config.profile !== "ebb" && (
                <fieldset disabled={running}>
                  <legend>Положение пера</legend>
                  {(workspace.config.penMode === "servo" ? [["penUp", "Поднято"], ["penDown", "Касание"]] : [["zUp", "Поднято, мм"], ["zDown", "Касание, мм"]]).map(([key, label]) => (
                    <label className="field" key={key}>
                      <span>{label}</span>
                      <input type="number" value={workspace.config[key]} step={workspace.config.penMode === "servo" ? 1 : 0.1} onChange={(event) => {
                        if (event.target.value !== "" && Number.isFinite(event.target.valueAsNumber)) adjust(key, event.target.valueAsNumber);
                      }} />
                    </label>
                  ))}
                  {["stepper", "estepper"].includes(workspace.config.penMode) && (
                    <button type="button" className="button" disabled={Math.abs(workspace.config.zUp - workspace.config.zDown) < 0.02}
                      onClick={() => adjust("zUp", Math.round((Number(workspace.config.zUp) + Number(workspace.config.zDown)) * 50) / 100)}>
                      Уменьшить подъём вдвое
                    </button>
                  )}
                  <p className="calibration-note">Изменение сохраняет настройку без движения. Высота подъёма меняется относительно установленного нуля; положение опускания не сдвигается.</p>
                </fieldset>
              )}
              {step.kind === "connect" &&
                workspace.config.penMode === "laser" && (
                  <p className="calibration-warning">
                    Лазерный режим: излучатель должен быть физически отключён.
                    Мастер проверит только перемещения.
                  </p>
                )}
              {step.kind === "origin" && (
                <div
                  className="calibration-jog"
                  aria-label="Позиционирование нулевой точки"
                >
                  <button
                    type="button"
                    disabled={!workspace.connected || running}
                    onClick={() => jog(0, -workspace.config.calibrationStep)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    disabled={!workspace.connected || running}
                    onClick={() => jog(-workspace.config.calibrationStep, 0)}
                  >
                    ←
                  </button>
                  <span>{workspace.config.calibrationStep} мм</span>
                  <button
                    type="button"
                    disabled={!workspace.connected || running}
                    onClick={() => jog(workspace.config.calibrationStep, 0)}
                  >
                    →
                  </button>
                  <button
                    type="button"
                    disabled={!workspace.connected || running}
                    onClick={() => jog(0, workspace.config.calibrationStep)}
                  >
                    ↓
                  </button>
                </div>
              )}

              {state.phase === "awaiting-verification" ? (
                <div className="calibration-verification">
                  <strong>Результат соответствует описанию?</strong>
                  <div>
                    <button
                      className="button primary"
                      type="button"
                      onClick={() => verify(true)}
                    >
                      Да, верно
                    </button>
                    <button
                      className="button ghost"
                      type="button"
                      onClick={() => verify(false)}
                    >
                      Нет
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  className="button primary"
                  type="button"
                  disabled={
                    running || (step.kind !== "connect" && !workspace.connected)
                  }
                  onClick={runStep}
                >
                  {running
                    ? "Выполняется…"
                    : actionLabel(step, workspace.connected)}
                </button>
              )}
            </>
          )}

          {state.error && (
            <p className="calibration-error" role="alert">
              {state.error}
            </p>
          )}
        </div>

        <footer>
          <span>
            Рабочая область: {workspace.config.workAreaWidth} ×{" "}
            {workspace.config.workAreaHeight} мм
          </span>
          <button className="text-button" type="button" onClick={close}>
            Отменить калибровку
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
