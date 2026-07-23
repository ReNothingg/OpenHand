export default function NaturalnessReport({ report, onAutofix }) {
  return (
    <div className={`naturalness-report ${report.level}`}>
      <div className="naturalness-score">
        <span>
          <small>Естественность</small>
          <strong>{report.score}<i>/100</i></strong>
        </span>
        <meter min="0" max="100" low="62" high="82" optimum="100" value={report.score} />
      </div>
      {!!report.repeats.length && (
        <div className="naturalness-repeats" aria-label="Карта повторяющихся символов">
          {report.repeats.map(({ character, count }, index) => (
            <span
              key={character}
              style={{ '--repeat-risk': Math.min(1, count / Math.max(4, report.repeats[0].count)) }}
              title={`Символ «${character}» повторяется ${count} раз`}
            >
              {character}<small>{count}</small>
              {index === 0 && <i>чаще всего</i>}
            </span>
          ))}
        </div>
      )}
      <p>{report.recommendations[0]}</p>
      {report.level !== 'good' && report.level !== 'empty' && (
        <button className="text-button" type="button" onClick={onAutofix}>Сбалансировать автоматически</button>
      )}
    </div>
  )
}
