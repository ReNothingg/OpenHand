import { layoutText } from "./job";
import { PLOTTER_HEADING_MARKS, PLOTTER_CONTROL_MARKS, PLOTTER_FORMULA_START, PLOTTER_SVG_START } from "./richText";
import { isExerciseLabel } from "../handwriting/headings";
import { mergeTrajectoryReports } from "../font-builder/letterForms";

const headingStarts = new Set<string>(Object.entries(PLOTTER_HEADING_MARKS).filter(([key]) => key.endsWith("Start")).map(([,value]) => value));
const startsHeading = (text: string) => {
  const line = text.split("\n", 1)[0];
  return headingStarts.has(line.trimStart()[0]) ||
    isExerciseLabel(Array.from(line).filter(char => !PLOTTER_CONTROL_MARKS.has(char)).join(""));
};

/** Measure with the actual GFont rather than estimating pages by character count. */
export async function layoutSections(text: string, font: any, page: any, config: any) {
  const source = config.compactLayout ? text.replace(/\n[\t ]*\n+/g, "\n") : text;
  const chunks: string[] = [];
  for (const line of source.split("\n")) {
    const precedingHasBody = chunks.at(-1)?.split("\n").some(part => part.trim() && !startsHeading(part));
    if (!chunks.length || (startsHeading(line) && precedingHasBody)) chunks.push(line);
    else chunks[chunks.length - 1] += "\n" + line;
  }
  const strokes = [], reports = [], missing = new Set();
  let top = page.top;
  let overflowText = "";
  for (let index = 0; index < chunks.length; index++) {
    const chunk = config.compactLayout ? chunks[index].trim() : chunks[index];
    if (!chunk.trim()) continue;
    const remaining = { ...page, top };
    const partConfig = { ...config, seed: Number(config.seed) + index * 1009 };
    let result = await layoutText(chunk, font, remaining, partConfig);
    if (strokes.length && result.clipped && startsHeading(chunk)) {
      const onEmptyPage = await layoutText(chunk, font, page, partConfig);
      const lines = chunk.split("\n");
      let firstBody = 1;
      while (firstBody < lines.length && (!lines[firstBody].trim() || startsHeading(lines[firstBody]))) firstBody++;
      const body = lines[firstBody] || "";
      const openingBody = body.includes(PLOTTER_FORMULA_START) || body.includes(PLOTTER_SVG_START)
        ? body : body.split(/\s+/).slice(0, 6).join(" ");
      const opening = await layoutText([...lines.slice(0, firstBody), openingBody].join("\n"), font, remaining, partConfig);
      if (!onEmptyPage.clipped || opening.clipped) {
        overflowText = chunks.slice(index).join("\n");
        break;
      }
    }
    strokes.push(...result.strokes);
    reports.push(...result.trajectoryReport);
    result.missing.forEach(character => missing.add(character));
    if (result.clipped) {
      overflowText = [result.overflowText, ...chunks.slice(index + 1)].filter(Boolean).join("\n");
      // Preserve an unrenderable section so the caller reports a stalled layout.
      if (!overflowText) overflowText = chunk;
      break;
    }
    let bottom = top;
    for (const stroke of result.strokes) for (const point of stroke) bottom = Math.max(bottom, point.y);
    top = Math.max(bottom + page.lineHeight * (config.compactLayout ? 0.25 : 1),
      config.compactLayout ? 0 : result.endBaseline);
  }
  return { strokes, missing: [...missing], clipped: Boolean(overflowText), overflowText,
    trajectoryReport: mergeTrajectoryReports(reports) };
}
