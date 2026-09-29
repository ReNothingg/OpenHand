import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const args = process.argv.slice(2);
const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
if (args.includes('--help')) {
  console.log('npm run font:audit -- --output /local/review [--reference /local/page-crop.jpg]');
  console.log('Reference: IMG_0589, upright 1824x1368, crop x=880 y=175 width=910 height=1125.');
  process.exit(0);
}
const output = option('--output') ? resolve(option('--output')) : await mkdtemp(join(tmpdir(), 'openhand-audit-'));
const reference = option('--reference');
await mkdir(output, { recursive: true });
let photo = '';
if (reference) {
  const extension = extname(reference).toLowerCase();
  if (!['.png', '.jpg', '.jpeg'].includes(extension)) throw new Error('Use a local PNG or JPEG crop.');
  photo = `data:image/${extension === '.png' ? 'png' : 'jpeg'};base64,${(await readFile(reference)).toString('base64')}`;
}
const cases = JSON.parse(await readFile('font/pavel-notes/audit-cases.json', 'utf8'));
const previous = JSON.parse(await readFile('font/pavel-notes/previous-settings.json', 'utf8'));
const directory = await mkdtemp(join(tmpdir(), 'openhand-audit-engine-'));
try {
  const modulePath = join(directory, 'engine.mjs');
  await build({ stdin: { contents: `export {GFont} from './src/plotter/gfont.ts';
    export {layoutText,DEFAULT_PLOTTER_CONFIG} from './src/plotter/job.ts';
    export {DEFAULT_SETTINGS} from './src/app/config.ts';`, resolveDir: process.cwd() },
    outfile: modulePath, bundle: true, format: 'esm', platform: 'node', loader: { '.gfont': 'file' }, logLevel: 'silent' });
  const { GFont, layoutText, DEFAULT_PLOTTER_CONFIG, DEFAULT_SETTINGS } = await import(pathToFileURL(modulePath).href);
  const measurements = [], allPaths = {};
  for (const [name, filename, settings] of [
    ['before', 'pavel-notes-legacy.gfont', previous],
    ['after', 'pavel-notes.gfont', DEFAULT_SETTINGS],
  ]) {
    const bytes = await readFile(`font/plotter/${filename}`);
    const font = new GFont(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const size = settings.fontSize * 25.4 / 96;
    allPaths[name] = { lines: [], words: [] };
    for (const [kind, rows] of [['lines', cases.rows], ['words', cases.heldOutWords]]) {
      for (const row of rows) {
        const layout = await layoutText(row.text, font, {
          pageWidth: 2000, pageHeight: 2000, left: 0, right: 0, top: 0, bottom: 0,
          fontSize: size, lineHeight: size * settings.lineHeight,
        }, { ...DEFAULT_PLOTTER_CONFIG, ...settings, seed: cases.seed });
        if (layout.clipped || layout.missing.length) throw new Error(`Incomplete sample: ${row.text}`);
        const points = layout.strokes.flat();
        const left = Math.min(...points.map(p => p.x)), right = Math.max(...points.map(p => p.x));
        allPaths[name][kind].push(layout.strokes.map(stroke => stroke.map(p => ({
          x: row.left + (p.x - left) * cases.pixelsPerMm,
          y: row.baseline + (p.y - size) * cases.pixelsPerMm,
        }))));
        measurements.push({ name, kind, text: row.text,
          widthErrorPercent: 100 * ((right - left) * cases.pixelsPerMm / (row.right - row.left) - 1) });
      }
    }
    const paths = allPaths[name].lines.flat();
    let right = 910;
    for (const stroke of paths) for (const point of stroke) right = Math.max(right, point.x);
    const width = Math.ceil(right + 25);
    const color = name === 'before' ? '#d42642' : '#137651';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="1130"><rect width="100%" height="100%" fill="white"/>${photo ? `<image width="910" height="1125" href="${photo}"/>` : ''}<g fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths.map(stroke => `<polyline points="${stroke.map(p => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(' ')}"/>`).join('')}</g></svg>`;
    await writeFile(join(output, `${name}-overlay.svg`), svg);
  }
  const summary = {
    sourceFile: cases.sourceFile, seed: cases.seed, pixelsPerMm: cases.pixelsPerMm,
    registration: 'One translation per source line; no per-letter scaling or seed selection.',
    widthIsNotSimilarityScore: true, exactCopyVerified: false,
    heldOutMeanAbsoluteWidthError: Object.fromEntries(['before', 'after'].map(name => {
      const values = measurements.filter(row => row.name === name && row.kind === 'words');
      return [name, values.reduce((sum, row) => sum + Math.abs(row.widthErrorPercent), 0) / values.length];
    })), measurements, paths: allPaths,
  };
  await writeFile(join(output, 'comparison.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(`Audit saved: ${output}`);
  console.log('Held-out mean absolute width error:', summary.heldOutMeanAbsoluteWidthError);
  console.log('Width checks do not certify visual similarity; inspect both overlays.');
} finally {
  await rm(directory, { recursive: true, force: true });
}
