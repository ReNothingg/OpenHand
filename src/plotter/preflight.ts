export interface PlotterLayoutSafety {
  strokes?: unknown[];
  missing?: unknown[];
  clipped?: boolean;
  startLineSafe?: boolean;
}

export interface PlotterPreflight {
  hasStrokes: boolean;
  hasMissingGlyphs: boolean;
  clipped: boolean;
  withinWorkArea: boolean;
  blockers: string[];
  warnings: string[];
  canStart: boolean;
}

/** Content checks; hardware readiness is evaluated once by assessDeviceReadiness. */
export function assessPlotterPreflight(
  layout: PlotterLayoutSafety | null | undefined,
  options: {
    withinWorkArea?: boolean;
  },
): PlotterPreflight {
  const hasStrokes = Boolean(layout?.strokes?.length);
  const hasMissingGlyphs = Boolean(layout?.missing?.length);
  const clipped = Boolean(layout?.clipped);
  const withinWorkArea = options.withinWorkArea !== false;
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (!hasStrokes) blockers.push("В задании нет траекторий для рисования.");
  if (hasMissingGlyphs)
    blockers.push("В выбранном GFont отсутствуют символы из документа.");
  if (clipped)
    blockers.push("Часть документа выходит за пределы выбранного листа.");
  if (layout?.startLineSafe === false)
    blockers.push("Есть штрихи выше линии начала письма. Измените разметку перед запуском.");
  if (!withinWorkArea)
    blockers.push(
      "Траектория выходит за настроенную рабочую область плоттера.",
    );

  return {
    hasStrokes,
    hasMissingGlyphs,
    clipped,
    withinWorkArea,
    blockers,
    warnings,
    canStart: blockers.length === 0,
  };
}

export interface PlotterDeviceReadinessInput {
  connected: boolean;
  running: boolean;
  busy: boolean;
  calibrationActive: boolean;
  emergencyStopped: boolean;
  profile: string;
  machineState?: string;
  statusReceivedAt?: number;
  originConfirmed: boolean;
  penReferenceConfirmed: boolean;
  penPositionsVerified: boolean;
  controllerSettingsKnown: boolean;
}

/** Hardware gate shared by document, workshop, frame, imported and recovery jobs. */
export function assessDeviceReadiness(input: PlotterDeviceReadinessInput, now = Date.now()) {
  const blockers: string[] = [];
  if (input.emergencyStopped) blockers.push("Действует СТОП. Проверьте механизм и разрешите управление.");
  if (!input.connected) blockers.push("Подключите плоттер во вкладке «Плоттер».");
  if (input.running || input.busy) blockers.push("Дождитесь завершения текущей операции.");
  if (input.calibrationActive) blockers.push("Завершите настройку направлений и рабочей области.");
  if (input.connected && input.profile === "grbl") {
    if (!input.controllerSettingsKnown) blockers.push("Прочитайте параметры платы в блоке подключения.");
    if (!input.statusReceivedAt || now - input.statusReceivedAt > 3000)
      blockers.push("Нет свежего ответа контроллера. Проверьте соединение.");
    else if (input.machineState === "Alarm") blockers.push("Контроллер сообщает Alarm. Устраните причину и снимите блокировку.");
    else if (input.machineState !== "Idle") blockers.push("Контроллер ещё не готов к запуску. Дождитесь состояния Idle.");
  }
  if (!input.penPositionsVerified) blockers.push("Сохраните верхнее и нижнее положения пера во вкладке «Плоттер».");
  else if (!input.penReferenceConfirmed)
    blockers.push("Высота пера неизвестна. В настройке пера укажите его фактическое положение; начало листа высоту не меняет.");
  if (!input.originConfirmed)
    blockers.push("Задайте положение кнопкой «Начало текста здесь» или «Угол листа здесь».");
  return { blockers, canStart: blockers.length === 0 };
}
