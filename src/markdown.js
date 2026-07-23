import DOMPurify from "dompurify";
import { marked } from "marked";
import markedKatex from "marked-katex-extension";

marked.setOptions({ gfm: true, breaks: true });
marked.use(markedKatex({ throwOnError: false, nonStandard: true }));

function hashSeed(value) {
  let hash = 2166136261;
  const string = String(value);
  for (let index = 0; index < string.length; index += 1) {
    hash ^= string.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function randomFor(seed, key) {
  let value = hashSeed(`${seed}:${key}`);
  value += 0x6d2b79f5;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}

function signed(settings, value, key) {
  const directionChance = Math.max(
    0,
    Math.min(100, Number(settings.directionChance) || 0),
  );
  return randomFor(settings.seed, `${key}:direction`) * 100 < directionChance
    ? -value
    : value;
}

function preserveExtraBlankLines(markdown) {
  const lines = String(markdown).replace(/\r\n?/g, '\n').split('\n')
  const output = []
  let fence = null

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/)
    if (fenceMatch) {
      const marker = fenceMatch[1]
      if (!fence) fence = { character: marker[0], length: marker.length }
      else if (marker[0] === fence.character && marker.length >= fence.length) fence = null
      output.push(line)
      continue
    }
    if (fence || line.trim()) {
      output.push(line)
      continue
    }

    let end = index
    while (end + 1 < lines.length && !lines[end + 1].trim()) end += 1
    const count = end - index + 1
    if (count <= 1 || index === 0 || end === lines.length - 1) {
      output.push(...Array(count).fill(''))
    } else {
      output.push('')
      output.push(...Array(count - 1).fill('<div data-preserved-blank="true"></div>'))
      output.push('')
    }
    index = end
  }

  return output.join('\n')
}

function renderAlignmentBlocks(markdown) {
  return String(markdown).replace(
    /^:::(left|center|right)[ \t]*\n([\s\S]*?)\n:::[ \t]*$/gm,
    (_, alignment, contents) => (
      `<div class="text-align-${alignment}" align="${alignment}">\n`
      + `${marked.parse(contents.trim())}\n`
      + '</div>'
    ),
  )
}

function protectSvgBlocks(markdown) {
  const blocks = []
  const store = (block) => {
    const token = `OPENHANDSVGBLOCK${blocks.length}TOKEN`
    blocks.push({ token, block })
    return token
  }
  const protectedSource = String(markdown)
    .replace(/<figure\b[^>]*>[\s\S]*?<svg\b[\s\S]*?<\/svg>[\s\S]*?<\/figure>/gi, store)
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, store)

  return {
    source: protectedSource,
    restore(html) {
      return blocks.reduce((output, { token, block }) => (
        output
          .replace(new RegExp(`<p>\\s*${token}\\s*</p>`, 'g'), block)
          .replaceAll(token, block)
      ), html)
    },
  }
}

export function renderMarkdown(markdown, settings, fontPool) {
  const protectedSvg = protectSvgBlocks(markdown)
  const source = renderAlignmentBlocks(preserveExtraBlankLines(protectedSvg.source)
    .replace(/^\s*:::pagebreak\s*$/gm, '<div data-page-break="true"></div>')
    .replace(/\+\+\+([^\n]+?)\+\+\+/g, '<span class="underline-double">$1</span>')
    .replace(/\+\+([^\n]+?)\+\+/g, '<u>$1</u>')
    .replace(/==([^\n]+?)==/g, '<mark>$1</mark>'));
  return renderHandwrittenHtml(protectedSvg.restore(marked.parse(source)), settings, fontPool);
}

export function renderHandwrittenHtml(html, settings, fontPool) {
  const clean = DOMPurify.sanitize(html, {
    ADD_ATTR: [
      "target",
      "align",
      "viewBox",
      "preserveAspectRatio",
      "data-page-break",
      "data-preserved-blank",
    ],
    USE_PROFILES: { html: true, mathMl: true, svg: true },
  });
  const parser = new DOMParser();
  const documentNode = parser.parseFromString(
    `<main>${clean}</main>`,
    "text/html",
  );
  const root = documentNode.querySelector("main");
  root.querySelectorAll('li > input[type="checkbox"]').forEach((checkbox) => {
    const item = checkbox.closest("li");
    item?.classList.add("task-list-item");
    item?.parentElement?.classList.add("contains-task-list");
  });
  const calloutLabels = {
    NOTE: "Заметка",
    TIP: "Совет",
    IMPORTANT: "Важно",
    WARNING: "Предупреждение",
    CAUTION: "Осторожно",
  };
  root.querySelectorAll("blockquote").forEach((quote) => {
    const firstParagraph = quote.querySelector(":scope > p");
    if (!firstParagraph) return;
    const markerWalker = documentNode.createTreeWalker(
      firstParagraph,
      NodeFilter.SHOW_TEXT,
    );
    let markerNode;
    let match;
    while ((markerNode = markerWalker.nextNode())) {
      match = markerNode.nodeValue.match(
        /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i,
      );
      if (match) break;
    }
    if (!match) return;
    const type = match[1].toUpperCase();
    markerNode.nodeValue = markerNode.nodeValue.slice(match[0].length);
    quote.classList.add("callout", `callout-${type.toLowerCase()}`);
    const label = documentNode.createElement("strong");
    label.className = "callout-label";
    label.textContent = calloutLabels[type];
    quote.prepend(label);
  });
  const walker = documentNode.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  let current;
  while ((current = walker.nextNode())) {
    if (!current.nodeValue.trim()) continue;
    if (
      current.parentElement.closest(
        "pre, code, style, script, .katex, math, svg",
      )
    )
      continue;
    textNodes.push(current);
  }

  let wordIndex = 0;
  let letterIndex = 0;
  textNodes.forEach((node) => {
    const fragment = documentNode.createDocumentFragment();
    node.nodeValue.split(/(\s+)/u).forEach((part) => {
      if (!part) return;
      if (/^\s+$/u.test(part)) {
        const whitespace = documentNode.createElement("span");
        whitespace.className = "hw-space";
        whitespace.dataset.plotterWhitespace = "true";
        whitespace.textContent = part;
        fragment.append(whitespace);
        return;
      }

      const wordInterval = Math.max(1, Number(settings.wordFrequency) || 1);
      const active = wordIndex % wordInterval === 0;
      const word = documentNode.createElement("span");
      word.className = "hw-word";
      if (Array.from(part).length > 18) word.classList.add("hw-breakable");
      word.dataset.wordIndex = String(wordIndex);
      const tilt =
        active && settings.maxWordTilt > 0
          ? signed(
              settings,
              randomFor(settings.seed, `word:${wordIndex}:tilt`) *
                settings.maxWordTilt,
              `word:${wordIndex}:tilt`,
            )
          : 0;
      const lift =
        active && settings.maxLift > 0
          ? signed(
              settings,
              randomFor(settings.seed, `word:${wordIndex}:lift`) *
                settings.maxLift,
              `word:${wordIndex}:lift`,
            )
          : 0;
      word.style.setProperty("--word-rotation", `${tilt.toFixed(2)}deg`);
      word.style.setProperty("--word-lift", `${lift.toFixed(2)}px`);

      if (
        active &&
        fontPool.length &&
        randomFor(settings.seed, `word:${wordIndex}:font-active`) * 100 <
          settings.fontRandomization
      ) {
        const selected =
          fontPool[
            Math.floor(
              randomFor(settings.seed, `word:${wordIndex}:font`) *
                fontPool.length,
            )
          ];
        word.style.fontFamily = `'${selected}'`;
      }

      Array.from(part).forEach((character) => {
        const letter = documentNode.createElement("span");
        letter.className = "hw-letter";
        letter.textContent = character;
        const applySpacing =
          settings.maxLetterSpacing > 0 &&
          randomFor(settings.seed, `letter:${letterIndex}:active`) * 100 <
            settings.letterFrequency;
        const spacing = applySpacing
          ? signed(
              settings,
              randomFor(settings.seed, `letter:${letterIndex}:spacing`) *
                settings.maxLetterSpacing,
              `letter:${letterIndex}:spacing`,
            )
          : 0;
        letter.style.marginRight = `${spacing.toFixed(2)}px`;
        word.append(letter);
        letterIndex += 1;
      });
      fragment.append(word);
      wordIndex += 1;
    });
    node.replaceWith(fragment);
  });

  root.querySelectorAll("a").forEach((link) => {
    link.target = "_blank";
    link.rel = "noreferrer";
  });
  return root.innerHTML;
}

export function applyLineEffects(container, settings) {
  if (!container) return;
  const papers = container.querySelectorAll(".paper");
  let globalLine = 0;
  let drift = 0;
  papers.forEach((paper) => {
    const words = [...paper.querySelectorAll(".hw-word")];
    const paperTop = paper.getBoundingClientRect().top;
    const lines = new Map();
    words.forEach((word) => {
      const top =
        Math.round((word.getBoundingClientRect().top - paperTop) / 3) * 3;
      if (!lines.has(top)) lines.set(top, []);
      lines.get(top).push(word);
    });
    [...lines.values()].forEach((lineWords) => {
      if (settings.maxLineDrift > 0) {
        const step = signed(
          settings,
          randomFor(settings.seed, `line:${globalLine}:drift`) *
            settings.maxLineDrift,
          `line:${globalLine}:drift`,
        );
        drift = Math.max(
          -settings.maxLineDrift * 4,
          Math.min(settings.maxLineDrift * 4, drift + step),
        );
      } else {
        drift = 0;
      }
      const indent =
        settings.maxLineIndent > 0
          ? signed(
              settings,
              randomFor(settings.seed, `line:${globalLine}:indent`) *
                settings.maxLineIndent,
              `line:${globalLine}:indent`,
            )
          : 0;
      const lineRotation =
        settings.maxLineDrift > 0
          ? signed(
              settings,
              randomFor(settings.seed, `line:${globalLine}:rotation`) *
                0.12 *
                settings.maxLineDrift,
              `line:${globalLine}:rotation`,
            )
          : 0;
      lineWords.forEach((word) => {
        word.style.setProperty(
          "--line-shift",
          `${(drift + indent).toFixed(2)}px`,
        );
        word.style.setProperty(
          "--line-rotation",
          `${lineRotation.toFixed(2)}deg`,
        );
      });
      globalLine += 1;
    });
  });
}
