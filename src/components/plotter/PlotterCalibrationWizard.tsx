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
  "pen-down": "Перо должно мягко коснуться бумаги без чрезмерного прижима.",
  "pen-safe": "Перед позиционированием и проверкой рамки снова поднимите перо.",
  origin:
    "Кнопками переместите поднятое перо в левый верхний угол рабочей области, затем установите ноль.",
  "boundary-right":
    "Перо с поднятым механизмом переместится по верхней стороне к правому углу.",
  "boundary-bottom": "Перо переместится вниз к правому нижнему углу.",
  "boundary-left": "Перо переместится по нижней стороне к левому углу.",
  "boundary-home": "Перо вернётся вверх в исходную нулевую точку.",
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
  if (step.action === "pen-up") return "Поднять перо";
  if (step.action === "pen-down") return "Опустить перо";
  if (step.kind === "boundary") return "Перейти к углу";
  return "Выполнить движение";
}

export default function PlotterCalibrationWizard({ workspace }) {
  const [state, dispatch] = useReducer(
    calibrationReducer,
    workspace.config,
    createCalibrationState,
  );
  const wasConnected = useRef(workspace.connected);
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
    dispatch({ type: "action-start" });
    try {
      if (step.kind === "connect" && !workspace.connected) {
        const connected = await workspace.connect();
        if (!connected) throw new Error("Не удалось подключить устройство.");
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
    }
  };

  const verify = (passed) => {
    dispatch({ type: passed ? "verify-pass" : "verify-fail" });
    if (passed) dispatch({ type: "continue" });
  };

  const jog = (dx, dy) => {
    void workspace.jog(dx, dy);
  };

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
          ) : step.kind === "summary" ? (
            <>
              <div className="calibration-success" aria-hidden="true">
                ✓
              </div>
              <p>
                Оси, перо, нулевая точка и рабочая область проверены. Профиль «
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
              <p>{stepText}</p>
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
