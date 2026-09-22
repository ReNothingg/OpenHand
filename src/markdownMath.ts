import katex from "katex";
import type { MarkedExtension } from "marked";

/** TeX delimiters must be recognized before Markdown consumes their backslashes. */
function formulaToken(source: string, block: boolean) {
  const prefix = block ? source.match(/^ {0,3}\\\[/)?.[0] : source.match(/^\\[([]/)?.[0];
  if (!prefix) return;
  const displayMode = prefix.endsWith("[");
  const close = displayMode ? "\\]" : "\\)";
  let depth = 0;
  for (let index = prefix.length; index < source.length; index++) {
    if (source[index] === "\\") {
      if (!depth && source.startsWith(close, index)) {
        const end = index + 2;
        const text = source.slice(prefix.length, index).trim();
        if (!text) return;
        // A display embedded in prose is handled by the inline extension.
        if (block && !/^(?:[ \t]*(?:\n|$))/.test(source.slice(end))) return;
        const suffix = block ? source.slice(end).match(/^[ \t]*(?:\n|$)/)![0] : "";
        return { type: block ? "texDisplay" : "texInline", raw: source.slice(0, end) + suffix, text, displayMode };
      }
      index++; // An escaped backslash or brace is not another delimiter.
    } else if (source[index] === "{") depth++;
    else if (source[index] === "}") depth = Math.max(0, depth - 1);
  }
}

export const backslashMath: MarkedExtension = {
  extensions: [
    {
      name: "texInline", level: "inline",
      start(source) {
        for (let i = 0; i < source.length; i++) {
          if (source[i] !== "\\") continue;
          if (["(", "["].includes(source[i + 1]) && formulaToken(source.slice(i), false)) return i;
          i++;
        }
      },
      tokenizer: source => formulaToken(source, false),
      renderer: token => katex.renderToString(token.text, { displayMode: token.displayMode, throwOnError: false, trust: false }),
    },
    {
      name: "texDisplay", level: "block",
      start: source => source.match(/(?:^|\n) {0,3}\\\[/)?.index,
      tokenizer: source => formulaToken(source, true),
      renderer: token => katex.renderToString(token.text, { displayMode: true, throwOnError: false, trust: false }) + "\n",
    },
  ],
};
