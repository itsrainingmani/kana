"""Homoglyph groups within the recognizer's label space.

Characters in one group are visually identical (or indistinguishable at
handwriting fidelity) even though they are distinct codepoints — e.g. the
katakana へ and hiragana へ, or katakana カ and the kanji 力. No classifier
can separate them from strokes alone, and neither can a human without
context, so evaluation and app-side grading treat a prediction inside the
target's group as a hit. The write drill also uses the groups to teach the
twin ("same shape as katakana ni!") instead of marking a false miss.

Only pairs where stroke count *and* stroke shapes coincide belong here.
Near-twins that differ in stroke direction or count (シ/ツ, ソ/ン, コ/口,
り/リ) stay separate — the direction features genuinely distinguish them.
"""

HOMOGLYPH_GROUPS = [
    "へヘ",  # hiragana / katakana he
    "べベ",  # he + dakuten
    "ぺペ",  # he + handakuten
    "ニ二",  # katakana ni / kanji two
    "エ工",  # katakana e / kanji craft
    "ロ口",  # katakana ro / kanji mouth
    "カ力",  # katakana ka / kanji power
    "タ夕",  # katakana ta / kanji evening
    "ハ八",  # katakana ha / kanji eight
    "オ才",  # katakana o / kanji talent
    "りリ",  # hiragana / katakana ri — handwritten り routinely drops the
             # connecting hook, collapsing onto リ
]


def build_group_index(labels: list[str]) -> dict[int, int]:
    """label index -> group id (own index if not in any group)."""
    group_of = {}
    for group_id, group in enumerate(HOMOGLYPH_GROUPS):
        for char in group:
            group_of[char] = group_id

    index = {}
    for i, label in enumerate(labels):
        if label in group_of:
            index[i] = -1 - group_of[label]  # negative ids: shared group space
        else:
            index[i] = i
    return index
