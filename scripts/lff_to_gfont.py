from __future__ import annotations

import argparse
import math
import re
import struct
import zipfile
from pathlib import Path


GLYPH_RE = re.compile(r"^\[([0-9A-Fa-f]{4,6})\]")
COPY_RE = re.compile(r"^C([0-9A-Fa-f]{4,6})$")


def arc_points(start, end, bulge, max_step=math.pi / 18):
    if abs(bulge) < 1e-9:
        return [end]
    dx, dy = end[0] - start[0], end[1] - start[1]
    chord = math.hypot(dx, dy)
    if chord < 1e-9:
        return [end]
    theta = 4 * math.atan(bulge)
    offset = chord * (1 - bulge * bulge) / (4 * bulge)
    middle = ((start[0] + end[0]) / 2, (start[1] + end[1]) / 2)
    center = (middle[0] - dy / chord * offset, middle[1] + dx / chord * offset)
    radius = math.hypot(start[0] - center[0], start[1] - center[1])
    start_angle = math.atan2(start[1] - center[1], start[0] - center[0])
    steps = max(2, math.ceil(abs(theta) / max_step))
    return [
        (center[0] + radius * math.cos(start_angle + theta * index / steps),
         center[1] + radius * math.sin(start_angle + theta * index / steps))
        for index in range(1, steps + 1)
    ]


def parse_polyline(line):
    vertices = []
    for raw_vertex in line.split(";"):
        fields = [field.strip() for field in raw_vertex.split(",")]
        if len(fields) < 2:
            continue
        bulge = 0.0
        for field in fields[2:]:
            if field.startswith("A"):
                bulge = float(field[1:])
        vertices.append((float(fields[0]), float(fields[1]), bulge))
    if len(vertices) < 2:
        return []
    points = [(vertices[0][0], vertices[0][1])]
    for index in range(len(vertices) - 1):
        start = (vertices[index][0], vertices[index][1])
        end = (vertices[index + 1][0], vertices[index + 1][1])
        points.extend(arc_points(start, end, vertices[index][2]))
    return points


def read_lff(path):
    glyphs = {}
    current = None
    for raw_line in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw_line.strip()
        match = GLYPH_RE.match(line)
        if match:
            current = int(match.group(1), 16)
            glyphs[current] = {"strokes": [], "copies": []}
            continue
        if current is None or not line or line.startswith("#"):
            continue
        copy_match = COPY_RE.match(line)
        if copy_match:
            glyphs[current]["copies"].append(int(copy_match.group(1), 16))
            continue
        points = parse_polyline(line)
        if points:
            glyphs[current]["strokes"].append(points)
    return glyphs


def resolve_strokes(codepoint, glyphs, stack=()):
    if codepoint in stack:
        raise ValueError(f"Recursive glyph copy at U+{codepoint:04X}")
    glyph = glyphs[codepoint]
    strokes = []
    for copied in glyph["copies"]:
        if copied in glyphs:
            strokes.extend(resolve_strokes(copied, glyphs, stack + (codepoint,)))
    strokes.extend(glyph["strokes"])
    return strokes


def encode_glyph(codepoint, strokes, scale):
    points = []
    flags = []
    for stroke in strokes:
        for index, (x, y) in enumerate(stroke):
            points.append((x * scale, -y * scale))
            flags.append(0 if index == 0 else 1)
    flat = [coordinate for point in points for coordinate in point]
    return b"".join((
        struct.pack(">HI", codepoint, len(flat)),
        struct.pack(">" + "f" * len(flat), *flat) if flat else b"",
        struct.pack(">I", len(flags)),
        bytes(flags),
    ))


def stretch_strokes(strokes, width):
    points = [point for stroke in strokes for point in stroke]
    if not points:
        return strokes
    center = (min(point[0] for point in points) + max(point[0] for point in points)) / 2
    return [
        [(center + (x - center) * width, y) for x, y in stroke]
        for stroke in strokes
    ]


def convert(source, destination, scale, fallback_gfont=None):
    glyphs = read_lff(source)
    if 0x2014 not in glyphs and 0x002D in glyphs:
        glyphs[0x2014] = {
            "strokes": stretch_strokes(resolve_strokes(0x002D, glyphs), 2.4),
            "copies": [],
        }
    encoded = {}
    for codepoint in sorted(glyphs):
        if codepoint > 0xFFFF:
            continue
        strokes = resolve_strokes(codepoint, glyphs)
        if strokes:
            encoded[codepoint] = encode_glyph(codepoint, strokes, scale)
    if fallback_gfont:
        with zipfile.ZipFile(fallback_gfont) as fallback:
            for name in fallback.namelist():
                if name.isdigit():
                    encoded.setdefault(int(name), fallback.read(name))

    destination.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for codepoint, data in sorted(encoded.items()):
            archive.writestr(str(codepoint), data)
    return len(encoded)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--scale", type=float, default=40.0)
    parser.add_argument("--fallback-gfont", type=Path)
    args = parser.parse_args()
    count = convert(args.source, args.destination, args.scale, args.fallback_gfont)
    print(f"Converted {count} glyphs: {args.destination}")


if __name__ == "__main__":
    main()
