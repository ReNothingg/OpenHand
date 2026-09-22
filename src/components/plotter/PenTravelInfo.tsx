import { penLiftDistance, penTravelSeconds } from "../../plotter/penLift";

export default function PenTravelInfo({ config }: { config: any }) {
  const seconds = penTravelSeconds(config);
  if (!(seconds > 0)) return null;
  const duration = seconds < 60 ? `${Number(seconds.toFixed(1)).toLocaleString("ru-RU")} сек.`
    : `${Math.floor(seconds / 60)} мин.${Math.ceil(seconds % 60) ? ` ${Math.ceil(seconds % 60)} сек.` : ""}`;
  return <p className={`pen-travel-info ${seconds >= 10 ? "plotter-warning" : "plotter-note"}`}>
    Расчёт одного подъёма или опускания: <strong>{duration}</strong> — ход {penLiftDistance(config).toLocaleString("ru-RU")} мм
    при {Number(config.zSpeed).toLocaleString("ru-RU")} мм/мин.
    {seconds >= 10 && " Пока перо опускается, движение по листу ждёт. Скорость задаётся в миллиметрах в минуту."}
  </p>;
}
