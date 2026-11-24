"""Visual order <-> logical order for right-to-left Gazette lines.

The PDF paints every line from left to right (visual order). The text file
needs logical order (the order in which the text is read and typed).

``visual_to_logical`` is the inverse step used by the extraction.
``logical_to_visual`` is a forward implementation of the Unicode Bidirectional
Algorithm (UAX #9) restricted to what a right-to-left paragraph without
explicit embedding controls needs. It is used to *verify* every line: the
logical text we emit, once laid out by the standard algorithm, must give back
exactly the glyph order printed in the Gazette.
"""

import unicodedata

_NUMBER_JOINERS = ".,:/\u060c\u00a0"   # bidi class CS


def _cls(ch):
    return unicodedata.bidirectional(ch)


def _is_digit_unit(text):
    return bool(text) and all(c in "0123456789" for c in text)


def visual_to_logical(units, join_es=False):
    """Reorder ``units`` (objects with a ``.text``), given left to right.

    A unit is one glyph; a ligature glyph carries several characters already in
    logical order and is never split. Runs of digits (with a single separator
    of class CS between two digits, e.g. "1.26.07") are left-to-right islands:
    they keep their order. Everything else is right-to-left.

    ``join_es`` also keeps a single "-" or "+" between two digits inside the
    number (UAX #9 rule W4 for European numbers that do not follow an Arabic
    letter).
    """
    n = len(units)
    segments = []
    i = 0
    while i < n:
        if _is_digit_unit(units[i].text):
            j = i + 1
            while j < n:
                if _is_digit_unit(units[j].text):
                    j += 1
                    continue
                sep = units[j].text
                if (len(sep) == 1
                        and (sep in _NUMBER_JOINERS or (join_es and sep in "+-"))
                        and j + 1 < n and _is_digit_unit(units[j + 1].text)):
                    j += 2
                    continue
                break
            segments.append(units[i:j])
            i = j
        else:
            segments.append(units[i:i + 1])
            i += 1
    logical = []
    for seg in reversed(segments):
        logical.extend(seg)
    return logical


# ----------------------------------------------------------------------------
# Forward algorithm (verification)
# ----------------------------------------------------------------------------

def _resolve_types(chars, after_arabic_letter):
    """Rules W1-W7 and N1-N2 of UAX #9, paragraph level 1, no explicit codes."""
    types = [_cls(c) for c in chars]
    n = len(types)
    sos = "R"
    # W1: non-spacing marks take the type of the previous character
    prev = sos
    for i in range(n):
        if types[i] == "NSM":
            types[i] = prev if prev not in ("LRI", "RLI", "FSI", "PDI") else "ON"
        prev = types[i]
    # W2: European number after an Arabic letter becomes Arabic number
    last_strong = "AL" if after_arabic_letter else sos
    for i in range(n):
        t = types[i]
        if t in ("R", "L", "AL"):
            last_strong = t
        elif t == "EN" and last_strong == "AL":
            types[i] = "AN"
    # W3
    types = ["R" if t == "AL" else t for t in types]
    # W4: single separator between two numbers
    for i in range(1, n - 1):
        if types[i] == "ES" and types[i - 1] == "EN" and types[i + 1] == "EN":
            types[i] = "EN"
        elif types[i] == "CS" and types[i - 1] == types[i + 1] and types[i - 1] in ("EN", "AN"):
            types[i] = types[i - 1]
    # W5: European terminators next to European numbers
    i = 0
    while i < n:
        if types[i] == "ET":
            j = i
            while j < n and types[j] == "ET":
                j += 1
            before = types[i - 1] if i > 0 else None
            after = types[j] if j < n else None
            if before == "EN" or after == "EN":
                for k in range(i, j):
                    types[k] = "EN"
            i = j
        else:
            i += 1
    # W6
    types = ["ON" if t in ("ES", "ET", "CS") else t for t in types]
    # W7: European number after L becomes L (sos is R here)
    last_strong = sos
    for i in range(n):
        if types[i] in ("R", "L"):
            last_strong = types[i]
        elif types[i] == "EN" and last_strong == "L":
            types[i] = "L"
    # N1/N2: neutrals between two L take L, otherwise the embedding direction.
    # (Paired-bracket rule N0 gives the same result in a right-to-left
    # paragraph unless a pair encloses Latin text, which is handled by N1 here.)
    i = 0
    while i < n:
        if types[i] in ("ON", "WS", "B", "S", "BN"):
            j = i
            while j < n and types[j] in ("ON", "WS", "B", "S", "BN"):
                j += 1
            before = types[i - 1] if i > 0 else "R"
            after = types[j] if j < n else "R"
            before = "R" if before in ("EN", "AN") else before
            after = "R" if after in ("EN", "AN") else after
            fill = "L" if (before == "L" and after == "L") else "R"
            for k in range(i, j):
                types[k] = fill
            i = j
        else:
            i += 1
    return types


def logical_to_visual(chars, after_arabic_letter):
    """Return the indexes of ``chars`` in display order (left to right)."""
    types = _resolve_types(chars, after_arabic_letter)
    # I2 for the odd paragraph level 1: R stays 1, L/EN/AN go to 2
    levels = [1 if t == "R" else 2 for t in types]
    # L1: trailing whitespace goes back to the paragraph level
    k = len(chars) - 1
    while k >= 0 and _cls(chars[k]) in ("WS", "B", "S"):
        levels[k] = 1
        k -= 1
    order = list(range(len(chars)))
    # L2: reverse runs from the highest level down to 1
    for level in (2, 1):
        i = 0
        while i < len(order):
            if levels[order[i]] >= level:
                j = i
                while j < len(order) and levels[order[j]] >= level:
                    j += 1
                order[i:j] = reversed(order[i:j])
                i = j
            else:
                i += 1
    return order


def contains_arabic_letter(text):
    return any(_cls(c) == "AL" for c in text)
