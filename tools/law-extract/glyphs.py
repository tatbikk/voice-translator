"""Glyph-level reading of the Official Gazette PDF (primary path).

Every painted glyph is collected with its position, its font, its glyph code,
the text given by the font's ToUnicode map and, when the glyph sits inside a
marked-content span, the span's /ActualText.

Nothing here interprets the text: that is done in ``lines.py``.
"""

from pdfminer.converter import PDFLayoutAnalyzer
from pdfminer.layout import LTChar
from pdfminer.pdfdocument import PDFDocument
from pdfminer.pdfinterp import PDFPageInterpreter, PDFResourceManager
from pdfminer.pdfpage import PDFPage
from pdfminer.pdfparser import PDFParser


class Glyph:
    """One painted glyph."""

    __slots__ = (
        "page", "seq", "cid", "tu", "font", "size", "x0", "x1", "y0", "y1",
        "base", "span", "actual", "in_form", "text",
    )

    def __init__(self, page, seq, cid, tu, font, size, x0, x1, y0, y1, base,
                 span, actual, in_form):
        self.page = page          # 1-based PDF page index
        self.seq = seq            # painting order on the page
        self.cid = cid            # glyph code in the font
        self.tu = tu              # ToUnicode text (None when unmapped)
        self.font = font          # subset font name, e.g. "BCKTFG+SakkalMajalla"
        self.size = size          # font size in points
        self.x0 = x0
        self.x1 = x1
        self.y0 = y0
        self.y1 = y1
        self.base = base          # baseline y of the glyph
        self.span = span          # id of the enclosing ActualText span, or None
        self.actual = actual      # the span's ActualText, or None
        self.in_form = in_form    # painted from a form XObject (page furniture)
        self.text = None          # resolved logical text, set by lines.py

    @property
    def width(self):
        return self.x1 - self.x0

    @property
    def bold(self):
        return "Bold" in self.font

    @property
    def family(self):
        return self.font.split("+", 1)[-1]

    def __repr__(self):
        return "<Glyph p%d #%d %04X %r x=%.1f y=%.1f>" % (
            self.page, self.seq, self.cid, self.tu, self.x0, self.base)


def _decode_actual_text(raw):
    if isinstance(raw, bytes):
        if raw[:2] == b"\xfe\xff":
            return raw[2:].decode("utf-16-be")
        return raw.decode("latin-1")
    return str(raw)


class _Collector(PDFLayoutAnalyzer):
    def __init__(self, rsrcmgr):
        super().__init__(rsrcmgr, pageno=1, laparams=None)
        self.page_index = 0
        self.glyphs = []
        self._tags = []
        self._span_seq = 0
        self._forms = 0

    def begin_page(self, page, ctm):
        super().begin_page(page, ctm)
        self.glyphs = []
        self._tags = []
        self._forms = 0

    def begin_figure(self, name, bbox, matrix):
        super().begin_figure(name, bbox, matrix)
        self._forms += 1

    def end_figure(self, name):
        super().end_figure(name)
        self._forms -= 1

    def begin_tag(self, tag, props=None):
        entry = None
        if isinstance(props, dict) and "ActualText" in props:
            self._span_seq += 1
            entry = (self._span_seq, _decode_actual_text(props["ActualText"]))
        self._tags.append(entry)

    def end_tag(self):
        if self._tags:
            self._tags.pop()

    def render_char(self, matrix, font, fontsize, scaling, rise, cid, ncs,
                    graphicstate):
        try:
            tu = font.to_unichr(cid)
        except Exception:  # pdfminer raises PDFUnicodeNotDefined
            tu = None
        item = LTChar(matrix, font, fontsize, scaling, rise, tu or "",
                      font.char_width(cid), font.char_disp(cid), ncs,
                      graphicstate)
        span = actual = None
        for entry in self._tags:
            if entry is not None:
                span, actual = entry
        self.glyphs.append(Glyph(
            page=self.page_index, seq=len(self.glyphs), cid=cid, tu=tu,
            font=font.fontname, size=round(item.size, 3),
            x0=item.x0, x1=item.x1, y0=item.y0, y1=item.y1, base=matrix[5],
            span=span, actual=actual, in_form=self._forms > 0))
        return item.adv

    def receive_layout(self, ltpage):
        pass


def read_glyphs(pdf_path, first_page=1, last_page=None):
    """Return ({page_index: [Glyph, ...]}, {page_index: (width, height)})."""
    pages = {}
    sizes = {}
    with open(pdf_path, "rb") as fp:
        doc = PDFDocument(PDFParser(fp))
        rsrcmgr = PDFResourceManager()
        device = _Collector(rsrcmgr)
        interpreter = PDFPageInterpreter(rsrcmgr, device)
        for index, page in enumerate(PDFPage.create_pages(doc), 1):
            if index < first_page:
                continue
            if last_page is not None and index > last_page:
                break
            device.page_index = index
            interpreter.process_page(page)
            pages[index] = device.glyphs
            box = page.mediabox
            sizes[index] = (box[2] - box[0], box[3] - box[1])
    return pages, sizes
