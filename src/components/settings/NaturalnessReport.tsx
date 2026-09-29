interface NaturalnessReportData {
  level: string;
  repeats: Array<{ character: string; count: number }>;
  recommendations: string[];
}

export default function NaturalnessReport({
  report,
  onAutofix,
}: {
  report: NaturalnessReportData;
  onAutofix: () => void;
}) {
  return (
    <div className={`naturalness-report ${report.level}`}>
      <strong>Проверка настроек почерка</strong>
      {!!report.repeats.length && (
        <div
          className="naturalness-repeats"
          aria-label="Карта повторяющихся символов"
        >
          {report.repeats.map(({ character, count }, index) => (
            <span
              key={character}
              style={{
                "--repeat-risk": Math.min(
                  1,
                  count / Math.max(4, report.repeats[0].count),
                ),
              }}
              title={`Символ «${character}» повторяется ${count} раз`}
            >
              {character}
              <small>{count}</small>
              {index === 0 && <i>чаще всего</i>}
            </span>
          ))}
        </div>
      )}
      <p>{report.recommendations[0]}</p>
      {report.level !== "good" && report.level !== "empty" && (
        <button className="text-button" type="button" onClick={onAutofix}>
          Сбалансировать автоматически
        </button>
      )}
    </div>
  );
}
