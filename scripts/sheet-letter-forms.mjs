// Original PencilKit centreline samples. A single scale preserves relative
// sizes, loops, stroke order and the three genuinely written alternatives.
export function sheetLetterForms(source, calibration) {
  if (source.version !== 1 || !(source.medianBodyHeight > 0) ||
      source.normalisedBodyHeight !== 220 || source.cells?.length !== 210)
    throw new Error('Invalid completed handwriting sheet.');
  const scale = source.normalisedBodyHeight / source.medianBodyHeight;
  if (calibration.version !== 1 || calibration.sourceSha256 !== source.sourceSha256 ||
      Object.values(calibration.characterScales).some(value => !Number.isFinite(value) || value < .5 || value > 2))
    throw new Error('Invalid handwriting size calibration.');
  const maximumForce = Math.max(...source.cells.flatMap(cell =>
    cell.strokes.flatMap(stroke => stroke.map(point => point[2]))));
  const forms = {};
  for (const cell of source.cells) {
    const letterScale = scale * (calibration.characterScales[cell.character] ?? 1);
    if (Array.from(cell.character).length !== 1 || !Number.isFinite(cell.originX) ||
        !Number.isFinite(cell.baseline) || !cell.strokes.length)
      throw new Error(`Invalid sample cell ${cell.page}:${cell.cell}`);
    const strokes = cell.strokes.map(stroke => {
      if (stroke.length < 2 || stroke.some(point => point.length !== 4 ||
          point.some(value => !Number.isFinite(value))))
        throw new Error(`Invalid pen trajectory ${cell.page}:${cell.cell}`);
      return stroke.map(([x, y, force, time]) => ({
        x: +((x - cell.originX) * letterScale).toFixed(4),
        y: +((y - cell.baseline) * letterScale).toFixed(4),
        pressure: +(Math.max(0, force) / maximumForce).toFixed(5),
        time,
      }));
    });
    const width = Math.max(...strokes.flat().map(point => point.x));
    (forms[cell.character] ??= []).push({
      originX: 0, advance: width + 4, strokes, position: 'any', style: 'sheet-pencil',
    });
  }
  for (const [char, variants] of Object.entries(forms)) {
    const expected = /^\p{Ll}$/u.test(char) ? 3 : /^[\p{Lu}\p{N}]$/u.test(char) && char !== '№' ? 2 : 1;
    if (variants.length !== expected)
      throw new Error(`Incomplete alternatives for ${char}: ${variants.length}/${expected}`);
  }
  return { forms, scale, maximumForce, characterScales: calibration.characterScales };
}
