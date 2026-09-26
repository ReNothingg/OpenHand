import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

// Editable centreline geometry, not outlines: a plotter traverses every line once.
const source = JSON.parse(await readFile('font/pavel-notes/strokes.json', 'utf8'));
function sample(path) {
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
  return points.map(p => ({x:Math.round(p.x*220)/100,y:Math.round(p.y*220)/100}));
}
const glyphs = {};
for (const [char, paths] of Object.entries(source.glyphs)) {
  // Each M starts a real pen lift, including marks and crossbars.
  glyphs[char] = paths.flatMap(path => path.match(/M[^M]+/g).map(sample));
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
  'я':'M 0 -4 C 15 -11 50 -44 64 -77 C 80 -109 46 -100 35 -75 C 19 -43 34 -36 57 -49 C 47 -25 34 -6 43 0 C 56 10 76 -9 88 -20'
};
const forms = {};
for (const [char, path] of Object.entries(alternates)) {
  // Anchor only the first continuous written body; detached accents never join.
  forms[char] = [glyphs[char], path.match(/M[^M]+/g).map(sample)].map(strokes=>({
    strokes, position:'any', entry:{stroke:0,end:'start'},
    exit:{stroke:strokes.length-1,end:'end'}
  }));
}
const directory = await mkdtemp(join(tmpdir(), 'openhand-font-'));
try {
  const modulePath=join(directory,'export.mjs');
  await build({stdin:{contents: `export {createGFontBlob} from './src/font-builder/gfontExport.ts'; export {GFont} from './src/plotter/gfont.ts'; export {layoutText,DEFAULT_PLOTTER_CONFIG} from './src/plotter/job.ts'; export {profilePatch,DEFAULT_WRITING_CONFIG} from './src/handwriting/profiles.ts';`,resolveDir:process.cwd()},outfile:modulePath,bundle:true,format:'esm',platform:'node',loader:{'.gfont':'file'},logLevel:'silent'});
  const { createGFontBlob, GFont, layoutText, DEFAULT_PLOTTER_CONFIG, profilePatch, DEFAULT_WRITING_CONFIG } = await import(pathToFileURL(modulePath).href);
  const blob=createGFontBlob(glyphs,forms);
  await writeFile('font/plotter/pavel-notes.gfont',Buffer.from(await blob.arrayBuffer()));
  await writeFile('font/pavel-notes/coverage.json',JSON.stringify({version:1,method:'manual-centreline-reconstruction',glyphs:Object.keys(glyphs).join(''),inferredCapitals:inferred.join(''),variants:Object.keys(forms),pressureMeasured:false,timingMeasured:false},null,2)+'\n');
  const settings = profilePatch('pavelNotes');
  await writeFile('font/pavel-notes/handwriting-settings.json',JSON.stringify(settings,null,2)+'\n');
  await writeFile('font/pavel-notes/writing-config.json',JSON.stringify(DEFAULT_WRITING_CONFIG,null,2)+'\n');
  const font = new GFont(await blob.arrayBuffer(),'По умолчанию');
  const page = {pageWidth:148,pageHeight:210,left:12,right:12,top:12,bottom:12,fontSize:settings.fontSize*25.4/96,lineHeight:settings.fontSize*settings.lineHeight*25.4/96};
  const text = await readFile('font/pavel-notes/sample.txt','utf8');
  const layout = await layoutText(text,font,page,{...DEFAULT_PLOTTER_CONFIG,...settings,...DEFAULT_WRITING_CONFIG,seed:31847});
  if (layout.missing.length || layout.clipped) throw new Error('Personal font sample has missing glyphs or overflows.');
  const paths = layout.strokes.map(stroke => `<polyline points="${stroke.map(p=>`${p.x},${p.y}`).join(' ')}" fill="none" stroke="#233266" stroke-width=".4" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
  await writeFile('font/pavel-notes/writing-sample.svg',`<svg xmlns="http://www.w3.org/2000/svg" width="740" height="1050" viewBox="0 0 148 210"><rect width="148" height="210" fill="white"/>${paths}</svg>\n`);
  const escape = s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  const entries=Object.entries(glyphs);
  const tiles=entries.map(([char,strokes],i)=>{
    const x=35+(i%10)*110,y=60+Math.floor(i/10)*145;
    return `<g transform="translate(${x},${y})"><text y="-30" font-size="15" fill="#697386">${escape(char)}</text><path d="M -10 76 H 91" stroke="#d7dce2"/><g transform="translate(0,76) scale(.22)">${strokes.map(s=>`<polyline points="${s.map(p=>`${p.x},${p.y}`).join(' ')}" fill="none" stroke="#233266" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}</g></g>`;
  }).join('');
  await writeFile('font/pavel-notes/specimen.svg',`<svg xmlns="http://www.w3.org/2000/svg" width="1130" height="${Math.ceil(entries.length/10)*145+35}" style="background:white">${tiles}</svg>\n`);
  console.log(`Default handwriting: ${entries.length} glyphs; ${Object.keys(forms).length} characters with alternate forms.`);
} finally { await rm(directory,{recursive:true,force:true}); }
