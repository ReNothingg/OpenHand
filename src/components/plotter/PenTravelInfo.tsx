import { automaticPenSpeed, automaticPenUpPosition, penLiftDistance, penTravelSeconds } from "../../plotter/penLift";

export default function PenTravelInfo({ config }: { config: any }) {
  const seconds = penTravelSeconds(config);
  if (!(seconds > 0)) return null;
  const duration = seconds < 0.1 ? "меньше 0,1 сек."
    : seconds < 60 ? `${Number(seconds.toFixed(1)).toLocaleString("ru-RU")} сек.`
    : `${Math.floor(seconds / 60)} мин.${Math.ceil(seconds % 60) ? ` ${Math.ceil(seconds % 60)} сек.` : ""}`;
  return <p className={`pen-travel-info ${seconds >= 10 ? "plotter-warning" : "plotter-note"}`}>
    Расчёт одного подъёма или опускания: <strong>{duration}</strong> — ход {penLiftDistance(config).toLocaleString("ru-RU")} мм
    при {Number(automaticPenSpeed(config)).toLocaleString("ru-RU")} мм/мин.
    {config.profile === "grbl" && automaticPenUpPosition(config) !== config.zUp &&
      ` Чтобы снизить риск удара в верхний упор, автоматический подъём ограничен 3 мм: вместо ${Number(config.zUp).toLocaleString("ru-RU")} мм перо идёт к ${automaticPenUpPosition(config).toLocaleString("ru-RU")} мм.`}
    {config.profile === "grbl" && automaticPenSpeed(config) !== config.zSpeed &&
      " Скорость шагового пера при записи ограничена 1000 мм/мин, чтобы оно не пропускало шаги."}
    {seconds >= 10 && " Пока перо опускается, движение по листу ждёт. Скорость задаётся в миллиметрах в минуту."}
  </p>;
}
