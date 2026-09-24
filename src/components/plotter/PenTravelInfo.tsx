import { automaticPenSpeed, automaticPenUpPosition, penLiftDistance, penTravelSeconds } from "../../plotter/penLift";

export default function PenTravelInfo({ config }: { config: any }) {
  const seconds = penTravelSeconds(config);
  if (!(seconds > 0)) return null;
  const upper = automaticPenUpPosition(config);
  const travel = penLiftDistance(config);
  const format = (value: number) => Number(value).toLocaleString("ru-RU");
  const duration = seconds < 0.1 ? "меньше 0,1 сек."
    : seconds < 60 ? `${Number(seconds.toFixed(1)).toLocaleString("ru-RU")} сек.`
    : `${Math.floor(seconds / 60)} мин.${Math.ceil(seconds % 60) ? ` ${Math.ceil(seconds % 60)} сек.` : ""}`;
  return <div className={`pen-travel-info ${seconds >= 10 ? "plotter-warning" : "plotter-note"}`}>
    <strong>Команда записи: опустить на {format(travel)} мм</strong>
    <span>От Z{format(upper)} до Z{format(config.zDown)}. Расчётное время — {duration} при {format(automaticPenSpeed(config))} мм/мин.</span>
    <span>Число Z{format(config.zDown)} — координата от назначенного нуля, а не величина опускания.</span>
    {config.profile === "grbl" && upper !== config.zUp &&
      <span>Сохранённое верхнее положение Z{format(config.zUp)} выше допустимого автоматического хода. При записи подъём ограничен 3 мм, чтобы снизить риск удара в упор.</span>}
    {config.profile === "grbl" && automaticPenSpeed(config) !== config.zSpeed &&
      <span>Скорость Z при записи ограничена 1000 мм/мин, чтобы снизить риск пропуска шагов.</span>}
  </div>;
}
