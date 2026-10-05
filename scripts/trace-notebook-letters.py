#!/usr/bin/env python3
"""Trace reviewed letters from notebook photographs into GFont letter forms.

Input: font/pavel-notes/notebook-letter-words.json. Each word stores its
photo, two baseline points (upright photo pixels), the photo scale, the
reviewed character cells and the cut points on the written trajectory
between neighbouring letters. Only letters listed in "accept" are written.

  trace   photos -> font/pavel-notes/notebook-letters.json
  sheets  contact sheets of the traced letters, one image per character

The ink is separated by red-light reflectance against the local paper. The
centre line comes from a thinned mask: junctions are paired by good
continuation, retrace cusps (the pen runs down and back up the same ink) are
followed out and back, and short thinning spurs are removed. Cuts split the
trajectory, so a connection belongs to the letters it joins. Letters are
scaled by the x-height of their word to a body of 200 GFont units and
sheared once per word to the writer's median slant.

Requires Python 3 with NumPy, Pillow and OpenCV (opencv-python).
Photos stay outside the repository.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps

RES = 20.0            # working resolution, pixels per millimetre
BODY = 200.0          # GFont units of the x-height
SMOOTH_MM = 0.11      # Gaussian smoothing of the exported centre line
SIMPLIFY = 0.35       # RDP tolerance in GFont units (0.007 mm at 3.7 mm x-height)


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
            self.cache[name] = np.asarray(image)
        return self.cache[name]


class Frame:
    """Word frame: u along the baseline, v down, in millimetres."""

    def __init__(self, word, u0=-3.0, v0=-11.0, v1=7.0, res=RES):
        (x0, y0), (x1, y1) = word['baseline']
        self.origin = np.array([x0, y0], float)
        d = np.array([x1 - x0, y1 - y0], float)
        self.eu = d / np.hypot(*d)
        self.ev = np.array([-self.eu[1], self.eu[0]])
        self.ppm = float(word['pxPerMm'])
        self.length = np.hypot(*d) / self.ppm
        self.u0, self.u1 = u0, self.length + 3.0
        self.v0, self.v1, self.res = v0, v1, res
        self.w = int(round((self.u1 - self.u0) * res))
        self.h = int(round((self.v1 - self.v0) * res))

    def to_img(self, u, v):
        u = np.asarray(u, float)
        v = np.asarray(v, float)
        return (self.origin[0] + u * self.ppm * self.eu[0] + v * self.ppm * self.ev[0],
                self.origin[1] + u * self.ppm * self.eu[1] + v * self.ppm * self.ev[1])

    def mm(self, x, y):
        return np.asarray(x) / self.res + self.u0, np.asarray(y) / self.res + self.v0

    def sample(self, image):
        jj, ii = np.meshgrid(np.arange(self.w) + .5, np.arange(self.h) + .5)
        u, v = self.mm(jj, ii)
        x, y = self.to_img(u, v)
        scale = self.ppm / self.res
        if scale > 1.25:
            # Low-pass before resampling to avoid aliasing at the working resolution.
            x0, x1 = int(max(0, x.min() - 20)), int(min(image.shape[1], x.max() + 20))
            y0, y1 = int(max(0, y.min() - 20)), int(min(image.shape[0], y.max() + 20))
            sub = cv2.GaussianBlur(image[y0:y1, x0:x1].astype(np.float32), (0, 0), .42 * scale)
            return cv2.remap(sub, (x - x0 - .5).astype(np.float32), (y - y0 - .5).astype(np.float32),
                             cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        return cv2.remap(image.astype(np.float32), (x - .5).astype(np.float32), (y - .5).astype(np.float32),
                         cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)


def reflectance(rgb, res=RES):
    """Per-channel reflectance against a local paper estimate."""
    k = int(round(res * 1.4)) | 1
    out = np.empty_like(rgb)
    for c in range(3):
        channel = rgb[:, :, c]
        paper = cv2.GaussianBlur(cv2.dilate(channel, np.ones((k, k), np.uint8)), (0, 0), res * 1.2)
        out[:, :, c] = channel / np.maximum(paper, 1)
    return np.clip(out, 0, 1.3)


def ink_mask(rgb, level=0.42):
    """Blue ballpoint ink: thresholds between the ink core and the paper, so
    dark blurred ink does not merge strokes and pale ink stays connected.
    The blue/red separation rejects the grid and grey show-through."""
    r = reflectance(rgb)
    red, blue = r[:, :, 0], r[:, :, 2]
    rough = red < 0.7
    core = float(np.percentile(red[rough], 12)) if rough.sum() > 50 else 0.25
    strong = red < core + 0.22 * (1 - core)
    weak = (red < core + level * (1 - core)) & ((blue - red > 0.06) | strong)
    n, labels, _, _ = cv2.connectedComponentsWithStats(weak.astype(np.uint8), connectivity=8)
    keep = np.bincount(labels.ravel(), weights=strong.ravel().astype(float), minlength=n) >= 4
    keep[0] = False
    mask = keep[labels]
    return cv2.morphologyEx(mask.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8)).astype(bool)


def body_mask(mask, frame, word, marks):
    """Ink connected to this word's body zone; detached accents are kept."""
    b, xh, slant = word['baselineOffset'], word['xHeight'], word['slant']
    qa, qb = word['cuts'][0], word['cuts'][-1]
    n, labels = cv2.connectedComponents(mask.astype(np.uint8), connectivity=8)
    jj, ii = np.meshgrid(np.arange(frame.w) + .5, np.arange(frame.h) + .5)
    u, v = frame.mm(jj, ii)
    q = u + slant * (v - b)
    zone = (v > b - 0.95 * xh) & (v < b + 0.2 * xh) & (q > qa - .3) & (q < qb + .3) & mask
    keep = np.zeros(n, bool)
    keep[np.unique(labels[zone])] = True
    if marks:
        for c in range(1, n):
            if keep[c]:
                continue
            sel = labels == c
            vv, qq = v[sel], q[sel]
            if (vv.max() - vv.min() < 1.6 and qq.max() - qq.min() < 1.8 and vv.min() > b - 2.9 * xh
                    and vv.max() < b - 0.55 * xh and qq.min() > qa - .2 and qq.max() < qb + .2):
                keep[c] = True
    keep[0] = False
    return keep[labels] & (q > qa - 1.0) & (q < qb + 1.0)


# ---------------------------------------------------------------- centre lines
def thin(mask):
    """Zhang-Suen thinning."""
    a = np.pad(mask.astype(np.uint8), 1)
    for _ in range(300):
        changed = False
        for phase in (0, 1):
            p = [a[:-2, 1:-1], a[:-2, 2:], a[1:-1, 2:], a[2:, 2:], a[2:, 1:-1], a[2:, :-2], a[1:-1, :-2], a[:-2, :-2]]
            count = sum(x.astype(np.int16) for x in p)
            transitions = sum(((p[i] == 0) & (p[(i + 1) % 8] == 1)).astype(np.int16) for i in range(8))
            if phase == 0:
                constraint = (p[0] * p[2] * p[4] == 0) & (p[2] * p[4] * p[6] == 0)
            else:
                constraint = (p[0] * p[2] * p[6] == 0) & (p[0] * p[4] * p[6] == 0)
            remove = (a[1:-1, 1:-1] > 0) & (count >= 2) & (count <= 6) & (transitions == 1) & constraint
            if remove.any():
                a[1:-1, 1:-1][remove] = 0
                changed = True
        if not changed:
            break
    return a[1:-1, 1:-1] > 0


N8 = [(-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1)]


def neighbours(pixels, p):
    r, c = p
    out = []
    for dr, dc in N8:
        q = (r + dr, c + dc)
        if q not in pixels:
            continue
        if dr and dc and ((r + dr, c) in pixels or (r, c + dc) in pixels):
            continue
        out.append(q)
    return out


class Graph:
    """Skeleton graph: clustered junctions, end points and the paths between them."""

    def __init__(self, skeleton, width_px):
        self.pts = set(zip(*np.nonzero(skeleton)))
        self.adj = {p: neighbours(self.pts, p) for p in self.pts}
        self.w = width_px
        self.build()

    def build(self):
        adj = self.adj
        junction_px = [p for p, n in adj.items() if len(n) >= 3]
        end_px = [p for p, n in adj.items() if len(n) == 1]
        radius = max(2.0, 0.45 * self.w)
        parent = {p: p for p in junction_px}

        def find(p):
            while parent[p] != p:
                parent[p] = parent[parent[p]]
                p = parent[p]
            return p
        jp = np.array(junction_px) if junction_px else np.zeros((0, 2))
        for i in range(len(jp)):
            d = np.hypot(*(jp[i + 1:] - jp[i]).T) if i + 1 < len(jp) else []
            for k in np.nonzero(np.asarray(d) <= radius)[0]:
                a, b = find(tuple(jp[i])), find(tuple(jp[i + 1 + k]))
                if a != b:
                    parent[a] = b
        clusters = {}
        for p in junction_px:
            clusters.setdefault(find(p), []).append(p)
        self.nodes, self.node_of = [], {}
        for pixels in clusters.values():
            for p in pixels:
                self.node_of[p] = len(self.nodes)
            self.nodes.append({'center': np.array(pixels, float).mean(0), 'pixels': pixels, 'kind': 'junction'})
        for p in end_px:
            self.node_of[p] = len(self.nodes)
            self.nodes.append({'center': np.array(p, float), 'pixels': [p], 'kind': 'end'})
        self.edges = []
        visited = set()
        for idx, node in enumerate(self.nodes):
            for p in node['pixels']:
                for q in adj[p]:
                    if q in self.node_of and self.node_of[q] == idx:
                        continue
                    if (p, q) in visited:
                        continue
                    path = [p, q]
                    visited.add((p, q))
                    visited.add((q, p))
                    prev, cur = p, q
                    while cur not in self.node_of:
                        nxt = [n for n in adj[cur] if n != prev]
                        if not nxt:
                            break
                        n = nxt[0]
                        visited.add((cur, n))
                        visited.add((n, cur))
                        path.append(n)
                        prev, cur = cur, n
                    b = self.node_of.get(cur)
                    if b is not None:
                        self.edges.append({'a': idx, 'b': b, 'path': path})
        seen, unique = set(), []
        for e in self.edges:
            inner = tuple(sorted(e['path'][1:-1])) if len(e['path']) > 2 else (tuple(sorted(e['path'])),)
            key = (min(e['a'], e['b']), max(e['a'], e['b']), inner)
            if key not in seen:
                seen.add(key)
                unique.append(e)
        self.edges = unique
        used = set()
        for e in self.edges:
            used.update(e['path'])
        for p in self.pts:
            if p in used or p in self.node_of or len(adj[p]) != 2:
                continue
            loop = [p]
            used.add(p)
            prev, cur = p, adj[p][0]
            while cur != p and cur not in used:
                loop.append(cur)
                used.add(cur)
                nxt = [n for n in adj[cur] if n != prev]
                if not nxt:
                    break
                prev, cur = cur, nxt[0]
            if len(loop) > 6:
                idx = len(self.nodes)
                self.nodes.append({'center': np.array(p, float), 'pixels': [p], 'kind': 'loop'})
                self.edges.append({'a': idx, 'b': idx, 'path': loop + [p]})

    def degree(self, n):
        return sum((e['a'] == n) + (e['b'] == n) for e in self.edges)

    def prune(self, spur_px):
        changed = True
        while changed:
            changed = False
            for e in list(self.edges):
                a, b = e['a'], e['b']
                ka, kb = self.nodes[a]['kind'], self.nodes[b]['kind']
                if len(e['path']) > spur_px:
                    continue
                if (ka == 'end' and kb == 'junction' and self.degree(b) >= 3) or \
                   (kb == 'end' and ka == 'junction' and self.degree(a) >= 3):
                    self.edges.remove(e)
                    changed = True
            for e in list(self.edges):
                if self.nodes[e['a']]['kind'] == 'end' and self.nodes[e['b']]['kind'] == 'end' and len(e['path']) < spur_px * .6:
                    self.edges.remove(e)
                    changed = True

    def merge_bridges(self, bridge_px):
        changed = True
        while changed:
            changed = False
            for e in list(self.edges):
                a, b = e['a'], e['b']
                if a == b:
                    continue
                if self.nodes[a]['kind'] == 'junction' and self.nodes[b]['kind'] == 'junction' and len(e['path']) <= bridge_px:
                    self.edges.remove(e)
                    na, nb = self.nodes[a], self.nodes[b]
                    na['pixels'] = na['pixels'] + nb['pixels'] + e['path']
                    na['center'] = (na['center'] + nb['center']) / 2
                    nb['kind'] = 'merged'
                    for f in self.edges:
                        if f['a'] == b:
                            f['a'] = a
                        if f['b'] == b:
                            f['b'] = a
                    changed = True
                    break


def end_direction(pts, from_start, near, far):
    pts = pts if from_start else pts[::-1]
    cum = np.r_[0, np.cumsum(np.hypot(*np.diff(pts, axis=0).T))]
    total = cum[-1]
    if total < 1e-6:
        return np.array([1.0, 0.0])
    a = np.interp(min(near, total * .4), cum, np.arange(len(pts)))
    b = np.interp(min(far, total * .8), cum, np.arange(len(pts)))
    pa = pts[int(a)] + (pts[min(len(pts) - 1, int(a) + 1)] - pts[int(a)]) * (a - int(a))
    pb = pts[int(b)] + (pts[min(len(pts) - 1, int(b) + 1)] - pts[int(b)]) * (b - int(b))
    d = pb - pa
    n = np.hypot(*d)
    return d / n if n > 1e-9 else np.array([1.0, 0.0])


def hermite(p0, t0, p1, t1, n=12):
    d = np.hypot(*(p1 - p0))
    s = np.linspace(0, 1, n)[:, None]
    return ((2 * s ** 3 - 3 * s ** 2 + 1) * p0 + (s ** 3 - 2 * s ** 2 + s) * t0 * d
            + (-2 * s ** 3 + 3 * s ** 2) * p1 + (s ** 3 - s ** 2) * t1 * d)


def smooth_path(pts, sigma_mm, step):
    """Resample a polyline (mm) and smooth it; the end points stay fixed."""
    pts = np.asarray(pts, float)
    if len(pts) < 2:
        return pts
    cum = np.r_[0, np.cumsum(np.hypot(*np.diff(pts, axis=0).T))]
    total = cum[-1]
    if total < 1e-6:
        return pts[:1]
    n = max(2, int(math.ceil(total / step)) + 1)
    s = np.linspace(0, total, n)
    x, y = np.interp(s, cum, pts[:, 0]), np.interp(s, cum, pts[:, 1])
    sigma = sigma_mm / (total / (n - 1))
    radius = int(math.ceil(3 * sigma))
    if radius >= 1:
        kernel = np.exp(-0.5 * (np.arange(-radius, radius + 1) / sigma) ** 2)
        kernel /= kernel.sum()
        x = np.convolve(np.pad(x, radius, mode='reflect', reflect_type='odd'), kernel, 'valid')
        y = np.convolve(np.pad(y, radius, mode='reflect', reflect_type='odd'), kernel, 'valid')
    return np.stack([x, y], 1)


def centre_lines(mask, frame, max_turn=70, spur=1.6, cusp_len=3.2):
    """Strokes in millimetres, the junctions each stroke passes and the junction centres."""
    holes = (~mask).astype(np.uint8)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(holes, connectivity=4)
    small = np.zeros(n, bool)
    small[1:] = stats[1:, cv2.CC_STAT_AREA] < 0.06 * frame.res ** 2
    mask = mask | small[labels]
    dist = cv2.distanceTransform(mask.astype(np.uint8), cv2.DIST_L2, 5)
    skeleton = thin(mask)
    w = 2.0 * float(np.median(dist[skeleton])) if skeleton.any() else 8.0
    g = Graph(skeleton, w)
    g.prune(max(4, int(spur * w)))
    g.merge_bridges(max(3, int(0.9 * w)))
    g.prune(max(4, int(spur * w)))
    to_mm = lambda path: np.array([frame.mm(c + .5, r + .5) for r, c in path], float)
    edges = [{'a': e['a'], 'b': e['b'], 'pts': to_mm(e['path'])} for e in g.edges
             if g.nodes[e['a']]['kind'] != 'merged' and g.nodes[e['b']]['kind'] != 'merged']
    wmm = w / frame.res
    centre = lambda node: np.array(frame.mm(g.nodes[node]['center'][1] + .5, g.nodes[node]['center'][0] + .5))
    ends = {}
    for i, e in enumerate(edges):
        for side, node in ((0, e['a']), (1, e['b'])):
            ends.setdefault(node, []).append((i, side))
    pair, cusp = {}, {}
    for node, items in ends.items():
        if g.nodes[node]['kind'] != 'junction' or len(items) < 2:
            continue
        dirs = [end_direction(edges[i]['pts'], side == 0, 0.9 * wmm, 2.4 * wmm) for i, side in items]
        candidates = []
        for x in range(len(items)):
            for y in range(x + 1, len(items)):
                if items[x][0] == items[y][0] and len(edges[items[x][0]]['pts']) < 6:
                    continue
                turn = math.degrees(math.acos(max(-1, min(1, -float(dirs[x] @ dirs[y])))))
                candidates.append((turn, x, y))
        candidates.sort()
        taken = set()
        if len(items) == 3:
            # Retrace cusp: the pen runs to a point and back along the same ink,
            # so thinning leaves a short dead end between two branches that
            # leave the junction side by side. Follow it out and back.
            for sp in range(3):
                i_sp, side_sp = items[sp]
                other = edges[i_sp]['b'] if side_sp == 0 else edges[i_sp]['a']
                length = float(np.hypot(*np.diff(edges[i_sp]['pts'], axis=0).T).sum())
                if g.nodes[other]['kind'] != 'end' or length > cusp_len * wmm:
                    continue
                x, y = [k for k in range(3) if k != sp]
                if float(dirs[x] @ dirs[y]) < math.cos(math.radians(80)):
                    continue
                bisector = dirs[x] + dirs[y]
                bisector = bisector / max(1e-9, float(np.hypot(*bisector)))
                if float(dirs[sp] @ bisector) > -0.3:
                    continue
                cusp[items[x]] = (items[y], items[sp])
                cusp[items[y]] = (items[x], items[sp])
                taken.update((x, y, sp))
                break
        for turn, x, y in candidates:
            if turn > max_turn or x in taken or y in taken:
                continue
            taken.update((x, y))
            pair[items[x]] = items[y]
            pair[items[y]] = items[x]
    radius = 1.0 * wmm

    def trim_end(pts, c):
        k = len(pts)
        while k > 2 and np.hypot(*(pts[k - 1] - c)) < radius:
            k -= 1
        return pts[:k]

    used = set()
    spur_edges = {v[1][0] for v in cusp.values()}
    starts = [it for it in ((i, s) for i in range(len(edges)) for s in (0, 1))
              if it not in pair and it not in cusp and it[0] not in spur_edges]
    starts.sort(key=lambda it: edges[it[0]]['pts'][0 if it[1] == 0 else -1][0])

    def walk(start):
        i, side = start
        out = []
        nodes = [edges[i]['a'] if side == 0 else edges[i]['b']]
        while i not in used:
            used.add(i)
            pts = edges[i]['pts'] if side == 0 else edges[i]['pts'][::-1]
            end_item = (i, 1 - side)
            node = edges[i]['b'] if side == 0 else edges[i]['a']
            nodes.append(node)
            if end_item in cusp and cusp[end_item][0][0] not in used and cusp[end_item][1][0] not in used:
                (j, js), (k_sp, ks) = cusp[end_item]
                tip = edges[k_sp]['pts'] if ks == 0 else edges[k_sp]['pts'][::-1]
                used.add(k_sp)
                out.extend(list(pts if not out else pts[1:]))
                out.extend(list(tip[1:]))
                out.extend(list(tip[::-1][1:]))
                npts = edges[j]['pts'] if js == 0 else edges[j]['pts'][::-1]
                edges[j]['pts'] = npts[1:] if js == 0 else npts[1:][::-1]
                i, side = j, js
                continue
            nxt = pair.get(end_item)
            if nxt is not None and nxt[0] not in used:
                c = centre(node)
                body = trim_end(pts, c)
                if out:
                    body = body[1:] if len(body) > 1 else body
                out.extend(list(body))
                j, js = nxt
                npts = edges[j]['pts'] if js == 0 else edges[j]['pts'][::-1]
                k = 0
                while k < len(npts) - 2 and np.hypot(*(npts[k] - c)) < radius:
                    k += 1
                tail = np.array(out[-6:] if len(out) >= 6 else out)[::-1]
                t0 = -end_direction(tail, True, 0.0, 10)
                t1 = end_direction(npts[k:], True, 0.0, 0.6 * wmm)
                out.extend(list(hermite(np.array(out[-1]), t0, npts[k], t1)[1:-1]))
                trimmed = npts[k:]
                edges[j]['pts'] = trimmed if js == 0 else trimmed[::-1]
                i, side = j, js
                continue
            out.extend(list(pts if not out else pts[1:]))
            break
        return np.array(out), nodes

    strokes, node_sets = [], []
    for start in starts:
        if start[0] in used:
            continue
        s, nodes = walk(start)
        if len(s) > 1:
            strokes.append(s)
            node_sets.append(nodes)
    for i in range(len(edges)):
        if i not in used:
            s, nodes = walk((i, 0))
            if len(s) > 1:
                strokes.append(s)
                node_sets.append(nodes)
    centres = {k: centre(k) for k in range(len(g.nodes))}
    return [smooth_path(s, 0.06, 0.04) for s in strokes], node_sets, centres


# ---------------------------------------------------------------- letters
class Piece:
    def __init__(self, pts, stroke, start_cut, end_cut, nodes):
        self.pts, self.stroke = pts, stroke
        self.start_cut, self.end_cut = start_cut, end_cut
        self.nodes = set(nodes)
        self.letter = None


def nearest(stroke, p):
    d = np.hypot(*(stroke - p).T)
    i = int(np.argmin(d))
    return i, float(d[i])


def segment(strokes, node_sets, centres, cut_points, slant, cells, max_dist=0.5):
    """Split strokes at the cut points and assign every piece to a letter.

    Cut k separates letters k-1 and k. A piece between two cuts belongs to
    the letter between them; other pieces follow the junctions they share,
    or the reviewed character cell of their middle."""
    n_letters = len(cells) - 1
    attach = {}
    for k, c in enumerate(cut_points, start=1):
        if c is None:
            continue
        p = np.array(c[:2], float)
        best = None
        for s, st in enumerate(strokes):
            i, d = nearest(st, p)
            if best is None or d < best[2]:
                best = (s, i, d)
        if best is None or best[2] > max_dist:
            continue
        attach.setdefault(best[0], []).append((best[1], k))
    pieces = []
    for s, st in enumerate(strokes):
        node_pos = [(nearest(st, centres[n])[0], n) for n in node_sets[s] if n in centres]
        cs = sorted(attach.get(s, []))
        if len(cs) >= 2:
            ks = [k for _, k in cs]
            if ks != sorted(ks) and ks == sorted(ks, reverse=True):
                st = st[::-1].copy()
                last = len(st) - 1
                cs = sorted((last - i, k) for i, k in cs)
                node_pos = [(last - j, n) for j, n in node_pos]
        bounds = [0] + [i for i, _ in cs] + [len(st) - 1]
        labels = [None] + [k for _, k in cs] + [None]
        for t in range(len(bounds) - 1):
            a, b = bounds[t], bounds[t + 1]
            if b - a < 1:
                continue
            pieces.append(Piece(st[a:b + 1], s, labels[t], labels[t + 1], [n for j, n in node_pos if a <= j <= b]))
    q_of = lambda pts: pts[:, 0] + slant * pts[:, 1]
    cell = lambda q: int(max(0, min(n_letters - 1, np.searchsorted(cells, q) - 1)))
    for pc in pieces:
        if pc.start_cut is not None and pc.end_cut is not None:
            if abs(pc.end_cut - pc.start_cut) == 1:
                pc.letter = min(pc.start_cut, pc.end_cut)
        elif pc.start_cut is not None or pc.end_cut is not None:
            k = pc.start_cut if pc.start_cut is not None else pc.end_cut
            pc.letter = k if cell(float(np.median(q_of(pc.pts)))) >= k else k - 1
    # A stroke cut once: the half further along the writing belongs to the next letter.
    by_stroke = {}
    for pc in pieces:
        by_stroke.setdefault(pc.stroke, []).append(pc)
    for group in by_stroke.values():
        if len(group) != 2:
            continue
        a, b = group
        if a.end_cut is None or a.end_cut != b.start_cut or a.start_cut is not None or b.end_cut is not None:
            continue
        k = a.end_cut
        qa, qb = float(np.median(q_of(a.pts))), float(np.median(q_of(b.pts)))
        a.letter, b.letter = (k - 1, k) if qa <= qb else (k, k - 1)
    parent = list(range(len(pieces)))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    owner = {}
    for idx, pc in enumerate(pieces):
        for n in pc.nodes:
            if n in owner:
                a, b = find(idx), find(owner[n])
                if a != b:
                    parent[a] = b
            else:
                owner[n] = idx
    groups = {}
    for idx in range(len(pieces)):
        groups.setdefault(find(idx), []).append(idx)
    for members in groups.values():
        letters = {pieces[i].letter for i in members if pieces[i].letter is not None}
        for i in members:
            if pieces[i].letter is None:
                pieces[i].letter = next(iter(letters)) if len(letters) == 1 else cell(float(np.mean(q_of(pieces[i].pts))))
    letters = [[] for _ in range(n_letters)]
    for pc in pieces:
        if pc.letter is not None and 0 <= pc.letter < n_letters:
            letters[pc.letter].append(pc)
    return letters


def fit_baseline(strokes, guess, xh, window=0.45, edge=0.25):
    """Line through the lowest turning points of the centre lines."""
    pts = []
    for st in strokes:
        if len(st) < 5:
            continue
        cum = np.r_[0, np.cumsum(np.hypot(*np.diff(st, axis=0).T))]
        last = None
        for i in range(len(st)):
            if cum[i] < edge or cum[-1] - cum[i] < edge:
                continue
            lo, hi = np.searchsorted(cum, cum[i] - window), np.searchsorted(cum, cum[i] + window)
            if st[i, 1] >= st[lo:hi + 1, 1].max() - 1e-9:
                if last is not None and abs(cum[last] - cum[i]) < window:
                    continue
                last = i
                if guess - 0.9 * xh < st[i, 1] < guess + 0.9 * xh:
                    pts.append(st[i])
    pts = np.array(pts)
    if len(pts) < 3:
        return guess, 0.0
    keep = np.ones(len(pts), bool)
    coef = np.array([guess, 0.0])
    for _ in range(6):
        coef, *_ = np.linalg.lstsq(np.c_[np.ones(keep.sum()), pts[keep, 0]], pts[keep, 1], rcond=None)
        residual = pts[:, 1] - (coef[0] + coef[1] * pts[:, 0])
        new = np.abs(residual) < max(0.35, 2.0 * np.median(np.abs(residual[keep])))
        if (new == keep).all():
            break
        keep = new
        if keep.sum() < 3:
            break
    return float(coef[0]), float(coef[1])


def chain(pieces, tolerance=0.15, max_turn=75):
    """Join uncut pieces whose ends meet into longer strokes."""
    items = [dict(p) for p in pieces]
    changed = True
    while changed:
        changed = False
        for a in range(len(items)):
            for b in range(len(items)):
                if a == b:
                    continue
                A, B = items[a], items[b]
                for reverse in (False, True):
                    bp = B['pts'][::-1] if reverse else B['pts']
                    b_start, b_end = (B['end'], B['start']) if reverse else (B['start'], B['end'])
                    if A['end'] is not None or b_start is not None:
                        continue
                    if np.hypot(*(A['pts'][-1] - bp[0])) > tolerance:
                        continue
                    ta = A['pts'][-1] - A['pts'][max(0, len(A['pts']) - 6)]
                    tb = bp[min(len(bp) - 1, 5)] - bp[0]
                    na, nb = np.hypot(*ta), np.hypot(*tb)
                    if na < 1e-6 or nb < 1e-6:
                        continue
                    if math.degrees(math.acos(max(-1, min(1, float(ta @ tb) / na / nb)))) > max_turn:
                        continue
                    A['pts'] = np.vstack([A['pts'], bp[1:]])
                    A['end'] = b_end
                    items.pop(b)
                    changed = True
                    break
                if changed:
                    break
            if changed:
                break
    return items


def letter_strokes(pieces, k):
    """Pen order: the entry stroke first, the exit stroke last, the rest left to right."""
    pieces = [{'pts': pc.pts, 'start': pc.start_cut, 'end': pc.end_cut} for pc in pieces]
    if not pieces:
        return None
    for p in pieces:
        if p['end'] == k and p['start'] != k:
            p['pts'], p['start'], p['end'] = p['pts'][::-1], p['end'], p['start']
        if p['start'] == k + 1 and p['end'] != k + 1:
            p['pts'], p['start'], p['end'] = p['pts'][::-1], p['end'], p['start']
    pieces = chain(pieces)
    entry = next((p for p in pieces if p['start'] == k), None)
    exit_ = next((p for p in pieces if p['end'] == k + 1), None)
    others = [p for p in pieces if p is not entry and p is not exit_]
    for p in others:
        a, b = p['pts'][0], p['pts'][-1]
        if abs(a[0] - b[0]) > abs(a[1] - b[1]) * .5:
            if a[0] > b[0]:
                p['pts'] = p['pts'][::-1]
        elif a[1] > b[1]:
            p['pts'] = p['pts'][::-1]
    others.sort(key=lambda p: float(p['pts'][:, 0].mean()))
    order = ([entry] if entry else []) + others + ([exit_] if exit_ and exit_ is not entry else [])
    return order, entry is not None, exit_ is not None


def rdp(points, tolerance):
    points = np.asarray(points)
    if len(points) < 3:
        return points
    keep = np.zeros(len(points), bool)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1:
            continue
        p, d = points[a], points[b] - points[a]
        dd = float(d @ d)
        seg = points[a + 1:b]
        if dd < 1e-12:
            dist = np.hypot(*(seg - p).T)
        else:
            t = np.clip(((seg - p) @ d) / dd, 0, 1)
            dist = np.hypot(*(seg - (p + t[:, None] * d)).T)
        i = int(np.argmax(dist))
        if dist[i] > tolerance:
            keep[a + 1 + i] = True
            stack += [(a, a + 1 + i), (a + 1 + i, b)]
    return points[keep]


def trace_word(word, photos, target_slant):
    frame = Frame(word)
    mask = ink_mask(frame.sample(photos.get(word['photo'])))
    marks = any(ch in 'йЙёЁ:;!?і' for ch in word['text'])
    strokes, node_sets, centres = centre_lines(body_mask(mask, frame, word, marks), frame)
    keep = [i for i, st in enumerate(strokes) if np.hypot(*np.diff(st, axis=0).T).sum() > (0.12 if marks else 0.25)]
    strokes = [strokes[i] for i in keep]
    node_sets = [node_sets[i] for i in keep]
    cuts = word['cutPoints']
    letters = segment(strokes, node_sets, centres, cuts, word['slant'], np.array(word['cuts']))
    b0, tilt = fit_baseline(strokes, word['baselineOffset'], word['xHeight'])
    units = BODY / word['xHeightUsed']
    shear = target_slant - word['slant']
    text = word['text']
    geometry = [letter_strokes(letters[k], k) for k in range(len(text))]
    origins, rights = [], []
    for k in range(len(text)):
        if geometry[k] is None:
            origins.append(None)
            rights.append(None)
            continue
        pts = np.concatenate([p['pts'] for p in geometry[k][0]])
        cut = cuts[k - 1] if k >= 1 else None
        origins.append(cut[0] if cut else float(pts[:, 0].min()))
        rights.append(float(pts[:, 0].max()))
    out = []
    for k in word['accept']:
        if geometry[k] is None:
            continue
        order, has_entry, has_exit = geometry[k]
        o = origins[k]
        exit_cut = cuts[k] if k < len(cuts) else None
        if exit_cut:
            advance = exit_cut[0] - o
        elif k + 1 < len(text) and origins[k + 1] is not None:
            advance = origins[k + 1] - o
        else:
            advance = rights[k] - o
        strokes_out = []
        for p in order:
            pts = smooth_path(p['pts'], SMOOTH_MM, 0.03) if len(p['pts']) > 3 else p['pts']
            base = b0 + tilt * pts[:, 0]
            xy = np.stack([(pts[:, 0] - o - shear * (pts[:, 1] - base)) * units, (pts[:, 1] - base) * units], 1)
            strokes_out.append([[round(float(x), 1), round(float(y), 1)] for x, y in rdp(xy, SIMPLIFY)])
        exit_stroke = next((n for n, p in enumerate(order) if p['end'] == k + 1), None)
        isletter = lambda c: bool(c) and c.isalpha()
        out.append({
            'char': text[k], 'source': f"{word['id']}:{k}", 'photo': word['photo'],
            'before': text[k - 1] if k and isletter(text[k - 1]) else '',
            'after': text[k + 1] if k + 1 < len(text) and isletter(text[k + 1]) else '',
            'advance': round(float(advance * units), 1), 'entry': has_entry, 'exit': has_exit,
            **({'exitStroke': exit_stroke} if has_exit and exit_stroke is not None else {}),
            'strokes': strokes_out,
        })
    return out


# ---------------------------------------------------------------- review
def review_font(size):
    for path in ('/System/Library/Fonts/Supplemental/Arial Unicode.ttf', '/System/Library/Fonts/Supplemental/Arial.ttf',
                 '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 'C:/Windows/Fonts/arial.ttf'):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def sheets(letters, directory, per_row=14, scale=0.19):
    directory.mkdir(parents=True, exist_ok=True)
    by_char = {}
    for item in letters:
        by_char.setdefault(item['char'], []).append(item)
    font = review_font(11)
    for char, items in sorted(by_char.items()):
        cw, chh = 112, 140
        rows = math.ceil(len(items) / per_row)
        image = Image.new('RGB', (per_row * cw, rows * chh), 'white')
        draw = ImageDraw.Draw(image)
        for n, item in enumerate(items):
            x0, y0 = (n % per_row) * cw, (n // per_row) * chh
            ox, oy = x0 + 24, y0 + 95
            draw.rectangle([x0, y0, x0 + cw - 1, y0 + chh - 1], outline=(205, 205, 205))
            draw.line([(x0 + 2, oy), (x0 + cw - 3, oy)], fill=(170, 210, 170))
            draw.line([(x0 + 2, oy - BODY * scale), (x0 + cw - 3, oy - BODY * scale)], fill=(228, 238, 228))
            for stroke in item['strokes']:
                draw.line([(ox + x * scale, oy + y * scale) for x, y in stroke], fill=(25, 35, 110), width=2)
            draw.text((x0 + 3, y0 + 2), item['source'], fill=(200, 0, 0), font=font)
        image.save(directory / f'letters-{ord(char):05d}.png')


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('command', choices=['trace', 'sheets'])
    parser.add_argument('--photos', help='Directory with decoded photos named like IMG_0839.png')
    parser.add_argument('--words', default='font/pavel-notes/notebook-letter-words.json')
    parser.add_argument('--output', default='font/pavel-notes/notebook-letters.json')
    parser.add_argument('--review-dir', default='notebook-letter-review')
    args = parser.parse_args()
    if args.command == 'sheets':
        sheets(json.loads(Path(args.output).read_text())['letters'], Path(args.review_dir))
        return
    if not args.photos:
        parser.error('trace needs --photos')
    spec = json.loads(Path(args.words).read_text())
    photos = Photos(args.photos)
    for name, source in spec['sources'].items():
        heic = [p for p in Path(args.photos).iterdir() if p.stem == name and p.suffix.lower() == '.heic']
        if heic and hashlib.sha256(heic[0].read_bytes()).hexdigest() != source['sha256']:
            raise ValueError(f'{name}: the photo differs from the reviewed source')
    letters = []
    for word in spec['words']:
        if word.get('accept'):
            letters.extend(trace_word(word, photos, spec['targetSlant']))
            print(word['id'], word['text'], len(word['accept']), 'letters', flush=True)
    Path(args.output).write_text(json.dumps({
        'version': 1, 'unit': 'gfont', 'bodyHeight': BODY,
        'method': 'notebook-centre-lines-cut-on-the-trajectory',
        'targetSlant': spec['targetSlant'], 'sources': spec['sources'],
        'letters': letters,
    }, ensure_ascii=False, separators=(',', ':')) + '\n')
    print(len(letters), 'letters')


if __name__ == '__main__':
    main()
