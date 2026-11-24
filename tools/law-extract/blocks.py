"""From printed lines to printed paragraphs ("blocks").

A block is one printed paragraph: a heading line, a title, a body paragraph or
a list item. Line grouping relies on the printed layout only:

* inside a column, a new paragraph starts where the distance between two
  baselines is larger than the constant line pitch of that column;
* at the top of a column, the first line continues the paragraph left open in
  the previous column when it starts at the continuation margin (no first-line
  indent) and is not centred;
* consecutive bold lines of the same size form one title.

Anything unusual at the top of a column is noted for review, and the review
report lists every paragraph that runs from one column into the next.
"""

import re

import bidi
import lines as L

BREAK_PITCH = 1.5       # extra baseline distance that marks a new paragraph
EDGE_TOL = 1.5          # tolerance when comparing margins
CENTRE_TOL = 3.0
CENTRE_MIN_MARGIN = 25.0

# enumerators that open a bold sub-heading: "أولا -", "أ -", "ب-", "1.", ...
ENUMERATOR = re.compile(
    r"^\s*(?:(?:أولا|ثانيا|ثالثا|رابعا|خامسا|سادسا|سابعا|ثامنا|تاسعا|عاشرا)\s*-"
    r"|[\u0621-\u064a]\u0640?\s*-"
    r"|\d+\s*[.\-])")

RUNNING_QUOTE = "\u00ab"      # opening guillemet


class Block:
    __slots__ = ("lines", "bold", "centred", "text", "note", "uncertain")

    def __init__(self, line):
        self.lines = [line]
        self.bold = line.bold
        self.centred = False
        self.text = None
        self.note = None
        self.uncertain = []

    @property
    def first(self):
        return self.lines[0]

    @property
    def last(self):
        return self.lines[-1]

    @property
    def size(self):
        return self.first.size

    def __repr__(self):
        return "<Block p%d %s %r>" % (self.first.page, self.first.column, self.text)


class ColumnGeometry:
    """Ink margins of the columns, measured on the document itself."""

    def __init__(self, all_lines):
        self.edges = {}
        for column in ("right", "left"):
            xs0 = sorted(round(l.x0, 1) for l in all_lines if l.column == column)
            xs1 = sorted(round(l.x1, 1) for l in all_lines if l.column == column)
            # justified lines dominate: the mode is the margin
            self.edges[column] = (_mode(xs0), _mode(xs1))
        left = min(e[0] for e in self.edges.values())
        right = max(e[1] for e in self.edges.values())
        self.edges["full"] = (left, right)

    def right_indent(self, line):
        return self.edges[line.column][1] - line.x1

    def left_indent(self, line):
        return line.x0 - self.edges[line.column][0]

    def is_centred(self, line):
        lo, hi = self.edges[line.column]
        off = (line.x0 + line.x1) / 2 - (lo + hi) / 2
        return abs(off) < CENTRE_TOL and self.right_indent(line) > CENTRE_MIN_MARGIN


def _mode(values):
    counts = {}
    for v in values:
        counts[v] = counts.get(v, 0) + 1
    return max(counts, key=counts.get)


def _same_column(a, b):
    return a.page == b.page and a.column == b.column and a.band == b.band


def _is_plain(line):
    return not line.bold and line.size == 14.0


def column_pitches(all_lines, geo):
    """Constant line pitch of every column: the baseline distance in front of
    a line that sits at the continuation margin (indent 0)."""
    samples = {}
    for prev, line in zip(all_lines, all_lines[1:]):
        if not _same_column(prev, line):
            continue
        if _is_plain(line) and _is_plain(prev) and geo.right_indent(line) < EDGE_TOL:
            samples.setdefault((line.page, line.column, line.band), []).append(
                prev.baseline - line.baseline)
    pitches = {}
    for key, values in samples.items():
        values.sort()
        if values[-1] - values[0] > 1.0:
            raise L.ExtractionError("line pitch is not constant in column %r: %r" % (key, values))
        pitches[key] = values[len(values) // 2]
    return pitches


def build_blocks(all_lines, geo, review):
    """Group lines into blocks. ``review`` receives notes on column tops."""
    pitches = column_pitches(all_lines, geo)
    # which right indents belong to continuation lines / to first lines,
    # learnt from the places where the line pitch decides
    cont_indents, first_indents = set(), set()
    for prev, line in zip(all_lines, all_lines[1:]):
        if not _same_column(prev, line) or line.bold or prev.bold:
            continue
        pitch = pitches.get((line.page, line.column, line.band))
        if pitch is None or geo.is_centred(line):
            continue
        extra = (prev.baseline - line.baseline) - pitch
        (cont_indents if extra < BREAK_PITCH else first_indents).add(
            round(geo.right_indent(line), 1))

    blocks = []
    prev = None
    for line in all_lines:
        block = blocks[-1] if blocks else None
        start = _starts_block(prev, line, block, geo, pitches, cont_indents,
                              first_indents, review)
        if start:
            block = Block(line)
            block.centred = geo.is_centred(line)
            blocks.append(block)
        else:
            block.lines.append(line)
        prev = line

    for block in blocks:
        _finish(block)
    return blocks


def _starts_block(prev, line, block, geo, pitches, cont_indents, first_indents, review):
    if prev is None:
        return True
    if line.bold or prev.bold:
        if (line.bold and prev.bold and _same_column(prev, line)
                and line.size == prev.size and not ENUMERATOR.match(visual_hint(line))):
            return False       # next line of a title
        if line.bold and prev.bold and not _same_column(prev, line):
            review.append("bold line at a column top after a bold line: p%d %s"
                          % (line.page, line.column))
        return True
    if _same_column(prev, line):
        pitch = pitches.get((line.page, line.column, line.band))
        if pitch is None:
            # no continuation line in this column: every line is a paragraph
            return True
        return (prev.baseline - line.baseline) - pitch >= BREAK_PITCH
    # --- first line of a column -------------------------------------------
    if geo.is_centred(line):
        return True
    if block.centred or block.bold:
        return True
    indent = geo.right_indent(line)
    if not cont_indents or not first_indents:
        raise L.ExtractionError("no paragraph margins could be learnt from the layout")
    d_cont = min(abs(indent - v) for v in cont_indents)
    d_first = min(abs(indent - v) for v in first_indents)
    if min(d_cont, d_first) > 1.0 or abs(d_cont - d_first) < 0.5:
        raise L.ExtractionError(
            "cannot decide whether p%d %s starts a paragraph (indent %.1f)"
            % (line.page, line.column, indent))
    if d_first < d_cont:
        return True
    # continuation: the paragraph left open must agree
    last = block.last
    if len(block.lines) > 1 and abs(geo.right_indent(last) - geo.right_indent(line)) > EDGE_TOL:
        review.append("continuation margin differs at p%d %s" % (line.page, line.column))
    if geo.left_indent(last) > 8.0:
        review.append("p%d %s continues a paragraph whose last line in the previous "
                      "column is short" % (line.page, line.column))
    return False


def visual_hint(line):
    """Logical text of a line before the paragraph context is known."""
    return "".join(g.text for g in bidi.visual_to_logical(line.glyphs))


def _finish(block):
    seen_letter = False
    parts = []
    for line in block.lines:
        L.to_logical(line, seen_letter)
        seen_letter = seen_letter or bidi.contains_arabic_letter(line.text)
        parts.append(normalise_text(line.text))
    if len(parts) > 1 and all(p.startswith(RUNNING_QUOTE) for p in parts):
        # Quoted replacement text: the Gazette repeats the opening guillemet
        # at the start of every printed line. The printed line breaks are
        # kept so that each guillemet stays where it is printed.
        text = "\n".join(parts)
        block.note = "running guillemets: printed line breaks kept"
    else:
        text = normalise_text(" ".join(parts))
    block.text, block.uncertain = mark_split_numbers(text)


# A number separator stranded next to a space between two digit groups, e.g.
# the printed "2.98 .500" (decree no. 2.98.500 typed with a stray space).
# The two groups are then independent runs for the bidirectional algorithm,
# which orders them right to left ("500. 2.98"), whereas the eye reads the
# figure as one number. The order of the groups cannot be established: the
# text is left as the algorithm gives it (it displays exactly as printed) and
# is followed by the marker of uncertain readings.
SPLIT_NUMBER = re.compile(
    r"\d+(?:[.,:/]\d+)*(?:[.,:/] +| +[.,:/])\d+(?:[.,:/]\d+)*")
UNCERTAIN_MARK = "[\u061f]"


def mark_split_numbers(text):
    found = SPLIT_NUMBER.findall(text)
    if found:
        text = SPLIT_NUMBER.sub(lambda m: m.group(0) + " " + UNCERTAIN_MARK, text)
    return text, found


def normalise_text(text):
    """Remove layout artefacts: tatweel, repeated or outer spaces."""
    text = text.replace(L.TATWEEL, "").replace(L.NBSP, " ")
    return " ".join(text.split())
