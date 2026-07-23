import { useRef } from 'react'
import SettingSection from '../settings/controls/SettingSection.jsx'
import Toggle from '../settings/controls/Toggle.jsx'

function Help({ children }) {
  return <span className="plotter-help" tabIndex="0" aria-label={children}>!<span role="tooltip">{children}</span></span>
}

function Caption({ children, help }) {
  return <span className="plotter-caption">{children}<Help>{help}</Help></span>
}

export default function PlotterSettings({ workspace }) {
  const fontInputRef = useRef(null)
  const { enabled, config, connected, running, plotter } = workspace
  const locked = !enabled || running
  const number = (key, min, max) => (event) => workspace.boundedConfig(key, event.target.value, min, max)

  return (
    <div className={`integrated-plotter-settings ${enabled ? 'enabled' : 'disabled'}`}>
      <fieldset disabled={!enabled}>
        <SettingSection title="Контроллер">
          <div className="plotter-row two">
            <label className="field"><Caption help="Тип прошивки платы. Неверный вариант не повредит контроллер, но команды не будут распознаны.">Прошивка</Caption><select value={config.profile} disabled={connected} onChange={(event) => workspace.changeProfile(event.target.value)}><option value="grbl">GRBL</option><option value="marlin">Marlin</option><option value="ebb">EBB / DrawCore</option></select></label>
            <label className="field"><Caption help="Скорость обмена с платой. Обычно используется 115200. При неверном значении порт отвечает мусором или молчит.">Скорость порта</Caption><select value={config.baudRate} disabled={connected} onChange={(event) => workspace.updateConfig('baudRate', Number(event.target.value))}><option>9600</option><option>115200</option><option>250000</option></select></label>
          </div>
          {!connected
            ? <button className="button primary settings-wide-button" type="button" disabled={!enabled || !plotter.supported || plotter.status === 'connecting'} onClick={workspace.connect}>Выбрать USB-порт</button>
            : <button className="button settings-wide-button" type="button" disabled={running} onClick={workspace.disconnect}>Отключить</button>}
          {!plotter.supported && <p className="plotter-warning">Web Serial работает в Chrome/Edge на localhost или HTTPS.</p>}
        </SettingSection>

        <SettingSection title="Механика">
          <div className="plotter-reset-row"><button className="text-button" type="button" disabled={locked} onClick={workspace.resetMechanics}>Сбросить</button></div>
          {config.profile !== 'ebb' && <label className="field"><Caption help="Servo управляет сервоприводом, Z/E — шаговым мотором. Laser может немедленно включить излучатель — сначала снимите с него питание.">Механизм пера</Caption><select value={config.penMode} disabled={running} onChange={(event) => workspace.updateConfig('penMode', event.target.value)}><option value="servo">Сервопривод</option><option value="stepper">Ось Z</option>{config.profile === 'grbl' && <option value="laser">Лазер / PWM</option>}{config.profile === 'marlin' && <option value="estepper">Ось E</option>}</select></label>}
          {config.profile === 'ebb'
            ? <label className="field"><Caption help="Количество шагов моторов на миллиметр. Начинайте с малого тестового перемещения.">Шагов на миллиметр</Caption><input type="number" min="1" max="1000" value={config.mmToSteps} onChange={number('mmToSteps', 1, 1000)} /></label>
            : config.penMode === 'servo'
              ? <div className="plotter-row two"><label className="field"><Caption help="Положение сервопривода при поднятом пере. Меняйте небольшими шагами, чтобы не упереть серву в механику.">Перо поднято</Caption><input type="number" min="0" max={config.profile === 'marlin' ? 180 : 32767} value={config.penUp} onChange={number('penUp', 0, config.profile === 'marlin' ? 180 : 32767)} /></label><label className="field"><Caption help="Положение при касании бумаги. Слишком сильный прижим может сломать перо или редуктор.">Перо опущено</Caption><input type="number" min="0" max={config.profile === 'marlin' ? 180 : 32767} value={config.penDown} onChange={number('penDown', 0, config.profile === 'marlin' ? 180 : 32767)} /></label></div>
              : config.penMode === 'laser'
                ? <label className="field"><Caption help="Мощность PWM. Не проверяйте со включённым лазером без очков и закрытого корпуса.">Мощность S</Caption><input type="number" min="0" max="1000" value={config.laserPower} onChange={number('laserPower', 0, 1000)} /></label>
                : <div className="plotter-row two"><label className="field"><Caption help="Координата Z/E при поднятом пере. Ошибка направления может увести ось в концевик.">Перо поднято, мм</Caption><input type="number" min="-50" max="50" step="0.1" value={config.zUp} onChange={number('zUp', -50, 50)} /></label><label className="field"><Caption help="Координата касания листа. Не задавайте большое заглубление.">Перо опущено, мм</Caption><input type="number" min="-50" max="50" step="0.1" value={config.zDown} onChange={number('zDown', -50, 50)} /></label></div>}
          <div className="plotter-row two"><label className="field"><Caption help="Начните с 500–1500 мм/мин. Высокая скорость вызывает пропуски шагов и рваные линии.">Рисование, мм/мин</Caption><input type="number" min="1" max="10000" value={config.feedRate} onChange={number('feedRate', 1, 10000)} /></label><label className="field"><Caption help="Скорость движения с поднятым пером. Слишком большое значение может привести к удару о раму.">Холостой ход</Caption><input type="number" min="1" max="10000" value={config.jogSpeed} onChange={number('jogSpeed', 1, 10000)} /></label></div>
          <Toggle
            checked={Boolean(config.optimizePath)}
            onChange={(value) => workspace.updateConfig('optimizePath', value)}
            label="Оптимизировать траекторию"
          ><small>Сокращает холостой путь в пределах соседних штрихов и строк. Геометрия текста не меняется; направление отдельных штрихов может быть развёрнуто.</small></Toggle>
          <div className="plotter-row two"><label className="field"><Caption help="Пауза после движения пера. Слишком мало — линия начнётся до касания; слишком много — печать замедлится.">Задержка, сек.</Caption><input type="number" min="0" max="10" step="0.05" value={config.penDelay} onChange={number('penDelay', 0, 10)} /></label><label className="field"><Caption help="Дополнительное расстояние между символами. Большое значение вытеснит текст за границы листа.">Межбуквенно, мм</Caption><input type="number" min="0" max="20" step="0.1" value={config.letterSpacing} onChange={number('letterSpacing', 0, 20)} /></label></div>
          <button className="button ghost settings-wide-button" type="button" disabled={!enabled || running} onClick={() => fontInputRef.current?.click()}>Загрузить свой .gfont</button>
          <input ref={fontInputRef} type="file" accept=".gfont,application/octet-stream" hidden onChange={(event) => { workspace.importFont(event.target.files?.[0]); event.target.value = '' }} />
        </SettingSection>

        <SettingSection title="Ручная проверка">
          <div className="jog-control">
            <button type="button" disabled={!connected || running} onClick={() => workspace.jog(0, -config.jogDistance)}>↑</button>
            <button type="button" disabled={!connected || running} onClick={() => workspace.jog(-config.jogDistance, 0)}>←</button>
            <span>{config.jogDistance} мм</span>
            <button type="button" disabled={!connected || running} onClick={() => workspace.jog(config.jogDistance, 0)}>→</button>
            <button type="button" disabled={!connected || running} onClick={() => workspace.jog(0, config.jogDistance)}>↓</button>
          </div>
          <label className="range-control"><span className="control-heading"><Caption help="Для первого теста выберите 0,1–1 мм, чтобы не ударить каретку о край.">Шаг ручного движения</Caption><output>{config.jogDistance} мм</output></span><input type="range" min="0.1" max="50" step="0.1" value={config.jogDistance} onChange={number('jogDistance', 0.1, 50)} /></label>
          <div className="plotter-actions compact-actions">
            <button className="button compact" type="button" disabled={!connected || running} onClick={() => workspace.pen(true)}>Перо ↑</button>
            <button className="button compact" type="button" disabled={!connected || running} onClick={() => workspace.pen(false)}>Перо ↓</button>
            <button className="button compact" type="button" disabled={!connected || running || config.profile === 'ebb'} onClick={workspace.setOrigin}>Это ноль</button>
          </div>
        </SettingSection>
      </fieldset>
    </div>
  )
}
