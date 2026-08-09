const FONT_EM = 400;

const SYMBOLS = Object.freeze({
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  epsilon: "ε",
  theta: "θ",
  lambda: "λ",
  mu: "μ",
  pi: "π",
  rho: "ρ",
  sigma: "σ",
  phi: "φ",
  psi: "ψ",
  omega: "ω",
  Gamma: "Γ",
  Delta: "Δ",
  Theta: "Θ",
  Lambda: "Λ",
  Pi: "Π",
  Sigma: "Σ",
  Phi: "Φ",
  Psi: "Ψ",
  Omega: "Ω",
  int: "∫",
  oint: "∮",
  sum: "Σ",
  prod: "Π",
  infty: "∞",
  pm: "±",
  mp: "∓",
  times: "×",
  cdot: "·",
  div: "÷",
  le: "≤",
  leq: "≤",
  ge: "≥",
  geq: "≥",
  ne: "≠",
  neq: "≠",
  approx: "≈",
  sim: "∼",
  to: "→",
  rightarrow: "→",
  leftarrow: "←",
  partial: "∂",
  nabla: "∇",
  hbar: "ℏ",
  degree: "°",
  circ: "°",
  ldots: "…",
  dots: "…",
});

const GROUP_COMMANDS = new Set([
  "text",
  "textrm",
  "textit",
  "textbf",
  "mathrm",
  "mathbf",
  "mathit",
  "mathsf",
  "mathtt",
  "operatorname",
  "mathbb",
  "mathcal",
]);
const IGNORED_COMMANDS = new Set([
  "left",
  "right",
  "limits",
  "displaystyle",
  "textstyle",
  "scriptstyle",
  "scriptscriptstyle",
]);

function sequence(children = []) {
  return { type: "sequence", children };
}

function parser(source) {
  let index = 0;
  const peek = () => source[index];
  const take = () => source[index++];
  const command = () => {
    take();
    if (!/[A-Za-z]/.test(peek() || "")) return take() || "";
    const start = index;
    while (/[A-Za-z]/.test(peek() || "")) index += 1;
    return source.slice(start, index);
  };
  const argument = () => {
    while (/\s/.test(peek() || "")) index += 1;
    if (peek() === "{") {
      take();
      const result = expression("}");
      if (peek() === "}") take();
      return result;
    }
    return atom();
  };
  const atom = () => {
    if (index >= source.length) return sequence();
    if (peek() === "{") return argument();
    if (peek() !== "\\") return { type: "text", value: take() };
    const name = command();
    if (name === "frac" || name === "dfrac" || name === "tfrac")
      return { type: "frac", numerator: argument(), denominator: argument() };
    if (name === "sqrt") {
      if (peek() === "[") {
        while (index < source.length && take() !== "]") {
          /* optional root index */
        }
      }
      return { type: "sqrt", body: argument() };
    }
    if (name === "hat" || name === "widehat")
      return { type: "accent", body: argument(), accent: "hat" };
    if (GROUP_COMMANDS.has(name)) return argument();
    if (IGNORED_COMMANDS.has(name)) return sequence();
    if ([",", ";", ":", "!", "quad", "qquad", " "].includes(name))
      return {
        type: "space",
        wide: name === "qquad" ? 2 : name === "quad" ? 1 : 0.35,
      };
    return { type: "text", value: SYMBOLS[name] || name };
  };
  const expression = (stop = "") => {
    const children = [];
    while (index < source.length && peek() !== stop) {
      if (/\s/.test(peek())) {
        index += 1;
        continue;
      }
      if (peek() === "&") {
        index += 1;
        continue;
      }
      if (source.slice(index, index + 2) === "\\\\") {
        index += 2;
        children.push({ type: "linebreak" });
        continue;
      }
      let base = atom();
      let sup = null;
      let sub = null;
      while (peek() === "^" || peek() === "_") {
        const kind = take();
        const value = argument();
        if (kind === "^") sup = value;
        else sub = value;
      }
      if (sup || sub) base = { type: "scripts", base, sup, sub };
      children.push(base);
    }
    return sequence(children);
  };
  return expression();
}

function shift(strokes, dx, dy) {
  return strokes.map((stroke) => {
    const shifted = stroke.map((point) => ({
      x: point.x + dx,
      y: point.y + dy,
    }));
    if (stroke.pressure) shifted.pressure = stroke.pressure;
    return shifted;
  });
}

function glyphStrokes(glyph, x, baseline, scale) {
  const strokes = [];
  let stroke = null;
  glyph.points.forEach((source, index) => {
    const point = {
      x: x + (source.x - glyph.bounds.minX) * scale,
      y: baseline + source.y * scale,
    };
    if (glyph.flags[index] === 0 || !stroke) {
      stroke = [point];
      strokes.push(stroke);
    } else stroke.push(point);
  });
  return strokes.filter((item) => item.length > 1);
}

function emptyBox(width = 0) {
  return { width, ascent: 0, descent: 0, strokes: [] };
}

function constructedSymbol(char, size) {
  const line = (...points) =>
    points.map(([x, y]) => ({ x: x * size, y: y * size }));
  if (char === "ℏ") {
    return {
      width: size * 0.62,
      ascent: size * 0.88,
      descent: size * 0.1,
      strokes: [
        line([0.13, 0.08], [0.24, -0.88]),
        line([0.08, -0.46], [0.54, -0.46]),
        line([0.12, -0.32], [0.58, -0.32]),
        line(
          [0.23, -0.36],
          [0.36, -0.52],
          [0.5, -0.48],
          [0.52, -0.28],
          [0.47, 0.06],
        ),
      ],
    };
  }
  if (char === "∂") {
    return {
      width: size * 0.62,
      ascent: size * 0.84,
      descent: size * 0.1,
      strokes: [
        line(
          [0.18, -0.78],
          [0.32, -0.88],
          [0.48, -0.78],
          [0.54, -0.58],
          [0.5, -0.3],
          [0.39, -0.06],
          [0.23, 0.08],
          [0.1, 0.02],
          [0.07, -0.16],
          [0.14, -0.34],
          [0.3, -0.42],
          [0.49, -0.36],
        ),
      ],
    };
  }
  if (char === "Ψ") {
    return {
      width: size * 0.78,
      ascent: size * 0.86,
      descent: size * 0.1,
      strokes: [
        line(
          [0.08, -0.78],
          [0.1, -0.48],
          [0.21, -0.22],
          [0.39, -0.12],
          [0.57, -0.22],
          [0.68, -0.48],
          [0.7, -0.78],
        ),
        line([0.39, -0.86], [0.39, 0.08]),
        line([0.18, 0.08], [0.6, 0.08]),
      ],
    };
  }
  if (char === "∫" || char === "∮") {
    const integral = line(
      [0.42, -0.88],
      [0.28, -0.92],
      [0.18, -0.78],
      [0.22, -0.48],
      [0.16, -0.18],
      [0.05, 0.08],
      [0.12, 0.18],
      [0.29, 0.14],
    );
    const strokes = [integral];
    if (char === "∮")
      strokes.push(
        line(
          [0.02, -0.39],
          [0.42, -0.39],
          [0.42, -0.16],
          [0.02, -0.16],
          [0.02, -0.39],
        ),
      );
    return {
      width: size * 0.48,
      ascent: size * 0.92,
      descent: size * 0.18,
      strokes,
    };
  }
  if (char === "±" || char === "∓") {
    return {
      width: size * 0.68,
      ascent: size * 0.72,
      descent: size * 0.08,
      strokes: [
        line([0.08, -0.48], [0.6, -0.48]),
        line([0.34, -0.7], [0.34, -0.26]),
        line([0.08, -0.08], [0.6, -0.08]),
      ],
    };
  }
  if (char === "Σ")
    return {
      width: size * 0.72,
      ascent: size * 0.82,
      descent: size * 0.1,
      strokes: [
        line(
          [0.66, -0.82],
          [0.1, -0.82],
          [0.42, -0.38],
          [0.1, 0.08],
          [0.68, 0.08],
        ),
      ],
    };
  if (char === "Π")
    return {
      width: size * 0.72,
      ascent: size * 0.82,
      descent: size * 0.08,
      strokes: [line([0.1, 0.08], [0.1, -0.82], [0.64, -0.82], [0.64, 0.08])],
    };
  if (char === "∞")
    return {
      width: size * 0.88,
      ascent: size * 0.56,
      descent: size * 0.02,
      strokes: [
        line(
          [0.06, -0.26],
          [0.18, -0.48],
          [0.36, -0.48],
          [0.76, -0.04],
          [0.86, -0.26],
          [0.74, -0.48],
          [0.56, -0.48],
          [0.16, -0.04],
          [0.06, -0.26],
        ),
      ],
    };
  if (char === "×")
    return {
      width: size * 0.65,
      ascent: size * 0.68,
      descent: 0,
      strokes: [
        line([0.1, -0.62], [0.56, -0.12]),
        line([0.56, -0.62], [0.1, -0.12]),
      ],
    };
  if (char === "·")
    return {
      width: size * 0.3,
      ascent: size * 0.38,
      descent: 0,
      strokes: [line([0.13, -0.28], [0.16, -0.25])],
    };
  return null;
}

export function parseFormula(source) {
  return parser(source.replace(/\s+/g, " ").trim());
}

function seededRandom(seed, key) {
  let value = 2166136261;
  const input = `${seed}:${key}`;
  for (let index = 0; index < input.length; index += 1) {
    value ^= input.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  value += 0x6d2b79f5;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}

function humanizeFormula(strokes, handwriting, fontSize) {
  if (!handwriting?.enabled) return strokes;
  const variation = Math.max(
    0,
    Math.min(100, Number(handwriting.variation) || 0),
  );
  const rhythm = Math.max(0, Math.min(100, Number(handwriting.rhythm) || 0));
  const width = Math.max(
    0.82,
    Math.min(1.18, Number(handwriting.authorWidth || 100) / 100),
  );
  const slant = Math.tan(
    (Math.max(-16, Math.min(20, Number(handwriting.authorSlant) || 0)) *
      Math.PI) /
      180,
  );
  const jitter = fontSize * (variation * 0.00012 + rhythm * 0.00008);
  return strokes.map((stroke, strokeIndex) => {
    const pressure =
      1 +
      (seededRandom(handwriting.seed, `formula:${strokeIndex}:pressure`) -
        0.5) *
        Number(handwriting.pressure || 0) *
        0.009;
    const transformed = stroke.map((point, pointIndex) => {
      const localJitter =
        (seededRandom(
          handwriting.seed,
          `formula:${strokeIndex}:${pointIndex}`,
        ) -
          0.5) *
        jitter;
      return {
        x: point.x * width + point.y * slant + localJitter,
        y: point.y + localJitter * 0.65,
      };
    });
    transformed.pressure = pressure;
    return transformed;
  });
}

export async function layoutFormula(
  source,
  { fontSize, letterSpacing = 0, getGlyph, handwriting = null },
) {
  const missing = new Set();
  const render = async (node, size) => {
    if (!node) return emptyBox();
    if (node.type === "space") return emptyBox(size * 0.22 * node.wide);
    if (node.type === "linebreak") return emptyBox(size * 0.5);
    if (node.type === "text") {
      let x = 0;
      let ascent = size * 0.72;
      let descent = size * 0.18;
      const strokes = [];
      for (const char of Array.from(node.value)) {
        const glyph = await getGlyph(char);
        if (!glyph) {
          const constructed = constructedSymbol(char, size);
          if (constructed) {
            strokes.push(...shift(constructed.strokes, x, 0));
            x += constructed.width;
            ascent = Math.max(ascent, constructed.ascent);
            descent = Math.max(descent, constructed.descent);
            continue;
          }
          missing.add(char);
          x += size * 0.46;
          continue;
        }
        const scale = size / FONT_EM;
        strokes.push(...glyphStrokes(glyph, x, 0, scale));
        const points = glyph.points || [];
        if (points.length) {
          ascent = Math.max(
            ascent,
            -Math.min(...points.map((point) => point.y)) * scale,
          );
          descent = Math.max(
            descent,
            Math.max(...points.map((point) => point.y)) * scale,
          );
        }
        x += Math.max(
          (glyph.bounds.maxX - glyph.bounds.minX) * scale +
            (letterSpacing * size) / fontSize,
          size * 0.24,
        );
      }
      return { width: x, ascent, descent, strokes };
    }
    if (node.type === "sequence") {
      let x = 0;
      let ascent = 0;
      let descent = 0;
      const strokes = [];
      for (const child of node.children) {
        const box = await render(child, size);
        strokes.push(...shift(box.strokes, x, 0));
        x += box.width;
        ascent = Math.max(ascent, box.ascent);
        descent = Math.max(descent, box.descent);
      }
      return { width: x, ascent, descent, strokes };
    }
    if (node.type === "sqrt") {
      const body = await render(node.body, size * 0.92);
      const lead = size * 0.42;
      const top = -Math.max(body.ascent + size * 0.08, size * 0.72);
      const width = lead + body.width + size * 0.1;
      const radical = [
        [
          { x: 0, y: -size * 0.12 },
          { x: size * 0.1, y: size * 0.02 },
          { x: size * 0.22, y: top + size * 0.16 },
          { x: size * 0.34, y: top },
          { x: width, y: top },
        ],
      ];
      return {
        width,
        ascent: Math.max(-top, body.ascent),
        descent: Math.max(body.descent, size * 0.03),
        strokes: [...radical, ...shift(body.strokes, lead, 0)],
      };
    }
    if (node.type === "accent") {
      const body = await render(node.body, size);
      const top = -body.ascent - size * 0.08;
      const inset = Math.min(body.width * 0.18, size * 0.14);
      const middle = body.width / 2;
      return {
        width: body.width,
        ascent: Math.max(body.ascent, -top + size * 0.16),
        descent: body.descent,
        strokes: [
          ...body.strokes,
          [
            { x: inset, y: top + size * 0.12 },
            { x: middle, y: top },
            { x: Math.max(middle, body.width - inset), y: top + size * 0.12 },
          ],
        ],
      };
    }
    if (node.type === "frac") {
      const numerator = await render(node.numerator, size * 0.72);
      const denominator = await render(node.denominator, size * 0.72);
      const padding = size * 0.14;
      const gap = size * 0.12;
      const width = Math.max(numerator.width, denominator.width) + padding * 2;
      const ruleY = -size * 0.1;
      const numeratorY = ruleY - gap - numerator.descent;
      const denominatorY = ruleY + gap + denominator.ascent;
      return {
        width,
        ascent: Math.max(-numeratorY + numerator.ascent, -ruleY),
        descent: denominatorY + denominator.descent,
        strokes: [
          ...shift(
            numerator.strokes,
            (width - numerator.width) / 2,
            numeratorY,
          ),
          [
            { x: 0, y: ruleY },
            { x: width, y: ruleY },
          ],
          ...shift(
            denominator.strokes,
            (width - denominator.width) / 2,
            denominatorY,
          ),
        ],
      };
    }
    if (node.type === "scripts") {
      const base = await render(node.base, size);
      const sup = node.sup ? await render(node.sup, size * 0.62) : emptyBox();
      const sub = node.sub ? await render(node.sub, size * 0.62) : emptyBox();
      const scriptX = base.width + size * 0.04;
      const supY = node.sup ? -Math.max(size * 0.52, base.ascent * 0.62) : 0;
      const subY = node.sub
        ? Math.max(size * 0.27, base.descent + size * 0.18)
        : 0;
      return {
        width:
          base.width +
          (node.sup || node.sub
            ? size * 0.04 + Math.max(sup.width, sub.width)
            : 0),
        ascent: Math.max(base.ascent, node.sup ? -supY + sup.ascent : 0),
        descent: Math.max(base.descent, node.sub ? subY + sub.descent : 0),
        strokes: [
          ...base.strokes,
          ...shift(sup.strokes, scriptX, supY),
          ...shift(sub.strokes, scriptX, subY),
        ],
      };
    }
    return emptyBox();
  };

  const box = await render(parseFormula(source), fontSize);
  return {
    ...box,
    width: handwriting?.enabled
      ? box.width *
        Math.max(
          0.82,
          Math.min(1.18, Number(handwriting.authorWidth || 100) / 100),
        )
      : box.width,
    strokes: humanizeFormula(box.strokes, handwriting, fontSize),
    missing: [...missing],
  };
}
