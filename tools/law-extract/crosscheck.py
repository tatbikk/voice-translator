"""Independent cross-check of the extraction with poppler's pdftotext.

The primary path (pdfminer glyphs, space glyphs, our own line assembly and
bidirectional reordering) is compared, word by word and column by column,
with a second path built on another PDF library:

1. The PDF is copied with every multi-character Arabic ToUnicode mapping
   reversed (strategy "A" of the task). poppler gives the characters of a
   ligature glyph in ToUnicode order while it walks a right-to-left word from
   left to right, which is what turns "lam alef" into "alef lam" in a naive
   extraction; with the reversed map the characters come out consistently.
2. ``pdftotext -bbox-layout`` gives every word of a page with its box, its
   characters in painting order (left to right), /ActualText applied by
   poppler itself. Words are cut by poppler (space glyphs and gaps).
3. Words are sorted here by their boxes: column, line, then right to left;
   each word is read from right to left, digit groups staying whole.
4. Both word sequences are aligned. Every difference must be of a known,
   explained kind; otherwise the run fails and nothing is written.

What the two paths share: the ToUnicode maps and /ActualText strings of the
PDF itself. Those are checked on page images, not here.
"""

import difflib
import html
import os
import re
import shutil
import subprocess
import tempfile
import unicodedata

import lines as L

_BFCHAR = re.compile(rb"<([0-9A-Fa-f]+)>(\s*)<([0-9A-Fa-f]+)>")
_WORD = re.compile(
    r'<word xMin="([-\d.]+)" yMin="([-\d.]+)" xMax="([-\d.]+)" yMax="([-\d.]+)">(.*?)</word>')
_ISLAND = re.compile(r"\d+(?:[.,:/\u060c]\d+)*|.", re.S)
_INVISIBLE = [0x200E, 0x200F, 0x061C, 0xFEFF, 0xFFFD] \
    + list(range(0x202A, 0x202F)) + list(range(0x2066, 0x206A))
_STRIP_KEEP_TATWEEL = dict.fromkeys(_INVISIBLE)
_STRIP = dict.fromkeys(_INVISIBLE + [0x0640])


class Result:
    def __init__(self):
        self.summary = []
        self.detail = []
        self.unexplained = 0
        self.differences = 0
        self.explained = {}
        self.tokens = 0
        self.zero_width = 0


def patch_tounicode(src, dst):
    """Copy ``src`` to ``dst`` with multi-character Arabic mappings reversed."""
    from pypdf import PdfWriter
    from pypdf.generic import DecodedStreamObject, NameObject

    writer = PdfWriter(clone_from=src)
    seen = set()
    patched = 0

    def swap(match):
        nonlocal patched
        target = match.group(3)
        if len(target) <= 4 or len(target) % 4:
            return match.group(0)
        cps = [int(target[i:i + 4], 16) for i in range(0, len(target), 4)]
        if not all(0x0600 <= cp <= 0x06FF for cp in cps):
            return match.group(0)
        patched += 1
        rev = b"".join(b"%04X" % cp for cp in reversed(cps))
        return b"<" + match.group(1) + b">" + match.group(2) + b"<" + rev + b">"

    def visit(resources):
        if resources is None:
            return
        resources = resources.get_object()
        fonts = resources.get("/Font")
        if fonts is not None:
            for ref in fonts.get_object().values():
                font = ref.get_object()
                key = ("font", getattr(ref, "idnum", None) or id(font))
                if key in seen:
                    continue
                seen.add(key)
                stream = font.get("/ToUnicode")
                if stream is None:
                    continue
                data = stream.get_object().get_data()
                new = _BFCHAR.sub(swap, data)
                if new != data:
                    fresh = DecodedStreamObject()
                    fresh.set_data(new)
                    font[NameObject("/ToUnicode")] = writer._add_object(fresh)
        xobjects = resources.get("/XObject")
        if xobjects is not None:
            for ref in xobjects.get_object().values():
                obj = ref.get_object()
                key = ("xobject", getattr(ref, "idnum", None) or id(obj))
                if key in seen:
                    continue
                seen.add(key)
                if obj.get("/Subtype") == "/Form":
                    visit(obj.get("/Resources"))

    for page in writer.pages:
        visit(page.get("/Resources"))
    with open(dst, "wb") as fp:
        writer.write(fp)
    return patched


def pdftotext_words(pdf, page):
    """Words of one page as (x0, top, x1, bottom, text); text in painting order."""
    cmd = ["pdftotext", "-enc", "UTF-8", "-nopgbrk", "-bbox-layout",
           "-f", str(page), "-l", str(page), pdf, "-"]
    out = subprocess.run(cmd, check=True, capture_output=True).stdout.decode("utf-8")
    return [(float(a), float(b), float(c), float(d), html.unescape(t))
            for a, b, c, d, t in _WORD.findall(out)]


def to_logical(painted_word):
    """Read a pdftotext word from right to left, digit groups staying whole."""
    return "".join(reversed(_ISLAND.findall(painted_word)))


def normalise(text, keep_tatweel=False):
    table = _STRIP_KEEP_TATWEEL if keep_tatweel else _STRIP
    return text.translate(table).replace(L.NBSP, " ").split()


def column_tokens(words, column, top, bottom, zero_width):
    """Logical tokens of one column between two heights (top-down y).

    pdftotext prints every painted vowel mark as a zero-width word of its own
    (with the ToUnicode value of the mark glyph). They are moved to
    ``zero_width`` and reconciled with the marks handled by the primary path.
    """
    column_words = []
    for w in words:
        if ((w[0] + w[2]) / 2 > L.PAGE_MID_X) != (column == "right"):
            continue
        if not top <= (w[1] + w[3]) / 2 < bottom:
            continue
        if w[2] - w[0] < 0.01:
            zero_width.append(w)
            continue
        column_words.append(w)
    column_words.sort(key=lambda w: (w[1] + w[3]) / 2)
    printed_lines = []
    for w in column_words:
        centre = (w[1] + w[3]) / 2
        if printed_lines and centre - printed_lines[-1][0] <= L.LINE_GAP:
            printed_lines[-1][1].append(w)
        else:
            printed_lines.append([centre, [w]])
    tokens = []
    for _centre, members in printed_lines:
        members.sort(key=lambda w: -w[2])          # right to left
        for w in members:
            tokens.extend(normalise(to_logical(w[4])))
    return tokens


def _strip_marks(token):
    return "".join(c for c in token if not L.is_mark(c))


def classify(ours, theirs, ours_raw):
    """Name of the known, explained kind of difference, or None.

    * "vowel marks": the primary path has a vocalised letter and both sides
      have the same letters. pdftotext prints the /ActualText "letter + mark"
      in painting order and cuts the word there. Every vocalised letter is
      listed in the review report and was checked on the page image.
    * "kashida": pdftotext cuts a word that the Gazette stretched with
      tatweel glyphs; there is no space glyph inside the word.
    """
    a, b = "".join(ours), "".join(theirs)
    if (a != b and any(L.is_mark(c) for c in a)
            and unicodedata.normalize("NFC", _strip_marks(a))
            == unicodedata.normalize("NFC", _strip_marks(b))):
        return "vowel marks"
    if a == b and len(ours) < len(theirs) and any(L.TATWEEL in t for t in ours_raw):
        return "kashida"
    return None


def run(pdf_path, law, page_height=841.89):
    if shutil.which("pdftotext") is None:
        raise RuntimeError("pdftotext (poppler-utils) is required for the cross-check")
    result = Result()

    columns = {}
    for line in law.lines:
        columns.setdefault((line.page, line.column), []).append(line)
    first_key = (law.lines[0].page, law.lines[0].column)
    last_key = (law.lines[-1].page, law.lines[-1].column)
    expected = [(page, column)
                for page in range(first_key[0], last_key[0] + 1)
                for column in ("right", "left")]
    expected = expected[expected.index(first_key):expected.index(last_key) + 1]
    if sorted(columns) != sorted(expected):
        raise RuntimeError("the primary path does not cover every column of the law")

    workdir = tempfile.mkdtemp(prefix="law-crosscheck-")
    try:
        patched_pdf = os.path.join(workdir, "patched.pdf")
        reversed_maps = patch_tounicode(pdf_path, patched_pdf)
        result.summary.append(
            "cross-check: %d ligature mappings reversed for pdftotext" % reversed_maps)
        header_bottom = page_height - L.HEADER_BASELINE_MIN
        words = {}
        for key in expected:
            page, column = key
            col_lines = columns[key]
            ours, ours_raw = [], []
            for line in col_lines:
                ours.extend(normalise(line.text))
                ours_raw.extend(normalise(line.text, keep_tatweel=True))
            if len(ours) != len(ours_raw):
                raise RuntimeError("a tatweel stands alone on page %d" % page)
            if page not in words:
                words[page] = pdftotext_words(patched_pdf, page)
            # the whole column below the running header, except where the law
            # starts or ends inside the column
            top, bottom = header_bottom, page_height
            if page == first_key[0]:
                # nothing above the title of the Dahir belongs to the text
                top = page_height - max(g.y1 for g in law.lines[0].glyphs) - 1
            if key == last_key:
                bottom = page_height - min(g.y0 for g in col_lines[-1].glyphs) + 1
            zero_width = []
            theirs = column_tokens(words[page], column, top, bottom, zero_width)
            _compare(result, page, column, ours, ours_raw, theirs)
            _reconcile_marks(result, law, page, column, top, bottom, zero_width, page_height)
    finally:
        shutil.rmtree(workdir, ignore_errors=True)

    result.summary.append(
        "cross-check: %d words compared, %d difference(s) [%s], unexplained: %d"
        % (result.tokens, result.differences,
           ", ".join("%s: %d" % kv for kv in sorted(result.explained.items())) or "none",
           result.unexplained))
    result.summary.append(
        "cross-check: %d zero-width word(s) of pdftotext matched with the painted "
        "marks handled by the primary path" % result.zero_width)
    return result


def _compare(result, page, column, ours, ours_raw, theirs):
    result.tokens += len(ours)
    matcher = difflib.SequenceMatcher(None, ours, theirs, autojunk=False)
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            continue
        result.differences += 1
        a, b = ours[i1:i2], theirs[j1:j2]
        kind = classify(a, b, ours_raw[i1:i2])
        if kind is None:
            result.unexplained += 1
        else:
            result.explained[kind] = result.explained.get(kind, 0) + 1
        result.detail.append(
            "p%d %s [%s] primary=%r pdftotext=%r after=%r"
            % (page, column, kind or "UNEXPLAINED", " ".join(ours_raw[i1:i2]),
               " ".join(b), " ".join(ours[max(0, i1 - 4):i1])))


def _reconcile_marks(result, law, page, column, top, bottom, zero_width, page_height):
    """Every zero-width word of pdftotext must be a painted mark that the
    primary path has accounted for (same page, same place), and conversely."""
    ours = []
    for mark_page, x, base in law.stats.painted_marks:
        if mark_page != page or (x > L.PAGE_MID_X) != (column == "right"):
            continue
        if top <= page_height - base < bottom:
            ours.append((x, page_height - base))
    unmatched = list(ours)
    for w in zero_width:
        hit = None
        for mark in unmatched:
            if abs(mark[0] - w[0]) < 1.0 and w[1] - 4 <= mark[1] <= w[3] + 4:
                hit = mark
                break
        if hit is None:
            result.unexplained += 1
            result.detail.append("p%d %s [UNEXPLAINED] zero-width word %r at x=%.1f"
                                 % (page, column, w[4], w[0]))
        else:
            unmatched.remove(hit)
            result.zero_width += 1
    for mark in unmatched:
        result.unexplained += 1
        result.detail.append("p%d %s [UNEXPLAINED] painted mark at x=%.1f not seen by "
                             "pdftotext" % (page, column, mark[0]))
