"""From printed paragraphs to the structure of Law 58.25 and to Markdown."""

import re
import unicodedata

import lines as L

DAHIR_PREFIX = "ظهير شريف رقم"
SECTION_HEADER = "نصوص عامة"           # Gazette section title, not part of the text

# printed division names, from the widest to the narrowest, and their level
DIVISIONS = {"القسم": 2, "الباب": 3, "الفرع": 4, "الجزء": 5}

# Bold sub-headings printed with an enumerator only ("أولا -", "أ -", "1.").
# They may sit under a "فرع" or under a "جزء", with up to three nested ranks;
# level 6 being reserved for the articles, they are all written at level 5.
SUBHEADING_LEVEL = 5

# bold headings printed without a division name
UNLABELLED_HEADINGS = {"بيان الأسباب": 2, "مقتضيات انتقالية وختامية": 2}

_UNITS = ["الأول", "الثاني", "الثالث", "الرابع", "الخامس", "السادس", "السابع",
          "الثامن", "التاسع", "العاشر"]
ORDINALS = {name: i + 1 for i, name in enumerate(_UNITS)}
ORDINALS["الحادي عشر"] = 11
for _i, _name in enumerate(_UNITS[1:9], 12):
    ORDINALS[_name + " عشر"] = _i

ARTICLE_RE = re.compile(r"^المادة ?(\d+)$")
FIRST_ARTICLE = "المادة الأولى"
LABEL_RE = re.compile(r"^(%s) (.+)$" % "|".join(DIVISIONS))
ORNAMENT_RE = re.compile(r"^[* ]+$")


class Node:
    __slots__ = ("kind", "level", "text", "number", "block", "printed")

    def __init__(self, kind, text, block, level=None, number=None, printed=None):
        self.kind = kind        # dahir-title, law-title, division, title,
                                # subheading, heading, article, para
        self.text = text
        self.block = block
        self.level = level
        self.number = number
        self.printed = printed  # printed wording when the output normalises it


class LawStructure:
    def __init__(self):
        self.nodes = []
        self.first_page = None
        self.last_page = None
        self.notes = []
        self.dropped = []


def build_structure(blocks, law_number):
    """``blocks``: the paragraphs from the Dahir title to the end of the law."""
    law_title = None
    for i, b in enumerate(blocks):
        if b.bold and b.centred and b.text.startswith("قانون رقم %s " % law_number):
            law_title = i
            break
    if law_title is None or not blocks[0].bold:
        raise L.ExtractionError("cannot locate the title of law %s" % law_number)
    start, end = 0, len(blocks)
    law = LawStructure()
    law.first_page = blocks[start].first.page
    law.last_page = blocks[end - 1].last.page
    nodes = law.nodes

    # ---- the promulgating Dahir --------------------------------------------
    nodes.append(Node("dahir-title", blocks[start].text, blocks[start], level=2))
    for b in blocks[start + 1:law_title]:
        if ORNAMENT_RE.match(b.text):
            law.dropped.append((b.first.page, b.first.column, b.text))
            continue
        if b.bold:
            raise L.ExtractionError("unexpected bold text in the Dahir: %r" % b)
        nodes.append(Node("para", b.text, b))

    # ---- the law ---------------------------------------------------------------
    nodes.append(Node("law-title", blocks[law_title].text, blocks[law_title], level=2))
    counters = {name: 0 for name in DIVISIONS}
    order = list(DIVISIONS)
    expect_title = None
    expected_article = 1
    for b in blocks[law_title + 1:end]:
        text = b.text
        if expect_title is not None:
            if not b.bold:
                raise L.ExtractionError("division %r has no bold title: %r" % (expect_title, b))
            nodes.append(Node("title", text, b))
            expect_title = None
            continue
        if b.bold:
            if text in UNLABELLED_HEADINGS:
                nodes.append(Node("heading", text, b, level=UNLABELLED_HEADINGS[text]))
            elif _is_subheading(text):
                nodes.append(Node("subheading", text, b, level=SUBHEADING_LEVEL))
            else:
                raise L.ExtractionError("unclassified bold text: %r" % b)
            continue
        if b.centred or text == FIRST_ARTICLE or ARTICLE_RE.match(text):
            number = None
            if text == FIRST_ARTICLE:
                number = 1
            else:
                m = ARTICLE_RE.match(text)
                if m:
                    number = int(m.group(1))
            if number is not None:
                if not b.centred or len(b.lines) != 1:
                    raise L.ExtractionError("article heading is not a centred line: %r" % b)
                if number != expected_article:
                    raise L.ExtractionError(
                        "article %d found where article %d was expected (p%d %s)"
                        % (number, expected_article, b.first.page, b.first.column))
                expected_article += 1
                printed = text if text != "المادة %d" % number else None
                nodes.append(Node("article", "المادة %d" % number, b, level=6,
                                  number=number, printed=printed))
                continue
            m = LABEL_RE.match(text)
            if m and m.group(2) in ORDINALS:
                name, rank = m.group(1), ORDINALS[m.group(2)]
                if rank != counters[name] + 1:
                    raise L.ExtractionError(
                        "%s %d follows %s %d (p%d %s)" % (
                            name, rank, name, counters[name], b.first.page, b.first.column))
                counters[name] = rank
                for lower in order[order.index(name) + 1:]:
                    counters[lower] = 0
                nodes.append(Node("division", text, b, level=DIVISIONS[name], number=rank))
                expect_title = text
                continue
            raise L.ExtractionError("unclassified centred line: %r" % b)
        nodes.append(Node("para", text, b))
    law.article_count = expected_article - 1
    return law


def _is_subheading(text):
    import blocks as B
    return bool(B.ENUMERATOR.match(text))


def render_markdown(law, title, provenance):
    out = ["# " + title, ""]
    for line in provenance:
        out.append("> " + line if line else ">")
    out.append("")
    for node in law.nodes:
        if node.kind in ("dahir-title", "law-title", "division", "heading",
                         "subheading", "article"):
            out.append("#" * node.level + " " + node.text)
        elif node.kind == "title":
            out.append("**" + node.text + "**")
        else:
            out.append(node.text)
        out.append("")
    while out and out[-1] == "":
        out.pop()
    # canonical composition (NFC): only reorders the marks of the two letters
    # that carry both a shadda and a vowel
    return unicodedata.normalize("NFC", "\n".join(out) + "\n")
