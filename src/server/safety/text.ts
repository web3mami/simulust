// First-line text screening. This is a blocklist, not a classifier: it catches
// the obvious cases cheaply and deterministically. Model-based moderation runs
// on top of it (see moderation.ts) and judges what this lets through.
// workers/media/safety.py mirrors the normalization, checkText's rules and
// checkImagePrompt's image-only rules for image prompts, so change both together.

export type TextVerdict =
  | { ok: true }
  | { ok: false; category: "minor" | "prohibited" | "real_person"; matched: string };

// What checkImagePrompt adds to checkText: words that are fine in chat but never
// in a photo or video ("my kids", "a minor tilt"). On its own not a finding about
// anyone; `minor` is set when the prompt also puts a sexual word near an age
// under 18, a child word or a family word, which is minor content and is logged
// as such.
export type ImageVerdict = TextVerdict | { ok: false; category: "image"; matched: string; minor?: string };

// Letters from other scripts that pass for a Latin letter, by the letter.
const LOOKALIKES: Record<string, string> = {
  a: "аɑαᴀ",
  b: "вьʙ",
  c: "сϲᴄ",
  d: "ԁđᴅ",
  e: "еєεᴇɛɇҽ",
  g: "ɡɢ",
  h: "һнħʜ",
  i: "іıɩιɪɨ",
  j: "јᴊ",
  k: "кκᴋ",
  l: "ӏłʟ",
  m: "мᴍ",
  n: "пηɴո",
  o: "оοσօøᴏ",
  p: "рρᴘ",
  q: "ԛ",
  r: "гʀ",
  s: "ѕꜱʂ",
  t: "тτŧᴛƭ",
  u: "υᴜ",
  v: "νᴠ",
  w: "ԝшωᴡ",
  x: "хχ",
  y: "уүγʏ",
  z: "ᴢ",
};

const CONFUSABLE = new Map(
  Object.entries(LOOKALIKES).flatMap(([latin, chars]) => [...chars].map((char) => [char, latin] as const)),
);

// Characters that render as nothing (zero-width spaces and joiners, soft hyphens,
// direction marks, Hangul fillers) or only decorate the letter before them, and
// code points this Unicode doesn't assign yet, so a mark from a newer version
// can't split a word. (The worker, on an older Unicode, refuses those outright.)
const INVISIBLE = /[\p{Cf}\p{Mn}\p{Me}\p{Cn}ᅟᅠㅤﾠ]/gu;

// Regional indicators (🇹🇪🇪🇳) and negative circled or squared letters (🅣) have no
// compatibility mapping to a letter, so they get one here.
function unenclose(text: string) {
  return text.replace(/[\u{1F150}-\u{1F169}\u{1F170}-\u{1F189}\u{1F1E6}-\u{1F1FF}]/gu, (char) => {
    const point = char.codePointAt(0)!;
    const first = point >= 0x1f1e6 ? 0x1f1e6 : point >= 0x1f170 ? 0x1f170 : 0x1f150;
    return String.fromCharCode(0x61 + point - first);
  });
}

// A word made only of Latin letters and lookalikes is read as Latin ("tеen" with
// a Cyrillic е). Words with other letters are real foreign words and stay as is.
function unconfuse(word: string) {
  const chars = [...word];
  if (!chars.every((char) => char < "\x80" || CONFUSABLE.has(char))) return word;
  return chars.map((char) => CONFUSABLE.get(char) ?? char).join("");
}

// Lowercased before marks are stripped, so "İ" loses the dot it gains. A vulgar
// fraction becomes " 1/2" first, so "13½" reads "13 1/2", not "131⁄2".
function fold(text: string) {
  const fractions = text.replace(/[¼-¾⅐-⅞]/g, (char) => ` ${char.normalize("NFKD").replace("⁄", "/")}`);
  return unenclose(fractions.normalize("NFKD").toLowerCase())
    .replace(INVISIBLE, "")
    .normalize("NFC")
    .replace(/[‘’ʼ′`]/g, "'")
    .replace(/[“”„‟]/g, '"')
    // Python's \s, which the worker uses, also covers \x1c-\x1f and \x85.
    .replace(/[\s\x1c-\x1f\x85]+/g, " ")
    .replace(/\p{L}+/gu, unconfuse)
    .replace(/([a-z])\1{2,}/g, "$1$1");
}

const LEET: Record<string, string> = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "@": "a",
  $: "s",
  "!": "i",
  "|": "l",
  "€": "e",
  "+": "t",
};

// Digits and symbols count as letters only inside a word ("l0li", "k1d",
// "j@ilbait", "t€€n", "+33n"), so "I'm 4 real", "under 18" and "15+" keep their
// numbers. "1" and "|" can stand for i or l.
function unleet(text: string, one: "i" | "l") {
  const letter = (char: string) => (char === "1" || char === "|" ? one : (LEET[char] ?? char));
  const letters = (run: string) => [...run].map(letter).join("");
  return text
    .replace(/(?<=[a-z0-9])[@$!|]+(?=[a-z0-9])|(?<=[a-z])[€+]+(?=[a-z0-9])|(?<=[a-z0-9])[€+]+(?=[a-z])/g, letters)
    .replace(/[a-z0-9]*[a-z][a-z0-9]*/g, (word) => word.replace(/[0-9]/g, letter))
    .replace(/(?<![a-z0-9])[€+]+(?=[a-z])/g, letters);
}

// "t e e n", "c.h.i.l.d" and "t/e/e/n" read as words. A leading "a" or "i" stays
// a word of its own, so "a k i d" reads as "a kid".
function joinSpelled(text: string) {
  return text.replace(/\b[a-z](?:[^a-z0-9'"]{1,3}[a-z]\b){2,}/g, (run) => {
    const letters = run.replace(/[^a-z]/g, "");
    return /^[ai] /.test(run) && letters.length > 3 ? `${letters[0]} ${letters.slice(1)}` : letters;
  });
}

// "lo.li" and "jail_bait" read as words: punctuation inside a word joins it, a
// space never does, so "lol icon" and "under a gentle rain" stay apart.
function joinPunctuated(text: string) {
  return text.replace(/(?<=[a-z])[^a-z0-9\s']+(?=[a-z])/g, "");
}

export function normalize(text: string) {
  return unleet(fold(text), "i");
}

// Every check runs on each of these readings of the input.
function views(input: string) {
  const folded = fold(input);
  const plain = unleet(folded, "i");
  return [
    ...new Set([folded, plain, unleet(folded, "l"), joinSpelled(plain), joinPunctuated(folded), joinPunctuated(plain)]),
  ];
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Words for a pattern, folded the way the text is ("мне" reads "mhe").
const words = (list: string[]) => list.map((word) => escape(fold(word))).join("|");

// A term list becomes one pattern. In a term, a space needs a separator and a
// hyphen allows one or none ("high-schooler" also matches "highschooler"). A
// plural s and an "-ish" are optional.
function termSource(list: string[]) {
  const alternatives = list.map((term) =>
    escape(fold(term)).replace(/[ -]/g, (separator) => (separator === " " ? "[^a-z0-9]{1,3}" : "[^a-z0-9]{0,3}")),
  );
  return `(?<![a-z])(?:${alternatives.join("|")})(?:e?s)?(?:\\s?-?\\s?ish)?(?![a-z])`;
}

const terms = (list: string[]) => new RegExp(termSource(list));

// Minor-coded on their own.
const MINOR_TERMS = [
  "teen",
  "teenage",
  "teenaged",
  "teenager",
  "teenish",
  "teenybopper",
  "pre-teen",
  "tween",
  "under-age",
  "underaged",
  "loli",
  "lolita",
  "lolicon",
  "shota",
  "shotacon",
  "jail-bait",
  "pedo",
  "paedo",
  "pedophile",
  "paedophile",
  "pedophilia",
  "paedophilia",
  "school-girl",
  "school-boy",
  "infant",
  "toddler",
  "age-play",
  "pre-pubescent",
  "pubescent",
  "child-like",
  "aged-down",
  "female-child",
  "male-child",
  "ddlg",
  "mdlg",
  "ddlb",
  "mdlb",
  "cgl",
  "abdl",
  "littlespace",
  "high-schooler",
  "middle-schooler",
  "grade-schooler",
  "elementary-schooler",
  "pre-schooler",
  "kindergartner",
  "kindergartener",
  "school uniform",
  "little-girl",
  "little-boy",
  "lil-girl",
  "lil-boy",
  "young-girl",
  "young-boy",
  "young-looking",
  "looks young",
  "looks underage",
  "barely-legal",
  "kid sister",
  "kid brother",
  "chica de secundaria",
  "chico de secundaria",
  "alumna de secundaria",
  "in diapers",
  "training bra",
  "schulmädchen",
  "kleines mädchen",
  "kleine mädchen",
  "schülerin",
  "colegiala",
  "menor de edad",
  "menores de edad",
  "minderjährig",
  "minderjährige",
  "minderjährigen",
  "minorenne",
  "minorenni",
  "petite fille",
  "petites filles",
  "lycéenne",
  "collégienne",
  "novinha",
  "школьница",
  "школьник",
  "несовершеннолетняя",
  "несовершеннолетний",
  "малолетка",
  "中学生",
  "小学生",
  "高校生",
  "女子高生",
  "初中生",
  "高中生",
  "幼女",
  "児童",
  "未成年",
  "ロリ",
  "ショタ",
  "萝莉",
  "초등학생",
  "중학생",
  "고등학생",
  "여고생",
  "미성년자",
  "pthc",
  "nymphet",
  "nymphette",
  "girl-child",
  "boy-child",
  "mesugaki",
  "shougakusei",
  "shogakusei",
  "chuugakusei",
  "chugakusei",
  "joshi-kousei",
  "joshi-kosei",
  "kinderporno",
  "kinderpornos",
  "kinderpornografie",
  "kinderpornographie",
  "kinderficker",
  "nacktes kind",
  "nackte kinder",
  "nackten kinder",
  "kinder nackt",
  "fillette",
  "écolière",
  "garotinha",
  "menininha",
  "niñita",
  "小女孩",
  "小男孩",
  "女童",
  "男童",
  "幼童",
  "蘿莉",
  "女児",
  "男児",
  "초딩",
  "중딩",
  "고딩",
  "쇼타",
];

// Child words in Chinese, Japanese and Korean. There are no spaces to mark a
// word, so these stay short and specific; "幼儿园" (kindergarten) and "칼로리"
// (calorie) are the everyday words around them.
const CJK_CHILD = String.raw`儿童|兒童|小孩|孩子|子供|子ども|こども|어린이|少女|소녀|正太|(?<![칼플글])로리`;

// Schools below high school, except as a workplace ("I teach middle school math").
const LOWER_SCHOOLS = ["middle-school", "elementary-school", "grade-school", "primary-school", "junior-high", "jr-high"];

// Ordinary words in adult talk ("a minor detail", "my kids", "high school
// sweetheart"). They block only next to sexual words or an age; otherwise the
// classifier judges them.
const AMBIGUOUS_TERMS = [
  "kid",
  "kiddo",
  "kiddie",
  "child",
  "children",
  "childish",
  "minor",
  "high-school",
  "kindergarten",
  "little one",
  "little sister",
  "little brother",
  "youngster",
  "adolescent",
  "adolescente",
  "juvenile",
  "newborn",
  "diaper",
  "cub",
  "ragazzina",
  "menina",
  "девочка",
  "мальчик",
  "imouto",
  "kodomo",
  "enfant",
  "criança",
  "ребенок",
  "дети",
];

// German "Kind" is also English "kind", so it counts only after a German word:
// "ein Kind", "die Kinder", but not "a kind man".
const GERMAN_CHILD = String.raw`(?<![a-z])(?:das|ein|einem|einen|eines|dem|des|kleines|kleine|kleinen|kleiner|junges|jungen|mein|meine|meinem|meinen|dein|deine|unser|unsere|zwei|drei|vier|die) kind(?:er|ern|es)?(?![a-z])`;

// Words that make an ambiguous one sexual. Not words with an everyday use next
// to "kids": "the kids turned on the TV", "they moan about homework", "sex ed",
// "a virgin piña colada", "being a dick", "anal about his toys".
const SEXUAL_TERMS = [
  "sex",
  "sexy",
  "sexual",
  "sexually",
  "nude",
  "naked",
  "nudity",
  "porn",
  "porno",
  "nsfw",
  "erotic",
  "horny",
  "aroused",
  "fuck",
  "fucked",
  "fucking",
  "fuckin",
  "cum",
  "cumming",
  "cock",
  "pussy",
  "cunt",
  "clit",
  "tits",
  "titties",
  "boobs",
  "genital",
  "penis",
  "vagina",
  "blowjob",
  "handjob",
  "orgasm",
  "masturbate",
  "masturbating",
  "undress",
  "undressing",
  "undressed",
  "lingerie",
  "panties",
  "seduce",
  "seducing",
  "fondle",
  "fondling",
  "kinky",
  "fetish",
  "bdsm",
  "lewd",
  "hentai",
  "make love",
  "making love",
  "jerk off",
  "jerking off",
  "desnuda",
  "desnudo",
  "nue",
  "nackt",
  "nackte",
  "nuda",
  "nudo",
  "nua",
  "sexo",
  "sexe",
  "follar",
  "baiser",
  "ficken",
  "scopare",
  "foder",
  "geil",
  "cachonda",
  "голая",
  "голый",
  "голые",
  "секс",
  "エッチ",
  "セックス",
  "ヌード",
  "做爱",
  "性交",
  "裸",
  "섹스",
  "누드",
  "알몸",
];

// Any sexual word at all: a sentence with one of these is never just a policy.
const ANY_SEXUAL = new RegExp(
  termSource([
    ...SEXUAL_TERMS,
    "nudes",
    "sext",
    "sexting",
    "sexted",
    "xxx",
    "dick",
    "anal",
    "moan",
    "moaning",
    "hump",
    "humping",
    "virgin",
    "turned on",
    "strip",
  ]),
);

const AMBIGUOUS = `(?:${termSource(AMBIGUOUS_TERMS)}|${GERMAN_CHILD})`;
const SEXUAL = `${termSource(SEXUAL_TERMS)}(?! (?:ed|education)\\b)`;
// A plainly sexual word, for rules that turn on one: not "turned on the TV",
// "virgin olive oil" or "they moan about homework".
const SEXUAL_WORD = new RegExp(`${SEXUAL}|${termSource(["nudes", "sext", "sexting", "sexted", "slut", "whore"])}`);

// Within five words of each other, either way round, unless a new clause about
// the writer starts in between: "the kids are asleep, I'm so horny" is about
// the writer, "naked kids" is not.
const CLAUSE = String.raw`[,.;:!?]\s?(?:(?:and|so|but|now|then|because|cause) )?(?:i|i'm|im|i've|ive|i'd|i'll|we|we're|let's|lets|you|u|you're|ur|wanna)\b`;
const GAP = String.raw`(?:(?:(?!${CLAUSE})[^a-z0-9])+[a-z0-9]+){0,5}?(?:(?!${CLAUSE})[^a-z0-9])+`;
const NEAR_SEXUAL = new RegExp(`${AMBIGUOUS}${GAP}${SEXUAL}|${SEXUAL}${GAP}${AMBIGUOUS}`);
// The same in Chinese, Japanese and Korean, which need no space between words:
// within a dozen characters in the same sentence.
const CJK_NEAR = String.raw`[^.!?;。！？；]{0,12}?`;
const NEAR_SEXUAL_CJK = new RegExp(`(?:${CJK_CHILD})${CJK_NEAR}(?:${SEXUAL})|(?:${SEXUAL})${CJK_NEAR}(?:${CJK_CHILD})`);

const SPELLED_TEEN = "ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen";
const SPELLED_SMALL = "two|three|four|five|six|seven|eight|nine";
const SPELLED_UNDER_18 = `one|${SPELLED_SMALL}|${SPELLED_TEEN}`;
const SPELLED_FOREIGN = `diez|once|doce|trece|catorce|quince|dieciseis|diecisiete|dez|onze|doze|treze|catorze|quatorze|dezesseis|dezasseis|dezessete|dezassete|dix|douze|treize|seize|dix[\\s-]?sept|zehn|elf|zwolf|dreizehn|vierzehn|funfzehn|sechzehn|siebzehn|dieci|undici|dodici|tredici|quattordici|quindici|sedici|diciassette|${words(["десять", "одиннадцать", "двенадцать", "тринадцать", "четырнадцать", "пятнадцать", "шестнадцать", "семнадцать"])}`;

// What a number after "I'm" or "she's" is when it isn't an age: "15 minutes",
// "5'9", "9:30", "10/10", "10 out of 10", "15-20 mins", "12 floors up".
const MEASURES = String.raw`minutes?|mins?|hours?|hrs?|seconds?|secs?|days?|weeks?|wks?|months?|decades?|feet|foot|ft|inch(?:es)?|cm|mm|m|meters?|metres?|kg|kgs|lbs?|pounds?|stones?|miles?|mi|km|kms|percent|degrees?|times|points?|pts|o'clock|am|pm|a\.m|p\.m|of|out(?:ta)?|more(?! or less)|less|items|things|steps|calls|messages|texts|dollars?|bucks|euros?|credits|million|thousand|hundred|grand|stars?|drinks?|shots?|beers?|glass(?:es)?|cups?|bottles?|pints?|episodes?|pages?|chapters?|books?|movies?|shows?|seasons?|songs?|games?|rounds?|laps?|reps?|sets?|floors?|stor(?:e?ys|ies)|levels?|blocks?|stops?|dates|cats?|dogs?|pets?|followers|likes|tries|attempts|reasons|ways|nights|shifts?|classes|lessons|pics|photos|videos|ahead|behind|away|late|early|deep|in a row|in my (?:book|eyes|opinion)|in(?=\s?(?:$|[.,!?)]|long|thick|wide|tall))`;
// "we were 3 people", but "under 16 girls" is an age.
const UNITS = String.raw`${MEASURES}|others?|people|persons?|guys|girls|kids`;
// "15 years" is a count when more follows ("15 years younger", "12 years
// sober"), and an age when it ends there or goes on as one ("15 years old").
const YEARS_COUNT = String.raw`(?:years?|yrs?)\s(?!(?:old|young|of age|and|now|lol|lmao|haha|btw|but|so|yet|already|today|tho|though|wanna|want|is|almost|nearly|turning|plus|ok|okay|too)\b)[a-z]`;
// A quote after the number is a height only with inches after it ("5'9"), or an
// inch measure ('10" long'). '"I'm 15" she whispers' is an age, and so are
// "14 and a half", "14.5", "15,16" and "15+".
// "13/14" is an age range, "10/10" and "12/10" are ratings.
const notAnAge = (units: string) =>
  String.raw`(?!\s?(?:['"]\s?\d|(?:"|'')\s?(?:long|thick|wide|girth|around|cock|dick)\b|(?:-|to|or|and|/)\s?\d+\s?(?:${units}|years?|yrs?)\b|:\d|%|/(?!\s?(?:[fm]\b|1[1-8](?![0-9])))|x\b|(?:[.,]\d+|\s?and a half|\s\d/\d)?\s?(?:${units})\b|${YEARS_COUNT}))`;
const NOT_AN_AGE = notAnAge(UNITS);

// A lone single digit is often txt-speak ("I'm 2 cute", "u r 4 real"), so it
// counts as an age only where an age would end the thought, or before a
// fraction ("9 1/2", but not "6 1/2 inches").
const AGE_ENDS = String.raw`(?=\s?(?:$|[!?;)]|[.,:](?!\d)|and\b(?! a half\s?(?:${UNITS})\b)|\d/\d(?!\s?(?:${UNITS})\b)|btw\b|lol\b|lmao\b|haha\b|now\b|yet\b|already\b|today\b|tho\b|though\b|but\b|y/?o\b|y\.o|years? old|yrs? old|year-old))`;

const ISH = String.raw`(?:\s?-?\s?ish)?`;
const TEEN = `(?:1[0-7]|${SPELLED_TEEN})`;
// "15yrs" and "15yo" have no break after the number.
const AGE = String.raw`(?:${TEEN}${ISH}(?:\b|(?=y))${NOT_AN_AGE}|(?:[1-9]|${SPELLED_SMALL})${ISH}\b${AGE_ENDS})`;
const UNDER_18 = `(?:[1-9]|1[0-7]|${SPELLED_UNDER_18})`;
// A half between the number and the unit: "12 1/2 years old", "12.5yo".
const HALF = String.raw`(?:\s\d/\d|\s?and a half|\.5)?`;
// "15 yo", "13 y.o.", "15 y o", "15 years old", "fourteen years young"
const YEARS_OLD = String.raw`\b${UNDER_18}${HALF}\s?-?\s?(?:y\s?[./]?\s?o|(?:yrs?|years?)\s?-?\s?(?:old|young))\b`;
// The same, also as a plural: "12 year olds", "12yos", "9-yr-olds".
const YEARS_OLDS = String.raw`\b${UNDER_18}${HALF}\s?-?\s?(?:y\s?[./]?\s?o|(?:yrs?|years?)\s?-?\s?(?:old|young))s?\b`;
// What follows "a 5 year old" when the writer is the parent or carer, not the
// child: "I'm a proud 5 year old's mom", "she's my 15 year old daughter".
const NOT_THE_CHILD = String.raw`(?!'s|s'|\s?(?:mom|mum|mother|mama|dad|father|papa|parent|sitter|nanny|teacher|twins?|son|daughter)\b)`;
// Up to two words between "a" and the age ("a lonely 14 year old"), but not
// "a mom of 12 year olds", "our 14 year old" or "this whisky is 12 years old".
const ADJECTIVES = String.raw`(?:(?!(?:of|for|with|to|from|by|in|on|at|as|like|than|and|or|but|so|that|which|who|my|our|your|his|her|their|its|it's|the|a|an|this|these|those|is|are|was|were|am|be|been|being|has|have|had|will|would|can|could|should|does|did|do|turned|turns|turning|looks|seems|just|only|about|around|over|under|almost|nearly)\b)[a-z]+ ){0,2}?`;

const PERSON = "(?:you|u|i|she|he|they|we|who)";
const IS = "(?:are|r|am|m|is|was|were)";
const COPULA = String.raw`(?:${PERSON} ${IS}|you're|youre|ur|i'm|im|she's|shes|he's|hes|they're|theyre|we're|who's)`;
const PRESENT = String.raw`(?:(?:you|u|i|she|he|they|we) (?:are|r|am|m|is)|you're|youre|ur|i'm|im|she's|shes|he's|hes|they're|theyre|we're)`;
const FIRST_PERSON = "(?:i am|i m|i'm|im)";
const WILL_BE = String.raw`(?:${PERSON}(?:'ll| will) be|(?:youll|ill|shell|theyll) be)`;
const SUBJECT = String.raw`(?:${COPULA}|${WILL_BE}|${PERSON} (?:look|seem|seems|appear|appears)(?: like| to be)?|look(?:s|ing)?(?: like)?|turn(?:ed|ing|s)?|pretend(?:ing)? to be|act(?:ing)? (?:like|as)|roleplay(?:ing)? as|play(?:ing)? as|pass(?:es)? for)`;
const HEDGE =
  "(?:only|just|like|about|around|barely|now|maybe|probably|almost|nearly|under|below|still|literally|actually|really|basically|supposedly|clearly|obviously|definitely|not even|not yet|younger than|less than|no older than|no more than|at most|turning|going on|gonna be|going to be|about to be|about to turn|soon to be|between)";

// "you're 15", "I'm 14ish", "she looks 12", "she's only thirteen", "pretend to be 16".
const statedAge = (subject: string, age: string) =>
  String.raw`\b${subject} (?:${HEDGE} ){0,2}(?:(?:at )?(?:the )?age (?:of )?|aged )?${age}`;
// "I'm 15yo", "she's a 15 year old girl", "I'm a lonely 14 year old"
const statedYearsOld = (subject: string) =>
  String.raw`\b${subject} (?:${HEDGE} ){0,2}(?:an? )?${ADJECTIVES}${YEARS_OLD}${NOT_THE_CHILD}`;

// "she's a minor", but not "that's a minor detail".
const minorNoun = (subject: string) =>
  String.raw`\b${subject} (?:(?:still|just|only|basically|literally|technically|legally|clearly|obviously) )?(?:a )?minors?(?=\s?(?:$|[^a-z0-9 ]|(?:and|but|who|so|in|at|with|lol|btw|too|right|tho|though|yet|still|now|ish|here|there)\b))`;
// "I'm just a kid", "I'm still a child lol", but not "I'm a kid at heart", "I'm
// a kid again" or "I'm a child of the 80s".
const FIRST_PERSON_KID = String.raw`\b(?:i am|i m|i'm|im) (?:(?:just|only|still|basically|literally|technically|legally|really|actually) ){0,2}(?:a )?(?:little )?(?:kid|child)(?=\s?(?:$|[^a-z0-9 ]|(?:and|but|who|so|lol|lmao|haha|btw|too|tho|though|yet|still|now|here|rn|ok|okay|honestly)\b))`;

// "she's in middle school", "I'm a sophomore in high school", "you're in 8th
// grade", "I'm in year 9", but not "I'm in high school drop off line".
const GRADE_ORDINAL = "second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth";
const SCHOOL = "high[ -]?school|hs|middle[ -]?school|junior[ -]?high|jr\\.?[ -]?high|secondary(?: school)?";
const IN_SCHOOL = String.raw`(?:(?:a (?:freshman|sophomore|junior|senior|student) )?in (?:the )?(?:${SCHOOL}|elementary(?: school)?|grade[ -]?school|primary[ -]?school|kindergarten|(?:(?:[1-9]|1[0-2])(?:st|nd|rd|th)|first|${GRADE_ORDINAL})[ -]?grade|(?:year|yr) (?:[7-9]|1[0-3]|seven|eight|nine|ten|eleven|twelve|thirteen)(?! of\b)|class (?:[1-9]|1[0-2])(?! of\b))|a (?:${SCHOOL}) (?:freshman|sophomore|junior|senior|student)|a (?:freshman|sophomore|junior|senior) (?:at|in) (?:[a-z]+ ){1,2}?(?:high|middle|junior high|jr\.? high)(?: school)?(?=\s?(?:$|[^a-z0-9 ]|(?:lol|and|but|so|now|btw)\b)))\b(?!\s?-?\s?(?:drop|pick|parking|car|line|lot|reunion|gym|office|building|district|board|teachers?|staff|principal|nurse|counselor|parents?|pta|fundraiser|games?|football|musical|play|dance|auditorium|cafeteria|library|bus|run|zone|traffic|lobby)\b)`;
const enrolled = (subject: string) => String.raw`\b${subject} (?:(?:still|currently|only|just) )?${IN_SCHOOL}`;
// "I go to Lincoln High", but not "I go to high school reunions".
const GOES_TO_SCHOOL = String.raw`\b(?:i|im|i'm) (?:still |currently )?(?:go|going|attend|attending) (?:to )?(?:[a-z]+ ){0,2}?(?:high|middle|junior high|jr\.? high|elementary)(?: school)?(?=\s?(?:$|[^a-z0-9 ]|(?:lol|and|but|so|now|btw)\b))`;
// A bio's "Still in high school lol", but not "we were still in high school".
const STILL_IN_SCHOOL = String.raw`(?<!was )(?<!were )\bstill ${IN_SCHOOL}`;

// A rule can be waived for a match that is plainly something else, judged from
// the text around it. Image prompts get every rule without waivers.
type Rule = { pattern: RegExp; strict: RegExp; unless?: (text: string, match: RegExpExecArray) => boolean };

function rule(source: string | RegExp, unless?: Rule["unless"]): Rule {
  const text = typeof source === "string" ? source : source.source;
  return { pattern: new RegExp(text, "g"), strict: new RegExp(text), unless };
}

// The sentence a match sits in.
function sentenceOf(text: string, match: RegExpExecArray) {
  const start = Math.max(...[".", "!", "?", ";"].map((stop) => text.lastIndexOf(stop, match.index))) + 1;
  const ends = [".", "!", "?", ";"].map((stop) => text.indexOf(stop, match.index + match[0].length)).filter((at) => at >= 0);
  return text.slice(start, ends.length ? Math.min(...ends) : text.length);
}

const sexualSentence = (text: string, match: RegExpExecArray) => ANY_SEXUAL.test(sentenceOf(text, match));

// "no one under 18 is allowed", "kids under 12 eat free": a rule about who may
// do something, with nothing sexual in the sentence. "anyone under 18" is not
// a rule in "sex with anyone under 18" or "I'm into anybody under 18".
const POLICY_SUBJECT =
  /(?:^|[^a-z])(?:no one|noone|nobody|anyone|anybody|everyone|people|persons|users|members|players|guests|visitors|customers|kids|children|minors|those|ages?)(?: aged?)? $/;
const POLICY_VERB =
  /^\s?,?\s?(?:is|are|isn't|isnt|aren't|arent|can|can't|cant|cannot|should|shouldn't|may|must|mustn't|will|won't|need|needs|have to|has to|allowed|permitted|welcome|admitted|get|gets|go|eat|eats|ride|rides|pay|pays|play|plays|enter|travel|stay|use|join|sign|not allowed|banned|prohibited|free|only)\b/;
const policy = (text: string, match: RegExpExecArray) =>
  POLICY_SUBJECT.test(text.slice(0, match.index)) &&
  POLICY_VERB.test(text.slice(match.index + match[0].length)) &&
  !sexualSentence(text, match);

// "I teach middle school math", "I work at an elementary school as a secretary".
const WORK_BEFORE =
  /\b(?:teach|teaches|taught|teaching|teachers?|work|works|worked|working|job|employed|volunteer|volunteers|volunteered|volunteering|substitute|sub|coach|coaches|coached|coaching|principal|staff|nurse|counselor|secretary|janitor|librarian|aide)\b/;
const WORK_AFTER =
  /^(?:[^a-z0-9]+[a-z0-9]+){0,3}?[^a-z0-9]+(?:teachers?|teaching|principal|staff|nurse|counselor|librarian|coach|secretary|janitor|administrator|aide|district|faculty)\b/;
const workplace = (text: string, match: RegExpExecArray) =>
  WORK_BEFORE.test(text.slice(0, match.index).split(" ").slice(-5).join(" ")) ||
  WORK_AFTER.test(text.slice(match.index + match[0].length));

// "my son is 10", "my 14 year old is driving me crazy": a parent talking about
// their own child, with nothing sexual in the sentence.
const FAMILY = /^(?:son|daughter|kid|kiddo|child|nephew|niece|boy)$/;
const ownChild = (text: string, match: RegExpExecArray) =>
  /^(?:my|our)$/.test(match[1] ?? "") && (match[2] === undefined || FAMILY.test(match[2])) && !sexualSentence(text, match);

const PERSON_NOUNS =
  "girl|boy|kid|kiddo|child|daughter|son|sister|brother|niece|nephew|cousin|student|pupil|stepdaughter|stepsister|stepson|stepbrother|babysitter|neighbou?r|virgin|lass|lad|bride|princess|cheerleader|maid|slut|whore|chick|babe|baby|blonde|brunette|redhead|female|male|woman|man|lady|guy|person|human|version|character|persona";

// Born this year or in the 17 before it.
export function recentYears() {
  const now = new Date().getUTCFullYear();
  return Array.from({ length: 18 }, (_, back) => now - back).join("|");
}

// Words that end a sentence with a number without being a name ("Yes, 12.").
const NOT_A_NAME =
  "yes|no|nope|yep|yeah|ok|okay|sure|maybe|about|around|like|only|just|lol|haha|hmm|um|uh|so|and|or|exactly|perhaps|thanks|please|well|oh|ah|mm|hm|idk|at|by|after|before|until|till|from|to|than|is|was|be|are|were|am|it|its|the|a|an|of|in|on|for|with|out|up|now|then|today|tonight|tomorrow|size|page|chapter|level|floor|room|table|gate|season|episode|number|apt|unit|suite|grade|score|round|lap|rep|reps|set|part|step|bus|route|exit|channel|row|seat|section|platform|game|match|volume|book|issue|act|scene|top|tops|max|min|over|under|past|nearly|almost|half|times|plus|minus|me|you|u|him|her|them|us|my|your|our|his|their|got|have|has|had|need|want|take|give|make|pick|say|guess|answer|total|age|ages|aged|turn|turned|turning";

// A foreign age: "tengo 14", "ich bin 14 und geil", "j'ai 14 ans", "мне 14",
// "una chica de 14 años". The year word alone is a duration ("llevamos 3 años
// juntos", "depuis 5 ans", "vor 10 Jahren", "10 лет назад").
const YEAR_WORDS = `anos|anitos|ans|anni|jahre|jahren|jaar|${words(["лет", "года", "год"])}`;
// With a person as the subject: "tiene 10 años" alone could be a car, and
// Italian "ha" is also Portuguese "há" ("há 10 anos", ten years ago), so
// Italian needs "anni" after the number.
const FOREIGN_SELF = words([
  "tengo",
  "tienes",
  "ella tiene",
  "él tiene",
  "tenía",
  "cumplo",
  "cumples",
  "ella cumple",
  "él cumple",
  "cumplí",
  "tenho",
  "tens",
  "ela tem",
  "ele tem",
  "você tem",
  "eu tinha",
  "ela tinha",
  "faço",
  "fiz",
  "j'ai",
  "jai",
  "tu as",
  "elle a",
  "il a",
  "j'avais",
  "elle avait",
  "ich bin",
  "du bist",
  "sie ist",
  "er ist",
  "ich war",
  "sie war",
  "ich werde",
  "sie wird",
  "ik ben",
  "zij is",
  "hij is",
  "мне",
  "ей",
  "ему",
  "тебе",
  "мне было",
  "ей было",
  "мне уже",
  "ей уже",
  "мне только",
  "ей только",
]);
const FOREIGN_GIRL = words([
  "chica",
  "chico",
  "niña",
  "niño",
  "nena",
  "hija",
  "hijo",
  "hermana",
  "hermano",
  "sobrina",
  "estudiante",
  "alumna",
  "alumno",
  "muchacha",
  "chavala",
  "fille",
  "fillette",
  "garçon",
  "gamine",
  "ado",
  "adolescente",
  "étudiante",
  "élève",
  "sœur",
  "soeur",
  "nièce",
  "ragazza",
  "ragazzo",
  "bambina",
  "bambino",
  "figlia",
  "sorella",
  "studentessa",
  "alunna",
  "mädchen",
  "junge",
  "tochter",
  "schwester",
  "nichte",
  "menina",
  "menino",
  "garota",
  "garoto",
  "moça",
  "filha",
  "irmã",
  "sobrinha",
  "aluna",
  "meisje",
  "jongen",
]);
const ITALIAN_SELF = words(["ho", "hai", "ha", "avevo", "aveva", "compio", "lei ha", "lui ha"]);
const FOREIGN_NUMBER = `(?:1[0-7]|[1-9]|${SPELLED_FOREIGN})`;
const FOREIGN_START = `(?<![^\\s.,;:!?"'()])`;
// Where a stated age ends, so "j'ai 10 ans de plus que toi" (ten years older)
// and "tengo 2 hijos" don't read as one.
const FOREIGN_END = String.raw`(?=\s?(?:$|[^a-z0-9\s\u0400-\u04ff]|(?:und|y|e|et|i|a|en|ja|${words(["и"])})(?![a-z\u0400-\u04ff])))`;

// Spoken numbers, and a stated age that is a reply to a rating question: "how
// wet are you from 1 to 10? I'm 10" and "on a scale of 1 to 10 you're 11" are
// not ages. Only a number after the question counts as the reply, and not in a
// sentence that says anything sexual, so a trailing "10/10" or a question
// pasted in front of "I'm 12 and ..." changes nothing.
const RATING = /\b(?:(?:from|between|scale of|rate (?:it|me|you|her|him|this)) (?:0|1|one|zero) ?(?:-|to|and|through) ?(?:10|ten)\b|out of (?:10|ten)\b)/;
// "you make me feel like a teenager again" is about an adult.
const TEEN_AGAIN = /\b(?:feel|feels|felt|feeling)(?: like)? (?:a )?teen(?:ager)?s? again\b/g;

function relax(text: string) {
  const question = RATING.exec(text);
  let rated = text;
  if (question) {
    const at = question.index + question[0].length;
    const replies = text
      .slice(at)
      .replace(/[^.!?;]+/g, (sentence) =>
        SEXUAL_WORD.test(sentence) ? sentence : sentence.replace(/\b(1[0-2]|ten|eleven|twelve)\b(?!\s?\/)/g, "$1/10"),
      );
    rated = text.slice(0, at) + replies;
  }
  return rated.replace(TEEN_AGAIN, "feel young again");
}

// Chat gets these readings: the same, minus what plainly isn't about a minor.
const chatViews = (input: string) => views(input).map(relax);

const BELOW_N = String.raw`\b(?:under|below|younger than|sub)\s?-?\s?(?:the )?(?:age (?:of )?)?(?:1[0-8]|${SPELLED_TEEN}|eighteen|consent|legal age)\b${notAnAge(MEASURES)}`;

const MINOR_RULES = [
  rule(terms(MINOR_TERMS)),
  rule(String.raw`幼[儿兒](?![园園])`),
  rule(terms(LOWER_SCHOOLS), workplace),
  rule(NEAR_SEXUAL),
  rule(NEAR_SEXUAL_CJK),
  rule(FIRST_PERSON_KID),
  // A character's looks: "tiny childish frame", "child body".
  rule(String.raw`(?<![a-z])child(?:ish|like)? (?:body|frame|figure|build|face|features|proportions|physique|chest|hips)(?![a-z])`),
  rule(minorNoun(COPULA)),
  rule(enrolled(PRESENT)),
  rule(GOES_TO_SCHOOL),
  rule(STILL_IN_SCHOOL),
  // "JKとエッチ": a Japanese school-age abbreviation, not "jk lol".
  rule(String.raw`(?<![a-z])j[kcs](?=[\u3040-\u30ff\u4e00-\u9fff])|(?<=[\u3040-\u30ff\u4e00-\u9fff])j[kcs](?![a-z])`),
];

const AGE_RULES = [
  // Any "N year old(s)" in a sentence with a plainly sexual word, whatever comes
  // before or after it. Elsewhere (a parent, a pet) the narrower rules decide.
  rule(YEARS_OLDS, (text, match) => !SEXUAL_WORD.test(sentenceOf(text, match))),
  rule(statedAge(SUBJECT, AGE)),
  rule(statedYearsOld(SUBJECT)),
  // "the girl is 14", "my student is 15 and naked", but not "my son is 10"
  rule(
    String.raw`\b(?:(my|our|the|a|an|this|that|your|his|her|their) )?(?:(?:little|lil|big|baby|younger|older|kid|step) ?)?(girl|boy|kid|kiddo|child|daughter|son|sister|brother|niece|nephew|cousin|student|pupil|stepdaughter|stepsister|stepson|stepbrother|babysitter|neighbou?r|virgin|bride|princess|cheerleader|maid)(?:s? (?:is|was|are|were|turned|turns|looks?|seems?)|'s) (?:${HEDGE} ){0,2}(?:an? )?(?:${AGE}|${YEARS_OLD})`,
    ownChild,
  ),
  // "a 16yo girl", "my 14 year-old stepdaughter", but not "a 3 year old golden retriever"
  rule(String.raw`${YEARS_OLD}(?:[^a-z0-9]{1,3}[a-z]+){0,2}?[^a-z0-9]{1,3}(?:${PERSON_NOUNS})s?\b`),
  rule(String.raw`\b(?:[1-9]|1[0-7]|${SPELLED_UNDER_18})\s?-?\s?(?:yrs?|years?)[^a-z0-9]{1,3}(?:girl|boy|kid|child|daughter|son|student|virgin|slut)s?\b`),
  // "a 13yr old", "a lonely 14 year old", "my 14 year old is driving me crazy"
  // (waived for a parent)
  rule(
    String.raw`\b(my|our|a|an|the|your|his|her|their|this|that|some) ${ADJECTIVES}${YEARS_OLD}${NOT_THE_CHILD}(?=\s?(?:$|[^a-z0-9\s]|(?:in|on|at|with|who|that|and|is|was|named|called|from|like|getting|being|wearing|sitting|lying|naked|nude|horny|sexy|hot|slut|whore|bitch|virgin|wants?|says?|said|asks?|crush|fantasy|roleplay|would|will|can|could|should|has|had|have|does|did|do|gets?|got)\b))`,
    ownChild,
  ),
  rule(String.raw`^\s?${YEARS_OLD}`),
  // A dating-app intro: "13 here", "13 m here", "14yo f looking". Not 10, which
  // is as often a rating.
  rule(
    String.raw`^\s?(?:1[1-7]|${SPELLED_TEEN})(?:\s?-?\s?(?:y/?o|yrs?(?: old)?|years? old))?(?:\s?[,/]?\s?(?:[fm]|girl|boy|female|male))?\s?,?\s?(?:here|looking|hbu|wbu|lol|btw|hi|hey|hello)\b`,
  ),
  // "girl 13", "Girl, 14 here", but not "girls 12 and under" or "my girl 13 years ago"
  rule(
    String.raw`(?<![a-z])(?:girl|boy)s?\s?,?\s?(?:1[0-7]|${SPELLED_TEEN})(?![0-9])${NOT_AN_AGE}(?!\s?(?:(?:and|&|or) (?:up|under|over|older|younger|above|below)\b|\+))`,
  ),
  rule(String.raw`\b${UNDER_18}\s?-?\s?(?:yrs?|years?) of age\b`),
  rule(String.raw`${FOREIGN_START}(?:${FOREIGN_SELF}) (?:(?:${words(["solo", "nur", "seulement", "только", "apenas", "solamente"])}) )?${FOREIGN_NUMBER}(?:\s?-?\s?(?:${YEAR_WORDS}))?${FOREIGN_END}`),
  rule(String.raw`${FOREIGN_START}(?:${ITALIAN_SELF}) ${FOREIGN_NUMBER}\s?-?\s?anni${FOREIGN_END}`),
  rule(String.raw`(?<![a-z])(?:${FOREIGN_GIRL})s? (?:de|di|von|van) ${FOREIGN_NUMBER}\s?-?\s?(?:${YEAR_WORDS})\b`),
  rule(String.raw`\b(?:[1-9]|1[0-7]|${SPELLED_FOREIGN})\s?-?\s?(?:anitos|jahre alt|jaar oud|anos de idade|anos de edad|jahrige[nrs]?(?! (?:jubil|bestehen|erfahrung|garantie|firmen))|jarige)\b`),
  rule(String.raw`(?<![0-9])(?:1[0-7]|[1-9])\s?(?:岁|歲|歳|才|살|세(?!기))`),
  rule(String.raw`(?:我|她|他|你)(?:才|只有|今年|已经|也)?\s?(?:1[0-7]|[1-9])(?![0-9])(?!\s?(?:[点點分个個号號月日年天次块塊元米斤楼樓]|cm|kg|%|:))`),
  // "a girl of 14", "a lass of fourteen summers", "a child aged 12"
  rule(
    String.raw`\b(?:girl|boy|lass|lad|daughter|son|sister|brother|niece|nephew|child|kid|kiddo|minor|youngster|adolescent|juvenile|student|pupil|virgin|maiden|bride)s? (?:of|aged|age) (?:(?:only|just|about|around|barely) )?(?:[1-9]|1[0-7]|${SPELLED_UNDER_18})\b(?!\s?(?:['"]\s?\d|:\d|\.\d|%|/|-\s?\d|(?:minutes?|mins?|hours?|days?|weeks?|months?|minds?)\b))`,
  ),
  // "aged sixteen", but not whisky "aged 12 years" or "kids aged 5 to 12"
  rule(
    String.raw`\baged (?:(?:only|just|about|around|barely) )?(?:[1-9]|1[0-7]|${SPELLED_UNDER_18})${ISH}\b(?!\s?(?:years?|yrs?|months?|weeks?|days?|in\b|for\b|barrels?|casks?|to\b|-\s?\d|and (?:up|over|older)|or (?:older|over|above)|\+))`,
  ),
  // "Age: 15", "my age is 14", "age 14, f", but not "at age 12 I moved" or "age 12 and up"
  rule(
    String.raw`(?<!at )(?<!since )(?<!from )(?<!by )(?<!until )(?<!till )(?<!before )(?<!after )(?<!the )(?<!same )(?<!this )(?<!that )(?<!an )(?<!any )(?<!legal )(?<!minimum )(?<!retirement )(?<!drinking )(?<!voting )(?<!driving )(?<!mental )(?<!reading )\bage\s?(?:[:=-]|is|was|'s)?\s?(?:(?:only|just|about|around) )?${AGE}(?!\s?(?:(?:and|&|or) (?:up|over|older|above)|\+))`,
  ),
  // "15/F", "15f", "f15", "asl? 14 f": an age in a dating-app intro, but not "it's 15F out".
  rule(
    String.raw`(?<![a-z0-9.'/:,-])(?<!it's )(?<!its )(?<!it is )(?<!it was )(?<!minus )(?<!negative )(?<!about )(?<!around )(?<!below )(?<!high of )(?<!low of )1[0-7]\s?(?:/\s?[fm]|f)(?![a-z0-9*])`,
  ),
  rule(
    String.raw`(?<![a-z0-9])(?<!press )(?<!hit )(?<!the )(?<!an )(?<!a )(?:f\s?/?\s?|m\s?/\s?)1[0-7](?![0-9])(?!\s?(?:jets?|fighters?|eagles?|falcons?|tomcats?|hornets?|raptors?|strike|key)\b)`,
  ),
  rule(String.raw`\basl\W{0,4}(?:1[0-7]|[1-9])(?![0-9])`),
  // "I was born in 2011", "born in 2012 lol", but not "my daughter was born in 2015"
  rule(
    String.raw`(?:\b(?:i|she|he|you|u|we|they|who) (?:was|were) |^\s?|\bi'm |\bim )born (?:in |on |back in )?(?:[a-z]+ (?:\d{1,2}(?:st|nd|rd|th)?,? )?)?(?:${recentYears()})\b`,
  ),
  // A name with an age: "Yuki (17)", "Yuki [15]", "me (15f)", "girl (9)", "Yuki,
  // 17", "Yuki seventeen".
  rule(String.raw`(?<![a-z0-9])[a-z]{2,} ?[(\[{](?:1[0-7]|${SPELLED_TEEN})(?:\s?[fm])?[)\]}]`),
  rule(String.raw`(?<![a-z])(?:girl|boy|lass|lad)s? ?[(\[{]${UNDER_18}(?:\s?[fm])?[)\]}]`),
  rule(
    String.raw`\b(?!(?:${NOT_A_NAME})\b)[a-z]{2,}(?:, (?:1[0-7]|${SPELLED_TEEN})| (?:thirteen|fourteen|fifteen|sixteen|seventeen))${ISH}(?=\s?(?:$|[.!?;|]))`,
  ),
  rule(String.raw`\bsweet sixteen\b`),
  rule(
    String.raw`\b(?:(?:[1-9]|1[0-7])(?:st|nd|rd|th)|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth) birthday\b`,
  ),
  // "8th grade", "an eighth grader", but not "I teach 3rd grade" or "a 9th grade reading level"
  rule(
    String.raw`(?<!teach )(?<!teaches )(?<!taught )(?<!teaching )(?<!teach the )\b(?:(?:[1-9]|1[0-2])(?:st|nd|rd|th)|${GRADE_ORDINAL}|in (?:the )?first)\s?-?\s?grade(?:rs?)?\b(?! (?:teachers?|teaching|level|reading|class(?:es|room)?|math|science|english|history|spelling)\b)`,
  ),
  rule(String.raw`\bfirst\s?-?\s?graders?\b`),
  rule(String.raw`\b(?:in grade (?:[1-9]|1[0-2]|one|${SPELLED_SMALL}|ten|eleven|twelve)|grade (?:[1-9]|1[0-2]) (?:student|pupil|girl|boy|kid|class)s?)\b`),
  // "under 18", "girls under 15", "an under-16 girl", "below the age of consent",
  // but not "I'm not under 18" or a rule like "no one under 18 is allowed".
  rule(String.raw`(?<!not )(?<!not be )${BELOW_N}`, policy),
  rule(String.raw`\b(?:less than|almost|nearly) (?:the )?(?:age (?:of )?)?(?:18|eighteen|consent|legal age)\b${NOT_AN_AGE}`),
  // "u18", "U16 girls", "Yuki <18", "sub-18"
  rule(String.raw`(?:(?<![a-z0-9])u-?1[0-8]s?(?![a-z0-9])|<\s?1[0-8](?![0-9])|\bsub\s?-?\s?(?:18|eighteen)\b)${notAnAge(MEASURES)}`),
  // "not 18 yet", "she isn't 18", but not "I'm not 18 anymore"
  rule(
    String.raw`\b(?:not|(?:is|are|was|were|ai)n'?t) (?:even |yet |quite |really )?(?:18|eighteen)(?: yet)?\b(?!\s?(?:anymore|any more|any longer|again|forever|either|\+|or (?:older|over)|and (?:up|over)))${NOT_AN_AGE}`,
  ),
  // "she's not legal", "she isn't quite legal", but not "it's not legal to park here"
  rule(
    String.raw`\b(?:${COPULA} (?:(?:still|just|technically) )?not|${PERSON} (?:is|are|am|was|were|ai)n'?t) (?:(?:quite|yet|even|really|technically) )?legal\b(?!\s?(?:to|in|here|there|for|anywhere|everywhere|tender|drinking|adult)\b)`,
  ),
  rule(String.raw`\bturn(?:s|ing)? (?:18|eighteen) (?:soon|next|tomorrow|this|in)\b`),
  rule(String.raw`\bnot (?:yet )?(?:legal yet|of (?:legal )?age|legal age)\b|\bnot yet legal\b`),
  rule(
    String.raw`\b(?:hasn't|hasnt|has not|haven't|havent|have not|hadn't|hadnt|not yet|yet to|didn't|didnt|never) (?:even |yet )?(?:hit|reached|started|gone through|been through|had) puberty\b|\bpre\s?-?\s?pubert(?:y|al)\b`,
  ),
];

// Fine in chat, never in anything that becomes an image: ambiguous minor words,
// school and childhood things, any age under 18 however it's put.
const IMAGE_TERMS = [
  ...AMBIGUOUS_TERMS,
  ...LOWER_SCHOOLS,
  "schoolyard",
  "classroom",
  "playground",
  "recess",
  "homework",
  "lunchbox",
  "lunch box",
  "backpack",
  "school bag",
  "schoolbag",
  "pigtails",
  "twin-tails",
  "braces",
  "pacifier",
  "stuffed animal",
  "teddy bear",
  "plushie",
  "lollipop",
  "sippy cup",
  "crayons",
  "baby sister",
  "baby brother",
  "daughter",
  "stepdaughter",
  "step-daughter",
  "niece",
  "student",
  "pupil",
  "young",
  "younger",
  "youthful",
  "youth",
  "baby face",
  "baby-faced",
  "babyface",
  "flat-chested",
  "flat chest",
  "budding breasts",
  "undeveloped body",
  "secondary school",
  // Infants and the youngest schools
  "babies",
  "crib",
  "nappy",
  "nappies",
  "sippy cup",
  "preschool",
  "pre-school",
  "playschool",
  "nursery school",
  "daycare",
  "day care",
  "elementary",
  "schoolkid",
  "school-kid",
  "schoolchild",
  "schoolchildren",
  "girl scout",
  "boy scout",
  "brownie uniform",
  "tiny girl",
  "small girl",
  "teeny girl",
  "teenie",
  "smol",
  // Japanese school wear and words, other languages
  "sukumizu",
  "randoseru",
  "ランドセル",
  "serafuku",
  "buruma",
  "shoujo",
  "nena",
  "bambina",
  "bimba",
  "jovencita",
  "chiquilla",
  "menor",
  "малышка",
  "дочка",
  "дочь",
  "女孩子",
  "幼儿园",
  "幼兒園",
  "幼稚園",
  "保育園",
  "学生",
  "學生",
  "生徒",
  "학생",
];

// Children by age or in another language, as anything that becomes an image
// reads them: "two 9-year-olds", "girl 9yrs", "girl (9)", "girl, nine", "ages
// 9 to 12", "ein Kind", "子供".
const IMAGE_AGES = [
  YEARS_OLDS,
  String.raw`\b${UNDER_18}${HALF}\s?-?\s?(?:y|yrs?|years?)\b(?!\s?-?\s?(?:ago|later|earlier|before|after|since|apart|together|older|younger|from|of (?!age)|in\b|into|married|sober|experience|anniversary|plan|warranty|lease)\b)`,
  String.raw`\b(?!(?:${NOT_A_NAME})\b)[a-z]{2,}(?:,? | ?- ?)(?:[1-9]|1[0-7]|${SPELLED_UNDER_18})${ISH}(?=\s?(?:$|[.!?;|]))`,
  String.raw`(?<![a-z])j[kcs]\s(?=[぀-ヿ一-鿿])`,
  String.raw`(?<![a-z0-9])[a-z]{2,} ?[(\[{]${UNDER_18}(?:\s?[fm])?[)\]}]`,
  String.raw`\bages? (?:of )?${UNDER_18}\b`,
  String.raw`\b(?:[1-9]|1[0-7]|${SPELLED_FOREIGN})\s?-?\s?(?:${YEAR_WORDS}|jahrige[nrs]?|jarige)\b`,
];

// "baby" and "tots", but not baby blue, babydoll, baby oil or tater tots.
const BABY_RULE = rule(
  String.raw`(?<![a-z])baby(?![a-z])(?!'s breath|\s?-?\s?(?:blue|pink|oil|dolls?|powder|hairs?|bump|steps?|shower|daddy|mama|momma)\b)|(?<![a-z])(?<!tater )(?<!tater-)tots?(?![a-z])`,
);

const IMAGE_RULES = [
  rule(terms(IMAGE_TERMS)),
  rule(CJK_CHILD),
  rule(GERMAN_CHILD),
  // Any school, but not an "old-school" look or a school for adults.
  rule(String.raw`(?<![a-z])(?<!old )(?<!old-)(?<!grad )(?<!law )(?<!med )(?<!medical )(?<!film )(?<!flight )(?<!business )(?<!nursing )(?<!cooking )(?<!culinary )(?<!art )school(?:s|ing)?(?![a-z])`),
  ...IMAGE_AGES.map((source) => rule(source)),
];

// What makes an image-only refusal a finding about a minor after all: an age
// under 18, a child, school or family word, or a child-like look, near a sexual
// word, as NEAR_SEXUAL reads "near". The classifier's policy counts all of these
// as minor content. Not styles adults wear too ("pigtails", "braces", "a
// backpack"), not a bare "baby", which is as often a pet name, and not "a minor
// tilt of the head".
const MINOR_MARKER = [
  ...IMAGE_AGES,
  termSource([
    ...AMBIGUOUS_TERMS.filter((term) => term !== "minor" && term !== "high-school"),
    ...LOWER_SCHOOLS,
    "student",
    "pupil",
    "classroom",
    "young",
    "younger",
    "youthful",
    "baby face",
    "baby-faced",
    "babyface",
    "flat chest",
    "flat-chested",
    "teddy bear",
    "stuffed animal",
    "lunchbox",
    "lunch box",
    "school bag",
    "schoolbag",
    "crayons",
    "babies",
    "crib",
    "nappy",
    "nappies",
    "pacifier",
    "sippy cup",
    "preschool",
    "pre-school",
    "playschool",
    "nursery school",
    "daycare",
    "day care",
    "elementary",
    "schoolkid",
    "school-kid",
    "schoolchild",
    "schoolchildren",
    "playground",
    "schoolyard",
    "recess",
    "daughter",
    "stepdaughter",
    "step-daughter",
    "niece",
    "baby sister",
    "baby brother",
    "nena",
    "bambina",
    "bimba",
    "jovencita",
    "chiquilla",
    "menor",
    "малышка",
    "дочка",
    "дочь",
  ]),
  CJK_CHILD,
  GERMAN_CHILD,
].join("|");
// In a picture, stripping is undressing too.
const SEXUAL_IN_IMAGE = `(?:${SEXUAL}|${termSource(["strip", "stripping", "stripped", "topless", "bottomless"])})`;
const MINOR_SIGNAL = rule(
  `(?:${MINOR_MARKER})${GAP}${SEXUAL_IN_IMAGE}|${SEXUAL_IN_IMAGE}${GAP}(?:${MINOR_MARKER})|(?:${CJK_CHILD})${CJK_NEAR}${SEXUAL_IN_IMAGE}|${SEXUAL_IN_IMAGE}${CJK_NEAR}(?:${CJK_CHILD})`,
);

const PROHIBITED = rule(terms(["bestiality", "zoophilia", "necrophilia", "snuff"]));

const REAL_PERSON = rule(terms(["deep-fake", "nudify", "undress her photo", "undress this photo", "face-swap"]));

function firstMatch(texts: string[], rules: Rule[], strict = false) {
  for (const { pattern, strict: plain, unless } of rules) {
    for (const text of texts) {
      if (strict || !unless) {
        const match = plain.exec(text);
        if (match) return match[0].trim();
        continue;
      }
      for (const match of text.matchAll(pattern)) {
        if (!unless(text, match)) return match[0].trim();
      }
    }
  }
  return null;
}

function minorMatch(texts: string[], strict = false) {
  return (
    firstMatch(texts, MINOR_RULES, strict) ?? (firstMatch(texts, AGE_RULES, strict) !== null ? "stated age under 18" : null)
  );
}

// A short name with a minor-coded word in it: "Child Yuki", "Yuki Twelve", "Your
// Daughter", "Lil Sis Amy", "Kiddo". Only a title-case name counts, as the whole
// text or a "Name:" field, so "no kids" or "a minor detail" in chat don't.
const NAME_WORDS = new RegExp(
  `^(?:${words(["child", "children", "kid", "kids", "kiddo", "kiddie", "minor", "daughter", "stepdaughter", "niece", "imouto", "eleven", "twelve", "девочка", "мальчик", "少女"])}|十[一二三四五六七])$`,
);
const NAME_PAIRS = /^(?:lil|little|baby|kid|step) (?:sis|sister|bro|brother)$|^your (?:daughter|niece|sister|baby)$/;
const NAME_ALONE = /^(?:kiddo|kiddie|imouto|少女)$/;

function minorName(input: string) {
  const spans = [...input.matchAll(/\bname\s*:\s*([^\n.,;:!?]{1,60})/gi)].map((match) => match[1]);
  const whole = input.trim().replace(/[.!]+$/, "");
  if (!/[\n.,;:!?]/.test(whole)) spans.push(whole);
  for (const span of spans) {
    const raw = span.normalize("NFKC").replace(INVISIBLE, "").trim().split(/\s+/).filter(Boolean);
    if (raw.length === 0 || raw.length > 4) continue;
    // No word starts lower case; CJK letters and digits have no case.
    if (raw.some((word) => /\p{Ll}/u.test(word[0]))) continue;
    const plain = raw.map((word) => normalize(word).replace(/[^\p{L}\p{N}]/gu, ""));
    const named =
      (plain.length === 1 && NAME_ALONE.test(plain[0])) ||
      (plain.length > 1 &&
        (plain.some((word) => NAME_WORDS.test(word)) ||
          plain.slice(1).some((word, index) => NAME_PAIRS.test(`${plain[index]} ${word}`))));
    if (named) return span.trim();
  }
  return null;
}

export function checkText(input: string): TextVerdict {
  const texts = chatViews(input);

  const minor = minorMatch(texts) ?? minorName(input);
  if (minor) return { ok: false, category: "minor", matched: minor };

  const prohibited = firstMatch(texts, [PROHIBITED]);
  if (prohibited) return { ok: false, category: "prohibited", matched: prohibited };

  const names = extraBlockedNames();
  const realPerson = firstMatch(texts, names.length ? [REAL_PERSON, rule(terms(names))] : [REAL_PERSON]);
  if (realPerson) return { ok: false, category: "real_person", matched: realPerson };

  return { ok: true };
}

// For anything that becomes an image or video (a photo hint, a motion, a scene):
// everything checkText refuses, plus every rule without its chat waivers and
// the words that only matter in a picture. The worker refuses the same.
export function checkImagePrompt(input: string): ImageVerdict {
  const verdict = checkText(input);
  if (!verdict.ok) return verdict;
  const texts = views(input);
  // "baby" last, so minorAdjacent can tell a bare pet name from anything else.
  const matched = firstMatch(texts, IMAGE_RULES) ?? minorMatch(texts, true) ?? firstMatch(texts, [BABY_RULE]);
  if (!matched) return { ok: true };
  const minor = firstMatch(texts, [MINOR_SIGNAL]);
  return minor ? { ok: false, category: "image", matched, minor } : { ok: false, category: "image", matched };
}

// Text near the line: an ambiguous minor word, school or childhood things, a
// family role, or a number that could be an age under 18. The chat route stops
// streaming a reply like this and waits for the classifier's verdict on all of
// it. A false hit only delays the text, so this leans hard toward recall.
const MINOR_ADJACENT = new RegExp(
  [
    termSource([
      "school",
      "class",
      "classes",
      "classroom",
      "teacher",
      "student",
      "principal",
      "detention",
      "homeroom",
      "locker",
      "prom",
      "recess",
      "homework",
      "curfew",
      "grounded",
      "allowance",
      "bedtime",
      "nap time",
      "babysitter",
      "babysit",
      "sleepover",
      "slumber party",
      "field trip",
      "report card",
      "backpack",
      "lunchbox",
      "lunch box",
      "juice box",
      "pigtails",
      "twin-tails",
      "braces",
      "stuffed animal",
      "teddy",
      "plushie",
      "lollipop",
      "crayons",
      "cartoons",
      "playground",
      "training bra",
      "puberty",
      "growth spurt",
      "first period",
      "mom",
      "mommy",
      "dad",
      "daddy",
      "stepdad",
      "step-dad",
      "stepmom",
      "step-mom",
      "parents",
      "sister",
      "brother",
      "stepsister",
      "stepbrother",
      "daughter",
      "son",
      "niece",
      "nephew",
      "babygirl",
      "little girl",
      "little boy",
      "little one",
      "little thing",
      "little body",
      "lil",
      "young",
      "younger",
      "youthful",
      "tiny",
      "petite",
      "smol",
      "innocent",
      "naive",
      "inexperienced",
      "virgin",
      "first time",
      "flat-chested",
      "hairless",
      "babies",
      "infant",
      "newborn",
      "toddler",
      "crib",
      "nappy",
      "nappies",
      "diaper",
      "preschool",
      "pre-school",
      "kindergarten",
      "daycare",
      "elementary",
    ]),
    // "the baby", "a newborn baby", but not "baby" as a pet name or "baby blue"
    String.raw`(?<![a-z])(?:a|the|this|that|newborn|little|tiny|infant|naked|nude) baby(?![a-z])(?!\s?-?\s?(?:blue|pink|oil|dolls?|powder|hairs?)\b)`,
    String.raw`\b(?:1[0-7]|${SPELLED_TEEN})\b`,
    // Any age under 18 next to a year word or a half, however young: "9 year
    // olds", "9yrs", "aged 9", "9 1/2"
    String.raw`\b${UNDER_18}${HALF}\s?-?\s?(?:y\b|y\s?[./]?\s?os?\b|yrs?\b|years?\b)`,
    String.raw`\b(?:age|aged|ages)\s?:?\s?${UNDER_18}\b`,
    String.raw`\b(?:[1-9]|1[0-7])\s\d/\d`,
  ].join("|"),
);

// A single digit in a sentence that says something sexual: "she is 9" in a
// sexual reply is held, "dinner at 8?" isn't.
const SMALL_NUMBER = /(?<![0-9.,:/])\b[1-9]\b(?![0-9.,:/])/g;
const smallNumberInSexualSentence = (text: string) =>
  [...text.matchAll(SMALL_NUMBER)].some((match) => ANY_SEXUAL.test(sentenceOf(text, match)));

export function minorAdjacent(input: string) {
  if (views(input).some((text) => MINOR_ADJACENT.test(text) || smallNumberInSexualSentence(text))) return true;
  const verdict = checkImagePrompt(input);
  if (verdict.ok) return false;
  // A bare "baby" is what checkImagePrompt tries last, and in chat it's a pet name.
  return verdict.category === "minor" || (verdict.category === "image" && verdict.matched !== "baby");
}

// A name as it would be written. The name rules read title case ("Child Yuki"),
// so names are screened in this form and "child yuki" is caught the same way.
export function asName(text: string) {
  return text.replace(/\p{L}+/gu, (word) => {
    const [first, ...rest] = [...word];
    return first.toUpperCase() + rest.join("").toLowerCase();
  });
}

// Real names we refuse to roleplay or draw, extended per deployment through
// BLOCKED_NAMES (comma separated). The image pipeline's celebrity detector is the
// real defence; this only stops the most obvious requests. The worker reads the
// same variable.
function extraBlockedNames() {
  return (process.env.BLOCKED_NAMES ?? "")
    .split(",")
    .map((name) => normalize(name.trim()))
    .filter(Boolean);
}

// A first-person statement that the writer is under 18 ("I'm 15", "I just
// turned 15", "I'm a 15 year old girl", "I'm in 9th grade", "15/F"). The
// message is refused like any minor content; this also marks it for human
// review, since the writer may be a minor.
const FIRST = String.raw`(?:${FIRST_PERSON}|i (?:just |only |barely )?turn(?:ed|s)?|i(?:'ll| will|ll) be|my age(?: is|'s|:)?|me:)`;
const NOT_LOOKING_BACK = "(?<!when )(?<!since )(?<!after )(?<!before )(?<!until )(?<!till )(?<!once )";
const DECLARES_MINOR = [
  NOT_LOOKING_BACK + statedAge(FIRST, AGE),
  NOT_LOOKING_BACK + statedYearsOld(FIRST),
  String.raw`\b${FIRST_PERSON} (?:(?:only|just|still) )?(?:under|below|younger than|almost|nearly|not yet|not even|not|sub) ?-?(?:18|eighteen)\b(?!\s?(?:anymore|any more|any longer|again|forever|either|\+|or (?:older|over)|and (?:up|over)))${NOT_AN_AGE}`,
  String.raw`\b${FIRST_PERSON} (?:(?:still|just|only|technically) )?(?:an? )?(?:underage|under-age|underaged|teen|teenager|preteen|pre-teen|tween|(?:high|middle|grade|elementary|pre)[ -]?schooler)\b`,
  minorNoun(FIRST_PERSON),
  FIRST_PERSON_KID,
  GOES_TO_SCHOOL,
  // "I'm not an adult yet", "I'm not even an adult". Too common as an adult's
  // joke to refuse in chat; here it only marks a message refused for other
  // reasons, or a report, for review.
  String.raw`\b${FIRST_PERSON} (?:(?:still|just) )?not (?:yet |even )?(?:an? )?(?:adult|grown[ -]?up)(?! (?:film|movie|content|site|store|star|actor|actress|performer|entertainer)\b)`,
  String.raw`^\s?(?:1[1-7]|${SPELLED_TEEN})(?:\s?-?\s?(?:y/?o|yrs?(?: old)?|years? old))?(?:\s?[,/]?\s?(?:[fm]|girl|boy|female|male))?\s?,?\s?(?:here|looking|hbu|wbu|lol|btw|hi|hey|hello)\b`,
  String.raw`^\s?(?:girl|boy|f|m)\s?,?\s?(?:1[0-7]|${SPELLED_TEEN})(?![0-9])${NOT_AN_AGE}`,
  enrolled(FIRST_PERSON),
  String.raw`(?:^\s?|[^a-z0-9\s]\s?|\b(?:asl|i'm|im|i am|me)\W{0,3})1[0-7]\s?(?:/\s?[fm]|f)(?![a-z0-9*])`,
  String.raw`^\s?(?:f\s?/?\s?|m\s?/\s?)1[0-7](?![0-9])`,
  String.raw`\basl\W{0,4}(?:1[0-7]|[1-9])(?![0-9])`,
  String.raw`^\s?${YEARS_OLD}`,
  String.raw`^\s?age\s?[:=-]\s?${AGE}`,
  String.raw`(?:\bi (?:was|wuz) |^\s?)born (?:in |on |back in )?(?:[a-z]+ (?:\d{1,2}(?:st|nd|rd|th)?,? )?)?(?:${recentYears()})\b`,
].map((source) => new RegExp(source));

export function declaresMinorAge(input: string) {
  const texts = chatViews(input);
  return DECLARES_MINOR.some((pattern) => texts.some((text) => pattern.test(text)));
}

// Recall matters more than precision here: a false hit only adds crisis
// resources to the reply and keeps the message out of memory.
const CRISIS_TERMS = terms([
  "kill my-self",
  "killing my-self",
  "end my life",
  "ending my life",
  "take my own life",
  "taking my own life",
  "want to die",
  "want 2 die",
  "wanna die",
  "want to be dead",
  "wanna be dead",
  "going to die tonight",
  "suicide",
  "suicidal",
  "self-harm",
  "hurt my-self",
  "hurting my-self",
  "cut my-self",
  "cutting my-self",
  "cut my wrists",
  "cutting my wrists",
  "slit my wrist",
  "overdose",
  "overdosed",
  "overdosing",
  "no reason to live",
  "better off dead",
  "better off without me",
  "better off if i was gone",
  "better off if i were gone",
  "better off if i wasnt here",
  "hang my-self",
  "hanging my-self",
  "end it all",
  "ending it all",
  "end it tonight",
  "ending it tonight",
  "off my-self",
  "unalive",
  "unaliving",
  "unalive my-self",
  "wish i was dead",
  "wish i were dead",
  "wish i wasnt alive",
  "wish i wasnt born",
  "wish i was never born",
  "wish i had never been born",
  "wish i could die",
  "want to stop existing",
  "not worth living",
  "isnt worth living",
  "nothing to live for",
  "no point in living",
  "no point living",
  "done with life",
  "done with living",
  "tired of living",
  "no reason to keep going",
  "reason to keep going",
  "sleep forever",
  "never wake up",
  "nobody would miss me",
  "no one would miss me",
  "noone would miss me",
  "nobody will miss me",
  "no one will miss me",
  "cant go on anymore",
  "cant go on any more",
  "too many pills",
  "bunch of pills",
  "handful of pills",
  "bottle of pills",
  "noose",
  "quiero morir",
  "quiero morirme",
  "me quiero matar",
  "quiero matarme",
  "me voy a matar",
  "voy a matarme",
  "suicidar",
  "suicidarme",
  "suicidio",
  "me tuer",
  "me suicider",
  "envie de mourir",
  "je veux mourir",
  "ich will sterben",
  "bring mich um",
  "bringe mich um",
  "mich umbringen",
  "selbstmord",
  "suizid",
  "voglio morire",
  "uccidermi",
  "quero morrer",
  "me matar",
  "хочу умереть",
  "покончить с собой",
  "убить себя",
  "самоубийство",
  "суицид",
  "死にたい",
  "自殺",
  "自杀",
  "想死",
  "不想活",
  "죽고 싶",
  "자살",
]);

const CRISIS_PATTERNS = [
  // "kms", but not "50 kms"
  /(?<![0-9] )(?<![0-9])\bkms\b/,
  /\bjump(?:ing)? (?:off|from) (?:a|the|this|that|my) (?:bridge|building|roof|rooftop|balcony|ledge|tower|overpass)\b/,
  /\b(?:jump|step|throw myself|walk|lie down) in front of (?:a|the) (?:train|bus|truck|car)\b/,
  /\bdo(?:nt| not) (?:want to|wanna) (?:live|be alive|exist)\b(?! (?:in|with|near|there|here|at|on|by|alone|together|like that|abroad|downtown|close|without you)\b)/,
  /\bdo(?:nt| not) (?:want to|wanna) wake up\b(?! (?:early|so early|at|before|for)\b)/,
  /\b(?:been |started |start |keep |kept )cutting (?:again|my (?:wrists?|arms?|legs?|thighs?))\b/,
  /\b(?:take|taking|took|swallow|swallowing|swallowed|down|downing|downed) all (?:of )?(?:my|the|these|those) (?:pills|meds|medication|tablets|sleeping pills)\b/,
  /\b(?:bought|got|have|tied|found) (?:a|the) rope\b/,
  /\bdrive (?:my car |myself )?(?:into|off) (?:a|the) (?:tree|wall|cliff|bridge|river|lake|ocean)\b/,
  /\b(?:want|wanna|going) to end things\b(?! (?:with|between|off|there|here|on|amicably|properly)\b)/,
];

// Also run on the spelled-out reading, so "k i l l myself" counts.
export function detectCrisis(input: string) {
  const plain = normalize(input).replace(/'/g, "");
  return [plain, joinSpelled(plain)].some(
    (text) => CRISIS_TERMS.test(text) || CRISIS_PATTERNS.some((pattern) => pattern.test(text)),
  );
}

export const REFUSAL: Record<Exclude<TextVerdict, { ok: true }>["category"], string> = {
  minor:
    "That's not something I'll do. Everyone here is an adult, and nothing involving minors, or anyone who seems like one, is allowed.",
  prohibited: "That's outside what's allowed here.",
  real_person: "I can't do anything involving real people or their photos.",
};

// For a photo hint or motion that checkImagePrompt refuses and checkText allows.
export const IMAGE_REFUSAL =
  "Photos and videos can't mention kids, school or anything that could suggest someone under 18, even in passing. Try other words. Nothing was charged.";
