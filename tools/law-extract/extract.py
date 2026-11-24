#!/usr/bin/env python3
"""Extract Law no. 58.25 (code of civil procedure) from the Official Gazette PDF.

    python3 -I tools/law-extract/extract.py <pdf> <out.md> [options]

Primary path: glyph-level reading with pdfminer.six (glyphs.py, lines.py,
blocks.py, structure.py). Independent cross-check: poppler's pdftotext on a
copy of the PDF whose ToUnicode maps are patched (crosscheck.py).

Nothing is written when an assertion on the result fails or when the
cross-check finds a difference it cannot explain.
See README.md (Arabic) for the method and its limits.
"""

import argparse
import json
import os
import sys

sys.dont_write_bytecode = True    # keep the repository free of __pycache__
HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:          # "python3 -I" does not add the script directory
    sys.path.insert(0, HERE)

import blocks as B        # noqa: E402
import checks             # noqa: E402
import glyphs as G        # noqa: E402
import lines as L         # noqa: E402
import structure as S     # noqa: E402

LAW_NUMBER = "58.25"
DAHIR_NUMBER = "1.26.07"
ARTICLE_COUNT = 644
TITLE = "القانون رقم 58.25 المتعلق بالمسطرة المدنية"
ISSUE = "7485"
ISSUE_DATE = "5 رمضان 1447 (23 فبراير 2026)"
SOURCE_COPY = "docs/sources/bo-7485-2026-02-23-ar.pdf"


def read_issue(pdf_path):
    """All body lines of the issue in reading order, with page numbers."""
    pages, _sizes = G.read_glyphs(pdf_path)
    stats = L.TextResolution()
    all_lines = []
    gazette_pages = {}
    for index in sorted(pages):
        header, body = L.split_header(pages[index])
        gazette_pages[index] = L.header_page_number(header)
        try:
            L.resolve_texts(body, stats)
            page_lines = L.build_lines(index, body)
        except L.ExtractionError as exc:
            # pages outside the law (cover, other texts) may use constructs this
            # tool does not know; they are only fatal inside the law's range
            all_lines.append(("error", index, str(exc)))
            continue
        all_lines.extend(page_lines)
    return all_lines, gazette_pages, stats


def extract(pdf_path):
    raw, gazette_pages, stats = read_issue(pdf_path)
    # The Dahir and the law are cut out of the issue by their printed titles:
    # from the bold line "ظهير شريف رقم 1.26.07 ..." up to the next bold line
    # "ظهير شريف رقم ..." (the following text of the issue).
    start = end = None
    for i, item in enumerate(raw):
        if isinstance(item, tuple) or not item.bold:
            continue
        hint = B.normalise_text(B.visual_hint(item))
        if not hint.startswith(S.DAHIR_PREFIX + " "):
            continue
        if start is None:
            if hint.startswith("%s %s " % (S.DAHIR_PREFIX, DAHIR_NUMBER)):
                start = i
        else:
            end = i
            break
    if start is None or end is None:
        raise L.ExtractionError("Dahir %s not found in the issue" % DAHIR_NUMBER)
    usable = raw[start:end]
    for item in usable:
        if isinstance(item, tuple):
            raise L.ExtractionError("page %d: %s" % (item[1], item[2]))
    for line in usable:
        if line.column == "full":
            raise L.ExtractionError("full-width line inside the law: %r" % line)
    geo = B.ColumnGeometry(usable)
    review = []
    blocks = B.build_blocks(usable, geo, review)
    law = S.build_structure(blocks, LAW_NUMBER)
    for page in range(law.first_page, law.last_page + 1):
        if gazette_pages.get(page) is None:
            raise L.ExtractionError("no printed page number on PDF page %d" % page)
        if gazette_pages[page] - page != gazette_pages[law.first_page] - law.first_page:
            raise L.ExtractionError(
                "Gazette page numbers are not consecutive at PDF page %d" % page)
    law.gazette_pages = gazette_pages
    law.review = review
    law.stats = stats
    law.geometry = geo
    law.lines = usable
    law.blocks = blocks
    return law


def provenance(law):
    first = law.gazette_pages[law.first_page]
    last = law.gazette_pages[law.last_page]
    return [
        "المصدر: الجريدة الرسمية عدد %s بتاريخ %s، الصفحات من %d إلى %d."
        % (ISSUE, ISSUE_DATE, first, last),
        "استخرج هذا النص آليا من ملف PDF الرسمي للجريدة الرسمية (`%s`) بواسطة "
        "`tools/law-extract`، وروجع على صور الصفحات." % SOURCE_COPY,
        "عند أي اختلاف، يرجح النص الرسمي المطبوع في الجريدة الرسمية.",
    ]


def article_pages(law):
    out = {}
    for node in law.nodes:
        if node.kind == "article":
            line = node.block.first
            out[str(node.number)] = {
                "page": line.page,                 # 1-based index in the PDF
                "column": line.column,             # "right" or "left"
                "gazette_page": law.gazette_pages[line.page],
            }
    return out


def review_report(law, check_lines, cross):
    """Everything a human reviewer should look at, as plain text."""
    out = ["# law-extract review report", ""]
    out.append("PDF pages %d-%d, Gazette pages %d-%d"
               % (law.first_page, law.last_page,
                  law.gazette_pages[law.first_page], law.gazette_pages[law.last_page]))
    out.append("column ink margins: %r" % (law.geometry.edges,))
    out.append("")
    out.append("## assertions")
    out.extend(check_lines)
    out.append("")
    out.append("## article headings whose printed wording was normalised")
    for node in law.nodes:
        if node.kind == "article" and node.printed:
            out.append("p%d %s: printed %r -> %r"
                       % (node.block.first.page, node.block.first.column,
                          node.printed, node.text))
    out.append("")
    out.append("## ornaments left out")
    for page, column, text in law.dropped:
        out.append("p%d %s: %r" % (page, column, text))
    out.append("")
    out.append("## uncertain readings (marked %s in the text)" % B.UNCERTAIN_MARK)
    article = None
    for node in law.nodes:
        if node.kind == "article":
            article = node.number
        for found in node.block.uncertain:
            out.append("article %s, p%d %s: %r"
                       % (article, node.block.first.page, node.block.first.column, found))
    out.append("")
    out.append("## vocalised letters (text taken from /ActualText; check on the page image)")
    article = None
    for node in law.nodes:
        if node.kind == "article":
            article = node.number
        for line in node.block.lines:
            for word in line.text.split():
                if any(L.is_mark(c) for c in word):
                    out.append("article %s, p%d %s: %s"
                               % (article, line.page, line.column, word))
    out.append("")
    out.append("## paragraphs that continue from one column to the next")
    prev = None
    for block in law.blocks:
        for i, line in enumerate(block.lines):
            if (prev is not None and i > 0
                    and (prev.page, prev.column) != (line.page, line.column)):
                out.append("p%d %s -> p%d %s: ...%s | %s..."
                           % (prev.page, prev.column, line.page, line.column,
                              prev.text.strip()[-30:], line.text.strip()[:30]))
            prev = line
    out.append("")
    out.append("## printed line breaks kept (running guillemets)")
    for block in law.blocks:
        if block.note:
            out.append("p%d %s: %d lines"
                       % (block.first.page, block.first.column, len(block.lines)))
    out.append("")
    out.append("## notes of the paragraph builder")
    out.extend(law.review or ["none"])
    out.append("")
    out.append("## /ActualText spans and two-glyph letters (whole issue)")
    out.append("kinds: %r" % (law.stats.actual_kinds,))
    for cid, letters in sorted(law.stats.carrier_letters.items()):
        out.append("carrier glyph %04X -> %s" % (cid, " ".join(sorted(letters))))
    if cross is not None:
        out.append("")
        out.append("## cross-check with pdftotext")
        out.extend(cross.summary)
        out.extend(cross.detail)
    return "\n".join(out) + "\n"


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("pdf")
    parser.add_argument("out")
    parser.add_argument("--article-pages", metavar="JSON",
                        help="write the page and column where every article starts")
    parser.add_argument("--report", metavar="TXT",
                        help="write the review report (what to check by eye, "
                             "detail of the cross-check)")
    parser.add_argument("--no-crosscheck", action="store_true",
                        help="skip the pdftotext cross-check")
    parser.add_argument("--render-pages", metavar="DIR",
                        help="render the pages of the law (one PNG per column) for review")
    args = parser.parse_args(argv)

    law = extract(args.pdf)
    markdown = S.render_markdown(law, TITLE, provenance(law))
    check_lines = checks.run(markdown, law, ARTICLE_COUNT)
    for line in check_lines:
        print(line)

    cross = None
    if not args.no_crosscheck:
        import crosscheck
        cross = crosscheck.run(args.pdf, law)
        for line in cross.summary:
            print(line)
    if args.report:
        with open(args.report, "w", encoding="utf-8", newline="\n") as fp:
            fp.write(review_report(law, check_lines, cross))
    if cross is not None and cross.unexplained:
        raise SystemExit("cross-check: %d unexplained difference(s); nothing written"
                         % cross.unexplained)

    with open(args.out, "w", encoding="utf-8", newline="\n") as fp:
        fp.write(markdown)
    print("written: %s" % args.out)

    if args.article_pages:
        with open(args.article_pages, "w", encoding="utf-8", newline="\n") as fp:
            json.dump(article_pages(law), fp, ensure_ascii=False, indent=1)
            fp.write("\n")
    if args.render_pages:
        import render
        count = render.render_pages(args.pdf, law.first_page, law.last_page,
                                    args.render_pages)
        print("rendered: %d pages to %s" % (count, args.render_pages))
    return 0


if __name__ == "__main__":
    sys.exit(main())
