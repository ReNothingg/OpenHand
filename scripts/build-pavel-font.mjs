import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

// Editable centreline geometry, not outlines: a plotter traverses every line once.
const source = JSON.parse(await readFile('font/pavel-notes/strokes.json', 'utf8'));
function sample(path, transform = p => ({ x: p.x * 2.2, y: p.y * 2.2 })) {
  const tokens = path.match(/[MLC]|-?\d+(?:\.\d+)?/g) || [];
  let i = 0, cursor = { x: 0, y: 0 };
  const points = [];
  const point = () => {
    const x = Number(tokens[i++]), y = Number(tokens[i++]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`Invalid path: ${path}`);
    return { x, y };
  };
  while (i < tokens.length) {
    const command = tokens[i++];
    if (command === 'M' || command === 'L') { cursor = point(); points.push(cursor); }
    else if (command === 'C') {
      const a = cursor, b = point(), c = point(), d = point();
      const length = Math.hypot(b.x-a.x,b.y-a.y)+Math.hypot(c.x-b.x,c.y-b.y)+Math.hypot(d.x-c.x,d.y-c.y);
      const count = Math.max(4, Math.ceil(length / 3));
      for (let k=1; k<=count; k++) {
        const t=k/count, u=1-t;
        points.push({x:u*u*u*a.x+3*u*u*t*b.x+3*u*t*t*c.x+t*t*t*d.x,
          y:u*u*u*a.y+3*u*u*t*b.y+3*u*t*t*c.y+t*t*t*d.y});
      }
      cursor=d;
    } else throw new Error(`Unsupported command ${command}`);
  }
  return points.map(p => {
    const value = transform(p);
    return { x: Math.round(value.x * 100) / 100, y: Math.round(value.y * 100) / 100 };
  });
}
const glyphs = {};
for (const [char, paths] of Object.entries(source.glyphs)) {
  // Each M starts a real pen lift, including marks and crossbars.
  glyphs[char] = paths.flatMap(path => path.match(/M[^M]+/g).map(path => sample(path)));
}
const clone = char => structuredClone(glyphs[char]);
const mark = path => sample(path);
glyphs['ё'] = [...clone('е'),mark('M 43 -129 L 46 -133'),mark('M 72 -128 L 75 -132')];
glyphs['ў'] = [...clone('у'),mark('M 60 -133 C 67 -119 83 -120 93 -129')];
glyphs['Й'] = [...clone('И'),mark('M 89 -212 C 99 -201 114 -201 123 -211')];
glyphs['Ё'] = [...clone('Е'),mark('M 73 -211 L 76 -215'),mark('M 108 -211 L 111 -215')];
glyphs['І'] = [mark('M 55 -176 L 4 0')];
glyphs['Ў'] = [...clone('У'),mark('M 67 -215 C 76 -203 92 -202 103 -213')];
const inferred = [];
for (const char of 'ЖХЦШЩЪЫЬЭЮ') {
  glyphs[char] = clone(char.toLowerCase()).map(s=>s.map(p=>({x:p.x*1.32,y:p.y*1.7})));
  inferred.push(char);
}
glyphs['«']=[mark('M 39 -83 L 8 -49 L 22 -18'),mark('M 74 -83 L 43 -49 L 57 -18')];
glyphs['»']=[mark('M 9 -83 L 23 -49 L -8 -18'),mark('M 44 -83 L 58 -49 L 27 -18')];
glyphs['[']=[mark('M 71 -172 L 35 -172 L -3 12 L 33 12')];
glyphs[']']=[mark('M 29 -172 L 65 -172 L 27 12 L -9 12')];
glyphs['№']=[mark('M 0 0 L 39 -151 L 58 -1 L 95 -151'),mark('M 112 -130 C 91 -143 80 -91 95 -88 C 114 -83 130 -130 112 -130'),mark('M 87 -68 L 115 -68')];
const alternates = {
  'а':'M 0 -5 C 16 -24 37 -97 59 -96 C 82 -94 45 -21 27 -7 C 8 10 9 -9 19 -31 C 34 -66 58 -99 71 -91 C 60 -59 42 -13 54 -5 C 65 5 79 -9 90 -20',
  'е':'M 0 -10 C 30 -30 62 -73 51 -85 C 36 -104 9 -62 10 -30 C 12 8 34 7 57 -7 L 76 -20',
  'о':'M 0 -8 C 10 -22 27 -84 49 -94 C 75 -109 69 -63 54 -31 C 39 3 10 9 13 -13 C 15 -43 46 -101 62 -92 C 74 -87 66 -54 55 -32 C 61 -17 70 -9 88 -20',
  'и':'M 0 -5 L 42 -93 C 28 -58 11 -18 22 -7 C 37 9 77 -64 91 -91 C 80 -55 61 -14 73 -5 C 85 6 105 -9 115 -20',
  'н':'M 0 -3 L 43 -93 L 10 0 M 23 -33 C 43 -30 67 -67 86 -94 C 72 -51 55 -15 69 -5 C 80 3 96 -9 108 -20',
  'т':'M 0 -3 L 34 -89 L 21 -37 C 38 -58 62 -85 72 -88 C 82 -89 66 -51 58 -28 C 84 -59 105 -88 117 -87 C 135 -80 105 -23 117 -6 C 129 7 145 -9 158 -20',
  'с':'M 55 -81 C 58 -110 26 -89 15 -56 C -4 -9 13 9 39 -1 L 73 -20',
  'я':'M 0 -4 C 15 -11 50 -44 64 -77 C 80 -109 46 -100 35 -75 C 19 -43 34 -36 57 -49 C 47 -25 34 -6 43 0 C 56 10 76 -9 88 -20',
  'б':'M 0 -7 C 19 -10 33 -40 47 -76 C 65 -122 88 -171 116 -183 C 132 -186 138 -171 129 -155 C 117 -139 103 -146 100 -157 M 48 -74 C 26 -95 7 -47 13 -14 C 19 13 49 2 62 -37 C 72 -66 58 -84 48 -74 C 65 -61 58 -21 71 -7 C 79 3 92 -6 105 -20',
  'в':'M 0 -3 C 14 -51 33 -125 67 -160 C 94 -187 93 -145 64 -110 C 42 -82 20 -66 18 -59 C 43 -82 65 -69 58 -47 C 49 -17 19 15 11 -3 C 5 -18 26 -27 45 -20 C 59 -13 69 -9 77 -20',
  'д':'M 0 -5 C 16 -12 31 -69 56 -91 C 78 -108 77 -65 49 -23 C 25 13 9 4 19 -31 C 30 -68 52 -93 69 -91 C 65 -59 41 16 19 57 C 1 88 -18 112 -29 94 C -35 76 -3 53 36 25 C 63 7 82 -9 95 -20',
  'к':'M 0 -2 C 14 -33 29 -77 42 -94 L 15 -3 M 25 -41 C 49 -65 69 -95 80 -89 C 95 -81 68 -57 37 -47 C 54 -42 49 -17 64 -6 C 75 3 88 -8 100 -20',
  'л':'M 0 -5 C 5 9 19 8 30 -17 C 44 -51 55 -93 67 -94 C 76 -92 64 -43 69 -14 C 75 8 95 -1 111 -20',
  'м':'M 0 -5 C 11 11 23 -3 30 -22 C 45 -57 51 -90 61 -95 C 69 -78 58 -39 65 -18 C 78 -51 91 -88 108 -91 C 118 -74 96 -29 106 -8 C 114 6 129 -3 144 -20',
  'п':'M 0 -4 C 14 -28 35 -82 45 -95 C 52 -92 44 -57 34 -29 C 49 -58 74 -91 84 -89 C 102 -82 82 -35 88 -12 C 97 9 115 -4 127 -20',
  'р':'M 0 -9 C 10 -28 25 -71 44 -94 L -7 88 C -14 106 -26 111 -30 99 C -34 81 -3 59 28 35 M 28 -51 C 47 -82 72 -94 81 -83 C 98 -65 65 -22 48 -13 C 69 -12 86 -11 103 -20',
  'у':'M 0 -6 C 15 -27 34 -77 45 -94 C 33 -61 13 -18 24 -7 C 43 7 71 -34 93 -94 C 71 -40 53 38 25 72 C 4 100 -19 108 -25 91 C -32 72 1 46 46 21 L 93 -20',
  'ш':'M 0 -4 C 11 -25 31 -72 43 -95 C 30 -59 11 -19 21 -5 C 34 10 59 -25 85 -94 C 71 -48 51 -15 64 -5 C 81 11 108 -42 131 -93 C 117 -53 96 -17 109 -6 C 121 5 139 -8 153 -20'
};
const forms = {};
for (const [char, path] of Object.entries(alternates)) {
  // Anchor only the first continuous written body; detached accents never join.
  forms[char] = [glyphs[char], path.match(/M[^M]+/g).map(path => sample(path))].map(strokes=>({
    strokes, position:'any', entry:{stroke:0,end:'start'},
    exit:{stroke:strokes.length-1,end:'end'}
  }));
}
// Photo coordinates stay editable and auditable independently of the exporter.
// Normalize by the photographed body height, preserving ascenders/descenders.
const photos = JSON.parse(await readFile('font/pavel-notes/photo-traces.json', 'utf8'));
const tracedForms = {};
for (const form of photos.forms) {
  if (!photos.references[form.reference] || form.baseline - form.bodyTop < 8)
    throw new Error(`Invalid photo reference or body height: ${form.char}`);
  const factor = 220 / (form.baseline - form.bodyTop);
  const strokes = form.paths.flatMap(path => path.match(/M[^M]+/g).map(path =>
    sample(path, p => ({ x: p.x * factor, y: (p.y - form.baseline) * factor }))));
  const minX = Math.min(...strokes.flat().map(p => p.x));
  for (const stroke of strokes) for (const p of stroke) p.x = Math.round((p.x - minX) * 100) / 100;
  const entryStroke = form.entryStroke ?? 0;
  const exitStroke = form.exitStroke ?? strokes.length - 1;
  (tracedForms[form.char] ??= []).push({
    strokes, position: form.position ?? 'any',
    ...(Number.isFinite(form.advance) && form.advance > 0
      ? { advance: Math.round(form.advance * factor * 100) / 100 } : {}),
    // High starting strokes (capitals, dotted letters) use the engine's anchor
    // search. Never connect the next letter to a detached dot or crossbar.
    ...(strokes[entryStroke][0].y > -120 ? { entry: { stroke: entryStroke, end: 'start' } } : {}),
    ...(strokes[exitStroke].at(-1).y > -120 ? { exit: { stroke: exitStroke, end: 'end' } } : {}),
  });
}
for (const [char, variants] of Object.entries(tracedForms)) {
  if (variants.length > 6 || !variants.some(f => f.position === 'any'))
    throw new Error(`Unsupported forms for ${char}`);
  // Index zero is also used with variation disabled, so keep it context-free.
  forms[char] = [...variants.filter(f => f.position === 'any'), ...variants.filter(f => f.position !== 'any')];
  glyphs[char] = forms[char][0].strokes;
}
for (const [char, base, dots] of [['ё', 'е', true], ['ў', 'у', false]]) {
  forms[char] = forms[base].map(form => {
    const body = structuredClone(form.strokes);
    const xs = body.flat().filter(p => p.y < -100).map(p => p.x);
    const center = (Math.min(...xs) + Math.max(...xs)) / 2;
    const accents = dots
      ? [[{x:center-28,y:-282},{x:center-23,y:-291}], [{x:center+28,y:-280},{x:center+33,y:-289}]]
      : [[{x:center-30,y:-286},{x:center-16,y:-271},{x:center+7,y:-268},{x:center+32,y:-282}]];
    return { ...form, strokes: [...body, ...accents], exit: {stroke: body.length-1, end:'end'} };
  });
  glyphs[char] = forms[char][0].strokes;
}
const directory = await mkdtemp(join(tmpdir(), 'openhand-font-'));
try {
  const modulePath=join(directory,'export.mjs');
  await build({stdin:{contents: `export {createGFontBlob} from './src/font-builder/gfontExport.ts'; export {GFont} from './src/plotter/gfont.ts'; export {layoutText,DEFAULT_PLOTTER_CONFIG} from './src/plotter/job.ts'; export {profilePatch,DEFAULT_WRITING_CONFIG} from './src/handwriting/profiles.ts';`,resolveDir:process.cwd()},outfile:modulePath,bundle:true,format:'esm',platform:'node',loader:{'.gfont':'file'},logLevel:'silent'});
  const { createGFontBlob, GFont, layoutText, DEFAULT_PLOTTER_CONFIG, profilePatch, DEFAULT_WRITING_CONFIG } = await import(pathToFileURL(modulePath).href);
  const blob=createGFontBlob(glyphs,forms);
  await writeFile('font/plotter/pavel-notes.gfont',Buffer.from(await blob.arrayBuffer()));
  await writeFile('font/pavel-notes/coverage.json',JSON.stringify({version:2,method:'manual-photo-centrelines-with-legacy-fallback',glyphs:Object.keys(glyphs).join(''),photoReferences:photos.references,photoTracedCharacters:Object.keys(tracedForms).join(''),photoTracedForms:photos.forms.length,legacyCharacters:Object.keys(glyphs).filter(c=>!tracedForms[c]&&!['ё','ў'].includes(c)).join(''),inferredCapitals:inferred.filter(c=>!tracedForms[c]).join(''),variants:Object.keys(forms).filter(c=>forms[c].length>1),formCounts:Object.fromEntries(Object.entries(forms).map(([c,f])=>[c,f.length])),pressureMeasured:false,timingMeasured:false,exactCopyVerified:false},null,2)+'\n');
  const settings = profilePatch('pavelNotes');
  await writeFile('font/pavel-notes/handwriting-settings.json',JSON.stringify(settings,null,2)+'\n');
  await writeFile('font/pavel-notes/writing-config.json',JSON.stringify(DEFAULT_WRITING_CONFIG,null,2)+'\n');
  const font = new GFont(await blob.arrayBuffer(),'По умолчанию');
  const page = {pageWidth:148,pageHeight:210,left:12,right:12,top:12,bottom:12,fontSize:settings.fontSize*25.4/96,lineHeight:settings.fontSize*settings.lineHeight*25.4/96};
  const text = await readFile('font/pavel-notes/sample.txt','utf8');
  const layout = await layoutText(text,font,page,{...DEFAULT_PLOTTER_CONFIG,...settings,...DEFAULT_WRITING_CONFIG,seed:31847});
  if (layout.missing.length || layout.clipped) throw new Error('Personal font sample has missing glyphs or overflows.');
  const paths = layout.strokes.map(stroke => `<polyline points="${stroke.map(p=>`${p.x},${p.y}`).join(' ')}" fill="none" stroke="${settings.inkColor}" stroke-width=".4" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
  await writeFile('font/pavel-notes/writing-sample.svg',`<svg xmlns="http://www.w3.org/2000/svg" width="740" height="1050" viewBox="0 0 148 210"><rect width="148" height="210" fill="white"/>${paths}</svg>\n`);
  const escape = s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  const entries=Object.entries(glyphs);
  const tiles=entries.map(([char,strokes],i)=>{
    const x=35+(i%10)*110,y=60+Math.floor(i/10)*145;
    return `<g transform="translate(${x},${y})"><text y="-30" font-size="15" fill="#697386">${escape(char)}</text><path d="M -10 76 H 91" stroke="#d7dce2"/><g transform="translate(0,76) scale(.22)">${strokes.map(s=>`<polyline points="${s.map(p=>`${p.x},${p.y}`).join(' ')}" fill="none" stroke="#233266" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}</g></g>`;
  }).join('');
  await writeFile('font/pavel-notes/specimen.svg',`<svg xmlns="http://www.w3.org/2000/svg" width="1130" height="${Math.ceil(entries.length/10)*145+35}" style="background:white">${tiles}</svg>\n`);
  const variantEntries = Object.entries(forms).filter(([, variants]) => variants.length > 1);
  const variantRows = variantEntries.map(([char, variants], row) =>
    `<g transform="translate(30,${row * 130 + 90})"><text y="-25" font-size="22">${escape(char)}</text>${variants.map((form, column) =>
      `<g transform="translate(${65 + column * 155},0)"><path d="M 0 0 H 135" stroke="#d7dce2"/><g transform="scale(.2)">${form.strokes.map(stroke => `<polyline points="${stroke.map(p=>`${p.x},${p.y}`).join(' ')}" fill="none" stroke="${settings.inkColor}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}</g><text y="32" font-size="12" fill="#697386">${form.position === 'final' ? 'окончание' : 'в слове'}</text></g>`).join('')}</g>`).join('');
  await writeFile('font/pavel-notes/variants.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="760" height="${variantEntries.length*130+20}"><rect width="100%" height="100%" fill="white"/>${variantRows}</svg>\n`);
  console.log(`Default handwriting: ${entries.length} glyphs; ${photos.forms.length} photo-traced forms; ${Object.values(forms).filter(f=>f.length>1).length} characters with alternatives.`);
} finally { await rm(directory,{recursive:true,force:true}); }
