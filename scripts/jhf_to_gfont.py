from __future__ import annotations

import argparse
import struct
import zipfile
from pathlib import Path


CYRILLIC_ASCII_MAP = {
    "А": "A", "Б": "B", "В": "V", "Г": "G", "Д": "D", "Е": "[",
    "Ж": "H", "З": "Z", "И": "E", "Й": "I", "К": "K", "Л": "L",
    "М": "M", "Н": "N", "О": "O", "П": "P", "Р": "R", "С": "S",
    "Т": "T", "У": "Y", "Ф": "F", "Х": "X", "Ц": "%", "Ч": "J",
    "Ш": "Q", "Щ": "W", "Ъ": "]", "Ы": "$", "Ь": "_", "Э": "C",
    "Ю": "U", "Я": "^",
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "{",
    "ж": "h", "з": "z", "и": "i", "й": "e", "к": "k", "л": "l",
    "м": "m", "н": "n", "о": "o", "п": "p", "р": "r", "с": "s",
    "т": "t", "у": "y", "ф": "f", "х": "x", "ц": "`", "ч": "j",
    "ш": "q", "щ": "w", "ъ": "|", "ы": "&", "ь": "~", "э": "c",
    "ю": "u", "я": "}",
}


def read_jhf(path: Path):
    glyphs = {}
    for index, line in enumerate(path.read_text(encoding="ascii").splitlines()):
        if len(line) < 10:
            continue
        raw = line[10:]
        strokes = []
        stroke = []
        for offset in range(0, len(raw) - 1, 2):
            pair = raw[offset:offset + 2]
            if pair == " R":
                if stroke:
                    strokes.append(stroke)
                stroke = []
                continue
            stroke.append((ord(pair[0]) - ord("R"), ord(pair[1]) - ord("R")))
        if stroke:
            strokes.append(stroke)
        glyphs[32 + index] = strokes
    return glyphs


def add_diaeresis(strokes):
    copied = [[tuple(point) for point in stroke] for stroke in strokes]
    points = [point for stroke in copied for point in stroke]
    if not points:
        return copied
    min_x = min(point[0] for point in points)
    max_x = max(point[0] for point in points)
    top = min(point[1] for point in points) - 2.2
    span = max(max_x - min_x, 4)
    for ratio in (0.36, 0.7):
        x = min_x + span * ratio
        copied.append([(x - 0.35, top), (x + 0.35, top)])
    return copied


def stretch_strokes(strokes, width):
    points = [point for stroke in strokes for point in stroke]
    if not points:
        return strokes
    center = (min(point[0] for point in points) + max(point[0] for point in points)) / 2
    return [
        [(center + (x - center) * width, y) for x, y in stroke]
        for stroke in strokes
    ]


def encode_glyph(codepoint, strokes, scale):
    points = []
    flags = []
    for stroke in strokes:
        for index, (x, y) in enumerate(stroke):
            points.append((x * scale, y * scale))
            flags.append(0 if index == 0 else 1)
    flat = [coordinate for point in points for coordinate in point]
    return b"".join((
        struct.pack(">HI", codepoint, len(flat)),
        struct.pack(">" + "f" * len(flat), *flat) if flat else b"",
        struct.pack(">I", len(flags)),
        bytes(flags),
    ))


def convert(
    cyrillic_source: Path,
    latin_source: Path,
    destination: Path,
    scale: float,
    fallback_gfont: Path | None = None,
):
    cyrillic = read_jhf(cyrillic_source)
    glyphs = read_jhf(latin_source)

    for target, source in CYRILLIC_ASCII_MAP.items():
        glyphs[ord(target)] = cyrillic[ord(source)]
    glyphs[ord("Ё")] = add_diaeresis(glyphs[ord("Е")])
    glyphs[ord("ё")] = add_diaeresis(glyphs[ord("е")])
    glyphs[0x2014] = stretch_strokes(glyphs[ord("-")], 2.4)

    encoded = {
        codepoint: encode_glyph(codepoint, strokes, scale)
        for codepoint, strokes in glyphs.items()
        if strokes
    }
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
    parser.add_argument("cyrillic_source", type=Path)
    parser.add_argument("latin_source", type=Path)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--scale", type=float, default=17.0)
    parser.add_argument("--fallback-gfont", type=Path)
    args = parser.parse_args()
    count = convert(
        args.cyrillic_source,
        args.latin_source,
        args.destination,
        args.scale,
        args.fallback_gfont,
    )
    print(f"Converted {count} glyphs: {args.destination}")


if __name__ == "__main__":
    main()
