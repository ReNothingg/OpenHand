import { describe, expect, it } from 'vitest';
import { GFont } from '../src/plotter/gfont';
import { createGFontBlob } from '../src/font-builder/gfontExport';
import { chooseForm, formGlyph, repeatedForms, validForms, type LetterForm } from '../src/font-builder/letterForms';
import { erasePart } from '../src/font-builder/partialErase';
import { layoutText, DEFAULT_PLOTTER_CONFIG } from '../src/plotter/job';
import { createPenCalibration } from '../src/plotter/penCalibration';
import { pageEvolution } from '../src/handwriting/structure';
import { analyzeSamples } from '../src/handwriting/sampleAnalysis';

const a: LetterForm = { strokes: [[{ x: 0, y: 0, pressure: .3 }, { x: 30, y: -40, pressure: .6 }, { x: 60, y: 0, pressure: .5 }]], entry: { stroke: 0, end: 'start' }, exit: { stroke: 0, end: 'end' }, position: 'any' };
const b: LetterForm = { ...a, strokes: [[{ x: 0, y: 0 }, { x: 15, y: -50 }, { x: 45, y: -20 }, { x: 60, y: 0 }]] };
const page = { pageWidth: 210, pageHeight: 297, left: 10, right: 10, top: 10, bottom: 10, fontSize: 5, lineHeight: 8 };
describe('recorded letter forms', () => {
  it('roundtrips forms, anchors, position and sensor data while retaining legacy glyph', async () => {
    const font = new GFont(await createGFontBlob({ а: a.strokes }, { а: [a, { ...b, position: 'final' }] }).arrayBuffer());
    expect(await font.getForms(1072)).toEqual([a, { ...b, position: 'final' }]);
    expect((await font.getGlyph(1072))?.points).toHaveLength(3);
    const old = new GFont(await createGFontBlob({ а: a.strokes }).arrayBuffer());
    expect(await old.getForms(1072)).toHaveLength(1);
  });
  it('rejects invalid shapes and dangling anchors', () => {
    expect(validForms([{ strokes: [[{ x: Infinity, y: 0 }, { x: 0, y: 1 }]] }])).toEqual([]);
    expect(validForms([{ ...a, entry: { stroke: 7, end: 'start' } }])[0]?.entry).toBeUndefined();
  });
  it('avoids adjacent duplicates and respects contextual forms', () => {
    for (let i = 0; i < 20; i++) expect(chooseForm([a, b], 12, i, 'medial', 0)).toBe(1);
    expect(chooseForm([a, { ...b, position: 'final' }], 12, 3, 'initial', 0)).toBe(0);
    expect(repeatedForms({ а: [a, { ...a, strokes: a.strokes.map(s => s.map(p => ({ ...p, x: p.x + 100 }))) }, b] })[0]).toMatchObject({ count: 3, distinct: 2 });
  });
  it('uses multiple recorded trajectories deterministically without mutating source', async () => {
    const font = new GFont(await createGFontBlob({ а: a.strokes }, { а: [a, b] }).arrayBuffer());
    const config = { trueHandwriting: true, seed: 32, connectionStrength: 100, glyphVariation: 0, authorWidth: 100 };
    const first = await layoutText('аааа', font, page, config);
    expect(first).toEqual(await layoutText('аааа', font, page, config));
    expect(first.trajectoryReport).toMatchObject([{ character: 'а', count: 4, distinct: 2 }]);
    expect(await font.getForms(1072)).toEqual([a, b]);
    expect(first.strokes.flat().every(p => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
  });
  it('joins compatible recorded ends without extra pen lifts', async () => {
    const font = { getGlyph: async () => formGlyph(a, 1072), getForms: async () => [a] };
    const result = await layoutText('аа', font, page, { trueHandwriting: true, seed: 1, connectionStrength: 100, letterSpacing: .3, authorWidth: 100 });
    expect(result.strokes.some(s => s.length > a.strokes[0].length * 2)).toBe(true);
  });
  it('cuts sparse segments and interpolates force at cut boundaries', () => {
    const cut = erasePart([{ x: 0, y: 0, pressure: 0 }, { x: 100, y: 0, pressure: 1 }], { x: 50, y: 0 }, 10);
    expect(cut).toHaveLength(2);
    expect(cut[0].at(-1)).toEqual({ x: 40, y: 0, pressure: .4 });
    expect(cut[1][0]).toEqual({ x: 60, y: 0, pressure: .6 });
    expect(erasePart([{ x: 0, y: 0 }, { x: 1, y: 0 }], { x: 0, y: 0 }, 5)).toEqual([]);
  });
  it('evolves smoothly by page position and remains off when disabled', () => {
    expect(pageEvolution(1, false, 100)).toMatchObject({ amount: 0, width: 1 });
    expect(pageEvolution(0, true, 100).width).toBe(1);
    expect(pageEvolution(.5, true, 100).width).toBeGreaterThan(pageEvolution(1, true, 100).width);
    expect(Math.abs(pageEvolution(.501, true, 100).width - pageEvolution(.5, true, 100).width)).toBeLessThan(.001);
  });
  it('compiles different physical speeds and pressure in one bounded sheet', () => {
    const sheet = createPenCalibration({ ...DEFAULT_PLOTTER_CONFIG, workAreaWidth: 210, workAreaHeight: 297 });
    expect(sheet.withinWorkArea).toBe(true);
    expect(sheet.candidates).toHaveLength(9);
    for (const rate of [900, 1200, 1500]) expect(sheet.commands.some(c => c.startsWith('G1X') && c.endsWith(`F${rate}`))).toBe(true);
    expect(new Set(sheet.commands.filter(c => c.startsWith('M3S'))).size).toBeGreaterThan(3);
    expect(createPenCalibration({ ...DEFAULT_PLOTTER_CONFIG, profile: 'ebb', workAreaWidth: 210, workAreaHeight: 297 }).candidates).toHaveLength(3);
    expect(() => createPenCalibration({ ...DEFAULT_PLOTTER_CONFIG, penMode: 'laser' })).toThrow();
  });
  it('requires useful samples and returns bounded measured settings', () => {
    expect(analyzeSamples([[], [], []])).toBeNull();
    const word = [Array.from({ length: 60 }, (_, i) => ({ x: i * 3, y: Math.sin(i * .25) * 60 - 80, time: i * 10, pressure: .5 }))];
    const result = analyzeSamples([word, word, word]);
    expect(result?.measuredTiming).toBe(true);
    expect(result?.settings.authorWidth).toBeGreaterThanOrEqual(78);
    expect(result?.settings.authorSlant).toBeLessThanOrEqual(22);
  });
});
