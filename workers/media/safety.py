"""Worker-side safety checks.

The app is the main line of defence: it screens every prompt and runs Hive image
moderation on every image and video frame before anything is stored. These checks
make the worker refuse obviously bad requests on its own, so a leaked worker key
or a bug in the app can't turn the GPU into a generator for prohibited content.
"""

from __future__ import annotations

import csv
import logging
import os
import re
import threading
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Iterable, List, Optional

import numpy as np
from PIL import Image

log = logging.getLogger("media-worker.safety")

# Mirrors the app's text screen (src/server/safety/text.ts): the same
# normalization, checkText's rules (refused as "minor:...", "prohibited:...",
# "real_person:...") and checkImagePrompt's image-only rules (refused as
# "term:..."), so the worker refuses what the app refuses. Change both together.
# The app files "minor:" refusals as minor content; "term:" ones are words that
# are fine in chat ("my kids", "a minor tilt") but never in a picture, and say
# nothing about anyone. The negative prompt is expected to contain these words;
# screen_negative refuses one that names an adult instead.

# Letters from other scripts that pass for a Latin letter, by the letter.
_LOOKALIKES = {
    "a": "аɑαᴀ", "b": "вьʙ", "c": "сϲᴄ", "d": "ԁđᴅ", "e": "еєεᴇɛɇҽ", "g": "ɡɢ", "h": "һнħʜ", "i": "іıɩιɪɨ",
    "j": "јᴊ", "k": "кκᴋ", "l": "ӏłʟ", "m": "мᴍ", "n": "пηɴո", "o": "оοσօøᴏ", "p": "рρᴘ", "q": "ԛ", "r": "гʀ",
    "s": "ѕꜱʂ", "t": "тτŧᴛƭ", "u": "υᴜ", "v": "νᴠ", "w": "ԝшωᴡ", "x": "хχ", "y": "уүγʏ", "z": "ᴢ",
}
_CONFUSABLE = {char: latin for latin, chars in _LOOKALIKES.items() for char in chars}
# Zero-width and format characters, combining marks, Hangul fillers, and code
# points this Python's Unicode doesn't know yet: Node, with a newer Unicode, strips
# newer marks such as U+0897 as combining marks, so they must not split a word here.
_INVISIBLE_CATEGORIES = {"Cf", "Mn", "Me", "Cn"}
_HANGUL_FILLERS = {"ᅟ", "ᅠ", "ㅤ", "ﾠ"}
# Regional indicators and negative circled or squared letters, by first code point.
_ENCLOSED = [(0x1F1E6, 0x1F1FF), (0x1F170, 0x1F189), (0x1F150, 0x1F169)]
_LEET = {
    "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "!": "i", "|": "l", "€": "e",
    "+": "t",
}


def _unenclose(char: str) -> str:
    point = ord(char)
    for first, last in _ENCLOSED:
        if first <= point <= last:
            return chr(0x61 + point - first)
    return char


def _unconfuse(word: str) -> str:
    if all(char < "\x80" or char in _CONFUSABLE for char in word):
        return "".join(_CONFUSABLE.get(char, char) for char in word)
    return word


def _unconfuse_words(text: str) -> str:
    """Runs of letters (any L category, as the app's \\p{L}), each read as Latin when it can be."""
    out: List[str] = []
    word: List[str] = []
    for char in text:
        if unicodedata.category(char).startswith("L"):
            word.append(char)
            continue
        out.append(_unconfuse("".join(word)))
        word = []
        out.append(char)
    out.append(_unconfuse("".join(word)))
    return "".join(out)


def _fraction(match: re.Match) -> str:
    """ "13½" reads "13 1/2", not "131⁄2"."""
    return " " + unicodedata.normalize("NFKD", match.group(0)).replace("\u2044", "/")


def _fold(text: str) -> str:
    text = re.sub("[\u00bc-\u00be\u2150-\u215e]", _fraction, text)
    text = "".join(_unenclose(c) for c in unicodedata.normalize("NFKD", text).lower())
    text = "".join(c for c in text if unicodedata.category(c) not in _INVISIBLE_CATEGORIES and c not in _HANGUL_FILLERS)
    text = unicodedata.normalize("NFC", text)
    text = re.sub("[‘’ʼ′`]", "'", text)
    text = re.sub("[“”„‟]", '"', text)
    text = re.sub(r"\s+", " ", text)
    text = _unconfuse_words(text)
    return re.sub(r"([a-z])\1{2,}", r"\1\1", text)


def _unleet(text: str, one: str) -> str:
    """Digits and symbols count as letters only inside a word ("l0li", "t€€n", "+33n")."""

    def letter(char: str) -> str:
        return one if char in "1|" else _LEET.get(char, char)

    def letters(match: re.Match) -> str:
        return "".join(letter(char) for char in match.group(0))

    text = re.sub(r"(?<=[a-z0-9])[@$!|]+(?=[a-z0-9])|(?<=[a-z])[€+]+(?=[a-z0-9])|(?<=[a-z0-9])[€+]+(?=[a-z])",
                  letters, text)
    text = re.sub(r"[a-z0-9]*[a-z][a-z0-9]*", lambda m: re.sub(r"[0-9]", lambda d: letter(d.group(0)), m.group(0)),
                  text)
    return re.sub(r"(?<![a-z0-9])[€+]+(?=[a-z])", letters, text)


def _join_spelled(text: str) -> str:
    """Reads "t e e n", "c.h.i.l.d" and "t/e/e/n" as words; "a k i d" reads as "a kid"."""

    def join(match: re.Match) -> str:
        run = match.group(0)
        letters = re.sub(r"[^a-z]", "", run)
        return f"{letters[0]} {letters[1:]}" if re.match(r"[ai] ", run) and len(letters) > 3 else letters

    return re.sub(r"\b[a-z](?:[^a-z0-9'\"]{1,3}[a-z]\b){2,}", join, text, flags=re.ASCII)


def _join_punctuated(text: str) -> str:
    """Reads "lo.li" as a word; a space never joins, so "lol icon" stays apart."""
    return re.sub(r"(?<=[a-z])[^a-z0-9\s']+(?=[a-z])", "", text)


def _normalize(text: str) -> str:
    return _unleet(_fold(text), "i")


def _views(prompt: str) -> List[str]:
    folded = _fold(prompt)
    plain = _unleet(folded, "i")
    readings = [folded, plain, _unleet(folded, "l"), _join_spelled(plain), _join_punctuated(folded),
                _join_punctuated(plain)]
    return list(dict.fromkeys(readings))


def _escape(text: str) -> str:
    return re.sub(r"[.*+?^${}()|[\]\\]", r"\\\g<0>", text)


def _words(words: List[str]) -> str:
    """Words for a pattern, folded the way the text is ("мне" reads "mhe")."""
    return "|".join(_escape(_fold(word)) for word in words)


def _terms(terms: List[str]) -> str:
    """A space in a term needs a separator, a hyphen allows one or none; a plural s and "-ish" are optional."""
    alternatives = [
        re.sub(r"[ -]", lambda m: "[^a-z0-9]{1,3}" if m.group(0) == " " else "[^a-z0-9]{0,3}", _escape(_fold(term)))
        for term in terms
    ]
    return r"(?<![a-z])(?:" + "|".join(alternatives) + r")(?:e?s)?(?:\s?-?\s?ish)?(?![a-z])"


_MINOR_TERMS = [
    "teen", "teenage", "teenaged", "teenager", "teenish", "teenybopper", "pre-teen", "tween", "under-age",
    "underaged", "loli", "lolita", "lolicon", "shota", "shotacon", "jail-bait", "pedo", "paedo", "pedophile",
    "paedophile", "pedophilia", "paedophilia", "school-girl", "school-boy", "infant", "toddler", "age-play",
    "pre-pubescent", "pubescent", "child-like", "aged-down", "female-child", "male-child", "ddlg", "mdlg", "ddlb",
    "mdlb", "cgl", "abdl", "littlespace", "high-schooler", "middle-schooler", "grade-schooler",
    "elementary-schooler", "pre-schooler", "kindergartner", "kindergartener", "school uniform", "little-girl",
    "little-boy", "lil-girl", "lil-boy", "young-girl", "young-boy", "young-looking", "looks young",
    "looks underage", "barely-legal", "kid sister", "kid brother", "chica de secundaria", "chico de secundaria",
    "alumna de secundaria", "in diapers", "training bra", "schulmädchen", "kleines mädchen", "kleine mädchen",
    "schülerin", "colegiala", "menor de edad", "menores de edad", "minderjährig", "minderjährige",
    "minderjährigen", "minorenne", "minorenni", "petite fille", "petites filles", "lycéenne", "collégienne",
    "novinha", "школьница", "школьник", "несовершеннолетняя", "несовершеннолетний", "малолетка", "中学生",
    "小学生", "高校生", "女子高生", "初中生", "高中生", "幼女", "児童", "未成年", "ロリ", "ショタ", "萝莉", "초등학생",
    "중학생", "고등학생", "여고생", "미성년자", "pthc", "nymphet", "nymphette", "girl-child", "boy-child", "mesugaki",
    "shougakusei", "shogakusei", "chuugakusei", "chugakusei", "joshi-kousei", "joshi-kosei", "kinderporno",
    "kinderpornos", "kinderpornografie", "kinderpornographie", "kinderficker", "nacktes kind", "nackte kinder",
    "nackten kinder", "kinder nackt", "fillette", "écolière", "garotinha", "menininha", "niñita", "小女孩", "小男孩",
    "女童", "男童", "幼童", "蘿莉", "女児", "男児", "초딩", "중딩", "고딩", "쇼타",
]
# Child words in Chinese, Japanese and Korean, which mark no word boundaries;
# "幼儿园" (kindergarten) and "칼로리" (calorie) are the everyday words around them.
_CJK_CHILD = r"儿童|兒童|小孩|孩子|子供|子ども|こども|어린이|少女|소녀|正太|(?<![칼플글])로리"
# Schools below high school, except as a workplace ("I teach middle school math").
_LOWER_SCHOOLS = ["middle-school", "elementary-school", "grade-school", "primary-school", "junior-high", "jr-high"]
# Ordinary words in adult talk: they block only next to sexual words or an age.
_AMBIGUOUS_TERMS = [
    "kid", "kiddo", "kiddie", "child", "children", "childish", "minor", "high-school", "kindergarten", "little one",
    "little sister", "little brother", "youngster", "adolescent", "adolescente", "juvenile", "newborn", "diaper",
    "cub", "ragazzina", "menina", "девочка", "мальчик", "imouto", "kodomo", "enfant", "criança", "ребенок", "дети",
]
# German "Kind" is also English "kind", so it counts only after a German word.
_GERMAN_CHILD = (
    r"(?<![a-z])(?:das|ein|einem|einen|eines|dem|des|kleines|kleine|kleinen|kleiner|junges|jungen|mein|meine|meinem|"
    r"meinen|dein|deine|unser|unsere|zwei|drei|vier|die) kind(?:er|ern|es)?(?![a-z])"
)
# Not words with an everyday use next to "kids" ("turned on the TV", "sex ed").
_SEXUAL_TERMS = [
    "sex", "sexy", "sexual", "sexually", "nude", "naked", "nudity", "porn", "porno", "nsfw", "erotic", "horny",
    "aroused", "fuck", "fucked", "fucking", "fuckin", "cum", "cumming", "cock", "pussy", "cunt", "clit", "tits",
    "titties", "boobs", "genital", "penis", "vagina", "blowjob", "handjob", "orgasm", "masturbate", "masturbating",
    "undress", "undressing", "undressed", "lingerie", "panties", "seduce", "seducing", "fondle", "fondling",
    "kinky", "fetish", "bdsm", "lewd", "hentai", "make love", "making love", "jerk off", "jerking off", "desnuda",
    "desnudo", "nue", "nackt", "nackte", "nuda", "nudo", "nua", "sexo", "sexe", "follar", "baiser", "ficken",
    "scopare", "foder", "geil", "cachonda", "голая", "голый", "голые", "секс", "エッチ", "セックス", "ヌード", "做爱",
    "性交", "裸", "섹스", "누드", "알몸",
]
# Any sexual word at all: a sentence with one of these is never just a policy.
_ANY_SEXUAL = re.compile(_terms(_SEXUAL_TERMS + [
    "nudes", "sext", "sexting", "sexted", "xxx", "dick", "anal", "moan", "moaning", "hump", "humping", "virgin",
    "turned on", "strip",
]), re.ASCII)
_AMBIGUOUS = f"(?:{_terms(_AMBIGUOUS_TERMS)}|{_GERMAN_CHILD})"
_SEXUAL = _terms(_SEXUAL_TERMS) + r"(?! (?:ed|education)\b)"
# A plainly sexual word, for rules that turn on one (not "turned on the TV").
_SEXUAL_WORD = re.compile(f"{_SEXUAL}|{_terms(['nudes', 'sext', 'sexting', 'sexted', 'slut', 'whore'])}", re.ASCII)
# Within five words, unless a new clause about the writer starts in between.
_CLAUSE = (
    r"[,.;:!?]\s?(?:(?:and|so|but|now|then|because|cause) )?"
    r"(?:i|i'm|im|i've|ive|i'd|i'll|we|we're|let's|lets|you|u|you're|ur|wanna)\b"
)
_GAP = rf"(?:(?:(?!{_CLAUSE})[^a-z0-9])+[a-z0-9]+){{0,5}}?(?:(?!{_CLAUSE})[^a-z0-9])+"
_NEAR_SEXUAL = rf"{_AMBIGUOUS}{_GAP}{_SEXUAL}|{_SEXUAL}{_GAP}{_AMBIGUOUS}"
# The same in Chinese, Japanese and Korean: within a dozen characters in one sentence.
_CJK_NEAR = r"[^.!?;。！？；]{0,12}?"
_NEAR_SEXUAL_CJK = rf"(?:{_CJK_CHILD}){_CJK_NEAR}(?:{_SEXUAL})|(?:{_SEXUAL}){_CJK_NEAR}(?:{_CJK_CHILD})"

_SPELLED_TEEN = "ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen"
_SPELLED_SMALL = "two|three|four|five|six|seven|eight|nine"
_SPELLED_UNDER_18 = f"one|{_SPELLED_SMALL}|{_SPELLED_TEEN}"
_SPELLED_FOREIGN = (
    r"diez|once|doce|trece|catorce|quince|dieciseis|diecisiete|dez|onze|doze|treze|catorze|quatorze|dezesseis|"
    r"dezasseis|dezessete|dezassete|dix|douze|treize|seize|dix[\s-]?sept|zehn|elf|zwolf|dreizehn|vierzehn|funfzehn|"
    r"sechzehn|siebzehn|dieci|undici|dodici|tredici|quattordici|quindici|sedici|diciassette|"
    + _words(["десять", "одиннадцать", "двенадцать", "тринадцать", "четырнадцать", "пятнадцать", "шестнадцать",
              "семнадцать"])
)
_MEASURES = (
    r"minutes?|mins?|hours?|hrs?|seconds?|secs?|days?|weeks?|wks?|months?|decades?|feet|foot|ft|inch(?:es)?|cm|mm|"
    r"m|meters?|metres?|kg|kgs|lbs?|pounds?|stones?|miles?|mi|km|kms|percent|degrees?|times|points?|pts|o'clock|am|"
    r"pm|a\.m|p\.m|of|out(?:ta)?|more(?! or less)|less|items|things|steps|calls|messages|texts|dollars?|bucks|"
    r"euros?|credits|million|thousand|hundred|grand|stars?|drinks?|shots?|beers?|glass(?:es)?|cups?|bottles?|"
    r"pints?|episodes?|pages?|chapters?|books?|movies?|shows?|seasons?|songs?|games?|rounds?|laps?|reps?|sets?|"
    r"floors?|stor(?:e?ys|ies)|levels?|blocks?|stops?|dates|cats?|dogs?|pets?|followers|likes|tries|attempts|"
    r"reasons|ways|nights|shifts?|classes|lessons|pics|photos|videos|ahead|behind|away|late|early|deep|in a row|"
    r"in my (?:book|eyes|opinion)|in(?=\s?(?:$|[.,!?)]|long|thick|wide|tall))"
)
_UNITS = rf"{_MEASURES}|others?|people|persons?|guys|girls|kids"
_YEARS_COUNT = (
    r"(?:years?|yrs?)\s(?!(?:old|young|of age|and|now|lol|lmao|haha|btw|but|so|yet|already|today|tho|though|wanna|"
    r"want|is|almost|nearly|turning|plus|ok|okay|too)\b)[a-z]"
)


def _not_an_age(units: str) -> str:
    return (
        r"""(?!\s?(?:['"]\s?\d|(?:"|'')\s?(?:long|thick|wide|girth|around|cock|dick)\b|(?:-|to|or|and|/)\s?\d+\s?"""
        rf"""(?:{units}|years?|yrs?)\b|:\d|%|/(?!\s?(?:[fm]\b|1[1-8](?![0-9])))|x\b|"""
        rf"""(?:[.,]\d+|\s?and a half|\s\d/\d)?\s?(?:{units})\b|{_YEARS_COUNT}))"""
    )


_NOT_AN_AGE = _not_an_age(_UNITS)
_AGE_ENDS = (
    rf"(?=\s?(?:$|[!?;)]|[.,:](?!\d)|and\b(?! a half\s?(?:{_UNITS})\b)|\d/\d(?!\s?(?:{_UNITS})\b)|btw\b|lol\b|"
    r"lmao\b|haha\b|now\b|yet\b|already\b|today\b|tho\b|though\b|but\b|y/?o\b|y\.o|years? old|yrs? old|year-old))"
)
_ISH = r"(?:\s?-?\s?ish)?"
_TEEN = f"(?:1[0-7]|{_SPELLED_TEEN})"
_AGE = rf"(?:{_TEEN}{_ISH}(?:\b|(?=y)){_NOT_AN_AGE}|(?:[1-9]|{_SPELLED_SMALL}){_ISH}\b{_AGE_ENDS})"
_UNDER_18 = f"(?:[1-9]|1[0-7]|{_SPELLED_UNDER_18})"
_HALF = r"(?:\s\d/\d|\s?and a half|\.5)?"
_YEARS_OLD = rf"\b{_UNDER_18}{_HALF}\s?-?\s?(?:y\s?[./]?\s?o|(?:yrs?|years?)\s?-?\s?(?:old|young))\b"
# Also as a plural: "12 year olds", "12yos".
_YEARS_OLDS = rf"\b{_UNDER_18}{_HALF}\s?-?\s?(?:y\s?[./]?\s?o|(?:yrs?|years?)\s?-?\s?(?:old|young))s?\b"
# The writer is the parent or carer, not the child: "a proud 5 year old's mom".
_NOT_THE_CHILD = (
    r"(?!'s|s'|\s?(?:mom|mum|mother|mama|dad|father|papa|parent|sitter|nanny|teacher|twins?|son|daughter)\b)"
)
# Up to two words between "a" and the age, but not "a mom of 12 year olds" or "this whisky is 12 years old".
_ADJECTIVES = (
    r"(?:(?!(?:of|for|with|to|from|by|in|on|at|as|like|than|and|or|but|so|that|which|who|my|our|your|his|her|"
    r"their|its|it's|the|a|an|this|these|those|is|are|was|were|am|be|been|being|has|have|had|will|would|can|could|"
    r"should|does|did|do|turned|turns|turning|looks|seems|just|only|about|around|over|under|almost|nearly)\b)"
    r"[a-z]+ ){0,2}?"
)

_PERSON = "(?:you|u|i|she|he|they|we|who)"
_COPULA = (
    rf"(?:{_PERSON} (?:are|r|am|m|is|was|were)|you're|youre|ur|i'm|im|she's|shes|he's|hes|they're|theyre|we're|"
    r"who's)"
)
_PRESENT = (
    r"(?:(?:you|u|i|she|he|they|we) (?:are|r|am|m|is)|you're|youre|ur|i'm|im|she's|shes|he's|hes|they're|theyre|"
    r"we're)"
)
_WILL_BE = rf"(?:{_PERSON}(?:'ll| will) be|(?:youll|ill|shell|theyll) be)"
_SUBJECT = (
    rf"(?:{_COPULA}|{_WILL_BE}|{_PERSON} (?:look|seem|seems|appear|appears)(?: like| to be)?|"
    r"look(?:s|ing)?(?: like)?|turn(?:ed|ing|s)?|pretend(?:ing)? to be|act(?:ing)? (?:like|as)|"
    r"roleplay(?:ing)? as|play(?:ing)? as|pass(?:es)? for)"
)
_HEDGE = (
    r"(?:only|just|like|about|around|barely|now|maybe|probably|almost|nearly|under|below|still|literally|actually|"
    r"really|basically|supposedly|clearly|obviously|definitely|not even|not yet|younger than|less than|"
    r"no older than|no more than|at most|turning|going on|gonna be|going to be|about to be|about to turn|soon to be|between)"
)
_GRADE_ORDINAL = "second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth"
_SCHOOL = r"high[ -]?school|hs|middle[ -]?school|junior[ -]?high|jr\.?[ -]?high|secondary(?: school)?"
_IN_SCHOOL = (
    rf"(?:(?:a (?:freshman|sophomore|junior|senior|student) )?in (?:the )?(?:{_SCHOOL}|elementary(?: school)?|"
    rf"grade[ -]?school|primary[ -]?school|kindergarten|(?:(?:[1-9]|1[0-2])(?:st|nd|rd|th)|first|{_GRADE_ORDINAL})"
    r"[ -]?grade|(?:year|yr) (?:[7-9]|1[0-3]|seven|eight|nine|ten|eleven|twelve|thirteen)(?! of\b)|"
    rf"class (?:[1-9]|1[0-2])(?! of\b))|a (?:{_SCHOOL}) (?:freshman|sophomore|junior|senior|student)|"
    r"a (?:freshman|sophomore|junior|senior) (?:at|in) (?:[a-z]+ ){1,2}?(?:high|middle|junior high|jr\.? high)"
    r"(?: school)?(?=\s?(?:$|[^a-z0-9 ]|(?:lol|and|but|so|now|btw)\b)))\b"
    r"(?!\s?-?\s?(?:drop|pick|parking|car|line|lot|reunion|gym|office|building|district|board|teachers?|staff|"
    r"principal|nurse|counselor|parents?|pta|fundraiser|games?|football|musical|play|dance|auditorium|cafeteria|"
    r"library|bus|run|zone|traffic|lobby)\b)"
)


def _stated_age(subject: str, age: str) -> str:
    return rf"\b{subject} (?:{_HEDGE} ){{0,2}}(?:(?:at )?(?:the )?age (?:of )?|aged )?{age}"


def _stated_years_old(subject: str) -> str:
    return rf"\b{subject} (?:{_HEDGE} ){{0,2}}(?:an? )?{_ADJECTIVES}{_YEARS_OLD}{_NOT_THE_CHILD}"


def _minor_noun(subject: str) -> str:
    return (
        rf"\b{subject} (?:(?:still|just|only|basically|literally|technically|legally|clearly|obviously) )?(?:a )?"
        r"minors?(?=\s?(?:$|[^a-z0-9 ]|(?:and|but|who|so|in|at|with|lol|btw|too|right|tho|though|yet|still|now|ish|"
        r"here|there)\b))"
    )


# "I'm just a kid", but not "I'm a kid at heart" or "a child of the 80s".
_FIRST_PERSON_KID = (
    r"\b(?:i am|i m|i'm|im) (?:(?:just|only|still|basically|literally|technically|legally|really|actually) ){0,2}"
    r"(?:a )?(?:little )?(?:kid|child)(?=\s?(?:$|[^a-z0-9 ]|(?:and|but|who|so|lol|lmao|haha|btw|too|tho|though|yet|"
    r"still|now|here|rn|ok|okay|honestly)\b))"
)

Waiver = Callable[[str, re.Match], bool]


class _Rule:
    """A pattern, and optionally a waiver for a match that is plainly something else (chat only)."""

    def __init__(self, pattern: str, unless: Optional[Waiver] = None):
        self.pattern = re.compile(pattern, re.ASCII)
        self.unless = unless


def _sentence_of(text: str, match: re.Match) -> str:
    start = max(text.rfind(stop, 0, match.start() + 1) for stop in ".!?;") + 1
    ends = [at for at in (text.find(stop, match.end()) for stop in ".!?;") if at >= 0]
    return text[start:min(ends) if ends else len(text)]


def _sexual_sentence(text: str, match: re.Match) -> bool:
    return bool(_ANY_SEXUAL.search(_sentence_of(text, match)))


_POLICY_SUBJECT = re.compile(
    r"(?:^|[^a-z])(?:no one|noone|nobody|anyone|anybody|everyone|people|persons|users|members|players|guests|"
    r"visitors|customers|kids|children|minors|those|ages?)(?: aged?)? $"
)
_POLICY_VERB = re.compile(
    r"^\s?,?\s?(?:is|are|isn't|isnt|aren't|arent|can|can't|cant|cannot|should|shouldn't|may|must|mustn't|will|won't|"
    r"need|needs|have to|has to|allowed|permitted|welcome|admitted|get|gets|go|eat|eats|ride|rides|pay|pays|play|"
    r"plays|enter|travel|stay|use|join|sign|not allowed|banned|prohibited|free|only)\b",
    re.ASCII,
)


def _policy(text: str, match: re.Match) -> bool:
    """ "no one under 18 is allowed", "kids under 12 eat free", with nothing sexual in the sentence."""
    return (bool(_POLICY_SUBJECT.search(text[:match.start()])) and bool(_POLICY_VERB.search(text[match.end():]))
            and not _sexual_sentence(text, match))


_WORK_BEFORE = re.compile(
    r"\b(?:teach|teaches|taught|teaching|teachers?|work|works|worked|working|job|employed|volunteer|volunteers|"
    r"volunteered|volunteering|substitute|sub|coach|coaches|coached|coaching|principal|staff|nurse|counselor|"
    r"secretary|janitor|librarian|aide)\b",
    re.ASCII,
)
_WORK_AFTER = re.compile(
    r"^(?:[^a-z0-9]+[a-z0-9]+){0,3}?[^a-z0-9]+(?:teachers?|teaching|principal|staff|nurse|counselor|librarian|"
    r"coach|secretary|janitor|administrator|aide|district|faculty)\b",
    re.ASCII,
)


def _workplace(text: str, match: re.Match) -> bool:
    """ "I teach middle school math", "a middle school math teacher"."""
    before = " ".join(text[:match.start()].split(" ")[-5:])
    return bool(_WORK_BEFORE.search(before)) or bool(_WORK_AFTER.search(text[match.end():]))


_FAMILY = re.compile(r"^(?:son|daughter|kid|kiddo|child|nephew|niece|boy)$")


def _own_child(text: str, match: re.Match) -> bool:
    """ "my son is 10": a parent on their own child, with nothing sexual in the sentence."""
    noun = match.group(2) if match.re.groups >= 2 else None
    return (match.group(1) in ("my", "our") and (noun is None or bool(_FAMILY.match(noun)))
            and not _sexual_sentence(text, match))


_PERSON_NOUNS = (
    r"girl|boy|kid|kiddo|child|daughter|son|sister|brother|niece|nephew|cousin|student|pupil|stepdaughter|"
    r"stepsister|stepson|stepbrother|babysitter|neighbou?r|virgin|lass|lad|bride|princess|cheerleader|maid|slut|"
    r"whore|chick|babe|baby|blonde|brunette|redhead|female|male|woman|man|lady|guy|person|human|version|character|"
    r"persona"
)


def _recent_years() -> str:
    """Born this year or in the 17 before it."""
    now = datetime.now(timezone.utc).year
    return "|".join(str(now - back) for back in range(18))


_NOT_A_NAME = (
    r"yes|no|nope|yep|yeah|ok|okay|sure|maybe|about|around|like|only|just|lol|haha|hmm|um|uh|so|and|or|exactly|"
    r"perhaps|thanks|please|well|oh|ah|mm|hm|idk|at|by|after|before|until|till|from|to|than|is|was|be|are|were|am|"
    r"it|its|the|a|an|of|in|on|for|with|out|up|now|then|today|tonight|tomorrow|size|page|chapter|level|floor|room|"
    r"table|gate|season|episode|number|apt|unit|suite|grade|score|round|lap|rep|reps|set|part|step|bus|route|exit|"
    r"channel|row|seat|section|platform|game|match|volume|book|issue|act|scene|top|tops|max|min|over|under|past|"
    r"nearly|almost|half|times|plus|minus|me|you|u|him|her|them|us|my|your|our|his|their|got|have|has|had|need|"
    r"want|take|give|make|pick|say|guess|answer|total|age|ages|aged|turn|turned|turning"
)
_YEAR_WORDS = "anos|anitos|ans|anni|jahre|jahren|jaar|" + _words(["лет", "года", "год"])
# With a person as the subject; Italian "ha" is also Portuguese "há", so Italian needs "anni".
_FOREIGN_SELF = _words([
    "tengo", "tienes", "ella tiene", "él tiene", "tenía", "cumplo", "cumples", "ella cumple", "él cumple", "cumplí",
    "tenho", "tens", "ela tem", "ele tem", "você tem", "eu tinha", "ela tinha", "faço", "fiz", "j'ai", "jai",
    "tu as", "elle a", "il a", "j'avais", "elle avait", "ich bin", "du bist", "sie ist", "er ist", "ich war",
    "sie war", "ich werde", "sie wird", "ik ben", "zij is", "hij is", "мне", "ей", "ему", "тебе", "мне было",
    "ей было", "мне уже", "ей уже", "мне только", "ей только",
])
_FOREIGN_GIRL = _words([
    "chica", "chico", "niña", "niño", "nena", "hija", "hijo", "hermana", "hermano", "sobrina", "estudiante",
    "alumna", "alumno", "muchacha", "chavala", "fille", "fillette", "garçon", "gamine", "ado", "adolescente",
    "étudiante", "élève", "sœur", "soeur", "nièce", "ragazza", "ragazzo", "bambina", "bambino", "figlia", "sorella",
    "studentessa", "alunna", "mädchen", "junge", "tochter", "schwester", "nichte", "menina", "menino", "garota",
    "garoto", "moça", "filha", "irmã", "sobrinha", "aluna", "meisje", "jongen",
])
_ITALIAN_SELF = _words(["ho", "hai", "ha", "avevo", "aveva", "compio", "lei ha", "lui ha"])
_FOREIGN_NUMBER = f"(?:1[0-7]|[1-9]|{_SPELLED_FOREIGN})"
_FOREIGN_START = r"""(?<![^\s.,;:!?"'()])"""
# Where a stated age ends, so "j'ai 10 ans de plus que toi" doesn't read as one.
_FOREIGN_END = rf"(?=\s?(?:$|[^a-z0-9\s\u0400-\u04ff]|(?:und|y|e|et|i|a|en|ja|{_words(['и'])})(?![a-z\u0400-\u04ff])))"

# A stated age in reply to a rating question ("from 1 to 10? I'm 10") and "feel
# like a teenager again" aren't about a minor. Only a number after the question,
# in a sentence with nothing sexual, counts as the reply.
_RATING = re.compile(
    r"\b(?:(?:from|between|scale of|rate (?:it|me|you|her|him|this)) (?:0|1|one|zero) ?(?:-|to|and|through) ?"
    r"(?:10|ten)\b|out of (?:10|ten)\b)",
    re.ASCII,
)
_TEEN_AGAIN = re.compile(r"\b(?:feel|feels|felt|feeling)(?: like)? (?:a )?teen(?:ager)?s? again\b", re.ASCII)


def _rated(sentence: re.Match) -> str:
    text = sentence.group(0)
    if _SEXUAL_WORD.search(text):
        return text
    return re.sub(r"\b(1[0-2]|ten|eleven|twelve)\b(?!\s?/)", r"\1/10", text, flags=re.ASCII)


def _relax(text: str) -> str:
    question = _RATING.search(text)
    if question:
        text = text[:question.end()] + re.sub(r"[^.!?;]+", _rated, text[question.end():])
    return _TEEN_AGAIN.sub("feel young again", text)


_BELOW_N = (
    rf"\b(?:under|below|younger than|sub)\s?-?\s?(?:the )?(?:age (?:of )?)?(?:1[0-8]|{_SPELLED_TEEN}|eighteen|"
    rf"consent|legal age)\b{_not_an_age(_MEASURES)}"
)
_CJK = r"\u3040-\u30ff\u4e00-\u9fff"

_MINOR_RULES = [
    _Rule(_terms(_MINOR_TERMS)),
    _Rule(r"幼[儿兒](?![园園])"),
    _Rule(_terms(_LOWER_SCHOOLS), _workplace),
    _Rule(_NEAR_SEXUAL),
    _Rule(_NEAR_SEXUAL_CJK),
    _Rule(_FIRST_PERSON_KID),
    _Rule(r"(?<![a-z])child(?:ish|like)? (?:body|frame|figure|build|face|features|proportions|physique|chest|hips)"
          r"(?![a-z])"),
    _Rule(_minor_noun(_COPULA)),
    _Rule(rf"\b{_PRESENT} (?:(?:still|currently|only|just) )?{_IN_SCHOOL}"),
    # "I go to Lincoln High", but not "I go to high school reunions".
    _Rule(r"\b(?:i|im|i'm) (?:still |currently )?(?:go|going|attend|attending) (?:to )?(?:[a-z]+ ){0,2}?"
          r"(?:high|middle|junior high|jr\.? high|elementary)(?: school)?"
          r"(?=\s?(?:$|[^a-z0-9 ]|(?:lol|and|but|so|now|btw)\b))"),
    _Rule(rf"(?<!was )(?<!were )\bstill {_IN_SCHOOL}"),
    _Rule(rf"(?<![a-z])j[kcs](?=[{_CJK}])|(?<=[{_CJK}])j[kcs](?![a-z])"),
]

def _not_sexual(text: str, match: re.Match) -> bool:
    return not _SEXUAL_WORD.search(_sentence_of(text, match))


_AGE_RULES = [
    # Any "N year old(s)" in a sentence with a plainly sexual word.
    _Rule(_YEARS_OLDS, _not_sexual),
    _Rule(_stated_age(_SUBJECT, _AGE)),
    _Rule(_stated_years_old(_SUBJECT)),
    _Rule(
        r"\b(?:(my|our|the|a|an|this|that|your|his|her|their) )?(?:(?:little|lil|big|baby|younger|older|kid|step) ?)?"
        r"(girl|boy|kid|kiddo|child|daughter|son|sister|brother|niece|nephew|cousin|student|pupil|stepdaughter|"
        r"stepsister|stepson|stepbrother|babysitter|neighbou?r|virgin|bride|princess|cheerleader|maid)"
        rf"(?:s? (?:is|was|are|were|turned|turns|looks?|seems?)|'s) (?:{_HEDGE} ){{0,2}}(?:an? )?"
        rf"(?:{_AGE}|{_YEARS_OLD})",
        _own_child,
    ),
    _Rule(rf"{_YEARS_OLD}(?:[^a-z0-9]{{1,3}}[a-z]+){{0,2}}?[^a-z0-9]{{1,3}}(?:{_PERSON_NOUNS})s?\b"),
    _Rule(rf"\b(?:[1-9]|1[0-7]|{_SPELLED_UNDER_18})\s?-?\s?(?:yrs?|years?)[^a-z0-9]{{1,3}}"
          r"(?:girl|boy|kid|child|daughter|son|student|virgin|slut)s?\b"),
    _Rule(
        rf"\b(my|our|a|an|the|your|his|her|their|this|that|some) {_ADJECTIVES}{_YEARS_OLD}{_NOT_THE_CHILD}"
        r"(?=\s?(?:$|[^a-z0-9\s]|"
        r"(?:in|on|at|"
        r"with|who|that|and|is|was|named|called|from|like|getting|being|wearing|sitting|lying|naked|nude|horny|sexy|"
        r"hot|slut|whore|bitch|virgin|wants?|says?|said|asks?|crush|fantasy|roleplay|would|will|can|could|should|has|"
        r"had|have|does|did|do|gets?|got)\b))",
        _own_child,
    ),
    _Rule(rf"^\s?{_YEARS_OLD}"),
    # A dating-app intro: "13 here", "13 m here". Not 10, which is as often a rating.
    _Rule(
        rf"^\s?(?:1[1-7]|{_SPELLED_TEEN})(?:\s?-?\s?(?:y/?o|yrs?(?: old)?|years? old))?"
        r"(?:\s?[,/]?\s?(?:[fm]|girl|boy|female|male))?\s?,?\s?(?:here|looking|hbu|wbu|lol|btw|hi|hey|hello)\b"
    ),
    # "girl 13", but not "girls 12 and under" or "my girl 13 years ago"
    _Rule(
        rf"(?<![a-z])(?:girl|boy)s?\s?,?\s?(?:1[0-7]|{_SPELLED_TEEN})(?![0-9]){_NOT_AN_AGE}"
        r"(?!\s?(?:(?:and|&|or) (?:up|under|over|older|younger|above|below)\b|\+))"
    ),
    _Rule(rf"\b{_UNDER_18}\s?-?\s?(?:yrs?|years?) of age\b"),
    _Rule(
        rf"{_FOREIGN_START}(?:{_FOREIGN_SELF}) "
        rf"(?:(?:{_words(['solo', 'nur', 'seulement', 'только', 'apenas', 'solamente'])}) )?{_FOREIGN_NUMBER}"
        rf"(?:\s?-?\s?(?:{_YEAR_WORDS}))?{_FOREIGN_END}"
    ),
    _Rule(rf"{_FOREIGN_START}(?:{_ITALIAN_SELF}) {_FOREIGN_NUMBER}\s?-?\s?anni{_FOREIGN_END}"),
    _Rule(rf"(?<![a-z])(?:{_FOREIGN_GIRL})s? (?:de|di|von|van) {_FOREIGN_NUMBER}\s?-?\s?(?:{_YEAR_WORDS})\b"),
    _Rule(rf"\b(?:[1-9]|1[0-7]|{_SPELLED_FOREIGN})\s?-?\s?(?:anitos|jahre alt|jaar oud|anos de idade|anos de edad|"
          r"jahrige[nrs]?(?! (?:jubil|bestehen|erfahrung|garantie|firmen))|jarige)\b"),
    _Rule(r"(?<![0-9])(?:1[0-7]|[1-9])\s?(?:岁|歲|歳|才|살|세(?!기))"),
    _Rule(r"(?:我|她|他|你)(?:才|只有|今年|已经|也)?\s?(?:1[0-7]|[1-9])(?![0-9])"
          r"(?!\s?(?:[点點分个個号號月日年天次块塊元米斤楼樓]|cm|kg|%|:))"),
    _Rule(
        r"\b(?:girl|boy|lass|lad|daughter|son|sister|brother|niece|nephew|child|kid|kiddo|minor|youngster|adolescent|"
        r"juvenile|student|pupil|virgin|maiden|bride)s? (?:of|aged|age) (?:(?:only|just|about|around|barely) )?"
        rf"""(?:[1-9]|1[0-7]|{_SPELLED_UNDER_18})\b(?!\s?(?:['"]\s?\d|:\d|\.\d|%|/|-\s?\d|"""
        r"(?:minutes?|mins?|hours?|days?|weeks?|months?|minds?)\b))"
    ),
    _Rule(
        rf"\baged (?:(?:only|just|about|around|barely) )?(?:[1-9]|1[0-7]|{_SPELLED_UNDER_18}){_ISH}\b"
        r"(?!\s?(?:years?|yrs?|months?|weeks?|days?|in\b|for\b|barrels?|casks?|to\b|-\s?\d|and (?:up|over|older)|"
        r"or (?:older|over|above)|\+))"
    ),
    _Rule(
        r"(?<!at )(?<!since )(?<!from )(?<!by )(?<!until )(?<!till )(?<!before )(?<!after )(?<!the )(?<!same )"
        r"(?<!this )(?<!that )(?<!an )(?<!any )(?<!legal )(?<!minimum )(?<!retirement )(?<!drinking )(?<!voting )"
        rf"(?<!driving )(?<!mental )(?<!reading )\bage\s?(?:[:=-]|is|was|'s)?\s?(?:(?:only|just|about|around) )?"
        rf"{_AGE}(?!\s?(?:(?:and|&|or) (?:up|over|older|above)|\+))"
    ),
    _Rule(
        r"(?<![a-z0-9.'/:,-])(?<!it's )(?<!its )(?<!it is )(?<!it was )(?<!minus )(?<!negative )(?<!about )"
        r"(?<!around )(?<!below )(?<!high of )(?<!low of )1[0-7]\s?(?:/\s?[fm]|f)(?![a-z0-9*])"
    ),
    _Rule(
        r"(?<![a-z0-9])(?<!press )(?<!hit )(?<!the )(?<!an )(?<!a )(?:f\s?/?\s?|m\s?/\s?)1[0-7](?![0-9])"
        r"(?!\s?(?:jets?|fighters?|eagles?|falcons?|tomcats?|hornets?|raptors?|strike|key)\b)"
    ),
    _Rule(r"\basl\W{0,4}(?:1[0-7]|[1-9])(?![0-9])"),
    _Rule(
        r"(?:\b(?:i|she|he|you|u|we|they|who) (?:was|were) |^\s?|\bi'm |\bim )born (?:in |on |back in )?"
        rf"(?:[a-z]+ (?:\d{{1,2}}(?:st|nd|rd|th)?,? )?)?(?:{_recent_years()})\b"
    ),
    _Rule(rf"(?<![a-z0-9])[a-z]{{2,}} ?[(\[{{](?:1[0-7]|{_SPELLED_TEEN})(?:\s?[fm])?[)\]}}]"),
    _Rule(rf"(?<![a-z])(?:girl|boy|lass|lad)s? ?[(\[{{]{_UNDER_18}(?:\s?[fm])?[)\]}}]"),
    _Rule(
        rf"\b(?!(?:{_NOT_A_NAME})\b)[a-z]{{2,}}(?:, (?:1[0-7]|{_SPELLED_TEEN})| "
        rf"(?:thirteen|fourteen|fifteen|sixteen|seventeen)){_ISH}(?=\s?(?:$|[.!?;|]))"
    ),
    _Rule(r"\bsweet sixteen\b"),
    _Rule(r"\b(?:(?:[1-9]|1[0-7])(?:st|nd|rd|th)|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|"
          r"seventeenth) birthday\b"),
    _Rule(
        r"(?<!teach )(?<!teaches )(?<!taught )(?<!teaching )(?<!teach the )\b(?:(?:[1-9]|1[0-2])(?:st|nd|rd|th)|"
        rf"{_GRADE_ORDINAL}|in (?:the )?first)\s?-?\s?grade(?:rs?)?\b"
        r"(?! (?:teachers?|teaching|level|reading|class(?:es|room)?|math|science|english|history|spelling)\b)"
    ),
    _Rule(r"\bfirst\s?-?\s?graders?\b"),
    _Rule(rf"\b(?:in grade (?:[1-9]|1[0-2]|one|{_SPELLED_SMALL}|ten|eleven|twelve)|"
          r"grade (?:[1-9]|1[0-2]) (?:student|pupil|girl|boy|kid|class)s?)\b"),
    _Rule(rf"(?<!not )(?<!not be ){_BELOW_N}", _policy),
    _Rule(rf"\b(?:less than|almost|nearly) (?:the )?(?:age (?:of )?)?(?:18|eighteen|consent|legal age)\b{_NOT_AN_AGE}"),
    _Rule(r"(?:(?<![a-z0-9])u-?1[0-8]s?(?![a-z0-9])|<\s?1[0-8](?![0-9])|\bsub\s?-?\s?(?:18|eighteen)\b)"
          + _not_an_age(_MEASURES)),
    _Rule(
        r"\b(?:not|(?:is|are|was|were|ai)n'?t) (?:even |yet |quite |really )?(?:18|eighteen)(?: yet)?\b"
        r"(?!\s?(?:anymore|any more|any longer|again|forever|either|\+|or (?:older|over)|and (?:up|over)))"
        + _NOT_AN_AGE
    ),
    _Rule(
        rf"\b(?:{_COPULA} (?:(?:still|just|technically) )?not|{_PERSON} (?:is|are|am|was|were|ai)n'?t) "
        r"(?:(?:quite|yet|even|really|technically) )?legal\b"
        r"(?!\s?(?:to|in|here|there|for|anywhere|everywhere|tender|drinking|adult)\b)"
    ),
    _Rule(r"\bturn(?:s|ing)? (?:18|eighteen) (?:soon|next|tomorrow|this|in)\b"),
    _Rule(r"\bnot (?:yet )?(?:legal yet|of (?:legal )?age|legal age)\b|\bnot yet legal\b"),
    _Rule(
        r"\b(?:hasn't|hasnt|has not|haven't|havent|have not|hadn't|hadnt|not yet|yet to|didn't|didnt|never) "
        r"(?:even |yet )?(?:hit|reached|started|gone through|been through|had) puberty\b|\bpre\s?-?\s?pubert(?:y|al)\b"
    ),
]

# Fine in chat, never in an image prompt: ambiguous minor words, school and
# childhood things, any age under 18 however it's put.
_IMAGE_TERMS = _AMBIGUOUS_TERMS + _LOWER_SCHOOLS + [
    "schoolyard", "classroom", "playground", "recess", "homework", "lunchbox", "lunch box", "backpack", "school bag",
    "schoolbag", "pigtails", "twin-tails", "braces", "pacifier", "stuffed animal", "teddy bear", "plushie",
    "lollipop", "sippy cup", "crayons", "baby sister", "baby brother", "daughter", "stepdaughter", "step-daughter",
    "niece", "student", "pupil", "young", "younger", "youthful", "youth", "baby face", "baby-faced", "babyface",
    "flat-chested", "flat chest", "budding breasts", "undeveloped body", "secondary school",
    # Infants and the youngest schools
    "babies", "crib", "nappy", "nappies", "sippy cup", "preschool", "pre-school", "playschool", "nursery school",
    "daycare", "day care", "elementary", "schoolkid", "school-kid", "schoolchild", "schoolchildren", "girl scout",
    "boy scout", "brownie uniform", "tiny girl", "small girl", "teeny girl", "teenie", "smol",
    # Japanese school wear and words, other languages
    "sukumizu", "randoseru", "ランドセル", "serafuku", "buruma", "shoujo", "nena", "bambina", "bimba", "jovencita",
    "chiquilla", "menor", "малышка", "дочка", "дочь", "女孩子", "幼儿园", "幼兒園", "幼稚園", "保育園",
    "学生", "學生", "生徒", "학생",
]
# Children by age or in another language: "two 9-year-olds", "girl 9yrs", "girl (9)", "girl, nine", "ages 9 to 12".
_IMAGE_AGES = [
    _YEARS_OLDS,
    rf"\b{_UNDER_18}{_HALF}\s?-?\s?(?:y|yrs?|years?)\b(?!\s?-?\s?(?:ago|later|earlier|before|after|since|apart|"
    r"together|older|younger|from|of (?!age)|in\b|into|married|sober|experience|anniversary|plan|warranty|lease)\b)",
    rf"\b(?!(?:{_NOT_A_NAME})\b)[a-z]{{2,}}(?:,? | ?- ?)(?:[1-9]|1[0-7]|{_SPELLED_UNDER_18}){_ISH}(?=\s?(?:$|[.!?;|]))",
    rf"(?<![a-z])j[kcs]\s(?=[{_CJK}])",
    rf"(?<![a-z0-9])[a-z]{{2,}} ?[(\[{{]{_UNDER_18}(?:\s?[fm])?[)\]}}]",
    rf"\bages? (?:of )?{_UNDER_18}\b",
    rf"\b(?:[1-9]|1[0-7]|{_SPELLED_FOREIGN})\s?-?\s?(?:{_YEAR_WORDS}|jahrige[nrs]?|jarige)\b",
]
# "baby" and "tots", but not baby blue, babydoll, baby oil or tater tots. Tried last.
_BABY = _Rule(
    r"(?<![a-z])baby(?![a-z])(?!'s breath|\s?-?\s?(?:blue|pink|oil|dolls?|powder|hairs?|bump|steps?|shower|daddy|"
    r"mama|momma)\b)|(?<![a-z])(?<!tater )(?<!tater-)tots?(?![a-z])"
)
_IMAGE_RULES = [
    _Rule(_terms(_IMAGE_TERMS)),
    _Rule(_CJK_CHILD),
    _Rule(_GERMAN_CHILD),
    _Rule(r"(?<![a-z])(?<!old )(?<!old-)(?<!grad )(?<!law )(?<!med )(?<!medical )(?<!film )(?<!flight )"
          r"(?<!business )(?<!nursing )(?<!cooking )(?<!culinary )(?<!art )school(?:s|ing)?(?![a-z])"),
] + [_Rule(source) for source in _IMAGE_AGES]
_PROHIBITED = _Rule(_terms(["bestiality", "zoophilia", "necrophilia", "snuff"]))
_REAL_PERSON = _Rule(_terms(["deep-fake", "nudify", "undress her photo", "undress this photo", "face-swap"]))


def _first_match(texts: List[str], rules: List[_Rule], strict: bool = False) -> Optional[str]:
    for rule in rules:
        for text in texts:
            for match in rule.pattern.finditer(text):
                if strict or rule.unless is None or not rule.unless(text, match):
                    return match.group(0).strip()
    return None


def _minor_match(texts: List[str], strict: bool = False) -> Optional[str]:
    term = _first_match(texts, _MINOR_RULES, strict)
    if term:
        return term
    return "stated age" if _first_match(texts, _AGE_RULES, strict) else None


def _blocked_names() -> List[str]:
    """Real names refused per deployment, from BLOCKED_NAMES (comma separated), as the app reads them."""
    names = (_normalize(name.strip()) for name in os.environ.get("BLOCKED_NAMES", "").split(","))
    return [name for name in names if name]


# A short title-case name with a minor-coded word in it ("Child Yuki", "Yuki
# Twelve", "Lil Sis Amy"), as the whole text or a "Name:" field.
_NAME_WORDS = re.compile(
    "^(?:" + _words(["child", "children", "kid", "kids", "kiddo", "kiddie", "minor", "daughter", "stepdaughter",
                     "niece", "imouto", "eleven", "twelve", "девочка", "мальчик", "少女"]) + "|十[一二三四五六七])$"
)
_NAME_PAIRS = re.compile(r"^(?:lil|little|baby|kid|step) (?:sis|sister|bro|brother)$|^your (?:daughter|niece|sister|baby)$")
_NAME_ALONE = re.compile(r"^(?:kiddo|kiddie|imouto|少女)$")


def _minor_name(prompt: str) -> Optional[str]:
    spans = [m.group(1) for m in re.finditer(r"\bname\s*:\s*([^\n.,;:!?]{1,60})", prompt, re.IGNORECASE)]
    whole = re.sub(r"[.!]+$", "", prompt.strip())
    if not re.search(r"[\n.,;:!?]", whole):
        spans.append(whole)
    for span in spans:
        cleaned = "".join(c for c in unicodedata.normalize("NFKC", span)
                          if unicodedata.category(c) not in _INVISIBLE_CATEGORIES and c not in _HANGUL_FILLERS)
        raw = cleaned.split()
        if not raw or len(raw) > 4:
            continue
        # No word starts lower case; CJK letters and digits have no case.
        if any(unicodedata.category(word[0]) == "Ll" for word in raw):
            continue
        plain = ["".join(c for c in _normalize(word) if unicodedata.category(c)[0] in "LN") for word in raw]
        named = (len(plain) == 1 and bool(_NAME_ALONE.match(plain[0]))) or (
            len(plain) > 1 and (any(_NAME_WORDS.match(word) for word in plain)
                                or any(_NAME_PAIRS.match(f"{a} {b}") for a, b in zip(plain, plain[1:]))))
        if named:
            return span.strip()
    return None


def screen_prompt(prompt: str) -> Optional[str]:
    """Returns the reason a positive prompt is refused, or None."""
    texts = _views(prompt)
    chat = [_relax(text) for text in texts]
    term = _minor_match(chat) or _minor_name(prompt)
    if term:
        return f"minor:{term}"
    prohibited = _first_match(chat, [_PROHIBITED])
    if prohibited:
        return f"prohibited:{prohibited}"
    names = _blocked_names()
    real_person = _first_match(chat, [_REAL_PERSON, _Rule(_terms(names))] if names else [_REAL_PERSON])
    if real_person:
        return f"real_person:{real_person}"
    image = _first_match(texts, _IMAGE_RULES) or _minor_match(texts, strict=True) or _first_match(texts, [_BABY])
    if image:
        return f"term:{image}"
    # A character newer than this Python's Unicode may fold to letters in the
    # app's newer Unicode (U+1CCD6 is an outlined "A" since Unicode 16), so a
    # prompt the worker can't read is refused rather than passed.
    unknown = next((char for char in prompt if unicodedata.category(char) == "Cn"), None)
    if unknown:
        return f"term:unassigned U+{ord(unknown):04X}"
    return None


# Minor terms belong in a negative prompt; adult ones don't. Negating them pushes
# the models that use the negative prompt (Animagine, Chroma, Wan) younger: adult
# words and ages (spelled too), adulthood, "aged up", and an adult body.
_ADULT_ANCHOR = re.compile(
    "|".join([
        _terms(["adult", "adulthood", "mature", "grown-up", "grown woman", "grown man", "woman", "women", "man", "men",
                "lady", "ladies", "milf", "mother", "mom", "mommy", "mum", "wife", "older", "middle-aged", "aged-up",
                "legal age", "of age", "large breasts", "big breasts", "huge breasts", "busty", "voluptuous", "curvy",
                "wide hips", "thick thighs", "pubic hair"]),
        r"\b(?:1[89]|[2-9]\d)\s?-?\s?(?:yo|y/o|y\.o|(?:yrs?|years?)\s?-?\s?old)\b",
        r"\b(?:eighteen|nineteen|(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)"
        r"(?:\s?-?\s?(?:one|two|three|four|five|six|seven|eight|nine))?)\s?-?\s?"
        r"(?:yo|y/o|y\.o|(?:yrs?|years?)\s?-?\s?old)\b",
        r"\b(?:twenties|thirties|forties|fifties|[2-5]0s)\b",
        r"\b(?:over|above|at least) (?:18|eighteen)\b|\b18\+|\b(?:18|eighteen) ?(?:and|or|&) ?(?:over|up|older|above)\b",
    ]),
    re.ASCII,
)


def screen_negative(negative_prompt: str) -> Optional[str]:
    """Why a negative prompt is refused, or None."""
    for text in _views(negative_prompt):
        match = _ADULT_ANCHOR.search(text)
        if match:
            return f"term:{match.group(0).strip()} (negative prompt)"
    return None


# Danbooru tags that mean a minor or a childlike depiction. The tagger only knows
# some of them depending on its training snapshot; unknown ones are ignored.
_TAGGER_BLOCK = [
    "loli", "shota", "child", "female_child", "male_child", "aged_down", "toddler", "baby",
    "kindergarten_uniform", "randoseru", "school_uniform", "serafuku", "elementary_school",
    "child_on_child", "flat_chest_child",
]


class AnimeTagger:
    """SmilingWolf WD tagger (ONNX) used as an apparent-age check on anime images.

    Hive's demographic model reads realistic faces; drawn faces need a model
    trained on drawn images. https://huggingface.co/SmilingWolf/wd-eva02-large-tagger-v3
    """

    def __init__(self, repo: str, threshold: float):
        self.repo = repo
        self.threshold = threshold
        self._session = None
        self._tags: List[str] = []
        self._watch: List[int] = []
        self._lock = threading.Lock()

    def _load(self) -> None:
        if self._session is not None:
            return
        import onnxruntime as ort
        from huggingface_hub import hf_hub_download

        model_path = hf_hub_download(self.repo, "model.onnx")
        tags_path = hf_hub_download(self.repo, "selected_tags.csv")
        with open(tags_path, newline="", encoding="utf-8") as handle:
            self._tags = [row["name"] for row in csv.DictReader(handle)]
        self._watch = [i for i, name in enumerate(self._tags) if name in _TAGGER_BLOCK]
        known = [self._tags[i] for i in self._watch]
        log.info("Anime tagger watching %s", ", ".join(known) or "nothing (no matching tags!)")
        if not known:
            raise RuntimeError(f"{self.repo} knows none of the blocked tags; pick another tagger")
        # ANIME_TAGGER_DEVICE=cpu keeps the tagger off a GPU that Wan needs whole.
        if os.environ.get("ANIME_TAGGER_DEVICE", "").lower() == "cpu":
            providers = ["CPUExecutionProvider"]
        else:
            providers = ["CUDAExecutionProvider", "CPUExecutionProvider"]
        self._session = ort.InferenceSession(model_path, providers=providers)

    def _prepare(self, image: Image.Image) -> np.ndarray:
        size = self._session.get_inputs()[0].shape[1]
        image = image.convert("RGBA")
        canvas = Image.new("RGBA", image.size, (255, 255, 255, 255))
        canvas.alpha_composite(image)
        rgb = canvas.convert("RGB")
        side = max(rgb.size)
        square = Image.new("RGB", (side, side), (255, 255, 255))
        square.paste(rgb, ((side - rgb.size[0]) // 2, (side - rgb.size[1]) // 2))
        if side != size:
            square = square.resize((size, size), Image.BICUBIC)
        # The WD taggers take BGR float pixels in 0..255.
        array = np.asarray(square, dtype=np.float32)[:, :, ::-1]
        return np.expand_dims(array, axis=0)

    def flagged(self, images: Iterable[Image.Image]) -> List[str]:
        """Blocked tags found in any of the images (empty when all are fine)."""
        with self._lock:
            self._load()
            found: List[str] = []
            input_name = self._session.get_inputs()[0].name
            output_name = self._session.get_outputs()[0].name
            for image in images:
                scores = self._session.run([output_name], {input_name: self._prepare(image)})[0][0]
                for index in self._watch:
                    if float(scores[index]) >= self.threshold:
                        found.append(f"{self._tags[index]}:{float(scores[index]):.2f}")
            return found


def tagger_from_env() -> Optional[AnimeTagger]:
    if os.environ.get("ANIME_TAGGER", "1") == "0":
        log.warning("ANIME_TAGGER=0: no apparent-age tagger, so the worker refuses all work with real models")
        return None
    return AnimeTagger(
        repo=os.environ.get("ANIME_TAGGER_REPO", "SmilingWolf/wd-eva02-large-tagger-v3"),
        threshold=float(os.environ.get("ANIME_TAGGER_THRESHOLD", "0.3")),
    )


def lora_path(root: Path, style: str, lora_id: str) -> Path:
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", lora_id):
        raise ValueError("invalid lora id")
    return root / style / f"{lora_id}.safetensors"
