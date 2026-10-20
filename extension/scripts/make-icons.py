#!/usr/bin/env python3
"""Generate the extension icons.

The icons are drawn rather than stored, so they stay in step with the
colours of the website and can be regenerated at any size. Only the standard
library is used: the PNG is encoded by hand, because adding an image library
to the project for four small files would not be worth it.

Run with::

    python extension/scripts/make-icons.py

The mark is the one of the website: a lime disc carrying a dark green arrow
pointing to the upper right.
"""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

ICON_DIR = Path(__file__).resolve().parent.parent / "src" / "icons"
SIZES = (16, 32, 48, 128)

# The supersampling factor used while drawing, before the downscale.
OVERSAMPLE = 4

LIME = (0xD9, 0xF3, 0x6A)
GREEN = (0x0F, 0x4F, 0x3D)

# The shape of the mark, in normalised coordinates from 0 to 1.
DISC_CENTER = (0.5, 0.5)
DISC_RADIUS = 0.47
STROKE_HALF_WIDTH = 0.062
ARROW_TIP = (0.70, 0.30)
ARROW_TAIL = (0.32, 0.68)
ARROW_BAR = (0.70, 0.50)
ARROW_STEM = (0.50, 0.70)


def distance_to_segment(
    point: tuple[float, float],
    start: tuple[float, float],
    end: tuple[float, float],
) -> float:
    """The distance between a point and a segment."""
    px, py = point
    ax, ay = start
    bx, by = end
    length_squared = (bx - ax) ** 2 + (by - ay) ** 2
    if length_squared == 0:
        return ((px - ax) ** 2 + (py - ay) ** 2) ** 0.5
    t = max(0.0, min(1.0, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / length_squared))
    return ((px - (ax + t * (bx - ax))) ** 2 + (py - (ay + t * (by - ay))) ** 2) ** 0.5


def colour_at(x: float, y: float) -> tuple[int, int, int, int]:
    """The colour of the mark at a point, in normalised coordinates."""
    if (x - DISC_CENTER[0]) ** 2 + (y - DISC_CENTER[1]) ** 2 > DISC_RADIUS**2:
        return (0, 0, 0, 0)

    segments = (
        (ARROW_TAIL, ARROW_TIP),
        (ARROW_TIP, ARROW_BAR),
        (ARROW_TIP, ARROW_STEM),
    )
    for start, end in segments:
        if distance_to_segment((x, y), start, end) <= STROKE_HALF_WIDTH:
            return (*GREEN, 255)

    return (*LIME, 255)


def render(size: int) -> bytes:
    """Render the mark at a size and return the raw RGBA rows."""
    high = size * OVERSAMPLE
    rows: list[bytes] = []

    for row in range(size):
        line = bytearray()
        for column in range(size):
            totals = [0, 0, 0, 0]
            for sub_row in range(OVERSAMPLE):
                for sub_column in range(OVERSAMPLE):
                    x = (column * OVERSAMPLE + sub_column + 0.5) / high
                    y = (row * OVERSAMPLE + sub_row + 0.5) / high
                    red, green, blue, alpha = colour_at(x, y)
                    totals[0] += red * alpha
                    totals[1] += green * alpha
                    totals[2] += blue * alpha
                    totals[3] += alpha

            samples = OVERSAMPLE * OVERSAMPLE
            alpha = totals[3] / samples
            if alpha == 0:
                line.extend((0, 0, 0, 0))
                continue
            line.extend(
                (
                    round(totals[0] / totals[3]),
                    round(totals[1] / totals[3]),
                    round(totals[2] / totals[3]),
                    round(alpha),
                )
            )
        rows.append(bytes(line))

    return b"".join(b"\x00" + row for row in rows)


def write_png(path: Path, size: int, raw: bytes) -> None:
    """Write a raw RGBA scanline buffer as a PNG file."""

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    path.write_bytes(png)


def main() -> None:
    ICON_DIR.mkdir(parents=True, exist_ok=True)
    for size in SIZES:
        path = ICON_DIR / f"icon-{size}.png"
        write_png(path, size, render(size))
        print(f"{path.relative_to(ICON_DIR.parents[2])} écrit.")


if __name__ == "__main__":
    main()
