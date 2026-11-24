"""Mandatory assertions on the produced Markdown. Any failure aborts the run."""

import re
import unicodedata


class CheckFailed(Exception):
    pass


def _fail(message):
    raise CheckFailed("ASSERTION FAILED: " + message)


BIDI_CONTROLS = set(range(0x202A, 0x202F)) | {0x200E, 0x200F, 0x061C} | set(range(0x2066, 0x206A))
FORBIDDEN_SINGLE = {
    0x0640: "tatweel",
    0xFEFF: "byte order mark",
    0xFFFD: "replacement character",
    0x00A0: "no-break space",
    0x00AD: "soft hyphen",
    0x200B: "zero width space",
    0x200C: "zero width non-joiner",
    0x200D: "zero width joiner",
}
HEADER_PATTERNS = [
    re.compile(r"^الجريدة الرسمية$"),
    re.compile(r"عدد 7485 -"),
    re.compile(r"ISSN"),
    re.compile(r"^\d{4}$"),
    re.compile(r"^نصوص عامة$"),
]
REQUIRED_TOKENS = ["ثلاثة", "ثلاثين", "خلال", "إلا", "لا"]
# "ثالثة" / "ثالثين" are what a naive extraction prints for "ثلاثة" / "ثلاثين"
PAIRS = [("ثلاثة", "ثالثة"), ("ثلاثين", "ثالثين")]

ARTICLE_LINE = re.compile(r"^###### المادة (\d+)$")
# Arabic letters and vowel marks make a word
TOKEN_SPLIT = re.compile(r"[^\u0621-\u064a\u064b-\u0652]+")


def tokens(text):
    return [t for t in TOKEN_SPLIT.split(text) if t]


def run(markdown, law, article_count):
    report = []
    lines = markdown.split("\n")

    # ---- structure of the file -------------------------------------------------
    if not markdown.endswith("\n") or markdown.endswith("\n\n"):
        _fail("the file must end with exactly one newline")
    if lines[0] != "# القانون رقم 58.25 المتعلق بالمسطرة المدنية":
        _fail("unexpected first line: %r" % lines[0])

    # ---- articles 1..N, once each, in order, none empty ----------------------
    numbers = []
    bodies = {}
    current = None
    for line in lines:
        if line.startswith("######"):
            m = ARTICLE_LINE.match(line)
            if not m:
                _fail("malformed article heading: %r" % line)
            current = int(m.group(1))
            numbers.append(current)
            bodies[current] = []
            continue
        if "المادة" in line and re.match(r"^#{1,6} ", line) and re.search(r"المادة \d+$", line):
            _fail("article heading at a wrong level: %r" % line)
        if line.startswith("#"):
            current = None
            continue
        if current is not None and line.strip():
            bodies[current].append(line)
    if numbers != list(range(1, article_count + 1)):
        missing = sorted(set(range(1, article_count + 1)) - set(numbers))
        repeated = sorted({n for n in numbers if numbers.count(n) > 1})
        _fail("articles are not exactly 1..%d in order (missing %r, repeated %r)"
              % (article_count, missing, repeated))
    empty = [n for n in numbers if not bodies[n]]
    if empty:
        _fail("empty articles: %r" % empty)
    if law.article_count != article_count:
        _fail("structure holds %d articles" % law.article_count)
    report.append("articles: %d, numbered 1..%d, each once, in order, none empty"
                  % (len(numbers), article_count))

    # ---- forbidden characters ----------------------------------------------------
    for lineno, line in enumerate(lines, 1):
        for ch in line:
            cp = ord(ch)
            if cp in FORBIDDEN_SINGLE:
                _fail("%s (U+%04X) at line %d" % (FORBIDDEN_SINGLE[cp], cp, lineno))
            if cp in BIDI_CONTROLS:
                _fail("bidi control U+%04X at line %d" % (cp, lineno))
            if 0xFB50 <= cp <= 0xFDFF or 0xFE70 <= cp <= 0xFEFE:
                _fail("Arabic presentation form U+%04X at line %d" % (cp, lineno))
            if 0x0660 <= cp <= 0x0669 or 0x06F0 <= cp <= 0x06F9:
                _fail("Arabic-Indic digit U+%04X at line %d" % (cp, lineno))
            if unicodedata.category(ch) in ("Cc", "Cf", "Co", "Cn", "Cs"):
                _fail("control or unassigned character U+%04X at line %d" % (cp, lineno))
        if line != line.strip():
            _fail("leading or trailing space at line %d" % lineno)
        if "  " in line:
            _fail("double space at line %d" % lineno)
    if "\t" in markdown or "\r" in markdown:
        _fail("tab or carriage return in the output")
    report.append("characters: no tatweel, bidi control, BOM, presentation form, "
                  "Arabic-Indic digit or replacement character")

    # ---- running headers ---------------------------------------------------------
    for lineno, line in enumerate(lines, 1):
        if lineno <= 6:
            continue          # the provenance block names the Gazette on purpose
        for pattern in HEADER_PATTERNS:
            if pattern.search(line):
                _fail("running header text at line %d: %r" % (lineno, line))
    report.append("running headers and page numbers: none")

    # ---- the words a naive extraction destroys ---------------------------------
    body = "\n".join(lines[6:])
    counts = {}
    for t in tokens(body):
        counts[t] = counts.get(t, 0) + 1
    for token in REQUIRED_TOKENS:
        if counts.get(token, 0) == 0:
            _fail("the word %r does not occur" % token)
    report.append("occurrences: " + "، ".join(
        "%s=%d" % (t, counts.get(t, 0)) for t in REQUIRED_TOKENS))
    for good, naive in PAIRS:
        report.append("occurrences: %s=%d / %s=%d"
                      % (good, counts.get(good, 0), naive, counts.get(naive, 0)))

    # ---- signatures of reversed ligatures ("االستئناف", "املحكمة", "إال") -------
    naive = [t for t in counts
             if re.match(r"^[وفبلك]?اال", t) or re.match(r"^[وفبل]?امل", t)
             or t in ("ال", "وال", "فال", "إال", "أال", "خالل", "ثالثين")]
    if naive:
        _fail("words that look like reversed ligatures: %r" % sorted(naive)[:20])
    report.append("reversed-ligature signatures (اال…، امل…، إال، خالل): none")

    # ---- titles and normal form ---------------------------------------------------
    for lineno, line in enumerate(lines, 1):
        if line.startswith("**"):
            if not (line.endswith("**") and lineno >= 3
                    and re.match(r"^#{2,5} ", lines[lineno - 3]) and lines[lineno - 2] == ""):
                _fail("bold title not placed right after its division heading, line %d" % lineno)
        elif "**" in line:
            _fail("unexpected bold markup at line %d" % lineno)
    if unicodedata.normalize("NFC", markdown) != markdown:
        _fail("the output is not in Unicode normal form C")
    report.append("division titles: each one right after its heading; text in NFC")

    # ---- uncertain readings ----------------------------------------------------------
    marked = markdown.count("[\u061f]")
    expected = sum(len(b.uncertain) for b in law.blocks)
    if marked != expected:
        _fail("%d uncertain-reading marker(s) in the text, %d expected" % (marked, expected))
    report.append("uncertain readings marked [\u061f]: %d" % marked)

    # ---- every bidirectional line was verified ---------------------------------
    unverified = [l for l in law.lines if l.text is None]
    if unverified:
        _fail("%d line(s) without verified reading order" % len(unverified))
    report.append("reading order: %d printed lines verified with the Unicode "
                  "bidirectional algorithm" % len(law.lines))
    return report
