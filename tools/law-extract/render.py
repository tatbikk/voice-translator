"""Render the pages of the law to PNG for visual review (needs pdftoppm).

For every PDF page NNN: pNNN-right.png and pNNN-left.png (one column each,
200 dpi) and pNNN-full.png (whole page, 110 dpi).
"""

import os
import subprocess

import lines as L

COLUMN_DPI = 200
FULL_DPI = 110
PAGE_WIDTH = 595.276
PAGE_HEIGHT = 841.89
OVERLAP = 3.0        # points kept on the far side of the column rule


def _run(args):
    subprocess.run(args, check=True, capture_output=True)


def render_pages(pdf_path, first_page, last_page, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    scale = COLUMN_DPI / 72.0
    height = int(PAGE_HEIGHT * scale)
    boxes = {
        "right": (int((L.PAGE_MID_X - OVERLAP) * scale),
                  int((PAGE_WIDTH - L.PAGE_MID_X + OVERLAP) * scale)),
        "left": (0, int((L.PAGE_MID_X + OVERLAP) * scale)),
    }
    for page in range(first_page, last_page + 1):
        stem = os.path.join(out_dir, "p%03d" % page)
        for column, (x, width) in boxes.items():
            _run(["pdftoppm", "-r", str(COLUMN_DPI), "-f", str(page), "-l", str(page),
                  "-x", str(x), "-y", "0", "-W", str(width), "-H", str(height),
                  "-png", "-singlefile", pdf_path, "%s-%s" % (stem, column)])
        _run(["pdftoppm", "-r", str(FULL_DPI), "-f", str(page), "-l", str(page),
              "-png", "-singlefile", pdf_path, stem + "-full"])
    return last_page - first_page + 1
