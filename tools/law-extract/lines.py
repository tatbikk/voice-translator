"""From glyphs to printed lines in reading order (primary path).

Steps, all driven by glyph geometry:

1. resolve the logical text of every glyph (ToUnicode, /ActualText, marks);
2. drop the running header;
3. cut each page into its two columns (right column first) and into lines;
4. turn every line from visual order into logical order.
"""

import unicodedata

import bidi

# --- page geometry of the Bulletin officiel (A4, two columns) ---------------
PAGE_MID_X = 297.64        # the vertical rule between the two columns
GUTTER_HALF = 4.0          # no column ink is ever this close to the rule
HEADER_BASELINE_MIN = 765.0  # baselines above belong to the running header
LINE_GAP = 6.0             # baselines closer than this are the same line

REPLACEMENT = "\ufffd"
NBSP = "\u00a0"
ZWNBSP = "\ufeff"
TATWEEL = "\u0640"
SIN_FAMILY = "سشصض"   # seen, sheen, sad, dad


class ExtractionError(Exception):
    pass


def is_mark(ch):
    return unicodedata.category(ch) == "Mn"


def _is_painted_mark(g):
    """A zero-advance glyph: a vowel mark or shadda painted over a letter."""
    return g.width < 0.01 and g.tu != " "


class TextResolution:
    """Statistics gathered while resolving glyph texts (reported, asserted)."""

    def __init__(self):
        self.carrier_letters = {}     # carrier glyph code -> set of letters
        self.tail_codes = set()       # glyph codes used as shared tail
        self.actual_kinds = {}        # kind -> count
        self.vocalised = []           # (page, baseline, x, text)
        self.painted_marks = []       # (page, x, baseline) of marks painted apart

    def count(self, kind):
        self.actual_kinds[kind] = self.actual_kinds.get(kind, 0) + 1


def resolve_texts(glyphs, stats):
    """Set ``g.text`` for the body glyphs of one page (painting order).

    Three mechanisms of the InDesign export are handled, and anything that
    does not match one of them raises ``ExtractionError``:

    * A ligature glyph has a multi-character ToUnicode value, already in
      logical order ("lam alef"): kept as is.
    * seen/sheen/sad/dad before a final yeh are painted with two glyphs: a
      "carrier" glyph without Unicode value (U+FFFD in ToUnicode) and a tail
      glyph shared by the four letters, whose ToUnicode says "seen" and whose
      /ActualText gives the real letter. The carrier is dropped, the tail takes
      the /ActualText letter.
    * A vocalised letter is painted as a base glyph inside a span whose
      /ActualText is "letter + marks", the mark glyph(s) being painted next to
      it. The base takes the /ActualText, the painted marks are not repeated.
    """
    n = len(glyphs)
    for g in glyphs:
        g.text = g.tu

    # -- spans carrying an /ActualText ---------------------------------------
    tails = []
    i = 0
    while i < n:
        g = glyphs[i]
        if g.span is None:
            i += 1
            continue
        j = i
        while j < n and glyphs[j].span == g.span:
            j += 1
        if _resolve_span(glyphs, i, j, stats) == "tail-letter":
            tails.append(i)
        i = j

    # -- carrier glyphs and painted marks -------------------------------------
    for i, g in enumerate(glyphs):
        if g.tu is None:
            raise ExtractionError("glyph without ToUnicode value: %r" % g)
        if g.tu == REPLACEMENT:
            tail = glyphs[i - 1] if i > 0 else None
            if (tail is None or tail.tu != SIN_FAMILY[0] or len(tail.text) != 1
                    or tail.text not in SIN_FAMILY or tail.font != g.font):
                raise ExtractionError("unpaired carrier glyph: %r" % g)
            stats.carrier_letters.setdefault(g.cid, set()).add(tail.text)
            stats.tail_codes.add(tail.cid)
            g.text = ""
        elif _is_painted_mark(g) and g.span is None:
            # A painted mark precedes its base letter in painting order. Its
            # character is already part of the text of that base (ActualText
            # "letter + marks", or a ligature whose ToUnicode holds the mark),
            # so it is not repeated. Its own ToUnicode value is not reliable
            # (the shadda glyph is mapped to "heh").
            k = i + 1
            while k < n and glyphs[k].text == "" and glyphs[k].span is not None:
                k += 1
            base = glyphs[k] if k < n else None
            if (base is None or not any(is_mark(c) for c in base.text)
                    or (is_mark(g.tu[:1]) and g.tu not in base.text)):
                raise ExtractionError("painted mark without vocalised base: %r" % g)
            g.text = ""
            stats.painted_marks.append((g.page, g.x0, g.base))

    # the shared tail glyph is always followed by its carrier, and a letter
    # given by /ActualText in place of "seen" is always such a tail
    for i, g in enumerate(glyphs):
        if i in tails or (g.cid in stats.tail_codes and g.tu == SIN_FAMILY[0]):
            nxt = glyphs[i + 1] if i + 1 < n else None
            if nxt is None or nxt.tu != REPLACEMENT:
                raise ExtractionError("shared tail glyph without carrier: %r" % g)


def _resolve_span(glyphs, i, j, stats):
    group = glyphs[i:j]
    actual = group[0].actual
    cleaned = "".join(
        " " if c == NBSP else c
        for c in actual
        if c not in (REPLACEMENT, ZWNBSP) and unicodedata.category(c) != "Cc")
    bases = [g for g in group if not _is_painted_mark(g)]
    if len(group) == 1 and group[0].tu == " ":
        if cleaned.strip() != "":
            raise ExtractionError("space glyph with text %r: %r" % (actual, group[0]))
        group[0].text = " " if cleaned else ""
        stats.count("space")
        return "space"
    if len(bases) != 1:
        raise ExtractionError("unsupported ActualText span %r: %r" % (actual, group))
    base = bases[0]
    while cleaned and is_mark(cleaned[0]):
        cleaned = cleaned[1:]      # a mark cannot open a span: export artefact
    if not cleaned or any(not is_mark(c) for c in cleaned[1:]):
        raise ExtractionError("unsupported ActualText %r: %r" % (actual, group))
    letter = cleaned[0]
    if len(cleaned) == 1 and len(group) == 1 and base.tu == SIN_FAMILY[0]:
        if letter not in SIN_FAMILY:
            raise ExtractionError("unexpected tail letter %r: %r" % (actual, base))
        kind = "tail-letter"
    elif len(cleaned) > 1 and letter == base.tu:
        kind = "vocalised"
        stats.vocalised.append((base.page, base.base, base.x0, cleaned))
    else:
        raise ExtractionError("unsupported ActualText %r on %r" % (actual, base))
    stats.count(kind)
    for g in group:
        g.text = ""
    base.text = cleaned
    return kind


# ----------------------------------------------------------------------------


class Line:
    """One printed line of one column (or one full-width line)."""

    __slots__ = ("page", "column", "baseline", "glyphs", "x0", "x1", "size",
                 "bold", "logical", "text", "band")

    def __init__(self, page, column, glyphs, band):
        self.page = page
        self.column = column          # "right", "left" or "full"
        self.band = band
        self.glyphs = glyphs          # painting order = left to right
        ink = [g for g in glyphs if g.text.strip()]
        self.x0 = min(g.x0 for g in ink)
        self.x1 = max(g.x1 for g in ink)
        self.baseline = _median([g.base for g in ink])
        sizes = {}
        bold = 0
        for g in ink:
            sizes[g.size] = sizes.get(g.size, 0) + 1
            if g.bold:
                bold += 1
        self.size = max(sizes, key=sizes.get)
        self.bold = bold * 2 > len(ink)
        self.logical = None
        self.text = None

    def __repr__(self):
        return "<Line p%d %s y=%.1f %r>" % (self.page, self.column, self.baseline, self.text)


def _median(values):
    values = sorted(values)
    return values[len(values) // 2]


def _cluster(glyphs):
    """Group glyphs sharing a baseline; return the groups from top to bottom."""
    out = []
    for g in sorted(glyphs, key=lambda g: -g.base):
        if out and out[-1][-1].base - g.base <= LINE_GAP:
            out[-1].append(g)
        else:
            out.append([g])
    return out


def split_header(glyphs):
    body = [g for g in glyphs if not g.in_form and g.base < HEADER_BASELINE_MIN]
    header = [g for g in glyphs if g.in_form or g.base >= HEADER_BASELINE_MIN]
    return header, body


def header_page_number(header):
    """The printed Gazette page number: the bold 4-digit figure of the header."""
    digits = [g for g in header
              if not g.in_form and g.bold and g.tu and g.tu.isdigit() and g.span is None]
    digits.sort(key=lambda g: g.x0)
    text = "".join(g.tu for g in digits)
    return int(text) if text.isdigit() else None


def build_lines(page, body):
    """Lines of one page in reading order: right column, then left column.

    A line whose ink crosses the rule between the columns is a full-width line
    (a title spanning both columns); it splits the page into horizontal bands,
    each band being read right column first.
    """
    for g in body:
        if g.text is None:
            raise ExtractionError("unresolved glyph %r" % g)
    ink = [g for g in body if g.text != ""]
    full_bases = []
    for group in _cluster(ink):
        crossing = [g for g in group if g.text.strip()
                    and g.x0 < PAGE_MID_X + GUTTER_HALF and g.x1 > PAGE_MID_X - GUTTER_HALF]
        if crossing:
            full_bases.append(_median([g.base for g in group]))

    def band_of(g):
        return sum(1 for b in full_bases if g.base < b - LINE_GAP)

    def is_full(g):
        return any(abs(g.base - b) <= LINE_GAP for b in full_bases)

    # band k = what stands between full-width line k-1 and full-width line k;
    # the columns of a band are read before the full-width line that closes it
    lines = []
    keys = sorted({(band_of(g), 1 if is_full(g) else 0) for g in ink})
    for band, full in keys:
        members = [g for g in ink
                   if band_of(g) == band and (1 if is_full(g) else 0) == full]
        if full:
            columns = [("full", members)]
        else:
            columns = [(name, [g for g in members
                               if ((g.x0 + g.x1) / 2 > PAGE_MID_X) == (name == "right")])
                       for name in ("right", "left")]
        for name, glyphs in columns:
            for group in _cluster(glyphs):
                line = _make_line(page, name, group, band)
                if line is not None:
                    lines.append(line)
    return lines


def _make_line(page, column, group, band):
    group = sorted(group, key=lambda g: g.seq)
    kept = []
    last_ink = None
    for g in group:
        if g.text.strip() == "":
            # the export parks a stray space after the last glyph of a line,
            # at an unrelated x position: it is not part of the visual order
            if last_ink is not None and g.x0 < last_ink.x0 - 0.5:
                continue
            kept.append(g)
            continue
        if last_ink is not None and g.x0 < last_ink.x0 - 0.5:
            raise ExtractionError(
                "glyphs of a line are not painted left to right: %r then %r" % (last_ink, g))
        last_ink = g
        kept.append(g)
    if last_ink is None:
        return None
    return Line(page, column, kept, band)


def to_logical(line, after_arabic_letter):
    """Set ``line.logical`` (glyphs in reading order) and ``line.text``.

    The result is verified with the forward bidirectional algorithm: laid out
    again, it must give back the printed glyph order.
    """
    units = line.glyphs
    visual_chars = "".join(g.text[::-1] for g in units)
    for join_es in (False, True):
        logical = bidi.visual_to_logical(units, join_es=join_es)
        chars = "".join(g.text for g in logical)
        order = bidi.logical_to_visual(chars, after_arabic_letter)
        if "".join(chars[k] for k in order) == visual_chars:
            line.logical = logical
            line.text = chars
            return
    raise ExtractionError("cannot establish the reading order of %r" % line)
