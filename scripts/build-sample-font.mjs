import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { sheetLetterForms } from './sheet-letter-forms.mjs';

const source = JSON.parse(await readFile('font/pavel-notes/sheet-strokes.json', 'utf8'));
const calibration = JSON.parse(await readFile('font/pavel-notes/sheet-size-calibration.json', 'utf8'));
const { forms, scale, maximumForce, characterScales } = sheetLetterForms(source, calibration);
const directory = await mkdtemp(join(tmpdir(), 'openhand-samples-'));
try {
  const modulePath = join(directory, 'font.mjs');
  await build({ stdin: { contents: `
    export {createGFontBlob} from './src/font-builder/gfontExport.ts';
    export {GFont} from './src/plotter/gfont.ts';
    export {layoutText, DEFAULT_PLOTTER_CONFIG} from './src/plotter/job.ts';
    export {profilePatch, DEFAULT_WRITING_CONFIG} from './src/handwriting/profiles.ts';`,
    resolveDir: process.cwd() }, outfile: modulePath, bundle: true, format: 'esm',
    platform: 'node', external: ['*.gfont?url'], logLevel: 'silent' });
  const { createGFontBlob, GFont, layoutText, DEFAULT_PLOTTER_CONFIG, profilePatch, DEFAULT_WRITING_CONFIG } =
    await import(pathToFileURL(modulePath).href);
  const glyphs = Object.fromEntries(Object.entries(forms).map(([char, variants]) => [char, variants[0].strokes]));
  const legacyBytes = await readFile('font/plotter/pavel-notes-legacy.gfont');
  const legacy = new GFont(legacyBytes.buffer.slice(legacyBytes.byteOffset,
    legacyBytes.byteOffset + legacyBytes.byteLength), 'Legacy');
  // These two Belarusian letters were absent from the completed sheet.
  for (const char of 'іІ') {
    const glyph = await legacy.getGlyph(char.codePointAt(0));
    if (!glyph) throw new Error(`Missing fallback ${char}`);
    const strokes = [];
    for (const [index, point] of glyph.points.entries()) {
      if (!glyph.flags[index] || !strokes.length) strokes.push([]);
      strokes.at(-1).push({ ...point });
    }
    glyphs[char] = strokes;
  }
  const blob = createGFontBlob(glyphs, forms);
  await writeFile('font/plotter/pavel-samples.gfont', Buffer.from(await blob.arrayBuffer()));
  const font = new GFont(await blob.arrayBuffer(), 'Из заполненного бланка');
  let maximumRoundTripError = 0;
  let maximumSourcePointError = 0;
  let pointCount = 0;
  const capturedOffsets = new Map();
  for (const [char, variants] of Object.entries(forms)) {
    const restored = await font.getForms(char.codePointAt(0));
    if (restored.length !== variants.length) throw new Error(`Lost alternatives: ${char}`);
    for (const [index, form] of variants.entries()) {
      const copy = restored[index];
      const cell = source.cells.filter(cell => cell.character === char)[index];
      const letterScale = scale * (characterScales[char] ?? 1);
      capturedOffsets.set(cell, copy);
      if (copy.strokes.length !== form.strokes.length) throw new Error(`Lost pen lift: ${char}`);
      for (const [strokeIndex, stroke] of form.strokes.entries()) {
        if (copy.strokes[strokeIndex].length !== stroke.length) throw new Error(`Lost trajectory points: ${char}`);
        for (const [pointIndex, point] of stroke.entries()) {
          const actual = copy.strokes[strokeIndex][pointIndex];
          maximumRoundTripError = Math.max(maximumRoundTripError, Math.hypot(actual.x-point.x, actual.y-point.y));
          const [sourceX, sourceY] = cell.strokes[strokeIndex][pointIndex];
          maximumSourcePointError = Math.max(maximumSourcePointError,
            Math.hypot(actual.x/letterScale+cell.originX-sourceX, actual.y/letterScale+cell.baseline-sourceY));
          pointCount++;
        }
      }
    }
  }
  // This review is made from the exported GFont, not from the input alone.
  // Original grey and reconstructed red paths use the same page registration.
  for (const pageNumber of [1, 2]) {
    const sourcePaths = [], exportedPaths = [];
    for (const cell of source.cells.filter(cell => cell.page === pageNumber)) {
      const letterScale = scale * (characterScales[cell.character] ?? 1);
      sourcePaths.push(...cell.strokes.map(stroke =>
        `<polyline points="${stroke.map(p=>`${p[0]},${p[1]}`).join(' ')}"/>`));
      exportedPaths.push(...capturedOffsets.get(cell).strokes.map(stroke =>
        `<polyline points="${stroke.map(p=>`${p.x/letterScale+cell.originX},${p.y/letterScale+cell.baseline}`).join(' ')}"/>`));
    }
    await writeFile(`font/pavel-notes/sheet-overlay-${pageNumber}.svg`,
      `<svg xmlns="http://www.w3.org/2000/svg" width="994" height="1406" viewBox="0 0 595.2756 841.8898"><rect width="100%" height="100%" fill="white"/><text x="42" y="35" font-size="12" font-family="Arial, sans-serif">Исходные линии — серые; экспортированный шрифт — красный · ${pageNumber}/2</text><g fill="none" stroke="#999" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${sourcePaths.join('')}</g><g fill="none" stroke="#db273a" stroke-width=".45" stroke-linecap="round" stroke-linejoin="round">${exportedPaths.join('')}</g></svg>\n`);
  }
  const settings = profilePatch('pavelSamples');
  const page = {pageWidth:148,pageHeight:210,left:12,right:12,top:12,bottom:12,
    fontSize:settings.fontSize*25.4/96,lineHeight:settings.fontSize*settings.lineHeight*25.4/96};
  const text = await readFile('font/pavel-notes/sample.txt', 'utf8');
  const layout = await layoutText(text, font, page, {...DEFAULT_PLOTTER_CONFIG,...settings,...DEFAULT_WRITING_CONFIG,seed:31847});
  if (layout.missing.length || layout.clipped) throw new Error('Sample text has missing characters or overflows.');
  const paths = layout.strokes.map(stroke => `<polyline points="${stroke.map(p=>`${p.x},${p.y}`).join(' ')}" fill="none" stroke="${settings.inkColor}" stroke-width=".35" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
  await writeFile('font/pavel-notes/sheet-writing-sample.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="740" height="1050" viewBox="0 0 148 210"><rect width="148" height="210" fill="white"/>${paths}</svg>\n`);
  await writeFile('font/pavel-notes/sheet-validation.json', JSON.stringify({
    sourceFile: source.sourceFile, sourceSha256: source.sourceSha256,
    pages: 2, cells: source.cells.length, capturedCharacters: Object.keys(forms).join(''),
    capturedForms: Object.values(forms).reduce((count, variants) => count + variants.length, 0),
    glyphs: Object.keys(glyphs).join(''), pointCount,
    sourcePenLifts: source.cells.reduce((count, cell) => count + cell.strokes.length, 0),
    scale, maximumRecordedForce: maximumForce, maximumRoundTripError,
    maximumSourcePointErrorMmAfterUndoingSizeCalibration: maximumSourcePointError*25.4/72,
    recordedPressureCaptured: true, recordedTimingCaptured: true,
    pressureNormalisation: 'recorded force / maximum recorded force; not calibrated physical pressure',
    perLetterScaling: true, characterScales, sizeCalibrationUserApproved: true,
    inferredCharacters: 'іІ', syntheticShapeVariation: settings.glyphVariation,
    connections: 'existing cursive connector; not captured from this isolated-letter sheet',
    exactNotebookCopyVerified: false, hardwareVerified: false,
  }, null, 2)+'\n');
  console.log(`Completed sheet: ${source.cells.length} real forms, ${Object.keys(glyphs).length} glyphs, ${pointCount} preserved trajectory points.`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
