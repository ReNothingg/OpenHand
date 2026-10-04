#!/usr/bin/env python3
"""Extract centre lines of reviewed handwritten words from notebook photographs.

Every word is described in font/pavel-notes/notebook-words.json by its photo,
text and two points on its baseline. The script works in a local frame along
that baseline, in millimetres measured with the notebook's 5 mm grid:
u runs along the baseline, v points down, and (0, 0) is the first point.

  propose  fills missing frame values (scale, baseline, x-height, slant and
           character boundaries) and writes review sheets; reviewed values are
           never overwritten.
  refine   re-measures baseline and x-height from the ink of plain letters
           inside the reviewed boundaries and stores the result.
  trace    extracts the ink of every word deterministically and writes
           font/pavel-notes/notebook-strokes.json.

Requires Python 3 with Pillow and NumPy. Photos stay outside the repository.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageOps

RES = 16.0          # processing resolution, pixels per millimetre
GRID_MM = 5.0       # notebook cell
V_TOP, V_BOTTOM = -13.0, 8.0
MARGIN_MM = 4.0

# Approximate relative widths (in x-heights) used only to propose boundaries.
WIDTH_PRIOR = {
    'а': .95, 'б': .95, 'в': .85, 'г': .75, 'д': 1.0, 'е': .72, 'ё': .72, 'ж': 1.45,
    'з': .8, 'и': 1.1, 'й': 1.1, 'к': .95, 'л': 1.0, 'м': 1.3, 'н': 1.05, 'о': .9,
    'п': 1.1, 'р': .95, 'с': .72, 'т': 1.45, 'у': .95, 'ф': 1.25, 'х': .95, 'ц': 1.15,
    'ч': .95, 'ш': 1.55, 'щ': 1.65, 'ъ': 1.05, 'ы': 1.25, 'ь': .8, 'э': .8, 'ю': 1.35,
    'я': .95, '.': .3, ',': .3, ':': .3, ';': .3, '-': .7, '—': 1.4, '(': .5, ')': .5,
    '«': .8, '»': .8, '!': .35, '?': .8, '1': .6, '2': .9, '3': .9, '4': .9, '5': .9,
    '6': .9, '7': .9, '8': .9, '9': .9, '0': .9,
}
ASCENDING = set('бвйёф') | set('0123456789()!?№/«»') | set('АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ')
DESCENDING = set('дзуфрцщ') | set(',;()')


def prior(char):
    if char in WIDTH_PRIOR:
        return WIDTH_PRIOR[char]
    if char.isupper():
        return 1.35
    return 1.0


# ---------------------------------------------------------------- photo access
class Photos:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.cache = {}

    def get(self, name):
        if name not in self.cache:
            matches = [p for p in self.directory.iterdir()
                       if p.stem == name and p.suffix.lower() in ('.png', '.jpg', '.jpeg', '.tif', '.tiff')]
            if not matches:
                raise FileNotFoundError(f'Decoded photo {name} not found in {self.directory}')
            image = ImageOps.exif_transpose(Image.open(matches[0])).convert('RGB')
            self.cache[name] = image
        return self.cache[name]


def reflectance(image):
    """Red-channel reflectance against a local paper estimate.

    Blue ballpoint ink absorbs red light, unlike grid lines, highlighter,
    the red margin and text showing through from the other side.
    """
    width, height = image.size
    k = 8
    small = image.resize((max(1, width // k), max(1, height // k)), Image.Resampling.BOX)
    paper = []
    for channel in small.split():
        paper.append(channel.filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.MaxFilter(9))
                     .filter(ImageFilter.GaussianBlur(6)))
    paper = Image.merge('RGB', paper).resize((width, height), Image.Resampling.BILINEAR)
    a = np.asarray(image).astype(np.float32)
    p = np.asarray(paper).astype(np.float32) + 1
    return np.clip(a / p, 0, 1.2)


def grid_pitch(image, center, half=330):
    """Pixels per 5 mm cell near a point, from the autocorrelation of grid lines."""
    cx, cy = center
    box = (int(cx - half), int(cy - half), int(cx + half), int(cy + half))
    r = reflectance(image.crop(box))[:, :, 0]
    signal = np.clip(1.0 - r, 0, .35)
    signal[r < .6] = 0
    m = signal.shape[0] // 6
    signal = signal[m:-m, m:-m]
    found = []
    for axis in (0, 1):
        profile = signal.mean(axis=axis)
        profile = profile - profile.mean()
        ac = np.correlate(profile, profile, 'full')[len(profile) - 1:]
        ac /= ac[0] + 1e-9
        lo, hi = 35, min(170, len(ac) - 2)
        k = lo + int(np.argmax(ac[lo:hi]))
        a, b, c = ac[k - 1], ac[k], ac[k + 1]
        found.append((k + (a - c) / (2 * (a - 2 * b + c) - 1e-9), float(b)))
    (p0, s0), (p1, s1) = found
    # Prefer the fundamental if one axis locked onto a harmonic.
    for pa, sa, pb, sb in ((p0, s0, p1, s1), (p1, s1, p0, s0)):
        if abs(pb / pa - 2) < .08 and sa > .2:
            return pa, sa
    return (p0, s0) if s0 >= s1 else (p1, s1)


# ---------------------------------------------------------------- word frame
class Frame:
    def __init__(self, word):
        (x0, y0), (x1, y1) = word['baseline']
        self.origin = np.array([x0, y0], float)
        d = np.array([x1 - x0, y1 - y0], float)
        self.length_px = float(np.hypot(*d))
        self.eu = d / self.length_px
        self.ev = np.array([-self.eu[1], self.eu[0]])
        self.ppm = float(word['pxPerMm'])
        self.length = self.length_px / self.ppm
        self.u0 = -MARGIN_MM
        self.u1 = self.length + MARGIN_MM
        self.v0, self.v1 = V_TOP, V_BOTTOM

    def photo(self, u, v):
        return self.origin + (u * self.eu + v * self.ev) * self.ppm

    def sample(self, image):
        """Red reflectance resampled into the word frame at RES px/mm."""
        corners = [self.photo(u, v) for u in (self.u0, self.u1) for v in (self.v0, self.v1)]
        xs = [c[0] for c in corners]
        ys = [c[1] for c in corners]
        pad = 3 * GRID_MM * self.ppm
        box = (int(min(xs) - pad), int(min(ys) - pad), int(max(xs) + pad), int(max(ys) + pad))
        crop = image.crop(box)
        step = self.ppm / RES
        # Low-pass before resampling to avoid aliasing at the working resolution.
        refl = reflectance(crop.filter(ImageFilter.GaussianBlur((step - 1) * .45)) if step > 1.3 else crop)
        out = []
        width = int(round((self.u1 - self.u0) * RES))
        height = int(round((self.v1 - self.v0) * RES))
        start = self.photo(self.u0, self.v0) - np.array(box[:2], float)
        coeffs = (self.eu[0] * step, self.ev[0] * step, start[0] + .5 * step * (self.eu[0] + self.ev[0]) - .5,
                  self.eu[1] * step, self.ev[1] * step, start[1] + .5 * step * (self.eu[1] + self.ev[1]) - .5)
        for channel in (0, 2):
            plane = Image.fromarray(refl[:, :, channel].astype(np.float32), 'F')
            out.append(np.asarray(plane.transform((width, height), Image.Transform.AFFINE, coeffs,
                                                  resample=Image.Resampling.BILINEAR, fillcolor=1.0)))
        gray = ImageOps.grayscale(crop)
        gray = gray.transform((width, height), Image.Transform.AFFINE, coeffs,
                              resample=Image.Resampling.BILINEAR, fillcolor=255)
        return out[0], out[1], gray

    def to_px(self, u, v):
        return (u - self.u0) * RES, (v - self.v0) * RES

    def from_px(self, x, y):
        return x / RES + self.u0, y / RES + self.v0


# ---------------------------------------------------------------- raster tools
def label(mask):
    """8-connected components as lists of (row, col) pairs."""
    remaining = set(zip(*np.nonzero(mask)))
    parts = []
    while remaining:
        seed = remaining.pop()
        part = [seed]
        stack = [seed]
        while stack:
            y, x = stack.pop()
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    p = (y + dy, x + dx)
                    if p in remaining:
                        remaining.remove(p)
                        stack.append(p)
                        part.append(p)
        parts.append(part)
    return parts


def ink_mask(red, blue=None, thresholds=(.45, .62)):
    strong = red < thresholds[0]
    weak = red < thresholds[1]
    # Pale blue ink needs a higher threshold. Colour separation prevents the
    # notebook grid and grey show-through from becoming pen trajectories.
    if blue is not None and thresholds[1] > .7:
        weak &= (blue - red > .035) | (red < .45)
    mask = np.zeros_like(weak)
    for part in label(weak):
        rows, cols = zip(*part)
        rows = np.array(rows)
        cols = np.array(cols)
        if strong[rows, cols].sum() >= 3:
            mask[rows, cols] = True
    return mask


def thin(mask):
    """Zhang-Suen thinning."""
    a = np.pad(mask.astype(np.uint8), 1)
    for _ in range(200):
        changed = False
        for phase in (0, 1):
            p = [a[:-2, 1:-1], a[:-2, 2:], a[1:-1, 2:], a[2:, 2:], a[2:, 1:-1], a[2:, :-2], a[1:-1, :-2], a[:-2, :-2]]
            count = sum(p)
            transitions = sum((p[i] == 0) & (p[(i + 1) % 8] == 1) for i in range(8))
            if phase == 0:
                constraint = (p[0] * p[2] * p[4] == 0) & (p[2] * p[4] * p[6] == 0)
            else:
                constraint = (p[0] * p[2] * p[6] == 0) & (p[0] * p[4] * p[6] == 0)
            remove = (a[1:-1, 1:-1] > 0) & (count >= 2) & (count <= 6) & (transitions == 1) & constraint
            if np.any(remove):
                a[1:-1, 1:-1][remove] = 0
                changed = True
        if not changed:
            break
    return a[1:-1, 1:-1] > 0


def smooth_mask(mask):
    image = Image.fromarray((mask * 255).astype(np.uint8))
    image = image.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(3))
    return np.asarray(image) > 0


# ---------------------------------------------------------------- estimates
def deskew_q(frame, slant, rows, cols, baseline):
    u, v = frame.from_px(cols + .5, rows + .5)
    return u + slant * (v - baseline)


def centre_lines(mask, frame):
    """Skeleton paths in millimetres, smoothed to remove pixel steps."""
    result = []
    for path in trace_paths(skeleton_graph(thin(mask))):
        if len(path) < 8:
            continue
        pts = np.array([frame.from_px(x + .5, y + .5) for x, y in path])
        kernel = np.ones(5) / 5
        if len(pts) > 9:
            pts = np.stack([np.convolve(np.pad(pts[:, k], 2, mode='edge'), kernel, 'valid') for k in (0, 1)], 1)
        result.append(pts)
    return result


def extrema(paths, u_range):
    """Local top and bottom turning points of centre lines."""
    tops, bottoms = [], []
    for pts in paths:
        v = pts[:, 1]
        w = 10
        for i in range(w, len(pts) - w):
            if not (u_range[0] < pts[i, 0] < u_range[1]):
                continue
            window = v[i - w:i + w + 1]
            if v[i] == window.min() and v[i] < window[0] - .06 and v[i] < window[-1] - .06:
                tops.append(v[i])
            if v[i] == window.max() and v[i] > window[0] + .06 and v[i] > window[-1] + .06:
                bottoms.append(v[i])
    return np.array(tops), np.array(bottoms)


def estimate_lines(mask, frame, baseline_guess, xh_guess, u_range=None):
    """Baseline and x-height that best align the turning points of the ink."""
    u_range = u_range or (0, frame.length)
    tops, bottoms = extrema(centre_lines(mask, frame), u_range)
    if len(tops) < 2 or len(bottoms) < 2:
        return baseline_guess, xh_guess
    best = (-1, baseline_guess, xh_guess)
    sigma = .22
    for b in np.arange(baseline_guess - 2.0, baseline_guess + 2.0, .05):
        lower = np.exp(-((bottoms - b) / sigma) ** 2 / 2).sum()
        for xh in np.arange(2.4, 5.4, .05):
            upper = np.exp(-((tops - (b - xh)) / sigma) ** 2 / 2).sum()
            # Both lines must be supported; the prior prefers the usual size.
            score = min(lower, upper) * 2 + lower + upper - abs(xh - xh_guess) * .6 - abs(b - baseline_guess) * .4
            if score > best[0]:
                best = (score, float(b), float(xh))
    return best[1], best[2]


def estimate_slant(mask, frame, baseline, xh):
    """Median lean of near-vertical centre-line pieces (down strokes, stems).

    Long diagonal joins dominate a projection profile, so they are excluded.
    """
    values, weights = [], []
    for pts in centre_lines(mask, frame):
        for i in range(0, len(pts) - 8, 3):
            seg = pts[i:i + 9]
            du, dv = seg[-1] - seg[0]
            mid = seg[:, 1].mean()
            length = math.hypot(du, dv)
            if length < .3 or abs(dv) < 1e-6 or not (baseline - 2.6 * xh < mid < baseline + .2 * xh):
                continue
            # Straight pieces only: curvature would bias the direction.
            centred = seg - seg.mean(0)
            _, sv, _ = np.linalg.svd(centred, full_matrices=False)
            if sv[1] > .12 * sv[0]:
                continue
            lean = -du / dv
            if abs(lean) < .7:
                values.append(lean)
                weights.append(length)
    if not values:
        return 0.0
    order = np.argsort(values)
    cumulative = np.cumsum(np.array(weights)[order])
    median = float(np.array(values)[order][np.searchsorted(cumulative, cumulative[-1] / 2)])
    return round(median, 3)


def crossings(mask, frame, slant, baseline, xh, q):
    """Ink runs crossed by the slanted line u + slant*(v-b) = q within the body."""
    vs = np.arange(baseline - xh * 1.05, baseline + xh * .15, 1 / RES)
    us = q - slant * (vs - baseline)
    xs, ys = frame.to_px(us, vs)
    xs = np.clip(np.round(xs).astype(int), 0, mask.shape[1] - 1)
    ys = np.clip(np.round(ys).astype(int), 0, mask.shape[0] - 1)
    line = mask[ys, xs].astype(int)
    runs = int(((line[1:] == 1) & (line[:-1] == 0)).sum() + line[0])
    return runs, float(line.mean())


def propose_cuts(mask, frame, text, slant, baseline, xh):
    rows, cols = np.nonzero(mask)
    u, v = frame.from_px(cols + .5, rows + .5)
    q = u + slant * (v - baseline)
    zone = (v > baseline - 1.2 * xh) & (v < baseline + .3 * xh)
    if not zone.any():
        raise ValueError('No ink in the body zone')
    left, right = float(np.percentile(q[zone], .2)), float(np.percentile(q[zone], 99.8))
    chars = list(text)
    n = len(chars)
    if n == 1:
        return [round(left, 2), round(right, 2)]
    step = .1
    grid = np.arange(left, right + step / 2, step)
    cost = np.zeros(len(grid))
    for i, g in enumerate(grid):
        runs, density = crossings(mask, frame, slant, baseline, xh, g)
        cost[i] = density * 6 + max(0, runs - 1) * 1.5 + (2.5 if runs == 0 else 0) * 0
    total = sum(prior(c) for c in chars)
    unit = (right - left) / total
    # DP over boundary positions (indices into grid)
    m = len(grid)
    if m < n + 1:
        raise ValueError(f'ink span {right - left:.1f} mm is too short for {n} characters')
    inf = float('inf')
    best = np.full((n + 1, m), inf)
    back = np.zeros((n + 1, m), int)
    best[0, 0] = 0
    for k in range(1, n + 1):
        expected = prior(chars[k - 1]) * unit
        for j in range(1, m):
            if k == n and j != m - 1:
                continue
            widths = grid[j] - grid[:j]
            dev = ((widths - expected) / max(expected, .4)) ** 2 * 4
            candidates = best[k - 1, :j] + dev
            i = int(np.argmin(candidates))
            best[k, j] = candidates[i] + (cost[j] if k < n else 0)
            back[k, j] = i
    cuts = [m - 1]
    for k in range(n, 0, -1):
        cuts.append(back[k, cuts[-1]])
    cuts = cuts[::-1]
    return [round(float(grid[c]), 2) for c in cuts]


ON_BASELINE = set('абвгеёжийклмнопстхчшъыьэюя')
AT_BODY_TOP = set('агдежзиклмнопрстухцчшщъыьэюя')


def letter_lines(mask, frame, word):
    """Baseline and x-height from the ink of individual reviewed letters.

    Turning points of a whole word mix joins, ascenders and descenders; with
    known boundaries the lowest and highest ink of plain letters is precise.
    """
    b, s, cuts = word['baselineOffset'], word['slant'], word['cuts']
    rows, cols = np.nonzero(mask)
    u, v = frame.from_px(cols + .5, rows + .5)
    q = u + s * (v - b)
    bottoms, tops = [], []
    for i, char in enumerate(word['text']):
        inside = (q > cuts[i] + .15 * (cuts[i + 1] - cuts[i])) & (q < cuts[i + 1] - .15 * (cuts[i + 1] - cuts[i]))
        inside &= (v > b - 1.45 * word['xHeight']) & (v < b + .45 * word['xHeight'])
        if inside.sum() < 20:
            continue
        vs = v[inside]
        if char in ON_BASELINE:
            bottoms.append(float(np.percentile(vs, 94)))
        if char in AT_BODY_TOP:
            tops.append(float(np.percentile(vs, 4)))
    baseline = float(np.median(bottoms)) if len(bottoms) >= 2 else None
    top = float(np.median(tops)) if len(tops) >= 2 else None
    return baseline, top, len(bottoms), len(tops)


def select_components(mask, frame, word, baseline, xh, slant, cuts):
    rows, cols = np.nonzero(mask)
    keep = np.zeros_like(mask)
    text = word['text']
    for part in label(mask):
        r = np.array([p[0] for p in part])
        c = np.array([p[1] for p in part])
        u, v = frame.from_px(c + .5, r + .5)
        q = u + slant * (v - baseline)
        inside = (q >= cuts[0] - .4) & (q <= cuts[-1] + .4)
        if not inside.any():
            continue
        body = ((v > baseline - .95 * xh) & (v < baseline + .25 * xh) & inside).any()
        small_mark = len(part) < (1.6 * RES) ** 2 and inside.mean() > .6
        owner = max(0, min(len(text) - 1, int(np.searchsorted(cuts, np.median(q)) - 1)))
        char = text[owner]
        mark_zone = ((char in 'йёЙЁіi' and baseline - 2.6 * xh < v.mean() < baseline - .9 * xh)
                     or (char in '.,:;!?«»"-—=+' and baseline - 1.1 * xh < v.mean() < baseline + .9 * xh))
        if body or (small_mark and mark_zone):
            keep[r, c] = True
    return keep


# ---------------------------------------------------------------- tracing
def skeleton_graph(skel):
    coords = set((int(x), int(y)) for y, x in zip(*np.nonzero(skel)))
    adj = {}
    for x, y in coords:
        neighbors = []
        for dx, dy in ((1, 0), (0, 1), (-1, 0), (0, -1), (1, 1), (-1, 1), (-1, -1), (1, -1)):
            p = (x + dx, y + dy)
            if p not in coords:
                continue
            if dx and dy and ((x + dx, y) in coords or (x, y + dy) in coords):
                continue
            neighbors.append(p)
        adj[(x, y)] = neighbors
    return adj


def prune_spurs(adj, max_length):
    """Remove short skeleton branches that end at a junction: thinning artefacts
    of ink blots and pen turns, not written strokes."""
    adj = {k: list(v) for k, v in adj.items()}
    for _ in range(3):
        removed = False
        for start in [n for n, nb in adj.items() if len(nb) == 1]:
            if start not in adj or len(adj[start]) != 1:
                continue
            branch = [start]
            prev, cur = None, start
            while len(adj[cur]) == 2 or cur == start:
                nxt = [n for n in adj[cur] if n != prev]
                if not nxt:
                    break
                prev, cur = cur, nxt[0]
                branch.append(cur)
                if len(branch) > max_length:
                    break
            if len(branch) <= max_length and len(adj.get(cur, [])) >= 3:
                for node in branch[:-1]:
                    for n in adj.pop(node, []):
                        if n in adj and node in adj[n]:
                            adj[n].remove(node)
                removed = True
        if not removed:
            break
    return adj


def edge_key(a, b):
    return (a, b) if a <= b else (b, a)


def biconnected_blocks(adj):
    """Iterative Tarjan: lists of edges forming cycles (blocks with >= 3 edges)."""
    index = {}
    low = {}
    counter = 0
    blocks = []
    edge_stack = []
    for root in sorted(adj):
        if root in index:
            continue
        index[root] = low[root] = counter
        counter += 1
        stack = [(root, None, iter(adj[root]))]
        while stack:
            u, parent, it = stack[-1]
            advanced = False
            for w in it:
                if w == parent:
                    continue
                if w not in index:
                    index[w] = low[w] = counter
                    counter += 1
                    edge_stack.append((u, w))
                    stack.append((w, u, iter(adj[w])))
                    advanced = True
                    break
                if index[w] < index[u]:
                    edge_stack.append((u, w))
                    low[u] = min(low[u], index[w])
            if advanced:
                continue
            stack.pop()
            if stack:
                p = stack[-1][0]
                low[p] = min(low[p], low[u])
                if low[u] >= index[p]:
                    group = []
                    while edge_stack:
                        e = edge_stack.pop()
                        group.append(e)
                        if e == (p, u):
                            break
                    if len(group) >= 3:
                        blocks.append(group)
    return blocks


def trace_paths(adj):
    used = set()
    paths = []
    nodes = sorted(adj, key=lambda p: (len(adj[p]) != 1, p[0], p[1]))
    for start in nodes:
        while any(edge_key(start, n) not in used for n in adj[start]):
            path = [start]
            cur = start
            while True:
                choices = [n for n in adj[cur] if edge_key(cur, n) not in used]
                if not choices:
                    break
                if len(path) > 1:
                    prev = path[max(0, len(path) - 6)]
                    vx, vy = cur[0] - prev[0], cur[1] - prev[1]
                    choices.sort(key=lambda n: -((n[0] - cur[0]) * vx + (n[1] - cur[1]) * vy)
                                 / max(.001, math.hypot(n[0] - cur[0], n[1] - cur[1])))
                else:
                    choices.sort()
                nxt = choices[0]
                used.add(edge_key(cur, nxt))
                path.append(nxt)
                cur = nxt
            if len(path) > 1:
                paths.append(path)
    return paths


def simplify(points, tol):
    if len(points) < 3:
        return points
    a = np.array(points[0])
    b = np.array(points[-1])
    q = np.array(points)
    d = b - a
    dd = float(np.dot(d, d))
    if dd < 1e-12:
        dist = np.linalg.norm(q - a, axis=1)
    else:
        t = np.clip(np.dot(q - a, d) / dd, 0, 1)
        dist = np.linalg.norm(q - (a + t[:, None] * d), axis=1)
    k = int(np.argmax(dist))
    if dist[k] <= tol:
        return [points[0], points[-1]]
    return simplify(points[:k + 1], tol)[:-1] + simplify(points[k:], tol)


def trace_word(frame, word, mask):
    baseline, slant, cuts = word['baselineOffset'], word['slant'], word['cuts']
    chars = list(word['text'])
    skel = thin(mask)
    adj = prune_spurs(skeleton_graph(skel), int(.32 * RES))

    def q_of(node):
        u, v = frame.from_px(node[0] + .5, node[1] + .5)
        return u + slant * (v - baseline)

    def cell(q):
        return max(0, min(len(chars) - 1, int(np.searchsorted(cuts, q, side='right') - 1)))

    owners = {}
    for block in biconnected_blocks(adj):
        nodes = {n for e in block for n in e}
        qs = [q_of(n) for n in nodes]
        cells = [cell(q) for q in qs]
        owner = max(set(cells), key=cells.count)
        if cells.count(owner) >= .75 * len(cells):
            for a, b in block:
                owners[edge_key(a, b)] = owner
    glyphs = [[] for _ in chars]
    joins = [{'entry': [], 'exit': []} for _ in chars]
    xh = word['xHeight']
    body_top, body_bottom = baseline - 1.2 * xh, baseline + .35 * xh
    for path in trace_paths(adj):
        # Split the path at boundaries crossed inside the body zone. Ascenders
        # and descenders lean further than the stems and belong to the letter
        # whose body they leave, so pieces outside the body are "free".
        pieces = []
        for a, b in zip(path, path[1:]):
            pa = frame.from_px(a[0] + .5, a[1] + .5)
            pb = frame.from_px(b[0] + .5, b[1] + .5)
            qa = pa[0] + slant * (pa[1] - baseline)
            qb = pb[0] + slant * (pb[1] - baseline)
            owner = owners.get(edge_key(a, b))
            free = owner is None and not (body_top < (pa[1] + pb[1]) / 2 < body_bottom)
            knots = [0.0, 1.0]
            if owner is None and not free and abs(qb - qa) > 1e-9:
                knots += [(c - qa) / (qb - qa) for c in cuts[1:-1] if 0 < (c - qa) / (qb - qa) < 1]
            knots.sort()
            for ta, tb in zip(knots, knots[1:]):
                aa = (pa[0] + (pb[0] - pa[0]) * ta, pa[1] + (pb[1] - pa[1]) * ta)
                bb = (pa[0] + (pb[0] - pa[0]) * tb, pa[1] + (pb[1] - pa[1]) * tb)
                index = owner if owner is not None else cell(qa + (qb - qa) * (ta + tb) / 2)
                pieces.append([aa, bb, index, free])
        bound = [i for i, piece in enumerate(pieces) if not piece[3]]
        if bound:
            for i, piece in enumerate(pieces):
                if not piece[3]:
                    continue
                before = max((j for j in bound if j < i), default=None)
                after = min((j for j in bound if j > i), default=None)
                if before is None:
                    piece[2] = pieces[after][2]
                elif after is None or pieces[before][2] == pieces[after][2]:
                    piece[2] = pieces[before][2]
                else:
                    # A free excursion between two letters: split at its extreme.
                    run = range(before + 1, after)
                    extreme = max(run, key=lambda j: abs(pieces[j][1][1] - baseline))
                    piece[2] = pieces[before][2] if i <= extreme else pieces[after][2]
        else:
            # Detached marks (breve, dots, dashes) go to the cell of their middle.
            mids = [p[0][0] + slant * (p[0][1] - baseline) for p in pieces]
            index = cell(float(np.median(mids))) if mids else 0
            for piece in pieces:
                piece[2] = index
        current, ci = [], None
        for aa, bb, index, free in pieces:
            if ci != index:
                if ci is not None and len(current) > 1:
                    glyphs[ci].append(current)
                    # A split on a boundary is a written connection.
                    if index == ci + 1:
                        joins[ci]['exit'].append(list(aa))
                        joins[index]['entry'].append(list(aa))
                    elif index == ci - 1:
                        joins[ci]['entry'].append(list(aa))
                        joins[index]['exit'].append(list(aa))
                current, ci = [aa], index
            elif not current:
                current = [aa]
            current.append(bb)
        if ci is not None and len(current) > 1:
            glyphs[ci].append(current)
    tol = .35 / RES * 1.0
    glyphs = [[[(round(x, 3), round(y, 3)) for x, y in simplify(p, tol)] for p in strokes] for strokes in glyphs]
    joins = [{k: [[round(x, 3), round(y, 3)] for x, y in pts] for k, pts in j.items()} for j in joins]
    return glyphs, joins, int(mask.sum()), int(skel.sum())


# ---------------------------------------------------------------- review
COLORS = [(8, 160, 120), (220, 50, 60), (40, 70, 220), (180, 80, 190), (220, 140, 20), (20, 150, 200)]


def review_font(size):
    for path in ('/System/Library/Fonts/Supplemental/Arial Unicode.ttf', '/System/Library/Fonts/Supplemental/Arial.ttf',
                 '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 'C:/Windows/Fonts/arial.ttf'):
        try:
            from PIL import ImageFont
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return None


def review_image(frame, word, gray, glyphs=None, mask=None, zoom=1.0):
    b, s, xh = word['baselineOffset'], word['slant'], word['xHeight']
    top_v, bottom_v = b - 2.9 * max(xh, 3), b + 2.0 * max(xh, 3)
    arr = np.asarray(gray.convert('RGB')).astype(np.float32)
    arr = 255 - (255 - arr) * .45
    if mask is not None:
        arr[mask] = arr[mask] * .5 + np.array([255, 190, 110]) * .5
    image = Image.fromarray(arr.astype(np.uint8))
    if zoom != 1:
        image = image.resize((int(image.width * zoom), int(image.height * zoom)), Image.Resampling.LANCZOS)

    def px(u, v):
        x, y = frame.to_px(u, v)
        return x * zoom, y * zoom
    y0 = int(max(0, px(0, top_v)[1]))
    y1 = int(min(image.height, px(0, bottom_v)[1]))
    draw = ImageDraw.Draw(image)
    small, big = review_font(int(13 * max(1, zoom * .8))), review_font(int(22 * max(1, zoom * .7)))
    for v, color in ((b, (0, 150, 0)), (b - xh, (120, 200, 120))):
        y = px(0, v)[1]
        draw.line([(0, y), (image.width, y)], fill=color)
    cuts = word['cuts']
    for i, c in enumerate(cuts):
        top = px(c - s * (top_v - b), top_v)
        bottom = px(c - s * (bottom_v - b), bottom_v)
        draw.line([top, bottom], fill=(230, 0, 0) if 0 < i < len(cuts) - 1 else (255, 150, 0))
        draw.text((bottom[0] - 10, bottom[1] - 34 * max(1, zoom * .8) - (i % 2) * 16 * zoom), f'{i}:{c:.1f}',
                  fill=(200, 0, 0), font=small)
    included = word.get('include')
    dropped = set(word.get('drop', []))
    for i, char in enumerate(word['text']):
        mid = (cuts[i] + cuts[i + 1]) / 2
        x, y = px(mid - s * (top_v + .6 - b), top_v + .6)
        ok = (included is None or i in included) and i not in dropped
        draw.text((x - 6, y), char, fill=COLORS[i % len(COLORS)] if ok else (150, 150, 150), font=big)
    base_y = px(0, b)[1]
    for tick in range(int(frame.u0), int(frame.u1) + 1):
        x = px(tick, b)[0]
        draw.line([(x, base_y), (x, base_y + (5 if tick % 5 else 12) * zoom)], fill=(0, 0, 0))
        if tick % 5 == 0:
            draw.text((x + 2, base_y + 6 * zoom), str(tick), fill=(0, 0, 0), font=small)
    if glyphs:
        for index, strokes in enumerate(glyphs):
            ok = (included is None or index in included) and index not in dropped
            color = COLORS[index % len(COLORS)] if ok else (120, 120, 120)
            for stroke in strokes:
                draw.line([px(x, y) for x, y in stroke], fill=color, width=max(2, int(zoom * 1.5)))
    return image.crop((0, y0, image.width, y1))


def sheet(images, path, title_lines):
    width = max(im.width for im in images)
    height = sum(im.height + 22 for im in images)
    out = Image.new('RGB', (width, height), 'white')
    y = 0
    draw = ImageDraw.Draw(out)
    font = review_font(15)
    for im, title in zip(images, title_lines):
        draw.text((4, y + 3), title, fill=(0, 0, 0), font=font)
        out.paste(im, (0, y + 22))
        y += im.height + 22
    out.save(path)


def body_components(mask, frame, baseline, xh, u_range=None):
    """Keep ink touching the body zone of this line (drops neighbouring lines)."""
    keep = np.zeros_like(mask)
    for part in label(mask):
        r = np.array([p[0] for p in part])
        c = np.array([p[1] for p in part])
        u, v = frame.from_px(c + .5, r + .5)
        inside = np.ones(len(u), bool) if u_range is None else (u > u_range[0]) & (u < u_range[1])
        if ((v > baseline - .9 * xh) & (v < baseline + .2 * xh) & inside).any():
            keep[r, c] = True
    return keep


def frame_for(word, image, spec):
    if 'pxPerMm' not in word:
        (x0, y0), (x1, y1) = word['baseline']
        source = spec['sources'][word['photo']]
        if source.get('ruled'):
            pitch = source['cellPx']
        else:
            pitch, _ = grid_pitch(image, ((x0 + x1) / 2, (y0 + y1) / 2 - 40))
        word['pxPerMm'] = round(float(pitch) / GRID_MM, 3)
    return Frame(word)


def split_line(line, photos, spec):
    """Find the words of a reviewed line from the largest gaps along it."""
    image = photos.get(line['photo'])
    frame = frame_for(line, image, spec)
    red, _, _ = frame.sample(image)
    mask = smooth_mask(ink_mask(red))
    xh_guess = spec.get('xHeightGuess', 3.6)
    mask = body_components(mask, frame, 0.0, xh_guess, (-2.0, frame.length + 2.0))
    baseline, xh = estimate_lines(mask, frame, 0.0, xh_guess, (-2.0, frame.length + 2.0))
    mask = body_components(mask, frame, baseline, xh, (-2.0, frame.length + 2.0))
    slant = estimate_slant(mask, frame, baseline, xh)
    rows, cols = np.nonzero(mask)
    u, v = frame.from_px(cols + .5, rows + .5)
    q = u + slant * (v - baseline)
    zone = (v > baseline - 1.1 * xh) & (v < baseline + .3 * xh) & (u > -2) & (u < frame.length + 2)
    occupied = np.unique(np.round(q[zone] * 10).astype(int))
    gaps = [(b - a, a, b) for a, b in zip(occupied, occupied[1:]) if b - a > 1]
    words = line['text'].split()
    breaks = sorted(gaps, reverse=True)[:len(words) - 1]
    breaks.sort(key=lambda g: g[1])
    edges = [occupied[0]] + [x for g in breaks for x in (g[1], g[2])] + [occupied[-1]]
    found = []
    for k, text in enumerate(words):
        qa, qb = edges[2 * k] / 10, edges[2 * k + 1] / 10
        a = frame.photo(qa - .6, baseline)
        b = frame.photo(qb + .6, baseline)
        found.append({'photo': line['photo'], 'text': text, 'line': line['id'],
                      'baseline': [[int(round(a[0])), int(round(a[1]))], [int(round(b[0])), int(round(b[1]))]],
                      'lineXHeight': round(xh, 2), 'lineSlant': slant})
    gap_sizes = sorted(g[0] / 10 for g in gaps)
    smallest_break = min((g[0] / 10 for g in breaks), default=0)
    largest_inner = max((g for g in gap_sizes if g < smallest_break), default=0)
    print(f"line {line['id']}: {len(words)} words, smallest word gap {smallest_break:.1f} mm, "
          f"largest gap inside words {largest_inner:.1f} mm, xh {xh:.2f}, slant {slant:.2f}")
    return found


def prepare(word, photos, spec, propose):
    image = photos.get(word['photo'])
    frame = frame_for(word, image, spec)
    red, blue, gray = frame.sample(image)
    mask = smooth_mask(ink_mask(red, None if word.get('highlighted') else blue,
                                word.get('inkThresholds', (.45, .62))))
    if 'verticalRange' in word:
        low, high = word['verticalRange']
        ys = np.arange(mask.shape[0]) / RES + frame.v0
        mask[(ys < low) | (ys > high), :] = False
    if propose:
        line_xh = word.get('lineXHeight', spec.get('xHeightGuess', 3.6))
        letters = sum(ch.isalpha() for ch in word['text'])
        if 'baselineOffset' not in word or 'xHeight' not in word:
            b, xh = estimate_lines(body_components(mask, frame, 0.0, line_xh, (0, frame.length)), frame, 0.0, line_xh)
            # Short words have too few turning points; keep the line estimate.
            if letters < 5 or abs(xh / line_xh - 1) > .22 or abs(b) > .4 * line_xh:
                b, xh = (b if letters >= 3 and abs(b) <= .4 * line_xh else 0.0), line_xh
            word.setdefault('baselineOffset', round(b, 2))
            word.setdefault('xHeight', round(xh, 2))
        body = body_components(mask, frame, word['baselineOffset'], word['xHeight'], (0, frame.length))
        if 'slant' not in word:
            slant = estimate_slant(body, frame, word['baselineOffset'], word['xHeight'])
            if 'lineSlant' in word and (letters < 5 or abs(slant - word['lineSlant']) > .2):
                slant = word['lineSlant']
            word['slant'] = slant
        if 'cuts' not in word:
            word['cuts'] = propose_cuts(body, frame, word['text'], word['slant'], word['baselineOffset'], word['xHeight'])
    if len(word['cuts']) != len(word['text']) + 1 or any(b <= a for a, b in zip(word['cuts'], word['cuts'][1:])):
        raise ValueError(f"Invalid boundaries for {word['text']}")
    mask = select_components(mask, frame, word, word['baselineOffset'], word['xHeight'], word['slant'], word['cuts'])
    rows, cols = np.nonzero(mask)
    u, v = frame.from_px(cols + .5, rows + .5)
    q = u + word['slant'] * (v - word['baselineOffset'])
    clip = (q < word['cuts'][0] - .5) | (q > word['cuts'][-1] + .5)
    for u0, v0, u1, v1 in word.get('exclude', []):
        clip |= (u > u0) & (u < u1) & (v > v0) & (v < v1)
    mask[rows[clip], cols[clip]] = False
    return frame, mask, gray


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('command', choices=['propose', 'refine', 'trace'])
    parser.add_argument('--photos', required=True, help='Directory with decoded photos named like IMG_0839.png')
    parser.add_argument('--words', default='font/pavel-notes/notebook-words.json')
    parser.add_argument('--output', default='font/pavel-notes/notebook-strokes.json')
    parser.add_argument('--review-dir', help='Directory for review sheets')
    parser.add_argument('--only', help='Comma-separated word indexes or ranges (3-7)')
    parser.add_argument('--zoom', type=float, default=1.0, help='Review sheet magnification')
    parser.add_argument('--per-sheet', type=int, default=4)
    parser.add_argument('--unreviewed', action='store_true', help='trace: also extract words awaiting review')
    args = parser.parse_args()
    spec_path = Path(args.words)
    spec = json.loads(spec_path.read_text())
    photos = Photos(args.photos)
    review = Path(args.review_dir) if args.review_dir else None
    if review:
        review.mkdir(parents=True, exist_ok=True)
    only = None
    if args.only:
        only = set()
        for part in args.only.split(','):
            lo, _, hi = part.partition('-')
            only.update(range(int(lo), int(hi or lo) + 1))
    if args.command == 'propose':
        for index, line in enumerate(spec.get('lines', [])):
            line.setdefault('id', index)
            if not line.get('split'):
                spec['words'].extend(split_line(line, photos, spec))
                line['split'] = True
    if args.command == 'propose':
        for name, source in spec['sources'].items():
            if 'sha256' not in source:
                candidates = list(Path(args.photos).glob(name + '.HEIC')) + list(Path(args.photos).glob(name + '.heic'))
                if candidates:
                    source['sha256'] = hashlib.sha256(candidates[0].read_bytes()).hexdigest()
    images, titles, results = [], [], []
    for index, word in enumerate(spec['words']):
        if only is not None and index not in only:
            continue
        if word.get('skip'):
            continue
        if args.command == 'trace' and not word.get('reviewed') and not args.unreviewed:
            raise ValueError(f"Word needs visual review: {index} {word['text']}")
        if args.command == 'refine':
            if 'cuts' not in word:
                continue
            frame, mask, gray = prepare(word, photos, spec, False)
            old = (word['baselineOffset'], word['xHeight'])
            baseline, top, nb, nt = letter_lines(mask, frame, word)
            if baseline is not None and top is not None and abs(baseline - old[0]) < .6 * old[1]:
                word['baselineOffset'] = round(baseline, 2)
                word['xHeight'] = round(baseline - top, 2)
            print(index, word['text'], 'baseline', old[0], '->', word['baselineOffset'], 'xHeight', old[1], '->',
                  word['xHeight'], f'({nb}/{nt} letters)')
            continue
        try:
            frame, mask, gray = prepare(word, photos, spec, args.command == 'propose')
        except ValueError as error:
            if args.command == 'trace' and not args.unreviewed:
                raise
            print(index, word['text'], 'FAILED:', error)
            continue
        glyphs, joins, ink, skel = trace_word(frame, word, mask)
        if review:
            images.append(review_image(frame, word, gray, glyphs, mask, args.zoom))
            titles.append(f"{index}: {word['text']}  {word['photo']} line {word.get('line')}  ppm={word['pxPerMm']} "
                          f"b={word['baselineOffset']} xh={word['xHeight']} slant={word['slant']}")
        results.append({'index': index, 'text': word['text'], 'photo': word['photo'],
                        'xHeight': word['xHeight'], 'slant': word['slant'], 'baselineOffset': word['baselineOffset'],
                        'cuts': word['cuts'], 'glyphs': glyphs, 'joins': joins, 'inkPixels': ink, 'skeletonPixels': skel,
                        **({'role': word['role']} if 'role' in word else {}),
                        **({'include': word['include']} if 'include' in word else {}),
                        **({'reviewed': True} if word.get('reviewed') else {}),
                        **({'line': word['line']} if 'line' in word else {})})
        print(index, word['text'], sum(len(g) for g in glyphs), 'paths')
        if review and len(images) == args.per_sheet:
            sheet(images, review / f'sheet-{results[-args.per_sheet]["index"]:03}.png', titles)
            images, titles = [], []
    if review and images:
        sheet(images, review / f'sheet-{results[-len(images)]["index"]:03}.png', titles)
    if args.command in ('propose', 'refine'):
        spec_path.write_text(json.dumps(spec, ensure_ascii=False, indent=1) + '\n')
    else:
        Path(args.output).write_text(json.dumps({
            'version': 1, 'method': 'red-reflectance-skeleton-with-reviewed-boundaries',
            'unit': 'mm', 'resolution': RES, 'words': results,
        }, ensure_ascii=False, separators=(',', ':')) + '\n')


if __name__ == '__main__':
    main()
