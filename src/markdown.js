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

function escapeAttribute(value) {
  return String(value).replace(/[&"]/g, (character) => character === '&' ? '&amp;' : '&quot;')
}

function renderPlacementBlocks(markdown) {
  return String(markdown).replace(
    /^:::place(?:[ \t]+([^\n]+))?[ \t]*\n([\s\S]*?)\n:::[ \t]*$/gm,
    (_, attributeSource = '', contents) => {
      const attributes = {}
      attributeSource.replace(/([\w-]+)(?:=("[^"]*"|'[^']*'|[^\s]+))?/g, (match, key, rawValue) => {
        const value = rawValue ? rawValue.replace(/^(['"])([\s\S]*)\1$/, '$2') : 'true'
        attributes[key.toLowerCase()] = value
        return match
      })
      const number = (key, alias, fallback) => {
        const value = Number(attributes[key] ?? attributes[alias])
        return Number.isFinite(value) ? value : fallback
      }
      const id = attributes.id || `place-${Math.abs(hashSeed(contents)).toString(36)}`
      const page = Math.max(0, Math.round(number('page', 'sheet', 1)) - 1)
      const align = ['left', 'center', 'right'].includes(attributes.align) ? attributes.align : 'left'
      const noWrap = ['true', '1', 'yes', 'on'].includes(String(attributes.nowrap || 'false').toLowerCase())
      const placementAttributes = [
        `data-layout-id="${escapeAttribute(id)}"`,
        `data-layout-page="${page}"`,
        `data-layout-x="${number('x', 'left', 0)}"`,
        `data-layout-y="${number('y', 'top', 0)}"`,
        `data-layout-width="${Math.max(36, number('width', 'w', 320))}"`,
        `data-layout-height="${Math.max(24, number('height', 'h', 80))}"`,
        `data-layout-rotation="${number('rotate', 'rotation', 0)}"`,
        `data-layout-align="${align}"`,
        `data-layout-nowrap="${noWrap}"`,
      ].join(' ')
      return `<section class="manual-source-block" ${placementAttributes}>\n${marked.parse(contents.trim())}\n</section>`
    },
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
  const source = renderAlignmentBlocks(preserveExtraBlankLines(renderPlacementBlocks(protectedSvg.source))
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
      "data-layout-id",
      "data-layout-page",
      "data-layout-x",
      "data-layout-y",
      "data-layout-width",
      "data-layout-height",
      "data-layout-rotation",
      "data-layout-align",
      "data-layout-nowrap",
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
  const totalLetters = Math.max(
    1,
    textNodes.reduce((sum, node) => sum + Array.from(node.nodeValue).filter((character) => !/\s/u.test(character)).length, 0),
  );
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
      if (settings.trueHandwriting) word.classList.add("hw-natural");
      if (Array.from(part).length > 18) word.classList.add("hw-breakable");
      word.dataset.wordIndex = String(wordIndex);
      const fatigueProgress = Math.max(0, Math.min(1, letterIndex / totalLetters));
      const fatigue = settings.fatigueEnabled
        ? Math.pow(fatigueProgress, 1.65) * Math.max(0, Math.min(100, Number(settings.fatigueStrength) || 0)) / 100
        : 0;
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
      const authorBaseline = Math.max(0, Math.min(100, Number(settings.authorBaseline) || 0));
      const fatigueTilt = fatigue * (0.8 + Number(settings.authorRhythm || 0) * 0.012);
      word.style.setProperty("--word-rotation", `${(tilt + fatigueTilt).toFixed(2)}deg`);
      word.style.setProperty("--word-lift", `${(lift + fatigue * authorBaseline * 0.026).toFixed(2)}px`);
      if (
        settings.trueHandwriting &&
        randomFor(settings.seed, `word:${wordIndex}:correction`) * 100 <
          Number(settings.correctionChance || 0)
      ) {
        word.classList.add("hw-correction");
      }

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

      const wordCharacters = Array.from(part);
      wordCharacters.forEach((character, characterIndex) => {
        const letter = documentNode.createElement("span");
        letter.className = "hw-letter";
        letter.textContent = character;
        if (settings.trueHandwriting) {
          const variation = Math.max(0, Math.min(100, Number(settings.glyphVariation) || 0));
          const variant = randomFor(settings.seed, `letter:${letterIndex}:variant-active`) * 100 < variation
            ? Math.floor(randomFor(settings.seed, `letter:${letterIndex}:variant`) * 4)
            : 0;
          const authorSlant = Number(settings.authorSlant || 0);
          const rhythm = Math.max(0, Math.min(100, Number(settings.authorRhythm) || 0));
          const slant = authorSlant + (randomFor(settings.seed, `letter:${letterIndex}:slant`) - 0.5) * (variation * 0.05 + rhythm * 0.025) + fatigue * 3.2;
          const scaleY = 1 + (randomFor(settings.seed, `letter:${letterIndex}:height`) - 0.5) * variation * 0.0024;
          const scaleX = Math.max(0.78, Math.min(1.22, Number(settings.authorWidth || 100) / 100 + fatigue * 0.025));
          const pressure = 1 + (randomFor(settings.seed, `letter:${letterIndex}:pressure`) - 0.5) * Number(settings.pressureVariation || 0) * 0.012;
          letter.classList.add("hw-glyph-variant", `variant-${variant}`);
          if (characterIndex === 0) letter.classList.add("word-start");
          if (characterIndex === wordCharacters.length - 1) letter.classList.add("word-end");
          letter.style.setProperty("--glyph-slant", `${slant.toFixed(2)}deg`);
          letter.style.setProperty("--glyph-height", scaleY.toFixed(3));
          letter.style.setProperty("--glyph-width", scaleX.toFixed(3));
          letter.style.setProperty("--glyph-pressure", pressure.toFixed(3));
          letter.style.setProperty("--glyph-join", `${Math.max(0, Number(settings.connectionStrength || 0)) * -0.006}em`);
          letter.style.fontFeatureSettings = `"calt" 1, "liga" 1, "salt" ${variant ? 1 : 0}, "ss0${variant + 1}" 1`;
        }
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
        const widthSpacing = (Number(settings.authorWidth || 100) - 100) * 0.012;
        const rhythmSpacing = settings.trueHandwriting
          ? (randomFor(settings.seed, `letter:${letterIndex}:rhythm`) - 0.5) * Number(settings.authorRhythm || 0) * 0.014
          : 0;
        letter.style.marginRight = `${(spacing + widthSpacing + rhythmSpacing + fatigue * 0.12).toFixed(2)}px`;
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
