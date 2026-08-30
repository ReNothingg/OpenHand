import { useRef, useState } from "react";
import LiquidRange from "../controls/LiquidRange";
import SettingSection from "../settings/controls/SettingSection";
import Toggle from "../settings/controls/Toggle";
import { downloadFile } from "../../lib/files";
import {
  PLOTTER_DEVICE_PRESETS,
  safeProfileFilename,
  serializePlotterProfile,
} from "../../plotter/profiles";
import PlotterCalibrationWizard from "./PlotterCalibrationWizard";

function Help({ children }: { children: string }) {
  return (
    <span className="plotter-help" tabIndex={0} aria-label={children}>
      !<span role="tooltip">{children}</span>
    </span>
  );
}

function Caption({
  children,
  help,
}: {
  children: React.ReactNode;
  help: string;
}) {
  return (
    <span className="plotter-caption">
      {children}
      <Help>{help}</Help>
    </span>
  );
}

export default function PlotterSettings({ workspace }: { workspace: any }) {
  const fontInputRef = useRef(null);
  const profileInputRef = useRef(null);
  const [manualCommand, setManualCommand] = useState("");
  const { enabled, config, connected, running, plotter, calibrationActive } =
    workspace;
  const locked = !enabled || running || calibrationActive;
  const number = (key, min, max) => (event) =>
    workspace.boundedConfig(key, event.target.value, min, max);
  const createProfile = () => {
    const name = window
      .prompt("Название нового профиля:", "Мой плоттер")
      ?.trim();
    if (name) workspace.createDeviceProfile(name);
  };
  const renameProfile = () => {
    const name = window
      .prompt("Новое название профиля:", workspace.activeProfile.name)
      ?.trim();
    if (name) workspace.renameDeviceProfile(workspace.activeProfile.id, name);
  };
  const duplicateProfile = () => {
    const name = window
      .prompt("Название копии:", `${workspace.activeProfile.name} — копия`)
      ?.trim();
    if (name)
      workspace.duplicateDeviceProfile(workspace.activeProfile.id, name);
  };
  const deleteProfile = () => {
    if (window.confirm(`Удалить профиль «${workspace.activeProfile.name}»?`))
      workspace.deleteDeviceProfile(workspace.activeProfile.id);
  };
  const exportProfile = () => {
    downloadFile(
      safeProfileFilename(workspace.activeProfile.name),
      serializePlotterProfile(workspace.activeProfile),
      "application/json;charset=utf-8",
    );
  };
  const importProfile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      await workspace.importDeviceProfile(file);
    } catch (reason) {
      window.alert(
        reason instanceof Error
          ? reason.message
          : "Не удалось импортировать профиль.",
      );
    }
    event.target.value = "";
  };

  return (
    <div
      className={`integrated-plotter-settings ${enabled ? "enabled" : "disabled"}`}
    >
      <fieldset disabled={!enabled || calibrationActive}>
        <SettingSection title="Плоттер" open={false}>
          <section
            className="settings-subgroup plotter-subgroup"
            aria-labelledby="plotter-profile-title"
          >
            <h3 id="plotter-profile-title">Профиль устройства</h3>
            <label className="field">
              <Caption help="Готовые локальные параметры, восстановленные из KDraw. Применение заменит механику и координаты активного профиля.">
                Совместимость
              </Caption>
              <select
                defaultValue=""
                disabled={connected || running}
                onChange={(event) => {
                  if (event.target.value)
                    workspace.applyDevicePreset(event.target.value);
                  event.target.value = "";
                }}
              >
                <option value="" disabled>
                  Применить готовый профиль…
                </option>
                {PLOTTER_DEVICE_PRESETS.map((preset) => (
                  <option value={preset.id} key={preset.id}>
                    {preset.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Активный профиль</span>
              <select
                value={workspace.activeProfile.id}
                disabled={connected || running}
                onChange={(event) =>
                  workspace.selectDeviceProfile(event.target.value)
                }
              >
                {workspace.profileStore.profiles.map((profile) => (
                  <option value={profile.id} key={profile.id}>
                    {profile.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="plotter-profile-meta">
              {workspace.activeProfile.calibratedAt
                ? `Калибровка: ${new Date(workspace.activeProfile.calibratedAt).toLocaleString("ru-RU")}`
                : "Калибровка ещё не завершена"}
            </div>
            <div className="plotter-profile-actions">
              <button
                className="text-button"
                type="button"
                disabled={connected || running}
                onClick={createProfile}
              >
                Новый
              </button>
              <button
                className="text-button"
                type="button"
                disabled={connected || running}
                onClick={renameProfile}
              >
                Переименовать
              </button>
              <button
                className="text-button"
                type="button"
                disabled={connected || running}
                onClick={duplicateProfile}
              >
                Дублировать
              </button>
              <button
                className="text-button danger-text"
                type="button"
                disabled={
                  connected ||
                  running ||
                  workspace.profileStore.profiles.length < 2
                }
                onClick={deleteProfile}
              >
                Удалить
              </button>
            </div>
            <div className="plotter-row two">
              <button
                className="button ghost compact"
                type="button"
                onClick={exportProfile}
              >
                Экспорт
              </button>
              <button
                className="button ghost compact"
                type="button"
                disabled={connected || running}
                onClick={() => profileInputRef.current?.click()}
              >
                Импорт
              </button>
            </div>
            <input
              ref={profileInputRef}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={importProfile}
            />
            <button
              className="button primary settings-wide-button"
              type="button"
              disabled={!enabled || running}
              onClick={workspace.startCalibration}
            >
              Калибровать
            </button>
          </section>

          <section
            className="settings-subgroup plotter-subgroup"
            aria-labelledby="plotter-controller-title"
          >
            <h3 id="plotter-controller-title">Подключение</h3>
            <label className="field">
              <Caption help="USB и Bluetooth используют системный последовательный порт. TCP подключается к сетевому модулю плоттера по адресу и порту.">
                Транспорт
              </Caption>
              <select
                value={config.connectionType}
                disabled={connected}
                onChange={(event) =>
                  workspace.updateConfig("connectionType", event.target.value)
                }
              >
                <option value="serial">USB / Bluetooth Serial</option>
                <option value="network">Wi‑Fi / TCP</option>
              </select>
            </label>
            <div className="plotter-row two">
              <label className="field">
                <Caption help="Тип прошивки платы. Неверный вариант не повредит контроллер, но команды не будут распознаны.">
                  Прошивка
                </Caption>
                <select
                  value={config.profile}
                  disabled={connected}
                  onChange={(event) =>
                    workspace.changeProfile(event.target.value)
                  }
                >
                  <option value="grbl">GRBL</option>
                  <option value="marlin">Marlin</option>
                  <option value="ebb">EBB / DrawCore</option>
                </select>
              </label>
              {config.connectionType === "serial" ? (
                <label className="field">
                  <Caption help="Скорость обмена с платой. Обычно используется 115200. При неверном значении порт отвечает мусором или молчит.">
                    Скорость порта
                  </Caption>
                  <select
                    value={config.baudRate}
                    disabled={connected}
                    onChange={(event) =>
                      workspace.updateConfig(
                        "baudRate",
                        Number(event.target.value),
                      )
                    }
                  >
                    <option>9600</option>
                    <option>115200</option>
                    <option>250000</option>
                  </select>
                </label>
              ) : (
                <label className="field">
                  <Caption help="TCP-порт из сетевых настроек контроллера KDraw.">
                    TCP-порт
                  </Caption>
                  <input
                    type="number"
                    min="1"
                    max="65535"
                    value={config.networkPort || ""}
                    disabled={connected}
                    onChange={number("networkPort", 1, 65535)}
                  />
                </label>
              )}
            </div>
            {config.connectionType === "network" && (
              <label className="field">
                <Caption help="IPv4, IPv6 или локальное имя сетевого модуля без http://.">
                  IP / хост плоттера
                </Caption>
                <input
                  className="plotter-network-host"
                  type="text"
                  maxLength={253}
                  placeholder="192.168.4.1"
                  value={config.networkHost}
                  disabled={connected}
                  onChange={(event) =>
                    workspace.updateConfig("networkHost", event.target.value)
                  }
                />
              </label>
            )}
            {config.connectionType === "serial" && (
            <details className="plotter-advanced">
              <summary>Расширенные параметры порта</summary>
              <div className="plotter-row two">
                <label className="field">
                  <span>Биты данных</span>
                  <select
                    value={config.dataBits}
                    disabled={connected}
                    onChange={(event) =>
                      workspace.updateConfig(
                        "dataBits",
                        Number(event.target.value),
                      )
                    }
                  >
                    <option value="8">8</option>
                    <option value="7">7</option>
                  </select>
                </label>
                <label className="field">
                  <span>Стоп-биты</span>
                  <select
                    value={config.stopBits}
                    disabled={connected}
                    onChange={(event) =>
                      workspace.updateConfig(
                        "stopBits",
                        Number(event.target.value),
                      )
                    }
                  >
                    <option value="1">1</option>
                    <option value="2">2</option>
                  </select>
                </label>
              </div>
              <div className="plotter-row two">
                <label className="field">
                  <span>Чётность</span>
                  <select
                    value={config.parity}
                    disabled={connected}
                    onChange={(event) =>
                      workspace.updateConfig("parity", event.target.value)
                    }
                  >
                    <option value="none">Нет</option>
                    <option value="even">Чётная</option>
                    <option value="odd">Нечётная</option>
                  </select>
                </label>
                <label className="field">
                  <span>Управление потоком</span>
                  <select
                    value={config.flowControl}
                    disabled={connected}
                    onChange={(event) =>
                      workspace.updateConfig(
                        "flowControl",
                        event.target.value,
                      )
                    }
                  >
                    <option value="none">Нет</option>
                    <option value="hardware">RTS/CTS</option>
                  </select>
                </label>
              </div>
              <label className="field">
                <Caption help="Сколько ждать ответа контроллера на одну команду перед остановкой задания.">
                  Тайм-аут ответа, мс
                </Caption>
                <input
                  type="number"
                  min="1000"
                  max="60000"
                  step="500"
                  value={config.connectionTimeoutMs}
                  disabled={connected}
                  onChange={number("connectionTimeoutMs", 1000, 60000)}
                />
              </label>
            </details>
            )}
            {!connected ? (
              <button
                className="button primary settings-wide-button"
                type="button"
                disabled={
                  !enabled ||
                  !plotter.supported ||
                  plotter.status === "connecting" ||
                  (config.connectionType === "network" &&
                    (!plotter.networkSupported ||
                      !config.networkHost ||
                      !config.networkPort))
                }
                onClick={workspace.connect}
              >
                {config.connectionType === "network"
                  ? "Подключиться по TCP"
                  : "Выбрать USB / Bluetooth-порт"}
              </button>
            ) : (
              <button
                className="button settings-wide-button"
                type="button"
                disabled={running}
                onClick={workspace.disconnect}
              >
                Отключить
              </button>
            )}
            {!plotter.supported && (
              <p className="plotter-warning">
                В браузере Web Serial работает в Chrome/Edge на localhost или
                HTTPS. В приложении доступны также системные Bluetooth COM-порты.
              </p>
            )}
            {config.connectionType === "network" &&
              !plotter.networkSupported && (
                <p className="plotter-warning">
                  Браузер не разрешает прямой TCP-доступ. Wi‑Fi-подключение
                  работает в приложениях OpenHand для macOS и Windows.
                </p>
              )}
          </section>

          <section
            className="settings-subgroup plotter-subgroup"
            aria-labelledby="plotter-mechanics-title"
          >
            <h3 id="plotter-mechanics-title">Механика</h3>
            <div className="plotter-reset-row">
              <button
                className="text-button"
                type="button"
                disabled={locked}
                onClick={workspace.resetMechanics}
              >
                Сбросить
              </button>
            </div>
            {config.profile !== "ebb" && (
              <label className="field">
                <Caption help="Servo управляет сервоприводом, Z/E — шаговым мотором. Laser может немедленно включить излучатель — сначала снимите с него питание.">
                  Механизм пера
                </Caption>
                <select
                  value={config.penMode}
                  disabled={running}
                  onChange={(event) =>
                    workspace.updateConfig("penMode", event.target.value)
                  }
                >
                  <option value="servo">Сервопривод</option>
                  <option value="stepper">Ось Z</option>
                  {config.profile === "grbl" && (
                    <option value="laser">Лазер / PWM</option>
                  )}
                  {config.profile === "marlin" && (
                    <option value="estepper">Ось E</option>
                  )}
                </select>
              </label>
            )}
            {config.profile === "ebb" ? (
              <label className="field">
                <Caption help="Количество шагов моторов на миллиметр. Начинайте с малого тестового перемещения.">
                  Шагов на миллиметр
                </Caption>
                <input
                  type="number"
                  min="1"
                  max="1000"
                  value={config.mmToSteps}
                  onChange={number("mmToSteps", 1, 1000)}
                />
              </label>
            ) : config.penMode === "servo" ? (
              <div className="plotter-row two">
                <label className="field">
                  <Caption help="Положение сервопривода при поднятом пере. Меняйте небольшими шагами, чтобы не упереть серву в механику.">
                    Перо поднято
                  </Caption>
                  <input
                    type="number"
                    min="0"
                    max={config.profile === "marlin" ? 180 : 32767}
                    value={config.penUp}
                    onChange={number(
                      "penUp",
                      0,
                      config.profile === "marlin" ? 180 : 32767,
                    )}
                  />
                </label>
                <label className="field">
                  <Caption help="Положение при касании бумаги. Слишком сильный прижим может сломать перо или редуктор.">
                    Перо опущено
                  </Caption>
                  <input
                    type="number"
                    min="0"
                    max={config.profile === "marlin" ? 180 : 32767}
                    value={config.penDown}
                    onChange={number(
                      "penDown",
                      0,
                      config.profile === "marlin" ? 180 : 32767,
                    )}
                  />
                </label>
              </div>
            ) : config.penMode === "laser" ? (
              <label className="field">
                <Caption help="Мощность PWM. Не проверяйте со включённым лазером без очков и закрытого корпуса.">
                  Мощность S
                </Caption>
                <input
                  type="number"
                  min="0"
                  max="1000"
                  value={config.laserPower}
                  onChange={number("laserPower", 0, 1000)}
                />
              </label>
            ) : (
              <div className="plotter-row two">
                <label className="field">
                  <Caption help="Координата Z/E при поднятом пере. Ошибка направления может увести ось в концевик.">
                    Перо поднято, мм
                  </Caption>
                  <input
                    type="number"
                    min="-50"
                    max="50"
                    step="0.1"
                    value={config.zUp}
                    onChange={number("zUp", -50, 50)}
                  />
                </label>
                <label className="field">
                  <Caption help="Координата касания листа. Не задавайте большое заглубление.">
                    Перо опущено, мм
                  </Caption>
                  <input
                    type="number"
                    min="-50"
                    max="50"
                    step="0.1"
                    value={config.zDown}
                    onChange={number("zDown", -50, 50)}
                  />
                </label>
              </div>
            )}
            <div className="plotter-row two">
              <label className="field">
                <Caption help="Начните с 500–1500 мм/мин. Высокая скорость вызывает пропуски шагов и рваные линии.">
                  Рисование, мм/мин
                </Caption>
                <input
                  type="number"
                  min="1"
                  max="10000"
                  value={config.feedRate}
                  onChange={number("feedRate", 1, 10000)}
                />
              </label>
              <label className="field">
                <Caption help="Скорость движения с поднятым пером. Слишком большое значение может привести к удару о раму.">
                  Холостой ход
                </Caption>
                <input
                  type="number"
                  min="1"
                  max="10000"
                  value={config.jogSpeed}
                  onChange={number("jogSpeed", 1, 10000)}
                />
              </label>
            </div>
            <label className="field">
              <Caption help="Физический угол, в котором вы устанавливаете ноль листа. Профиль Ozon / KDraw использует левый верхний угол и отрицательную Y вниз.">
                Нулевая точка листа
              </Caption>
              <select
                value={config.startPosition}
                disabled={running}
                onChange={(event) =>
                  workspace.updateConfig("startPosition", event.target.value)
                }
              >
                <option value="left-top">Слева сверху</option>
                <option value="right-top">Справа сверху</option>
                <option value="left-bottom">Слева снизу</option>
                <option value="right-bottom">Справа снизу</option>
              </select>
            </label>
            <Toggle
              checked={Boolean(config.swapAxes)}
              onChange={(value) => workspace.updateConfig("swapAxes", value)}
              label="Поменять X и Y местами"
            >
              <small>Используйте, если движение X физически идёт по высоте.</small>
            </Toggle>
            <div className="plotter-row two">
              <Toggle
                checked={Boolean(config.invertX)}
                onChange={(value) => workspace.updateConfig("invertX", value)}
                label="Инвертировать X"
              >
                <small>Меняет знак выходных команд X.</small>
              </Toggle>
              <Toggle
                checked={Boolean(config.invertY)}
                onChange={(value) => workspace.updateConfig("invertY", value)}
                label="Инвертировать Y"
              >
                <small>Меняет знак выходных команд Y.</small>
              </Toggle>
            </div>
            <Toggle
              checked={Boolean(config.autoSetOrigin)}
              onChange={(value) =>
                workspace.updateConfig("autoSetOrigin", value)
              }
              label="Фиксировать текущую точку как ноль перед заданием"
            >
              <small>Не заменяет ручную проверку положения пера на листе.</small>
            </Toggle>
            <Toggle
              checked={Boolean(config.returnToOrigin)}
              onChange={(value) =>
                workspace.updateConfig("returnToOrigin", value)
              }
              label="Возвращаться в ноль после задания"
            >
              <small>По завершении перо поднимется и каретка вернётся в 0,0.</small>
            </Toggle>
            <div className="plotter-row two">
              <label className="field">
                <Caption help="Физическая ширина безопасной рабочей области. Мастер использует её для проверки рамки.">
                  Рабочая ширина, мм
                </Caption>
                <input
                  type="number"
                  min="20"
                  max="2000"
                  step="0.1"
                  value={config.workAreaWidth}
                  onChange={number("workAreaWidth", 20, 2000)}
                />
              </label>
              <label className="field">
                <Caption help="Физическая высота безопасной рабочей области. Значение должно помещаться в пределы механики.">
                  Рабочая высота, мм
                </Caption>
                <input
                  type="number"
                  min="20"
                  max="2000"
                  step="0.1"
                  value={config.workAreaHeight}
                  onChange={number("workAreaHeight", 20, 2000)}
                />
              </label>
            </div>
            <label className="field">
              <Caption help="Короткое движение на этапе проверки направлений. Для первого запуска оставьте 1 мм или меньше.">
                Шаг калибровки, мм
              </Caption>
              <input
                type="number"
                min="0.1"
                max="5"
                step="0.1"
                value={config.calibrationStep}
                onChange={number("calibrationStep", 0.1, 5)}
              />
            </label>
            <Toggle
              checked={Boolean(config.optimizePath)}
              onChange={(value) =>
                workspace.updateConfig("optimizePath", value)
              }
              label="Оптимизировать траекторию"
            >
              <small>
                Сокращает холостой путь в пределах соседних штрихов и строк.
                Геометрия текста не меняется; направление отдельных штрихов
                может быть развёрнуто.
              </small>
            </Toggle>
            <div className="plotter-row two">
              <label className="field">
                <Caption help="Пауза после подъёма, прежде чем каретка начнёт холостой ход.">
                  После подъёма, сек.
                </Caption>
                <input
                  type="number"
                  min="0"
                  max="10"
                  step="0.05"
                  value={config.penUpDelay}
                  onChange={number("penUpDelay", 0, 10)}
                />
              </label>
              <label className="field">
                <Caption help="Пауза после опускания, чтобы перо успело коснуться бумаги до начала линии.">
                  После опускания, сек.
                </Caption>
                <input
                  type="number"
                  min="0"
                  max="10"
                  step="0.05"
                  value={config.penDownDelay}
                  onChange={number("penDownDelay", 0, 10)}
                />
              </label>
            </div>
            <label className="field">
                <Caption help="Дополнительное расстояние между символами. Большое значение вытеснит текст за границы листа.">
                  Межбуквенно, мм
                </Caption>
                <input
                  type="number"
                  min="0"
                  max="20"
                  step="0.1"
                  value={config.letterSpacing}
                  onChange={number("letterSpacing", 0, 20)}
                />
            </label>
            <details className="plotter-advanced">
              <summary>Команды до и после задания</summary>
              <p className="plotter-warning">
                Эти строки отправляются контроллеру без изменения. Используйте
                только известный вам G-code и по одной команде на строку.
              </p>
              <label className="field">
                <span>Перед заданием</span>
                <textarea
                  rows={3}
                  maxLength={8192}
                  value={config.customStartGcode}
                  onChange={(event) =>
                    workspace.updateConfig(
                      "customStartGcode",
                      event.target.value,
                    )
                  }
                />
              </label>
              <label className="field">
                <span>После задания</span>
                <textarea
                  rows={3}
                  maxLength={8192}
                  value={config.customEndGcode}
                  onChange={(event) =>
                    workspace.updateConfig(
                      "customEndGcode",
                      event.target.value,
                    )
                  }
                />
              </label>
            </details>
            <button
              className="button ghost settings-wide-button"
              type="button"
              disabled={!enabled || running}
              onClick={() => fontInputRef.current?.click()}
            >
              Загрузить свой .gfont
            </button>
            <input
              ref={fontInputRef}
              type="file"
              accept=".gfont,application/octet-stream"
              hidden
              onChange={(event) => {
                workspace.importFont(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </section>

          <section
            className="settings-subgroup plotter-subgroup"
            aria-labelledby="plotter-manual-title"
          >
            <h3 id="plotter-manual-title">Ручная проверка</h3>
            <div className="jog-control">
              <button
                type="button"
                aria-label="Переместить каретку вверх"
                disabled={!connected || running}
                onClick={() => workspace.jog(0, -config.jogDistance)}
              >
                ↑
              </button>
              <button
                type="button"
                aria-label="Переместить каретку влево"
                disabled={!connected || running}
                onClick={() => workspace.jog(-config.jogDistance, 0)}
              >
                ←
              </button>
              <span>{config.jogDistance} мм</span>
              <button
                type="button"
                aria-label="Переместить каретку вправо"
                disabled={!connected || running}
                onClick={() => workspace.jog(config.jogDistance, 0)}
              >
                →
              </button>
              <button
                type="button"
                aria-label="Переместить каретку вниз"
                disabled={!connected || running}
                onClick={() => workspace.jog(0, config.jogDistance)}
              >
                ↓
              </button>
            </div>
            <label className="range-control">
              <span className="control-heading">
                <Caption help="Для первого теста выберите 0,1–1 мм, чтобы не ударить каретку о край.">
                  Шаг ручного движения
                </Caption>
                <output>{config.jogDistance} мм</output>
              </span>
              <LiquidRange
                min="0.1"
                max="50"
                step="0.1"
                value={config.jogDistance}
                aria-label="Шаг ручного движения"
                onChange={number("jogDistance", 0.1, 50)}
              />
            </label>
            <div className="plotter-actions compact-actions">
              <button
                className="button compact"
                type="button"
                disabled={!connected || running}
                onClick={() => workspace.pen(true)}
              >
                Перо ↑
              </button>
              <button
                className="button compact"
                type="button"
                disabled={!connected || running}
                onClick={() => workspace.pen(false)}
              >
                Перо ↓
              </button>
              <button
                className="button compact"
                type="button"
                disabled={!connected || running || config.profile === "ebb"}
                onClick={workspace.setOrigin}
              >
                Это ноль
              </button>
              <button
                className="button compact"
                type="button"
                disabled={!connected || running || config.profile === "ebb"}
                onClick={workspace.home}
              >
                Homing
              </button>
              <button
                className="button compact"
                type="button"
                disabled={!connected || running || config.profile === "ebb"}
                onClick={workspace.returnToOrigin}
              >
                В ноль
              </button>
            </div>
            <form
              className="plotter-command-line"
              onSubmit={async (event) => {
                event.preventDefault();
                if (await workspace.sendManualCommand(manualCommand))
                  setManualCommand("");
              }}
            >
              <label className="field">
                <Caption help="Одна низкоуровневая команда контроллеру. Ответ появится в едином журнале порта снизу.">
                  Консоль G-code
                </Caption>
                <input
                  type="text"
                  maxLength={256}
                  placeholder={config.profile === "grbl" ? "$I" : "M115"}
                  value={manualCommand}
                  disabled={!connected || running}
                  onChange={(event) => setManualCommand(event.target.value)}
                />
              </label>
              <button
                className="button ghost compact"
                type="submit"
                disabled={!connected || running || !manualCommand.trim()}
              >
                Отправить
              </button>
            </form>
          </section>
        </SettingSection>
      </fieldset>
      {calibrationActive && <PlotterCalibrationWizard workspace={workspace} />}
    </div>
  );
}
