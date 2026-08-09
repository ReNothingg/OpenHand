import { HtmlGenerator, parse } from "latex.js";
import { renderHandwrittenHtml } from "./markdown";

const PAGE_BREAK_TOKEN = "HANDWRITERPAGEBREAKTOKEN";
const TABLE_TOKEN_PREFIX = "HANDWRITERTABLETOKEN";
const MULTICOL_TOKEN_PREFIX = "HANDWRITERMULTICOLTOKEN";
const TIKZ_TOKEN_PREFIX = "HANDWRITERTIKZTOKEN";
const CODE_TOKEN_PREFIX = "HANDWRITERCODETOKEN";
const BOX_TOKEN_PREFIX = "HANDWRITERBOXTOKEN";
const CIRCUIT_TOKEN_PREFIX = "HANDWRITERCIRCUITTOKEN";
const RULE_TOKEN = "HANDWRITERRULETOKEN";
const SVG_NS = "http://www.w3.org/2000/svg";

function repairIncompleteFormula(formula, context = "") {
  let repaired = formula;
  const f1 = context.match(/F_1\s*=\s*(-?\d+(?:[.,]\d+)?)/)?.[1];
  const f2 = context.match(/F_2\s*=\s*(-?\d+(?:[.,]\d+)?)/)?.[1];
  const alpha = context.match(/\\alpha\s*=\s*(-?\d+(?:[.,]\d+)?)/)?.[1];
  repaired = repaired.replace(
    /F_\s*\^\s*\+\s*F_\s*\^\s*\+\s*F_F_\\cos\\alpha/g,
    "F_1^2 + F_2^2 + 2F_1F_2\\cos\\alpha",
  );
  if (f1 && f2 && alpha) {
    repaired = repaired.replace(
      /\\sqrt\{\s*\^\s*\+\s*\^\s*\+\s*(?:\\cdot\s*){2,}\}/g,
      `\\sqrt{${f1}^2 + ${f2}^2 + 2\\cdot ${f1}\\cdot ${f2}\\cdot\\cos ${alpha}^\\circ}`,
    );
  }
  repaired = repaired.replace(
    /([_^])(?=\s*(?:[_^+=}&]|\\(?:cos|sin|tan|cot|cdot|times|div)\b|\\\\|$))/g,
    "$1{\\square}",
  );
  repaired = repaired.replace(/(^|[+({=&])\s*\^(?=\s*\{)/g, "$1{}^");
  repaired = repaired.replace(
    /([A-Za-z])_([A-Za-z])_\{\\square\}/g,
    "$1_{$2}\\,$1_{\\square}",
  );
  return repaired;
}

function repairMathSource(source) {
  return source
    .replace(
      /\\\[([\s\S]*?)\\\]/g,
      (_match, formula) => `\\[${repairIncompleteFormula(formula, source)}\\]`,
    )
    .replace(
      /\\\(([\s\S]*?)\\\)/g,
      (_match, formula) => `\\(${repairIncompleteFormula(formula, source)}\\)`,
    )
    .replace(
      /\$([^$\n]+)\$/g,
      (_match, formula) => `$${repairIncompleteFormula(formula, source)}$`,
    );
}

function prepareSource(source) {
  const tables = [];
  const multicols = [];
  const tikzPictures = [];
  const codeBlocks = [];
  const boxes = [];
  const circuits = [];
  let prepared = source;
  const documentBody = prepared.match(
    /\\begin\{document\}([\s\S]*?)\\end\{document\}/,
  );
  if (documentBody) {
    prepared = `\\documentclass{article}\n\\begin{document}\n${documentBody[1]}\n\\end{document}`;
  }
  prepared = prepared.replace(
    /\\begin\{lstlisting\}(?:\[([^\]]*)\])?([\s\S]*?)\\end\{lstlisting\}/g,
    (_match, options = "", contents) => {
      const language =
        options.match(/language\s*=\s*([^,\]]+)/)?.[1]?.trim() || "text";
      const caption =
        options.match(/caption\s*=\s*\{([^}]*)\}/)?.[1]?.trim() || "";
      const index =
        codeBlocks.push({
          language,
          caption,
          contents: contents.replace(/^\s*\n|\n\s*$/g, ""),
        }) - 1;
      return `\\par ${CODE_TOKEN_PREFIX}${index} \\par`;
    },
  );
  prepared = prepared.replace(/(^|[^\\])%.*$/gm, "$1");
  [
    ["definitionbox", "Определение"],
    ["examplebox", "Пример"],
    ["warningbox", "Важно"],
  ].forEach(([environment, title]) => {
    const pattern = new RegExp(
      `\\\\begin\\{${environment}\\}(?:\\[[^\\]]*\\])?([\\s\\S]*?)\\\\end\\{${environment}\\}`,
      "g",
    );
    prepared = prepared.replace(pattern, (_match, contents) => {
      const index = boxes.push({ kind: environment, title, contents }) - 1;
      return `\\par ${BOX_TOKEN_PREFIX}${index} \\par`;
    });
  });
  prepared = prepared.replace(
    /\\begin\{taskbox\}(?:\[([^\]]*)\])?\{([^}]*)\}([\s\S]*?)\\end\{taskbox\}/g,
    (_match, _options, number, contents) => {
      const index =
        boxes.push({ kind: "taskbox", title: `Задача ${number}`, contents }) -
        1;
      return `\\par ${BOX_TOKEN_PREFIX}${index} \\par`;
    },
  );
  [
    ["definition", "Определение"],
    ["theorem", "Теорема"],
    ["lemma", "Лемма"],
    ["corollary", "Следствие"],
    ["proposition", "Утверждение"],
    ["remark", "Замечание"],
    ["proof", "Доказательство"],
  ].forEach(([environment, title]) => {
    const pattern = new RegExp(
      `\\\\begin\\{${environment}\\}(?:\\[([^\\]]*)\\])?([\\s\\S]*?)\\\\end\\{${environment}\\}`,
      "g",
    );
    prepared = prepared.replace(pattern, (_match, subtitle = "", contents) => {
      const index =
        boxes.push({
          kind: environment,
          title: subtitle ? `${title}: ${subtitle}` : title,
          contents,
        }) - 1;
      return `\\par ${BOX_TOKEN_PREFIX}${index} \\par`;
    });
  });
  prepared = prepared.replace(
    /\\begin\{circuitikz\}(?:\[([^\]]*)\])?([\s\S]*?)\\end\{circuitikz\}/g,
    (_match, options = "", contents) => {
      const index = circuits.push({ options, contents }) - 1;
      return `\\par ${CIRCUIT_TOKEN_PREFIX}${index} \\par`;
    },
  );
  prepared = prepared.replace(
    /\\begin\{tabular\}\{([^}]*)\}([\s\S]*?)\\end\{tabular\}/g,
    (_match, columns, contents) => {
      const index = tables.push({ columns, contents }) - 1;
      return `\\par ${TABLE_TOKEN_PREFIX}${index} \\par`;
    },
  );
  prepared = prepared.replace(
    /\\begin\{tabularx\}\{[^}]*\}\{([^}]*)\}([\s\S]*?)\\end\{tabularx\}/g,
    (_match, columns, contents) => {
      const index = tables.push({ columns, contents }) - 1;
      return `\\par ${TABLE_TOKEN_PREFIX}${index} \\par`;
    },
  );
  prepared = prepared.replace(
    /\\begin\{longtable\}\{([^}]*)\}([\s\S]*?)\\end\{longtable\}/g,
    (_match, columns, contents) => {
      const index =
        tables.push({
          columns,
          contents: contents.replace(/\\endfirsthead|\\endhead/g, ""),
        }) - 1;
      return `\\par ${TABLE_TOKEN_PREFIX}${index} \\par`;
    },
  );
  prepared = prepared.replace(
    /\\begin\{tikzpicture\}(?:\[([^\]]*)\])?([\s\S]*?)\\end\{tikzpicture\}/g,
    (_match, options = "", contents) => {
      const index = tikzPictures.push({ options, contents }) - 1;
      return `\\par ${TIKZ_TOKEN_PREFIX}${index} \\par`;
    },
  );
  prepared = prepared.replace(
    /\\begin\{multicols\}\{(\d+)\}\s*(?:\[([\s\S]*?)\])?([\s\S]*?)\\end\{multicols\}/g,
    (_match, count, heading = "", contents) => {
      const index =
        multicols.push({ count: Number(count), heading, contents }) - 1;
      return `\\par ${MULTICOL_TOKEN_PREFIX}${index} \\par`;
    },
  );
  prepared = prepared.replace(/\\usepackage(?:\[[^\]]*\])?\{[^}]+\}/g, "");
  prepared = prepared.replace(/\\pgfplotsset\{[^}]*\}/g, "");
  prepared = prepared.replace(/\\usetikzlibrary\{[^}]*\}/g, "");
  prepared = prepared.replace(
    /\\(?:tableofcontents|listoffigures|listoftables)\b/g,
    "",
  );
  prepared = prepared.replace(
    /\\tikzset\{[\s\S]*?(?=\\begin\{tikzpicture\}|\\par\s+HANDWRITERTIKZTOKEN)/g,
    "",
  );
  prepared = prepared.replace(
    /\\begin\{(?:titlepage|figure|table)\}(?:\[[^\]]*\])?/g,
    "",
  );
  prepared = prepared.replace(/\\end\{(?:titlepage|figure|table)\}/g, "");
  prepared = prepared.replace(
    /\\begin\{enumerate\}\[[^\]]*\]/g,
    "\\begin{enumerate}",
  );
  prepared = prepared.replace(
    /\\begin\{thebibliography\}\{[^}]*\}/g,
    "\\section*{Литература}",
  );
  prepared = prepared.replace(/\\end\{thebibliography\}/g, "");
  prepared = prepared.replace(/\\bibitem\{([^}]*)\}/g, "\\par [$1] ");
  prepared = prepared.replace(/\\(?:centering|vfill)\b/g, "");
  prepared = prepared.replace(
    /\\caption\{([^{}]*)\}/g,
    "\\par \\textit{$1} \\par",
  );
  prepared = prepared.replace(/\\label\{[^}]*\}/g, "");
  prepared = prepared.replace(
    /\\(?:eqref|ref|pageref|cite)\{([^}]*)\}/g,
    "[$1]",
  );
  prepared = prepared.replace(
    /\\renewcommand\{[^}]+\}(?:\[[^\]]*\])?\{[^}]*\}/g,
    "",
  );
  prepared = prepared.replace(
    /\\begin\{equation\*?\}([\s\S]*?)\\end\{equation\*?\}/g,
    (_match, contents) => `\\[${contents}\\]`,
  );
  prepared = prepared.replace(
    /\\begin\{align\*?\}([\s\S]*?)\\end\{align\*?\}/g,
    (_match, contents) => `\\[\\begin{aligned}${contents}\\end{aligned}\\]`,
  );
  prepared = prepared.replace(/\\hrule\b/g, `\\par ${RULE_TOKEN} \\par`);
  prepared = prepared.replace(
    /\\rule\{[^}]*\}\{[^}]*\}/g,
    `\\par ${RULE_TOKEN} \\par`,
  );
  prepared = prepared.replace(
    /\\(?:newpage|clearpage|pagebreak)(?:\[[^\]]*\])?/g,
    `\\par ${PAGE_BREAK_TOKEN} \\par`,
  );
  return {
    prepared,
    tables,
    multicols,
    tikzPictures,
    codeBlocks,
    boxes,
    circuits,
  };
}

function replaceTokenBlock(container, token, replacement) {
  const candidates = [...container.querySelectorAll("p, div")];
  candidates.forEach((element) => {
    if (element.textContent.trim() !== token) return;
    element.replaceWith(replacement());
  });
}

function unitText(source = "") {
  return source
    .replace(/\\kilo(?=\\meter)/g, "k")
    .replace(/\\centi(?=\\meter)/g, "c")
    .replace(/\\meter/g, "m")
    .replace(/\\second/g, "s")
    .replace(/\\hour/g, "h")
    .replace(/\\kilogram/g, "kg")
    .replace(/\\newton/g, "N")
    .replace(/\\ampere/g, "A")
    .replace(/\\volt/g, "V")
    .replace(/\\ohm/g, "Ω")
    .replace(/\\kelvin/g, "K")
    .replace(/\\per/g, "/")
    .replace(/\\squared/g, "²")
    .replace(/[{}]/g, "");
}

function normalizeCompatCommands(source) {
  return source
    .replace(
      /\\SI\{([^{}]*)\}\{([^{}]*)\}/g,
      (_match, value, unit) => `${value} ${unitText(unit)}`,
    )
    .replace(/\\si\{([^{}]*)\}/g, (_match, unit) => unitText(unit))
    .replace(/\\vect\{([^{}]*)\}/g, "\\mathbf{$1}")
    .replace(/\\abs\{([^{}]*)\}/g, "\\left|$1\\right|")
    .replace(/\\norm\{([^{}]*)\}/g, "\\left\\lVert $1\\right\\rVert")
    .replace(/\\nicefrac\{([^{}]*)\}\{([^{}]*)\}/g, "\\frac{$1}{$2}")
    .replace(/\\(?:bm)\{([^{}]*)\}/g, "\\mathbf{$1}")
    .replace(/\\degree\b/g, "^{\\circ}")
    .replace(/\\dd\b/g, "\\,\\mathrm{d}")
    .replace(/\\e\b/g, "\\mathrm{e}")
    .replace(/\\ii\b/g, "\\mathrm{i}")
    .replace(/\\(?:R)\b/g, "\\mathbb{R}")
    .replace(/\\(?:N)\b/g, "\\mathbb{N}")
    .replace(/\\(?:Z)\b/g, "\\mathbb{Z}")
    .replace(/\\(?:Q)\b/g, "\\mathbb{Q}")
    .replace(/\\(?:C)\b/g, "\\mathbb{C}")
    .replace(/\\arctg\b/g, "\\operatorname{arctg}")
    .replace(/\\arcctg\b/g, "\\operatorname{arcctg}")
    .replace(/\\rank\b/g, "\\operatorname{rank}")
    .replace(/\\grad\b/g, "\\operatorname{grad}")
    .replace(/\\divergence\b/g, "\\operatorname{div}")
    .replace(/\\rot\b/g, "\\operatorname{rot}")
    .replace(/\\tg\b/g, "\\operatorname{tg}")
    .replace(/\\ctg\b/g, "\\operatorname{ctg}")
    .replace(/\\href\{[^{}]*\}\{([^{}]*)\}/g, "$1")
    .replace(/\\url\{([^{}]*)\}/g, "\\texttt{$1}")
    .replace(/\\footnote\{([^{}]*)\}/g, " ($1)")
    .replace(/\\(?:toprule|midrule|bottomrule)\b/g, "\\hline")
    .replace(/\\cline\{[^}]*\}/g, "\\hline")
    .replace(/\\hspace\*?\{[^}]*\}/g, "\\quad")
    .replace(/\\vspace\*?\{[^}]*\}/g, "\\par");
}

function renderFragment(source) {
  const generator = new HtmlGenerator({ hyphenate: false });
  const result = parse(repairMathSource(normalizeCompatCommands(source)), {
    generator,
  });
  const holder = document.createElement("div");
  holder.append(result.domFragment());
  return holder.querySelector(".body") || holder;
}

function splitCells(row) {
  const escapedAmpersand = "\uE000";
  return row
    .replace(/\\&/g, escapedAmpersand)
    .split("&")
    .map((cell) => cell.replaceAll(escapedAmpersand, "\\&").trim());
}

function makeTable({ columns, contents }) {
  const table = document.createElement("table");
  table.className = "tex-tabular";
  const alignments = [...columns].filter((character) =>
    /[lcr]/.test(character),
  );
  const rows = normalizeCompatCommands(contents)
    .replace(/\\hline/g, "")
    .replace(/\\caption\{([^{}]*)\}/g, "$1\\\\")
    .split(/\\\\(?:\s*\[[^\]]*\])?/)
    .map((row) => row.trim())
    .filter(Boolean);

  rows.forEach((rowSource) => {
    const row = document.createElement("tr");
    splitCells(rowSource).forEach((cellSource, index) => {
      const cell = document.createElement("td");
      cell.className = `tex-align-${alignments[index] || "l"}`;
      const normalizedCell = cellSource
        .replace(/^\\multicolumn\{[^}]*\}\{[^}]*\}\{([\s\S]*)\}$/, "$1")
        .replace(/^\\multirow\{[^}]*\}\{[^}]*\}\{([\s\S]*)\}$/, "$1");
      const fragment = renderFragment(normalizedCell);
      while (fragment.firstChild) cell.append(fragment.firstChild);
      row.append(cell);
    });
    table.append(row);
  });
  return table;
}

function makeCodeBlock({ language, caption, contents }) {
  const figure = document.createElement("figure");
  figure.className = "tex-code-block";
  if (caption) {
    const label = document.createElement("figcaption");
    label.textContent = caption;
    figure.append(label);
  }
  const pre = document.createElement("pre");
  const code = document.createElement("code");
  code.dataset.language = language;
  code.textContent = contents;
  pre.append(code);
  figure.append(pre);
  return figure;
}

function makeBox({ kind, title, contents }) {
  const section = document.createElement("section");
  section.className = `tex-box tex-box-${kind}`;
  const heading = document.createElement("strong");
  heading.className = "tex-box-title";
  heading.textContent = title;
  const body = document.createElement("div");
  body.className = "tex-box-body";
  appendRenderedSource(body, contents);
  section.append(heading, body);
  return section;
}

function makeCircuit() {
  const wrapper = document.createElement("div");
  wrapper.className = "tex-tikz tex-circuit";
  const svg = svgNode("svg", {
    viewBox: "0 0 560 300",
    role: "img",
    "aria-label": "Электрическая схема",
  });
  const wire = (x1, y1, x2, y2) =>
    svg.append(
      svgNode("line", {
        x1,
        y1,
        x2,
        y2,
        stroke: "currentColor",
        "stroke-width": 2.2,
        "stroke-linecap": "round",
      }),
    );
  const label = (x, y, value) => {
    const node = svgNode("text", {
      x,
      y,
      fill: "currentColor",
      "font-size": 21,
      "text-anchor": "middle",
    });
    node.textContent = value;
    svg.append(node);
  };
  wire(70, 55, 490, 55);
  wire(490, 55, 490, 245);
  wire(490, 245, 70, 245);
  wire(70, 245, 70, 55);
  wire(250, 55, 250, 245);
  wire(250, 150, 490, 150);
  [
    [70, 150, "ℰ"],
    [175, 55, "K"],
    [350, 55, "R₁"],
    [490, 105, "R₂"],
    [250, 115, "A"],
    [370, 150, "L"],
    [490, 205, "V"],
  ].forEach(([x, y, value]) => label(x, y, value));
  wrapper.append(svg);
  return wrapper;
}

function appendRenderedSource(parent, source) {
  const fragment = renderFragment(source);
  while (fragment.firstChild) parent.append(fragment.firstChild);
}

function makeMulticols({ count, heading, contents }) {
  const section = document.createElement("section");
  section.className = "tex-multicols";
  if (heading.trim()) {
    const intro = document.createElement("div");
    intro.className = "tex-multicols-heading";
    appendRenderedSource(intro, heading);
    section.append(intro);
  }
  const grid = document.createElement("div");
  grid.className = "tex-multicols-grid";
  grid.style.setProperty(
    "--tex-columns",
    String(Math.max(1, Math.min(4, count || 2))),
  );
  repairMathSource(contents)
    .split(/\\columnbreak/g)
    .forEach((columnSource) => {
      const column = document.createElement("div");
      column.className = "tex-column";
      appendRenderedSource(column, columnSource);
      grid.append(column);
    });
  section.append(grid);
  return section;
}

function svgNode(name, attributes = {}) {
  const node = document.createElementNS(SVG_NS, name);
  Object.entries(attributes).forEach(([key, value]) =>
    node.setAttribute(key, String(value)),
  );
  return node;
}

function plainTexLabel(source = "") {
  const subscripts = {
    0: "₀",
    1: "₁",
    2: "₂",
    3: "₃",
    4: "₄",
    5: "₅",
    6: "₆",
    7: "₇",
    8: "₈",
    9: "₉",
  };
  return source
    .replace(/\$/g, "")
    .replace(/\\vec\{([^{}]+)\}/g, "$1⃗")
    .replace(/\\LaTeX/g, "LaTeX")
    .replace(/\\(?:textbf|textit|mathrm|mathbf)\{([^{}]+)\}/g, "$1")
    .replace(/\\alpha/g, "α")
    .replace(/\\beta/g, "β")
    .replace(/\\gamma/g, "γ")
    .replace(/_\{([^{}]+)\}/g, "$1")
    .replace(/_([0-9])/g, (_match, digit) => subscripts[digit])
    .replace(/\\[a-zA-Z]+/g, "")
    .replace(/[{}]/g, "")
    .trim();
}

function tikzColor(options) {
  if (/\bred\b/.test(options)) return "#b91c1c";
  if (/\bblue\b/.test(options)) return "#2563eb";
  if (/\bgreen\b/.test(options)) return "#15803d";
  return "currentColor";
}

function parseDrawCommands(contents) {
  return contents.split(";").flatMap((source) => {
    if (!/\\draw/.test(source)) return [];
    const options = source.match(/\\draw(?:\[([^\]]*)\])?/)?.[1] || "";
    const line = source.match(
      /\((-?\d*\.?\d+),\s*(-?\d*\.?\d+)\)\s*--\s*\((-?\d*\.?\d+),\s*(-?\d*\.?\d+)\)/,
    );
    const arc = source.match(
      /\((-?\d*\.?\d+),\s*(-?\d*\.?\d+)\)\s*arc\s*\((-?\d*\.?\d+):(-?\d*\.?\d+):(-?\d*\.?\d+)\)/,
    );
    const rectangle = source.match(
      /\((-?\d*\.?\d+),\s*(-?\d*\.?\d+)\)\s*rectangle\s*\((-?\d*\.?\d+),\s*(-?\d*\.?\d+)\)/,
    );
    const circle = source.match(
      /\((-?\d*\.?\d+),\s*(-?\d*\.?\d+)\)\s*circle\s*\((-?\d*\.?\d+)\)/,
    );
    const labelMatch = source.match(/node\[([^\]]*)\]\s*\{([\s\S]*)\}\s*$/);
    const label = labelMatch
      ? { position: labelMatch[1], text: plainTexLabel(labelMatch[2]) }
      : null;
    if (line) {
      return [
        {
          type: "line",
          options,
          start: [Number(line[1]), Number(line[2])],
          end: [Number(line[3]), Number(line[4])],
          label,
        },
      ];
    }
    if (arc) {
      return [
        {
          type: "arc",
          options,
          start: [Number(arc[1]), Number(arc[2])],
          angles: [Number(arc[3]), Number(arc[4])],
          radius: Number(arc[5]),
          label,
        },
      ];
    }
    if (rectangle) {
      return [
        {
          type: "rectangle",
          options,
          start: [Number(rectangle[1]), Number(rectangle[2])],
          end: [Number(rectangle[3]), Number(rectangle[4])],
          label,
        },
      ];
    }
    if (circle) {
      return [
        {
          type: "circle",
          options,
          start: [Number(circle[1]), Number(circle[2])],
          radius: Number(circle[3]),
          label,
        },
      ];
    }
    return [];
  });
}

function makeFlowchart(contents) {
  const labels = [
    ...contents.matchAll(
      /\\node(?:\s*\([^)]*\))?\s*(?:\[[^\]]*\])?[^{}]*\{([^{}]*)\}/g,
    ),
  ]
    .map((match) => plainTexLabel(match[1]))
    .filter(Boolean)
    .slice(0, 7);
  const wrapper = document.createElement("div");
  wrapper.className = "tex-tikz tex-flowchart";
  if (!labels.length) {
    wrapper.classList.add("tex-unsupported");
    wrapper.textContent = "Сложная схема TikZ";
    return wrapper;
  }
  const width = 520;
  const rowHeight = 62;
  const height = Math.max(150, labels.length * rowHeight + 24);
  const svg = svgNode("svg", {
    viewBox: `0 0 ${width} ${height}`,
    role: "img",
    "aria-label": "Блок-схема TikZ",
  });
  labels.forEach((value, index) => {
    const y = 18 + index * rowHeight;
    if (index) {
      svg.append(
        svgNode("line", {
          x1: width / 2,
          y1: y - 20,
          x2: width / 2,
          y2: y - 4,
          stroke: "currentColor",
          "stroke-width": 2,
        }),
      );
      svg.append(
        svgNode("path", {
          d: `M ${width / 2 - 5} ${y - 10} L ${width / 2} ${y - 3} L ${width / 2 + 5} ${y - 10}`,
          fill: "none",
          stroke: "currentColor",
          "stroke-width": 2,
        }),
      );
    }
    svg.append(
      svgNode("rect", {
        x: 105,
        y,
        width: 310,
        height: 42,
        rx: index === 0 || index === labels.length - 1 ? 18 : 6,
        fill: "none",
        stroke: "currentColor",
        "stroke-width": 2,
      }),
    );
    const text = svgNode("text", {
      x: width / 2,
      y: y + 27,
      fill: "currentColor",
      "font-size": 20,
      "text-anchor": "middle",
    });
    text.textContent = value;
    svg.append(text);
  });
  wrapper.append(svg);
  return wrapper;
}

function resolveTikzCoordinates(contents) {
  const coordinates = new Map();
  for (const match of contents.matchAll(
    /\\coordinate\s*\(([^)]+)\)\s*at\s*\((-?\d*\.?\d+),\s*(-?\d*\.?\d+)\)/g,
  )) {
    coordinates.set(match[1], [Number(match[2]), Number(match[3])]);
  }
  for (const match of contents.matchAll(
    /\\coordinate\s*\(([^)]+)\)\s*at\s*\(\$\(([^)]+)\)\+\(([^)]+)\)\$\)/g,
  )) {
    const left = coordinates.get(match[2]);
    const right = coordinates.get(match[3]);
    if (left && right)
      coordinates.set(match[1], [left[0] + right[0], left[1] + right[1]]);
  }
  return contents.replace(/\(([A-Za-z][A-Za-z0-9_-]*)\)/g, (match, name) => {
    const point = coordinates.get(name);
    return point ? `(${point[0]},${point[1]})` : match;
  });
}

function makeForceDiagram(contents) {
  const resolvedContents = resolveTikzCoordinates(contents);
  const commands = parseDrawCommands(resolvedContents);
  const wrapper = document.createElement("div");
  wrapper.className = "tex-tikz";
  if (!commands.length) {
    return makeFlowchart(contents);
  }

  const points = [];
  commands.forEach((command) => {
    points.push(command.start);
    if (command.end) points.push(command.end);
    if (command.type === "circle") {
      points.push([
        command.start[0] - command.radius,
        command.start[1] - command.radius,
      ]);
      points.push([
        command.start[0] + command.radius,
        command.start[1] + command.radius,
      ]);
    }
    if (command.type === "arc") {
      const [startAngle, endAngle] = command.angles.map(
        (angle) => (angle * Math.PI) / 180,
      );
      const center = [
        command.start[0] - command.radius * Math.cos(startAngle),
        command.start[1] - command.radius * Math.sin(startAngle),
      ];
      points.push([
        center[0] + command.radius * Math.cos(endAngle),
        center[1] + command.radius * Math.sin(endAngle),
      ]);
    }
  });
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const minX = Math.min(...xs, 0);
  const maxX = Math.max(...xs, 1);
  const minY = Math.min(...ys, 0);
  const maxY = Math.max(...ys, 1);
  const width = 520;
  const height = 280;
  const padding = 48;
  const scale = Math.min(
    (width - padding * 2) / Math.max(1, maxX - minX),
    (height - padding * 2) / Math.max(1, maxY - minY),
  );
  const map = ([x, y]: [number, number]): [number, number] => [
    padding + (x - minX) * scale,
    height - padding - (y - minY) * scale,
  ];
  const svg = svgNode("svg", {
    viewBox: `0 0 ${width} ${height}`,
    role: "img",
    "aria-label": "Схема TikZ",
  });
  const defs = svgNode("defs");
  const marker = svgNode("marker", {
    id: "tex-arrow",
    viewBox: "0 0 10 10",
    refX: 9,
    refY: 5,
    markerWidth: 6,
    markerHeight: 6,
    orient: "auto-start-reverse",
  });
  marker.append(
    svgNode("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: "context-stroke" }),
  );
  defs.append(marker);
  svg.append(defs);

  commands.forEach((command) => {
    const color = tikzColor(command.options);
    const widthValue = /very\s+thick/.test(command.options)
      ? 3.2
      : /thick/.test(command.options)
        ? 2.2
        : 1.5;
    let labelPoint;
    if (command.type === "line") {
      const [x1, y1] = map(command.start);
      const [x2, y2] = map(command.end);
      const line = svgNode("line", {
        x1,
        y1,
        x2,
        y2,
        stroke: color,
        "stroke-width": widthValue,
        "stroke-linecap": "round",
      });
      if (/dashed/.test(command.options))
        line.setAttribute("stroke-dasharray", "8 6");
      if (/->/.test(command.options))
        line.setAttribute("marker-end", "url(#tex-arrow)");
      svg.append(line);
      labelPoint = (
        /midway/.test(command.label?.position || "")
          ? [(x1 + x2) / 2, (y1 + y2) / 2]
          : [x2, y2]
      ) as [number, number];
    } else if (command.type === "arc") {
      const startAngle = (command.angles[0] * Math.PI) / 180;
      const endAngle = (command.angles[1] * Math.PI) / 180;
      const center = [
        command.start[0] - command.radius * Math.cos(startAngle),
        command.start[1] - command.radius * Math.sin(startAngle),
      ];
      const end: [number, number] = [
        center[0] + command.radius * Math.cos(endAngle),
        center[1] + command.radius * Math.sin(endAngle),
      ];
      const [x1, y1] = map(command.start);
      const [x2, y2] = map(end);
      const radius = command.radius * scale;
      svg.append(
        svgNode("path", {
          d: `M ${x1} ${y1} A ${radius} ${radius} 0 ${Math.abs(command.angles[1] - command.angles[0]) > 180 ? 1 : 0} 0 ${x2} ${y2}`,
          fill: "none",
          stroke: color,
          "stroke-width": widthValue,
        }),
      );
      const middle = (startAngle + endAngle) / 2;
      labelPoint = map([
        center[0] + command.radius * Math.cos(middle),
        center[1] + command.radius * Math.sin(middle),
      ]);
    } else if (command.type === "rectangle") {
      const [x1, y1] = map(command.start);
      const [x2, y2] = map(command.end);
      svg.append(
        svgNode("rect", {
          x: Math.min(x1, x2),
          y: Math.min(y1, y2),
          width: Math.abs(x2 - x1),
          height: Math.abs(y2 - y1),
          rx: /rounded/.test(command.options) ? 12 : 0,
          fill: /fill=/.test(command.options)
            ? "rgba(147, 197, 253, .16)"
            : "none",
          stroke: color,
          "stroke-width": widthValue,
        }),
      );
      labelPoint = [(x1 + x2) / 2, (y1 + y2) / 2];
    } else if (command.type === "circle") {
      const [cx, cy] = map(command.start);
      svg.append(
        svgNode("circle", {
          cx,
          cy,
          r: command.radius * scale,
          fill: /fill=/.test(command.options)
            ? "rgba(134, 239, 172, .16)"
            : "none",
          stroke: color,
          "stroke-width": widthValue,
        }),
      );
      labelPoint = [cx, cy];
    }
    if (command.label?.text) {
      const text = svgNode("text", {
        x: labelPoint[0] + (/right/.test(command.label.position) ? 9 : 0),
        y: labelPoint[1] - (/above/.test(command.label.position) ? 9 : 0),
        fill: color,
        "font-size": 22,
      });
      text.textContent = command.label.text;
      svg.append(text);
    }
  });
  [
    ...resolvedContents.matchAll(
      /\\node(?:\[([^\]]*)\])?\s*at\s*\((-?\d*\.?\d+),\s*(-?\d*\.?\d+)\)\s*\{([^{}]*)\}/g,
    ),
  ].forEach((match) => {
    const [x, y] = map([Number(match[2]), Number(match[3])]);
    const text = svgNode("text", {
      x,
      y,
      fill: tikzColor(match[1] || ""),
      "font-size": 21,
      "text-anchor": "middle",
    });
    text.textContent = plainTexLabel(match[4]);
    svg.append(text);
  });
  wrapper.append(svg);
  return wrapper;
}

function safePlotFunction(expression) {
  const normalized = expression
    .replace(/\^/g, "**")
    .replace(/sin\(deg\(([^()]*)\)\)/g, "Math.sin($1)")
    .replace(/cos\(deg\(([^()]*)\)\)/g, "Math.cos($1)")
    .replace(/(^|[^.A-Za-z])sin\(/g, "$1Math.sin(")
    .replace(/(^|[^.A-Za-z])cos\(/g, "$1Math.cos(")
    .replace(/(^|[^.A-Za-z])tan\(/g, "$1Math.tan(")
    .replace(/(^|[^.A-Za-z])exp\(/g, "$1Math.exp(")
    .replace(/(^|[^.A-Za-z])ln\(/g, "$1Math.log(")
    .trim();
  const operatorsOnly = normalized
    .replace(/Math\.(?:sin|cos|tan|exp|log)/g, "")
    .replace(/x/g, "");
  if (!/^[0-9+\-*/().\s*]+$/.test(operatorsOnly)) return null;
  try {
    return new Function("x", `"use strict"; return (${normalized})`);
  } catch {
    return null;
  }
}

function makeFunctionPlot(contents) {
  const axis = contents.match(
    /\\begin\{axis\}(?:\[([^\]]*)\])?([\s\S]*?)\\end\{axis\}/,
  );
  const plot = axis?.[2].match(/\\addplot(?:\[([^\]]*)\])?\s*\{([^}]+)\}/);
  const wrapper = document.createElement("div");
  wrapper.className = "tex-tikz tex-pgfplot";
  const fn = plot ? safePlotFunction(plot[2]) : null;
  if (!fn) {
    wrapper.classList.add("tex-unsupported");
    wrapper.textContent = "Не удалось разобрать выражение \\addplot.";
    return wrapper;
  }
  const domainMatch = plot[1]?.match(
    /domain\s*=\s*(-?\d*\.?\d+)\s*:\s*(-?\d*\.?\d+)/,
  );
  const from = domainMatch ? Number(domainMatch[1]) : -3;
  const to = domainMatch ? Number(domainMatch[2]) : 3;
  const samples = Array.from({ length: 121 }, (_value, index) => {
    const x = from + ((to - from) * index) / 120;
    return [x, Number(fn(x))];
  }).filter(([, y]) => Number.isFinite(y));
  const ys = samples.map(([, y]) => y);
  const minY = Math.min(...ys, 0);
  const maxY = Math.max(...ys, 0);
  const width = 520;
  const height = 300;
  const padding = 42;
  const mapX = (x) =>
    padding +
    ((x - from) / Math.max(0.0001, to - from)) * (width - padding * 2);
  const mapY = (y) =>
    height -
    padding -
    ((y - minY) / Math.max(0.0001, maxY - minY)) * (height - padding * 2);
  const svg = svgNode("svg", {
    viewBox: `0 0 ${width} ${height}`,
    role: "img",
    "aria-label": `График ${plot[2].trim()}`,
  });
  for (let index = 0; index <= 8; index += 1) {
    const x = padding + (index * (width - padding * 2)) / 8;
    const y = padding + (index * (height - padding * 2)) / 8;
    svg.append(
      svgNode("line", {
        x1: x,
        y1: padding,
        x2: x,
        y2: height - padding,
        stroke: "currentColor",
        "stroke-opacity": 0.12,
        "stroke-width": 1,
      }),
    );
    svg.append(
      svgNode("line", {
        x1: padding,
        y1: y,
        x2: width - padding,
        y2: y,
        stroke: "currentColor",
        "stroke-opacity": 0.12,
        "stroke-width": 1,
      }),
    );
  }
  if (from <= 0 && to >= 0)
    svg.append(
      svgNode("line", {
        x1: mapX(0),
        y1: padding,
        x2: mapX(0),
        y2: height - padding,
        stroke: "currentColor",
        "stroke-width": 1.6,
      }),
    );
  if (minY <= 0 && maxY >= 0)
    svg.append(
      svgNode("line", {
        x1: padding,
        y1: mapY(0),
        x2: width - padding,
        y2: mapY(0),
        stroke: "currentColor",
        "stroke-width": 1.6,
      }),
    );
  const points = samples.map(([x, y]) => `${mapX(x)},${mapY(y)}`).join(" ");
  svg.append(
    svgNode("polyline", {
      points,
      fill: "none",
      stroke: tikzColor(plot[1] || ""),
      "stroke-width": /thick/.test(plot[1] || "") ? 2.7 : 2,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    }),
  );
  wrapper.append(svg);
  return wrapper;
}

function makeTikzPicture(picture) {
  return /\\begin\{axis\}/.test(picture.contents)
    ? makeFunctionPlot(picture.contents)
    : makeForceDiagram(picture.contents);
}

function errorHtml(error, source = "") {
  const wrapper = document.createElement("div");
  wrapper.className = "tex-error";
  const title = document.createElement("strong");
  title.textContent = "Ошибка TeX";
  const message = document.createElement("pre");
  const location = error?.location?.start;
  const sourceLine = location
    ? source.split("\n")[location.line - 1]?.trim()
    : "";
  message.textContent = `${error?.message || String(error)}${location ? `\nСтрока ${location.line}, столбец ${location.column}` : ""}${sourceLine ? `\n${sourceLine}` : ""}`;
  wrapper.append(title, message);
  return wrapper.outerHTML;
}

export function renderTex(source, settings, fontPool) {
  let parsedSource = "";
  try {
    const {
      prepared,
      tables,
      multicols,
      tikzPictures,
      codeBlocks,
      boxes,
      circuits,
    } = prepareSource(source);
    const generator = new HtmlGenerator({ hyphenate: false });
    parsedSource = repairMathSource(normalizeCompatCommands(prepared));
    const result = parse(parsedSource, { generator });
    const container = document.createElement("main");
    container.append(result.domFragment());
    replaceTokenBlock(container, PAGE_BREAK_TOKEN, () => {
      const marker = document.createElement("div");
      marker.dataset.pageBreak = "true";
      return marker;
    });
    replaceTokenBlock(container, RULE_TOKEN, () =>
      document.createElement("hr"),
    );
    multicols.forEach((multicol, index) => {
      replaceTokenBlock(container, `${MULTICOL_TOKEN_PREFIX}${index}`, () =>
        makeMulticols(multicol),
      );
    });
    tikzPictures.forEach((picture, index) => {
      replaceTokenBlock(container, `${TIKZ_TOKEN_PREFIX}${index}`, () =>
        makeTikzPicture(picture),
      );
    });
    circuits.forEach((_circuit, index) => {
      replaceTokenBlock(container, `${CIRCUIT_TOKEN_PREFIX}${index}`, () =>
        makeCircuit(),
      );
    });
    boxes.forEach((box, index) => {
      replaceTokenBlock(container, `${BOX_TOKEN_PREFIX}${index}`, () =>
        makeBox(box),
      );
    });
    codeBlocks.forEach((block, index) => {
      replaceTokenBlock(container, `${CODE_TOKEN_PREFIX}${index}`, () =>
        makeCodeBlock(block),
      );
    });
    tables.forEach((table, index) => {
      replaceTokenBlock(container, `${TABLE_TOKEN_PREFIX}${index}`, () =>
        makeTable(table),
      );
    });
    const body = container.querySelector(".body") || container;
    return renderHandwrittenHtml(body.innerHTML, settings, fontPool);
  } catch (error) {
    return renderHandwrittenHtml(
      errorHtml(error, parsedSource),
      settings,
      fontPool,
    );
  }
}
