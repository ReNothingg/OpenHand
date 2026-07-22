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

export function renderMarkdown(markdown, settings, fontPool) {
  const source = markdown.replace(
    /^\s*:::pagebreak\s*$/gm,
    '<div data-page-break="true"></div>',
  );
  return renderHandwrittenHtml(marked.parse(source), settings, fontPool);
}

export function renderHandwrittenHtml(html, settings, fontPool) {
  const clean = DOMPurify.sanitize(html, {
    ADD_ATTR: ["target", "data-page-break"],
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
        fragment.append(documentNode.createTextNode(part));
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
