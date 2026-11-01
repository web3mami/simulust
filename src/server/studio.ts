import "server-only";
import { z } from "zod";
import type { CharacterRow } from "@/server/db/schema";
import { joinPunctuated, joinSpelled, normalize } from "@/server/safety/text";
import { buildImagePrompt, type ImagePrompt, type ImageSubject } from "@/lib/portrait-prompt";
import {
  STUDIO_ACTION_IDS,
  STUDIO_DETAILS_MAX,
  STUDIO_OUTFIT_IDS,
  STUDIO_SETTING_IDS,
  studioAction,
  studioOutfit,
  studioPerson,
  studioSetting,
  type StudioPerson,
} from "@/lib/studio";

// The Video Studio's keyframe: one of the user's visible characters, alone, in
// a scene built only from the presets in src/lib/studio.ts plus a short line of
// screened details. The clip is made from it by POST /api/media/[id]/animate.

export const studioFrameInput = z.object({
  characterId: z.string().trim().min(1).max(64),
  setting: z.enum(STUDIO_SETTING_IDS, { error: "Pick a setting from the list." }),
  outfit: z.enum(STUDIO_OUTFIT_IDS, { error: "Pick an outfit from the list." }),
  action: z.enum(STUDIO_ACTION_IDS, { error: "Pick a motion from the list." }),
  details: z
    .string()
    .trim()
    .max(STUDIO_DETAILS_MAX, `Keep the details under ${STUDIO_DETAILS_MAX} characters.`)
    .optional()
    .transform((value) => value || undefined),
});

export type StudioFrameInput = z.infer<typeof studioFrameInput>;

// The scene part of the input; details are optional.
export type StudioSceneChoice = Pick<StudioFrameInput, "setting" | "outfit" | "action"> & { details?: string };

export function subjectOf(character: CharacterRow): ImageSubject {
  return {
    name: character.name,
    age: character.age,
    gender: character.gender,
    style: character.style,
    ethnicity: character.ethnicity,
    body: character.body,
    hair: character.hair,
    hairStyle: character.hairStyle,
    eyeColor: character.eyeColor,
    breast: character.breast,
  };
}

// Studio scenes, chat photos and clips star one character, alone. Anything that
// brings someone else in is refused before anything is charged, and refusing is
// the default rather than the exception:
// - a person, by any name and anywhere in the text: "a man", "two naked
//   women", "her roommate", "the pool boy", "a delivery guy", "the
//   photographer" (PEOPLE_WORDS);
// - a count of people ("both of them", "a couple", "three silhouettes");
// - a sex act or position that takes a partner ("a blowjob", "doggy", "riding
//   his cock"), or something done to her by someone ("being touched");
// - someone else's body ("a man's hand", "her roommate's hands");
// - the viewer as a participant ("riding you", "on my lap", "pov sex").
// Solo scenes stay open: touching herself, toys, spreading, posing, undressing,
// and the viewer as the one she poses for ("eyes on you", "blowing you a kiss",
// "stripping for you"). A few phrases with a person word in them aren't a person
// and are read past (NOT_PEOPLE); everything else in the text still counts. The
// prompt's "alone" and OTHER_PEOPLE_NEGATIVE keep the model there. A word list,
// so it refuses rather than rewrites, and it's the fast first check, not the
// last: the classifier's scene policy reads every scene after it, and the media
// worker checks every image and sampled clip frame for a second person. A false
// hit costs a paying user their request (or quietly swaps a written scene for a
// stock one), so it refuses what can only be someone else and reads ordinary
// solo wording as solo: the viewer's hoodie on her, a book on his lap, a scene
// that calls the character "a woman in lingerie" (withoutSelf).
//
// Pronouns depend on who the character is, so callers pass the gender:
// - a woman's "her hands" and a man's "his hands" are their own; the other
//   gender's pronouns are someone else ("his hands" on a woman, "she" or "her
//   lips" with a man), and so is "they" doing something ("they kiss her neck",
//   "they bend her over"). Only clothes are exempt: "wearing his shirt", "in
//   her dress", unless the one they belong to is still in them ("unbuttoning
//   his shirt", "her heels on his shoulders");
// - without a gender, "her" is someone else only as the object of a partner
//   verb ("fucking her", "kissing her slowly"), never as a possessive ("licking
//   her lips"), and a he counts next to a she ("his hands on her hips") or as
//   a place the character can't be alone ("on his lap", "beneath him"), not as
//   his own body ("his hands on his knees");
// - "you" is the character in a chat photo's hint (bringsOthers) and the viewer
//   everywhere else (studioBringsOthers): the studio's details, a clip's motion
//   and the photo's model-written scene. Either way "riding you", "her legs
//   around you" and "you between her thighs" put a second person in; "your
//   body", "you in bed" and "pulling you closer" are refused only where "you"
//   is the viewer, and "you touching her breasts" only where "you" isn't her.

// Anyone who isn't the character, refused wherever they appear.
const PEOPLE_WORDS = [
  // Anyone at all.
  String.raw`m[ae]n|wom[ae]n|guys?|dudes?|gentlem[ae]n|girls?|boys?|lad(?:y|ies)|lads?|gals?|blokes?|fellas?|persons?|people|hunks?|studs?|dadd(?:y|ies)|momm(?:y|ies)|males|females`,
  // Slang for someone: "a milf", "some chick", "her bro".
  String.raw`milfs?|gilfs?|dilfs?|twinks?|chicks?|bros?|homies?`,
  // One word for someone there for a job: "the poolboy", "a pizzaman".
  String.raw`(?:pool|pizza|delivery|milk|business|toy|paper|cable|lumber|frat|house|stable|farm|cabana|surf|gym|cow|errand|bus|stock|sales|door|garbage|tow)(?:boys?|m[ae]n|guys?)`,
  String.raw`someone|somebody|strangers?|lovers?|partners?|friends?|besties?|bffs?|boyfriends?|girlfriends?|bfs?|gfs?|husbands?|hubby|wi(?:fe|ves)|fianc[eé]e?s?|exes|groom|bridesmaids?|admirers?|suitors?`,
  // Family, home, work and school.
  String.raw`sisters?|brothers?|siblings?|step[- ]?(?:bro|sis|brother|sister|sibling|mom|mum|mommy|mother|mama|dad|daddy|papa|father|son|daughter|aunt|uncle|cousin|grandpa|grandma|parent|family)s?|step[- ]?(?:mommies|daddies|families)|moms?|mums?|mothers?|dads?|fathers?|sons?|daughters?|aunts?|aunties?|uncles?|cousins?|nieces?|nephews?|grand(?:ma|pa|mother|father)s?|grann(?:y|ies)|in-laws?`,
  String.raw`room-?mates?|flatmates?|housemates?|neighbou?rs?|landlord|landlady|tenants?|guests?|boss(?:es)?|managers?|employees?|co-?workers?|colleagues?|clients?|customers?|patients|teachers?|professors?|tutors?|students?|classmates?`,
  // Someone at work in the scene. Singular "trainer" only: trainers are shoes.
  String.raw`plumbers?|electricians?|mechanics?|handym[ae]n|repairm[ae]n|mailm[ae]n|postm[ae]n|doctors?|dentists?|surgeons?|(?:physio)?therapists?|nurses?|bartenders?|barm[ae]n|barmaids?|waiters?|waitress(?:es)?|baristas?|masseurs?|masseuses?|photographers?|camera[- ]?(?:m[ae]n|wom[ae]n|persons?|crew)|film crew`,
  String.raw`cops?|police(?:m[ae]n|wom[ae]n)?|officers?|security guards?|bodyguards?|lifeguards?|bouncers?|firefighters?|firem[ae]n|soldiers?|coach(?:es)?|trainer|personal trainers|instructors?|chauffeurs?|drivers?|pilots?|butlers?|maids?|valets?|bellboys?|bellhops?|receptionists?|secretar(?:y|ies)|assistants?|interns?|priests?|pastors?|gardeners?|janitors?|babysitters?|nann(?:y|ies)|dancers|strippers|escorts`,
].join("|");

// Roles a costume is named after: the outfit, not the person.
const COSTUME_ROLES = String.raw`nurse|doctor|french maid|maid|police officer|police|cop|policewoman|officer|teacher|secretary|flight attendant|stewardess|waitress|bartender|barmaid|lifeguard|firefighter|pilot|soldier|cowboy`;
const GARMENT_ADJECTIVE = String.raw`oversized|old|big|baggy|loose|borrowed|favou?rite|worn|white|black|blue|red|pink|green|navy|gray|grey|crisp|plaid|striped|flannel|linen|denim|silk|satin|lace|lacy|sheer|cotton|wool|leather|dress|button-down|little|tight|short|long|floral|sexy|work|gym|team|varsity|football|hockey`;
const GARMENTS = String.raw`shirts?|t-?shirts?|tees?|button-?downs?|button-?ups?|sweaters?|jumpers?|hoodies?|sweatshirts?|cardigans?|jackets?|blazers?|suits?|coats?|robes?|pajamas|pyjamas|boxers|briefs|underwear|jeans|trousers|pants|shorts|ties?|hats?|caps?|boots|shoes|socks|watch(?:es)?|cologne|clothes|clothing`;
// Clothes a woman may wear of his, and a man of hers ("his hoodie", "her
// dress"): the clothes, not the person.
const HIS_GARMENTS = String.raw`${GARMENTS}|jerseys?|flannels?|scarf|scarves|belts?|sunglasses|glasses|chains?|rings?|dog tags|uniforms?|bathrobes?|sweatpants|joggers|slippers|beanies?|bandanas?|sneakers`;
const HER_GARMENTS = String.raw`${GARMENTS}|dress(?:es)?|sundress(?:es)?|skirts?|panties|knickers|bras?|lingerie|stockings|heels|thongs?|nighties?|nightgowns?|camisoles?|blouses?|bikinis?|swimsuits?|leggings|tights|corsets?|garters?|bodysuits?|scarf|scarves|belts?|scrunchies?|jewel(?:le)?ry|necklaces?|earrings?|bracelets?|rings?|sunglasses`;
const ELEMENT_ADJECTIVE = String.raw`warm|soft|golden(?:[- ]?hour)?|bright|morning|evening|afternoon|late|gentle|pale|silver|cool|summer|first|dappled|fading|low|dim|natural|window|sunset|sunrise|neon`;
const ELEMENTS = String.raw`sun|sunlight|sunshine|sunbeams?|rays?|glow|light|lamplight|candlelight|moonlight|firelight|daylight|breeze|wind|water|rain|waves|surf|spray|steam|mist|silk|satin|sheets|petals`;

// Phrases with a person word in them that aren't a person: clothes and looks
// named after someone, light on skin, the scene's own "only person". Taken out
// of the text before it's read, so whatever else is in it still counts ("a
// man's shirt" goes, "a man's hand" stays).
const NOT_PEOPLE = new RegExp(
  [
    String.raw`\b(?:man's|men's|mens|guy's|guys')\s+(?:(?:${GARMENT_ADJECTIVE})\s+){0,3}(?:${GARMENTS})\b`,
    String.raw`\bboyfriend[- ](?:jeans?|jean shorts|denim|shirt|blazer|fit|cut|style|sweater|cardigan|hoodie|tee|t-?shirt|shorts|jacket|coat|chinos|trousers|pants|button-?down|flannel|sweatshirt|jumper)s?\b`,
    String.raw`\b(?:mom|dad)[- ](?:jeans|shorts|hats?|caps?|sneakers|trainers)\b`,
    String.raw`\bboy[- ]?shorts\b|\bman[- ]bun\b|\bguy[- ]?liner\b|\bmother[- ]of[- ]pearl\b`,
    // A look, not a person: "a trophy wife look", "milf energy", "wife-material".
    String.raw`\b(?:trophy[- ]wife|milf|twink|tomboy) (?:look|aesthetic|style|vibes?|energy|outfit)\b|\bwife[- ]material\b`,
    String.raw`\b(?:girl[- ]next[- ]door|pin-?up girl) (?:look|vibes?|style|aesthetic|charm|energy|smile|type|feel|pose|outfit)\b`,
    String.raw`\bboss (?:energy|vibes?|mode)\b|\blike a boss\b`,
    String.raw`\bwith you in mind\b`,
    String.raw`\b(?:being |getting )?(?:touched|kissed|caressed|warmed|stroked|embraced|hugged|lit|bathed|wrapped) by (?:the )?(?:(?:${ELEMENT_ADJECTIVE})\s+){0,2}(?:${ELEMENTS})\b`,
    // Western wear: "a cowgirl hat", "cowboy boots", "a cowgirl-style hat". Not
    // "cowgirl style" on its own, which is a position.
    String.raw`\bcow(?:boy|girl)[- ](?:style[- ])?(?:hats?|boots?|outfits?|costumes?|getup|shirts?|skirts?|belts?|cosplay|fringe|look|aesthetic|vibes?)\b`,
    // A team on a shirt: "a Dallas Cowboys jersey".
    String.raw`\bcowboys\s+(?:jerseys?|shirts?|tees?|t-?shirts?|hoodies?|sweatshirts?|caps?|hats?|beanies?|jackets?|merch|gear|fans?|games?)\b`,
    // Jewellery, bags, seats and rooms named for someone. A stud only as
    // jewellery: "stud earrings", "a nose stud", "a gold stud", "a stud in her nose".
    String.raw`\b(?:(?:diamond|gold|golden|silver|pearl|crystal|rhinestone|titanium|steel|ear|nose|tongue|belly|navel|nipple|lip|eyebrow|metal|spiked)\s+)studs?\b|\bstuds?\s+(?:earrings?|piercings?|belt|details?|collar|choker|boots|heels)\b|\bstuds?\s+in\s+(?:her|his|their|your|the)\s+(?:nose|ears?|tongue|lip|navel|belly button|eyebrow)\b`,
    String.raw`\bcoach (?:bag|handbag|purse|tote|wallet)s?\b|\blifeguard (?:tower|chair|stand|station|hut)s?\b|\bguest (?:room|bedroom|bathroom|house|suite|bed)s?\b|\bdriver'?s? (?:seat|side|door)\b`,
    // Costumes: "a nurse outfit", "dressed as a french maid". Never someone's
    // ("the bartender's look" is the bartender).
    String.raw`\b(?:dressed (?:up )?as (?:an? )?(?:(?:sexy|naughty|cute|hot|french)\s+)*)?(?:${COSTUME_ROLES})\s+(?:outfit|uniform|costume|cosplay|scrubs|dress|lingerie|look|hat|cap|apron|attire|getup|swimsuit)s?\b`,
    String.raw`\bdressed (?:up )?as (?:an? )?(?:(?:sexy|naughty|cute|hot|french)\s+)*(?:${COSTUME_ROLES})\b(?!')`,
    // Saying she's alone.
    String.raw`\b(?:the )?only (?:one|person) (?:in|on) (?:the )?(?:scene|frame|photo|picture|shot|room|clip|video)\b|\bno (?:other )?(?:people|person|one else)\b`,
  ].join("|"),
  "g",
);

// The viewer in the scene ("kissing me", "with you", "between us"). Not him,
// her or them, which are as often the character ("with her hair down").
const OTHER_PERSON_NOUNS = `${PEOPLE_WORDS}|me|you|us`;

// "a man", "her handsome lover", "two girls", "you".
const PERSON = String.raw`(?:(?:a|an|the|his|her|my|your|their|another|other|two|three|some|several|many|more|both|older|hot|sexy|handsome|beautiful|tall|strange|random|muscular|lucky|mysterious|masked|second|new)\s+)*(?:${OTHER_PERSON_NOUNS})\b`;

// Verbs that take a partner: whoever they land on is a second person, him and
// them included.
const PARTNER_VERBS = [
  "fuck(?:s|ed|ing)?",
  "screw(?:s|ed|ing)",
  "bang(?:ed|ing)",
  "pound(?:s|ed|ing)",
  "rail(?:s|ed|ing)",
  "rid(?:e|es|ing)",
  "rode",
  "suck(?:s|ed|ing)?",
  "blow(?:s|ing)?",
  "lick(?:s|ed|ing)?",
  "kiss(?:es|ed|ing)?",
  "hold(?:s|ing)?",
  "held",
  "embrac(?:e|es|ed|ing)",
  "cuddl(?:e|es|ed|ing)",
  "spoon(?:s|ed|ing)",
  "finger(?:s|ed|ing)?",
  "spank(?:s|ed|ing)?",
  "chok(?:e|es|ed|ing)",
  "slap(?:s|ped|ping)?",
  "straddl(?:e|es|ed|ing)",
  "mount(?:s|ed|ing)?",
  "grind(?:s|ing)? (?:on|against)",
  "sit(?:s|ting)? on",
  "sat on",
  "penetrat(?:e|es|ed|ing)",
  "thrust(?:s|ing)? into",
  "peg(?:s|ged|ging)?",
  "grop(?:e|es|ed|ing)",
  "fondl(?:e|es|ed|ing)",
  "grab(?:s|bed|bing)?",
  "pin(?:s|ned|ning)? down",
  "undress(?:es|ed|ing)?",
  "strip(?:s|ped|ping)?",
  "pleasur(?:e|es|ed|ing)",
  "worship(?:s|ped|ping)?",
  "dominat(?:e|es|ed|ing)",
  "ti(?:e|es|ed) up",
  "tying up",
  "join(?:s|ed|ing)?",
  "bend(?:s|ing)? over",
  "bent over",
  "climb(?:s|ed|ing)? (?:on|onto|on top of)",
  "mak(?:e|es|ing) love to",
  "made love to",
  "sleep(?:s|ing)? with",
  "slept with",
  "sex with",
  "hook(?:s|ed|ing)? up with",
  "mak(?:e|es|ing) out with",
  "made out with",
].join("|");

// Verbs that light, water and silk do too ("water caressing her", "the dress
// hugging her"): a second person only when they land on him, the viewer or a
// person, not on her.
const TOUCH_VERBS = [
  "touch(?:es|ed|ing)?",
  "caress(?:es|ed|ing)?",
  "strok(?:e|es|ed|ing)",
  "massag(?:e|es|ed|ing)",
  "hug(?:s|ged|ging)?",
  "rub(?:s|bed|bing)? (?:against|on)",
  "lean(?:s|ed|ing)? (?:on|into|against)",
  "press(?:es|ed|ing)? (?:against|into)",
  "cling(?:s|ing)? to",
  "wrap(?:s|ped|ping)? (?:her|his|their) (?:legs|arms) around",
].join("|");

// "her" as the object of a partner verb, not a possessive: "fucking her",
// "kissing her slowly", "holding her close", "bending her over", but not
// "licking her lips", "her open mouth" or "holding her back straight".
const HER_OBJECT = String.raw`her(?=\s*$|\s*[,.;:!?)]|\s+(?:with|from|hard|harder|softly|slowly|slow|deep|deeper|deeply|gently|roughly|rough|until|and|while|again|against|on|in|at|as|like|into|tonight|now|senseless|raw|passionately|tenderly|everywhere|all over|down|over|up|close|closer|apart|onto|to|open(?!\s+(?:mouth|lips|legs|thighs|palms?|hands?|eyes|arms|shirt|blouse|robe|jacket|book))|back(?!\s+(?:arched|straight|curved|to)\b))\b(?!-))`;
// Not "them", which is as often her shoes or her hands ("holding them up"),
// except after sex itself (SEX_VERBS).
const PARTNER_OBJECT = String.raw`(?:(?:him|someone|somebody|anyone|anybody|each other|one another)\b|${PERSON}|${HER_OBJECT})`;
const SEX_VERBS = String.raw`(?:fuck(?:s|ed|ing)?|screw(?:s|ed|ing)|bang(?:ed|ing)|pound(?:s|ed|ing)|rail(?:s|ed|ing)|peg(?:s|ged|ging)|penetrat(?:e|es|ed|ing)|sex with|sleep(?:s|ing)? with|slept with|mak(?:e|es|ing) love to|made love to|mak(?:e|es|ing) out with|made out with|hook(?:s|ed|ing)? up with)`;
const TOUCH_OBJECT = String.raw`(?:(?:him|someone|somebody|anyone|anybody|each other|one another)\b|${PERSON})`;
// "blowing you a kiss" is the studio's own blurb, not a blowjob.
const NOT_A_KISS = String.raw`(?!\s+(?:a\s+|an\s+|one\s+|another\s+|soft\s+)*(?:kiss|kisses|wink|look|glance|smile))`;
// Toys are solo ("fucked by a machine", "getting fucked with a dildo").
const NOT_A_TOY = String.raw`(?!\s+(?:by|with)\s+(?:(?:a|an|the|her|his|their|my|your)\s+)?(?:(?:big|pink|purple|black|glass|huge|thick|vibrating|realistic)\s+)*(?:toys?|dildos?|vibrators?|wands?|(?:fucking\s+|sex\s+)?machines?|sybian|plug))`;

// Body parts: someone else's in the scene means they're in it too.
const BODY =
  "hands?|fingers?|fingertips|palms?|fists?|arms?|lap|tongue|mouth|lips|kiss(?:es)?|breath|touch|embrace|grip|body|bodies|chest|abs|thighs?|legs?|knees?|cock|dick|penis|shaft|balls|cum|load|semen|face|pussy|breasts?|tits|boobs|ass|nipples?|skin|neck|teeth|beard|stubble|hips";
const BODY_ADJECTIVE = String.raw`(?:(?:own|big|strong|rough|warm|soft|wet|hard|thick|firm|gentle|eager|large|hot|greedy|calloused|bare)\s+)*`;
// Someone's cum, by any name ("loads of" is only a lot).
const CUM = String.raw`cum(?:s|ming|med)?|semen|jizz|spunk|loads(?!\s+of\b)`;
// A hand, a grip or a toy is never someone: "cock in your fist", "cum on her
// fingers", "cum dripping down her toy". Whose hand it is the pronoun rules
// read ("my hand" is the viewer's).
const NOT_A_HAND = String.raw`(?!\s+${BODY_ADJECTIVE}(?:hands?|fists?|fingers?|fingertips|palms?|grip|toys?|dildos?|vibrators?|wands?)\b)`;
// Deep in someone: "deep inside her", "all the way down her throat".
const IN_SOMEONE = String.raw`(?:(?:is|still|slowly|deep|deeper|all the way|balls deep|buried|sliding|slipping|pushing|thrusting|pressed|pressing|sunk|halfway)\s+)*(?:in|inside|into|between|down)\s+(?:of\s+)?(?:her|you|your|me|my|them)\b${NOT_A_HAND}`;
// "a man's", "someone's", "her lover's", "my".
const OWNER = String.raw`(?:(?:someone|somebody|anyone|anybody|someone else|another person|(?:a|an|the|some|another|her|his|their|my|your)\s+(?:${PEOPLE_WORDS}))'s|my|our)`;

// Acts and positions that take a partner, however they're dressed up.
const PARTNER_ACTS = [
  String.raw`blow\s?-?jobs?|bjs?|blowies?|hand\s?-?jobs?|foot\s?-?jobs?|rim\s?-?jobs?|rimming|anilingus|fellatio|cunnilingus`,
  String.raw`tit\s?-?jobs?|titty\s?-?fuck(?:ing|s)?|tit\s?-?fuck(?:ing|s)?|boob\s?-?jobs?|paizuri`,
  String.raw`oral sex|giving (?:head|oral)|gives (?:head|oral)|going down on|goes down on|face\s?-?sitting|face\s?-?sits?`,
  String.raw`69|69ing|sixty[- ]?nine|scissoring|tribbing|dogg(?:y|ie)(?:[ -]?style)?|missionary|reverse[ -]cowgirl|spit\s?-?roast(?:ed|ing|s)?`,
  String.raw`double penetration|dp|gang\s?-?bang(?:ed|ing|s)?|bukkake|creampie[ds]?|cream-?pied|cum\s?-?shots?|money shot|breeding`,
  String.raw`intercourse|(?:having|have|had|has) sex(?! appeal| toys?| drive)|(?:making|make|makes|made) love|making out|lovemaking|foreplay|lap\s?-?dances?`,
  String.raw`taking turns|passed around|cuckold(?:ing|s)?|cuck|hotwife|swingers|spooning|voyeurs?|peeping tom|each other|one another`,
  // Gestures that take two.
  String.raw`holding hands|hand in hand|arm in arm|sharing (?:a|the|one) (?:kiss|bed|bath|shower|tub)`,
  String.raw`(?:dancing|kissing|cuddling|cuddled up|snuggling|snuggled up|sleeping|showering|bathing|lying|laying|naked|nude|posing|in bed|in the shower|in the bath|in the tub|alone)\s+together`,
].join("|");

// Figures and silhouettes that are scenery or props, not someone: "palm
// silhouettes", "action figures on the shelf", "the silhouettes of the trees",
// "rooftop silhouettes". Art that draws people ("anime figures", "marble
// figures") is people in the picture; only a figurine or statue of one isn't.
const SCENERY = String.raw`palms?|palm[- ]trees?|trees?|pines?|cact(?:us|i)|forests?|woods|jungle|treelines?|city|skyline|cityscape|mountains?|hills?|dunes?|cliffs?|rocks?|buildings?|towers?|skyscrapers?|rooftops?|roofs?|chimneys?|spires?|steeples?|windmills?|cranes?|bridges?|boats?|ships?|sailboats?|lighthouses?|birds?|clouds?|temples?|church(?:es)?|castles?|ruins|stick|action|chess|toy|lego`;
// Decor that's only a figure with no count in front of it: "neon figures on the
// wall", but "two neon figures kissing" is two people drawn in neon.
const DECOR = String.raw`neon|painted|graffiti|chalk|paper|ceramic|collectible|miniature|wooden|cardboard|geometric|decorative|anime|cartoon|marble|bronze|wax|porcelain|clay|stone|carved`;
const NOT_SCENERY_BEFORE = String.raw`(?<!\b(?:${SCENERY}|${DECOR})\s+)`;
const NOT_COUNTED_SCENERY_BEFORE = String.raw`(?<!\b(?:${SCENERY})\s+)`;
const NOT_SCENERY_OF = String.raw`(?!\s+of\s+(?:(?:a|an|the|some|tall|distant|swaying|dark|black|old)\s+)*(?:${SCENERY})\b)`;
// Plurals in -girls or -boys that aren't people: catgirls figurines, beer
// tallboys, highboys and lowboys. Counted, only things you can hold: "two
// catgirls art" is two catgirls drawn.
const NOT_PLURAL_PEOPLE = String.raw`(?![- ]?(?:posters?|prints?|figurines?|figures?|plush(?:ies?)?|dolls?|stickers?|merch|wallpapers?|art(?:work)?|manga|comics?|statues?|calendars?)\b)`;
const NOT_COUNTED_THINGS = String.raw`(?![- ]?(?:posters?|prints?|figurines?|plush(?:ies?)?|dolls?|stickers?|merch|statues?|calendars?)\b)`;

// Beings a character may be, so someone else only as another one ("another
// demon") or doing something to her, and the things named after them ("angel
// wings", "a monster energy drink").
const CREATURES = String.raw`catgirls?|foxgirls?|elf|elves|angels?|demons?|vampires?|succub(?:us|uses|i)|incub(?:us|uses|i)|werewol(?:f|ves)|monsters?|creatures?|aliens?|robots?|orcs?|goblins?|minotaurs?|centaurs?`;
const CREATURE_THINGS = String.raw`wings?|halos?|horns?|hats?|caps?|charms?|pendants?|necklaces?|earrings?|ornaments?|toppers?|prints?|posters?|slippers|pajamas|pyjamas|tails?|ears?|fangs|teeth|claws|bites?|tattoos?|costumes?|outfits?|cosplay|makeup|contacts|lenses|capes?|cloaks?|collars?|headbands?|masks?|hoods?|onesies?|lingerie|style|aesthetic|look|vibes?|theme|themed|glow|energy|drinks?|cans?|figures?|figurines?|plush(?:ies?)?|statues?|dolls?|dildos?|toys?|vibrators?|trucks?|movies?|films?|books?|shows?|games?|landscapes?|planets?|spaceships?|faces?|smiles?|voice`;

// Counted people, under any name: "two naked women", "three silhouettes",
// "two catgirls", "three elves", "two anime figures". Not "two palm
// silhouettes" or "a few action figures".
const COUNTED = String.raw`people|persons|${NOT_COUNTED_SCENERY_BEFORE}(?:figures|silhouettes)${NOT_SCENERY_OF}|bodies|characters|models|beauties|babes|hotties|cuties|blondes|brunettes|redheads|sluts|whores|milfs|twinks|lesbians|dancers|strippers|[a-z]*girls${NOT_COUNTED_THINGS}|(?!(?:tall|high|low)boys\b)[a-z]*boys${NOT_COUNTED_THINGS}|guys|men|women|ladies|elves|goddesses|gods|angels|witches|vampires|succubi|succubuses|incubi|nymphs|demons|demonesses|devils|princesses|princes|queens|kings|fairies|faeries|mermaids|mermen|sirens|valkyries|maidens|nuns|aliens|androids|robots|monsters|orcs|goblins|werewolves|creatures|beings|clones|nekos|kitsunes`;

// The viewer, or anyone, on, under or in someone: "you behind her", "me
// between her legs", "you on his lap". Not after a verb that only shows them
// something ("show me between your legs") or makes them the audience ("for
// you", "at you").
const NOT_THE_SUBJECT = String.raw`(?<!\b(?:show|shows|showing|showed|give|gives|giving|gave|let|lets|letting|send|sends|sending|sent|tell|tells|telling|for|to|at|toward|towards)\s+)`;
const SUBJECT_FILLERS = String.raw`(?:(?:am|are|is|was|were|be|being|lying|laying|sitting|kneeling|standing|crouching|right|still|both|now|then|just|slowly|naked|nude|all|curled up|snuggled up|pressed up)\s+)*`;
const POSITION_BODY = String.raw`legs|thighs|knees|lap|arms|feet|hips|waist|shoulders?|stomach|belly|crotch|ass|cheeks|breasts|tits|chest|back|body|hair`;
// Any part of a body that can be on or against someone else's: "her nails
// down your back", "your head between her thighs", "her foot on your chest".
const CONTACT_BODY = String.raw`${BODY}|${POSITION_BODY}|head|throat|nails|foot|toes|lip|cheek`;

// Where someone's body goes on another's: "her legs wrapped around you", "his
// cock in your mouth", "your hands on her hips".
// Not "to": "her back to you" and "turning her face to you" are poses.
const ONTO = String.raw`(?:(?:wrapped|wrapping|tight|tightly|pressed|pressing|glued|held|locked|firmly|resting|slowly|gently|softly|still|all|curled|clamped|squeezing|sliding|slipping|trailing|roaming|running|moving|tangled|buried|deep)\s+)*(?:around|round|on|against|over|across|onto|into|in|inside|between|all over|along|up|down|under|beneath|(?<=(?:pressed|pressing|glued|held)\s)to)`;
// Hands, mouths and bodies with no owner said, described as someone else's.
const PARTNER_ADJECTIVE = String.raw`strong|muscular|bearded|hairy|rough|calloused|callused|masculine|manly|tattooed|large|big|veiny|greedy|wandering|roaming|eager|hungry`;
// A cock nobody owns: not hers, his or yours (a man's own "his cock in his
// hand"), which the pronoun rules read, and not a toy's or light's.
const NO_OWNER = String.raw`(?<!\b(?:her|his|their|your|my|our|own)\s+(?:[a-z-]+\s+){0,3})(?<!\b(?:toy|dildo|vibrator|wand|glass|silicone|rubber|plastic|fake|light|sun|sunlight|elevator|mine|air)(?:'s)?\s+)`;
const NOT_A_COCK_THING = String.raw`(?![- ]?(?:shaped|like|rings?|sleeves?|cages?))`;

// What leads into a place on someone: a new clause or a person, then maybe the
// character in a pose ("lying", "kneeling", "held"). Not a thing, even one
// that's posed: "a book resting on his lap", "a cat curled up in his lap", "a
// mug cradled in his hands", "the sheets under him".
const PERSON_LEAD = String.raw`(?:^|[,.;:!?(]\s*|\b(?:you|you're|you are|me|us|her|herself|she|she's|i|i'm|we|we're|them)\s+)`;
const POSES = String.raw`lying|laying|lies|lay|resting|rests|sitting|sits|sat|seated|perched|standing|stands|stood|bouncing|bounces|grinding|grinds|squatting|squats|sinking|sinks|sliding|slides|impaled|straddling|riding|rides|kneeling|kneels|knelt|curled up|curled|snuggled up|snuggled|snuggling|cuddled up|cuddled|cuddling|nestled|nestling|asleep|sleeping|melting|melts|naked|nude|sprawled|climbing|climbs|crawling|crawls|falling|falls|fell|collapsing|collapsed|squirming|writhing|moaning|trembling|pinned|trapped|bowing|bows|bowed|submitting|presenting|posing|poses|bent over|leaning|leans|settling|settled`;
const POSE_LEAD = String.raw`(?:${PERSON_LEAD}(?:(?:is|are|am|was|were|now|just|still|then|all)\s+)*(?:(?:${POSES})\s+)?|\b(?:and|then|while)\s+(?:${POSES})\s+)(?:(?:held|cradled|carried|wrapped|tucked|swept up|scooped up|pulled|drawn|safe|tight|tightly|close|warm|up|back|down)\s+)?`;

const OTHERS = [
  // "with a man", "and her friend", "next to two girls", "joined by someone", "between us".
  String.raw`\b(?:with|and|plus|beside|besides|alongside|next to|joined by|on top of|under|underneath|beneath|between|against|inside|in the arms of|in bed with)\s+${PERSON}`,
  // On or under him only from a clause, a person or a pose: "lying beneath
  // him", not "a heavy blanket on top of him".
  String.raw`\b(?:with|in bed with)\s+him\b|${POSE_LEAD}(?:on top of|underneath|beneath|inside)\s+him\b`,
  // Anyone else, by any name, anywhere: "the pool boy", "her roommate", "a nurse".
  String.raw`\b(?:${PEOPLE_WORDS})\b`,
  String.raw`\b(?:another|other|second|third|extra|more)\s+(?:person|people|man|men|woman|women|guy|guys|girl|girls|boy|boys|character|characters|lady|ladies|(?:${CREATURES})(?![- ]?(?:${CREATURE_THINGS})\b))\b`,
  // A creature doing something to her, or in a place on her: "a demon behind
  // her", "the vampire on top of her", "an alien touching her", "a vampire
  // kissing her neck". Not one that's her ("a vampire biting her lip").
  // "a demon fucking her ass", "a vampire licking her pussy": no one does that
  // to themselves, but with a toy.
  String.raw`\b(?:a|an|the|another|some)\s+(?:[a-z]+\s+){0,2}?(?:${CREATURES})\s+(?:(?:is|was|slowly|gently|roughly|then|now|hovering|looming|standing|kneeling|lying|crouching|leaning|waiting|lurking)\s+)*(?:(?:${PARTNER_VERBS}|${TOUCH_VERBS}|bit(?:e|es|ing)|nibbl(?:e|es|ed|ing)|pin(?:s|ned|ning))\s+(?:${HER_OBJECT}|(?:him|you|me|us)\b)|(?:kiss|bit|nibbl|lick|suck)[a-z]*\s+(?:her|his)\s+(?:neck|throat|nape|ears?)\b|(?:fuck|screw|bang|pound|rail|penetrat|peg|lick|suck|eat|tongu|rim)[a-z]*(?:\s+out)?\s+(?:her|his)\s+(?!own\b)(?:(?:wet|tight|little|soaked|dripping|bare)\s+)*(?:pussy|cunt|clit|ass|asshole|butt|cock|dick|balls)\b${NOT_A_TOY}|(?:behind|beside|next to|on top of|over|under|underneath|beneath|between|inside|in bed with|atop|astride|straddling)\s+(?:${HER_OBJECT}|her\s+(?:legs|thighs)\b|(?:him|you|me|us)\b))`,
  // With one, or doing it to one: "with a vampire", "kissing an orc", "riding
  // the werewolf". Not one she is ("as a vampire") or a thing named after one
  // ("with angel wings", "and a demon tail", "an angel's face", "alien-themed").
  String.raw`\b(?:with|and|kissing|riding|fucking)\s+(?:a|an|the)\s+(?:[a-z]+\s+){0,2}?(?:${CREATURES})\b(?!'s|-)(?!\s+(?:${CREATURE_THINGS})\b)(?!\s+on top\b)(?!\s+(?:cock|dick)\s+(?:dildos?|toys?|vibrators?|plugs?)\b)`,
  // Bare pin and bend only with her or him as the object: "pinning her down",
  // "bending him over". Not "pinning you with her gaze" (she only looks), "pinning
  // her hair up" or "bending her back in a stretch".
  String.raw`\b(?:pin(?:s|ned|ning)?\s+(?:${HER_OBJECT}|him\b)(?!\s+with\s+(?:her|his|a|an)\s+(?:gaze|eyes|look|stare|glance)\b)|bend(?:s|ing)?\s+(?!her\s+back\b)(?:${HER_OBJECT}|him\b))`,
  // However many: "two naked women", "both of them", "a couple", "2girls".
  String.raw`\b(?:two|three|four|five|six|several|multiple|many|a few|a pair of|a couple of|a group of|a bunch of|both|[2-9])\s+(?:[a-z'-]+\s+){0,3}?(?:${COUNTED}|of them|of us)\b`,
  String.raw`\b(?:both|all|the two|the three|two|three|a pair|the pair|a couple|the couple) of (?:them|us)\b`,
  String.raw`\b(?:[2-9]|multiple)\s?(?:girls|boys|others)\b`,
  String.raw`\bcouples?\b(?!\s+of\b)|\b(?:a|the)\s+pair\b(?!\s+of\b)`,
  String.raw`\b(?:threesome|foursome|moresome|[2-5]-?some|orgy|orgies|group|groups|crowd|audience|onlookers|spectators|bystanders|passers-?by|paparazzi|harem|twins|lesbians?|gay couple|duo|trio|everyone|everybody|others)\b`,
  // "her ex", "his patient" ("a patient smile" is only patient).
  String.raw`\b(?:my|her|his|your|their|an|the)\s+ex\b`,
  String.raw`\b(?:my|her|his|your|their|a|the)\s+patient(?=\s*$|\s*[,.;:!?)]|\s+(?:in|on|at|with|who|is|was|lying|waiting|watching|undressing)\b)`,
  // Sex that takes two, and positions that imply a partner ("on all fours" is
  // the solo way to say it). A cowgirl outfit is just an outfit.
  String.raw`\b(?:${PARTNER_ACTS})\b`,
  String.raw`(?<!\ba )(?<!\bsexy )(?<!\bwestern )\bcowgirl\b(?!\s+(?:hats?|boots?|outfits?|costumes?|look|vibe|getup|shirt|skirt|belt|cosplay))`,
  String.raw`\b(?:cum|messy|sticky)\s+facials?\b`,
  String.raw`\b(?:getting|gets|got|giving|gives|takes|taking|receiving|receives)\s+(?:(?:a|her|him|you|me)\s+){0,2}(?:cum|messy|big|huge|sticky)\s+facials?\b`,
  // A facial is skincare at the spa or salon, wherever that's said.
  String.raw`\b(?:getting|gets|got|giving|gives|takes|taking|receiving|receives)(?<!\b(?:spa|salon|skincare|skin care)\b.*)\s+(?:(?:a|her|him|you|me)\s+){0,2}facials?\b(?!\s+(?:masks?|creams?|treatments?|serums?|steam(?:er)?|oils?|mists?|massages?|scrubs?|peels?|at))(?!.*\b(?:spa|salon|skincare|skin care)\b)`,
  // A partner verb on anyone but the character: "fucking him", "riding you",
  // "kissing her slowly", "sex with someone". And touch on a person or the viewer.
  String.raw`\b(?:${PARTNER_VERBS})\s+${PARTNER_OBJECT}${NOT_A_KISS}`,
  String.raw`\b${SEX_VERBS}\s+them\b`,
  String.raw`\b(?:${TOUCH_VERBS})\s+${TOUCH_OBJECT}`,
  String.raw`\b(?:jerk|jack|suck|eat|finish|blow|rub|wank)(?:s|ed|ing|en)?\s+(?:her|him|them|you|me|us|someone|somebody)\s+(?:off|out)\b`,
  String.raw`\bfill(?:s|ed|ing)?\s+(?:her|him|them|you|me|us)\s+(?:up|with)\b`,
  // Done to her by someone: "being touched", "getting fucked", "fucked by him".
  String.raw`\b(?:being|getting|gets|got|is being|are being)\s+(?:(?:roughly|slowly|gently|deeply|hard|passionately|thoroughly|tenderly)\s+)?(?:touched|fucked|railed|pounded|banged|screwed|licked|eaten out|eaten|fingered|kissed|spanked|choked|groped|fondled|stroked|penetrated|pegged|creampied|bred|taken|ridden|sucked|sucked off|blown|jerked off|tied up|held down|pinned down|pinned|grabbed|caressed|embraced|hugged|massaged|ravished|dominated|used|shared|gangbanged|spit-?roasted)\b${NOT_A_TOY}`,
  String.raw`\bbeing\s+(?:(?:slowly|gently|roughly)\s+)?(?:undressed|stripped)\b`,
  String.raw`\b(?:fucked|railed|pounded|banged|screwed|bred|creampied|gangbanged|spit-?roasted|eaten out|pegged|ravished)\s+by\b(?!\s+(?:(?:a|an|the|her|his|their|my|your)\s+)?(?:(?:big|pink|purple|black|glass|huge|thick|vibrating|realistic)\s+)*(?:toys?|dildos?|vibrators?|wands?|(?:fucking\s+|sex\s+)?machines?|sybian|plug))`,
  String.raw`\b(?:sucked|licked|fingered|spanked|choked|groped|fondled|stroked|penetrated|undressed|stripped|grabbed|pinned|pinned down|held|held down|tied up|tied|cuffed|blindfolded|dominated|used|shared|taken|touched|kissed|caressed|embraced|hugged|massaged|watched|seduced|claimed|teased|pleasured|worshipp?ed|surrounded|carried|lifted)\s+by\s+(?:(?:him|her|them)\b|${PERSON})`,
  // Someone doing it: "someone touching her", "a man behind her", "I kiss her neck".
  String.raw`\b(?:someone|somebody|anyone|anybody|someone else|a stranger|the stranger|strangers|another (?:man|guy|woman|girl|person))\s+(?:(?:is|was|slowly|gently|roughly|then|else)\s+)*(?:${PARTNER_VERBS}|${TOUCH_VERBS}|behind|beside|next to|watching|watches|joins|enters|walks in|comes in|on top)\b`,
  String.raw`\b(?:we|we're|we are)\s+(?:(?:slowly|gently|then|just|also|really|start|starting|begin|beginning|keep|keeping|want to|wanna|will)\s+)*(?:${PARTNER_VERBS}|${TOUCH_VERBS})`,
  String.raw`\b(?:i|i'm|im|i am|we|we're|we are)\s+(?:(?:am|is|are|slowly|gently|then|just|also|really|start|starting|begin|beginning|keep|keeping|want to|wanna|will|to)\s+)*(?:${PARTNER_VERBS}|${TOUCH_VERBS})\s+(?:her|him|them|you|your|his|their)\b${NOT_A_KISS}`,
  // The viewer and her together: "you and me", "the two of us", "me and her".
  String.raw`\b(?:you and (?:me|i|her|him|them)|me and (?:you|her|him|them)|(?:her|him|them) and (?:you|me|i)|i and (?:her|him)|me with (?:her|him|them)|the two of (?:us|you)|both of (?:us|you)|us two|us both|you two|you both|us together)\b`,
  String.raw`\b(?:photos?|pics?|pictures?|selfies?|snaps?|shots?|videos?|clips?|images?|portraits?|polaroids?)\s+of\s+us\b`,
  String.raw`\b(?:we|we're|we are|us)\s+(?:(?:both|two|all|together|just|still|now|finally|lying|laying|sitting|cuddled up|snuggled up)\s+)*(?:in bed|in the (?:bed|shower|bath|tub|hot tub|pool|jacuzzi|sauna)|under the (?:covers|sheets|blanket)|between the sheets|naked|nude|kissing|making out|cuddling|snuggling|spooning|touching|having sex|fucking|together|on top|tangled|intertwined|entwined|holding hands|dancing|showering|bathing|sleeping|in each other's arms)\b`,
  // The viewer, or a third person, in a position with someone: "you behind
  // her", "me between her legs", "I'm on top", "you on his lap".
  String.raw`${NOT_THE_SUBJECT}\b(?:you|you're|you are|me|i|i'm|im|i am|we|we're|we are|us)\s+${SUBJECT_FILLERS}(?:(?:on top of|behind|under|underneath|beneath|between|in between|inside|in bed with|astride|straddling|atop|spooning)\s+(?:(?:her|his|their|my|your)\s+${BODY_ADJECTIVE}(?:${CONTACT_BODY})\b|(?:her|him|them)\b|${PERSON})|on top\b(?!\s+of\b)|(?:on|onto|in|into)\s+(?:her|his|their|my|your)\s+(?:lap|arms|embrace)\b)`,
  // Someone's body on another's: "her legs wrapped around you", "her tongue
  // in your mouth", "his cock in your mouth", "your hands on her hips", "my
  // head in her lap". Owner and target differ, so it's two people whoever
  // "you" is.
  String.raw`\b(?:her|his|their)\s+${BODY_ADJECTIVE}(?:${CONTACT_BODY})\s+${ONTO}\s+(?:(?:you|yourself|yours|me|us|mine|ours)\b|(?:your|my|our)\s+${BODY_ADJECTIVE}(?:${CONTACT_BODY})\b)`,
  String.raw`\b(?:your|my|our)\s+${BODY_ADJECTIVE}(?:${CONTACT_BODY})\s+${ONTO}\s+(?:(?:me|us|mine|ours|him|them)\b|${HER_OBJECT}|(?:my|our|her|his|their)\s+${BODY_ADJECTIVE}(?:${CONTACT_BODY})\b)`,
  // Hands, mouths and bodies nobody owns: "a tongue between her thighs",
  // "strong arms around her", "hands all over her".
  String.raw`(?<!\b(?:her|his|their|your|my|our|its|own)\s+(?:[a-z]+\s+){0,2})\b(?:(?:a|an|some|another)\s+(?:(?:${PARTNER_ADJECTIVE})\s+){0,2}(?:tongues?|lips|mouths?|face|arms|chest|beard|cock|dick|penis|body|torso|hands|fingers)|(?:${PARTNER_ADJECTIVE})\s+(?:(?:${PARTNER_ADJECTIVE})\s+){0,2}(?:hands?|fingers?|arms?|tongues?|lips|mouths?|face|chest|beard|body|torso|cock|dick|thighs?))\s+${ONTO}\s+(?:her|him|you|your|me|my|us|them)\b`,
  String.raw`\bhands\s+all\s+over\s+(?:him|you|me|us|them|${HER_OBJECT})`,
  // Someone else's cum or load on or in her: "cum dripping down her thighs",
  // "a load on her face". Her own ("her own cum") stays hers.
  String.raw`(?<!\b(?:her|his|their|own)\s+(?:own\s+)?)\b(?:cum|semen|jizz|spunk|seed|loads)\s+(?:(?:is|still|slowly|already)\s+)*(?:dripping|drips|dripped|running|runs|ran|leaking|leaks|leaked|oozing|oozes|spilling|spills|trickling|trickles|flowing|flows|pouring|pours|seeping|seeps|sliding|slides)\s+(?:down|from|out of|out|off|over|between|on|across)\s+(?:her|you|your|me|my|them)\b${NOT_A_HAND}`,
  String.raw`\b(?:a|his|their|the|another|some|someone's|hot|warm|thick|big|huge|fresh|sticky|two|three|several|multiple|many)\s+(?:(?:hot|warm|thick|big|huge|fresh|sticky|massive|creamy)\s+)?loads?\s+(?:(?:is|still|slowly|dripping|running|leaking|shot|spilling|splattered|splashed|dumped|blown|pumped)\s+)*(?:on|in|over|onto|into|inside|across|all over|down|deep in|deep inside)\s+(?:her|you|your|me|my|them)\b`,
  // Three, by any shorthand: "MMF", "a throuple", "double-teamed".
  String.raw`\b(?:throuples?|m[eé]nage(?:\s+[aà]\s+trois)?|double[- ]?team(?:s|ed|ing)?|tag[- ]?team(?:s|ed|ing)?)\b|\b(?=[mf]{3,5}\b)(?=[mf]*m)(?=[mf]*f)[mf]{3,5}\b`,
  // A master, mistress, dom or sub is someone else ("her master", "with a
  // dom"); as one ("playing a sub", "she's a dom"), she plays the part.
  String.raw`(?:\b(?:her|his|my|your|their|our|the|another|other|some|with|and|for|by)\s+|(?<!\b(?:as|play|plays|playing|be|being|is|she's|he's|you're|i'm)\s)\b(?:a|an)\s+)(?:(?:strict|cruel|stern|new|dominant|loving|sadistic|kinky|obedient|good|willing|personal|own|hot|sexy|handsome|masked|female|male)\s+){0,2}(?:master|mistress|dom|domme|sub|subby|slave|owner)s?\b(?!-|'s\s+degree|\s+p[eé]rignon|\s+(?:bed(?:room)?s?|bath(?:room)?s?|suites?|class(?:es)?|chef|keys?|piece|plan|list|copy|tapes?|degree)\b)`,
  // Another babe, a figure or a silhouette: someone else. "Babe" alone is
  // what the user calls her; "her silhouette", "an hourglass figure" and "a
  // lone figure" are hers, and palm silhouettes and action figures are things.
  String.raw`\b(?:another|other|second|some|several|a few|more|with a|and a|plus a|next to a|beside a)\s+(?:(?:hot|sexy|blonde|brunette|cute|busty)\s+)?babes?\b`,
  // A silhouette of her, or a silhouette shot, is her: "the silhouette of her
  // body against the window", "a silhouette shot against the sunset".
  String.raw`\b(?:a|an|the|another|shadowy|shadowed|dark|darkened|mysterious|hooded|cloaked|masked|unknown|faceless|ghostly|looming|lurking|tall|male|female|human|second)\s+(?:figure|silhouette)\b(?![- ](?:hugging|skimming|flattering|fitting|eight|8|skat\w*|shots?|photos?|photography|portraits?|poses?|style|lighting|effect|outlines?|looks?|images?|pictures?|framing|art)\b)${NOT_SCENERY_OF}(?!\s+of\s+(?:her|his|their|your|its)\b)|${NOT_SCENERY_BEFORE}\b(?:figures|silhouettes)\b${NOT_SCENERY_OF}`,
  // "A lone figure" is her, unless it watches her or is on her: "a lone figure
  // watching her", "a lone figure behind her".
  String.raw`\b(?:a|the)\s+(?:lone|single|solitary|solo)\s+(?:figure|silhouette)\s+(?:(?:is|was|quietly|silently|slowly|standing|stands|waiting|lurking|leaning)\s+)*(?:watching|watches|staring at|stares at|eyeing|following|follows|approaching|approaches|behind|beside|next to|over|on top of|under|underneath|beneath|between|inside|in bed with|atop|astride|straddling|${PARTNER_VERBS}|${TOUCH_VERBS})\s+(?:${HER_OBJECT}|her\s+(?:legs|thighs)\b|(?:him|you|me|us|them)\b)`,
  // Plural catgirls, foxgirls, cowboys: more than one, so someone else.
  String.raw`\b(?!(?:tall|high|low)boys\b)[a-z]+(?:girls|boys)\b${NOT_PLURAL_PEOPLE}`,
  // Someone else's body: "a man's hand", "someone's lips", "on my lap",
  // "male hands", "a cock" (a man's own is "his").
  String.raw`\b${OWNER}\s+${BODY_ADJECTIVE}(?:${BODY}|head|throat|foot|feet|toes|lip|cheeks?|shoulders?|nails)\b`,
  String.raw`\b(?:male|masculine|unseen|strange|extra|more|many|multiple|several|unknown|anonymous|groping|men's|women's)\s+(?:hands?|fingers|arms|tongues?|mouths?|lips|cocks?|dicks?|bodies)\b`,
  String.raw`\b(?:cocks|dicks|penises)\b${NOT_A_COCK_THING}`,
  String.raw`\b(?:a|an|another|some|two|three|several|many|multiple)\s+(?:(?:big|huge|hard|thick|throbbing|massive|long|fat|stiff|veiny|real)\s+){0,2}(?:cock|dick|penis)\b${NOT_A_COCK_THING}`,
  String.raw`\bsuck(?:s|ed|ing)?\s+(?:on\s+)?(?:(?:a|an|the|his|my|your|that|this|someone's|somebody's|big|huge|hard|thick)\s+)*(?:cock|dick|penis|balls)\b`,
  String.raw`\b(?:rid(?:e|es|ing)|rode|(?:sit(?:s|ting)?|sat|squat(?:s|ting)?|grind(?:s|ing)?)\s+on)\s+(?:on\s+)?(?:(?:a|an|the|his|her|my|your|their|someone's|somebody's|big|huge|hard|thick)\s+)*(?:cock|dick|penis|face|lap|strap[- ]?on)\b`,
  // A cock nobody owns in, on or entering someone: "cock deep inside her", "a
  // dick down her throat", "a strap-on in her", "dick on her face", "cock
  // entering her". Not in a hand ("cock in your fist" is the man's own).
  String.raw`${NO_OWNER}\b(?:(?:cock|dick|penis|shaft)s?\s+${IN_SOMEONE}|strap[- ]?ons?\s+${IN_SOMEONE})`,
  String.raw`${NO_OWNER}\b(?:cock|dick|penis)s?${NOT_A_COCK_THING}\s+(?:(?:resting|pressed|pressing|slapping|rubbing|sliding|lying|laid|throbbing|twitching|hard)\s+)*(?:on|against|across|over|between)\s+her\s+(?:face|lips|tongue|tits|breasts|boobs|cheeks?|mouth|chin|nose)\b`,
  String.raw`${NO_OWNER}\b(?:cock|dick|penis|shaft|strap[- ]?on)s?\s+(?:(?:slowly|deeply|finally|roughly|hard)\s+)?(?:enter(?:s|ed|ing)?|fill(?:s|ed|ing)|stretch(?:es|ed|ing)|split(?:s|ting)|pound(?:s|ed|ing)|pump(?:s|ed|ing)|(?:slid(?:e|es|ing)|slipp?(?:s|ed|ing)?|push(?:es|ed|ing)?|thrust(?:s|ed|ing)?)\s+into)\s+(?:her|you|me|us|them)\b`,
  // Cum from someone else on or in her, or on the viewer. Not on a hand or a
  // toy, and not her own ("her own cum on her thighs").
  String.raw`\b(?:${CUM})\s+(?:on|in|inside|over|all over|across|onto|into|down)\s+(?:him|them|me|you|us|my|your|our)\b${NOT_A_HAND}`,
  String.raw`(?<!\b(?:her|own)\s+(?:own\s+)?)\b(?:${CUM})\s+(?:on|in|inside|over|all over|across|onto|into|down)\s+(?:${HER_OBJECT}|her\s+(?:own\s+)?(?:face|mouth|tongue|lips|tits|breasts|boobs|chest|belly|stomach|tummy|abs|back|ass|butt|pussy|hair|thighs|legs|body|skin|neck|throat|cheeks|chin|nose|eyes|feet|toes|glasses)\b)`,
  String.raw`\b(?:${CUM})\s+(?:deep\s+)?inside\s+(?:of\s+)?her\b`,
  String.raw`\b(?:you|him|someone|somebody)\s+(?:deep\s+)?inside\s+(?:of\s+)?(?:her|me)\b`,
  String.raw`\b(?:covered|dripping|drenched|glazed|soaked|plastered|coated|splattered)\s+(?:in|with)\s+(?:cum|semen|jizz|spunk|loads\b(?!\s+of\b))`,
  String.raw`\b(?:full of|filled with|filled up with|stuffed with|stuffed full of|overflowing with)\s+(?:(?:hot|warm|thick|fresh|sticky|creamy)\s+)*(?:cum|semen|jizz|spunk|cocks?|dicks?)\b`,
  String.raw`(?<!\bown\s+)\bcum[- ]?(?:filled|covered|soaked|drenched|glazed|splattered|stained)\b`,
  // POV sex is the viewer having it.
  String.raw`\b(?:pov|point[- ]of[- ]view|first[- ]person)\s*:?\s*(?:sex|fuck(?:ing)?|blow\s?-?job|bj|hand\s?-?job|riding|rides?|doggy|missionary|cowgirl|penetration|creampie|lap\s?-?dance|tit\s?-?job|titty\s?-?fuck(?:ing)?)\b`,
  String.raw`\b(?:sex|fucking|blow\s?-?job|bj|hand\s?-?job|riding|doggy|missionary|cowgirl|penetration)\s+(?:in\s+|from\s+)?(?:pov|point[- ]of[- ]view|first[- ]person)\b`,
].map((source) => new RegExp(source, "i"));

// He and she, as someone in the scene: "he", "him", "his hands" (a man's
// shirt is just a shirt), and "she", "her".
const HE = new RegExp(String.raw`\b(?:he|him|himself|he's|he'll|he'd)\b|\bhis\s+${BODY_ADJECTIVE}(?:${BODY})\b`, "i");
const SHE = /\b(?:she|her|hers|herself|she's|she'll|she'd)\b/i;
const HE_ANY = /\b(?:he|him|himself|he's|he'll|he'd|his)\b/i;

// Clothes of his she wears, or of hers he wears: "wearing his hoodie", "in her
// dress", "his jersey and nothing else". Not while their owner is still in
// them: "unbuttoning his shirt", "hands under her skirt", "pulling his boxers
// down", "taking her panties off slowly", or with their feet in them on
// someone ("her heels on his shoulders"), unless they're said to be worn
// ("wearing", "in", "nothing but").
const STILL_WORN = String.raw`(?<!\b(?:under|underneath|beneath|inside|down|off|through|unbutton(?:s|ed|ing)?|unzip(?:s|ped|ping)?|undo(?:es|ing)?|undid|unhook(?:s|ed|ing)?|unclasp(?:s|ed|ing)?|unbuckl(?:e|es|ed|ing)|loosen(?:s|ed|ing)?|rip(?:s|ped|ping)?|tear(?:s|ing)?|tore|remov(?:e|es|ed|ing)|tug(?:s|ged|ging)?(?:\s+at)?|grab(?:s|bed|bing)?|grip(?:s|ped|ping)?|clutch(?:es|ed|ing)?\s+at|open(?:s|ed|ing)?|pull(?:s|ed|ing)?\s+(?:off|down|open|aside|up|at)|tak(?:e|es|ing)\s+off|took\s+off|strip(?:s|ped|ping)?\s+off|peel(?:s|ed|ing)?\s+off|lift(?:s|ed|ing)?|hik(?:e|es|ed|ing)\s+up|bulg(?:e|es|ing)\s+in)\s+|\b(?:hands?|fingers?|palms?|mouth|lips|tongue)\s+(?:[a-z]+\s+){0,2}?(?:in|into|inside|under|down|beneath|up|on|against|over)\s+)`;
const WEARING = String.raw`wearing|wears|wore|worn|in|into|slipping into|slips into|slipped into|slip into|borrowed|borrowing|borrows|stealing|steals|stole|stolen|nothing but|only|just|dressed in|clad in|draped in|wrapped in|lounging in|sleeping in|throws on|throwing on|threw on|puts on|putting on|put on|pulls on|pulling on|pulled on|tries on|trying on|tried on|sporting|rocking`;
// Coming off, or opened, up to two words on: "his shirt off", "her panties
// down slowly", "her panties pushed aside", "her skirt pulled up", "her bra
// unhooked", "his pants are down". Not down, up or off to somewhere ("his
// boxers down to his knees" and "his shirt riding up her thighs" leave the
// pronoun after to be read), not off a shoulder, and not already off and
// lying somewhere ("her heels kicked off by the bed").
const COMING_OFF_TO = String.raw`(?!\s+(?:to|over|around|across|past|on|onto|in|into|her|his|your|their|my)\b)(?!\s+(?:(?:the|one|a|her|his|both)\s+)?shoulders?\b)`;
const COMING_OFF_SOURCE = String.raw`\s+(?:(?!(?:kicked|tossed|thrown|flung|dropped|discarded|left|lying|lies|hung|hanging|draped|folded|piled|crumpled|strewn|scattered|cast|slung)\b)[a-z]+\s+){0,2}?(?:(?:off|down|aside|open)\b${COMING_OFF_TO}|(?:pulled|pushed|hiked|hitched|bunched|rucked|riding|ridden|rides|lifted|yanked|tugged|shoved|flipped)\s+up\b${COMING_OFF_TO}|(?:unhooked|unbuttoned|unzipped|undone|unfastened|unclasped|torn|ripped|shredded)\b${COMING_OFF_TO})`;
const COMING_OFF = new RegExp(`^${COMING_OFF_SOURCE}`);
// Shoes and stockings have feet in them, so on someone they bring their owner:
// "her heels on his shoulders", "his boots against her back". Not on feet.
const FOOTWEAR = /^(?:heels|boots|shoes|socks|stockings|sneakers|slippers|tights|leggings)$/;
const FEET_ON = new RegExp(
  String.raw`^\s+(?:(?:up|high|digging|dug|propped|planted|perched|resting|pressed|pressing|hooked|locked|crossed|still|firmly)\s+)*(?:on|onto|over|against|into|around|across|behind)\s+(?:(?:her|his|their|your|my|our)\s+${BODY_ADJECTIVE}(?:shoulders?|back|chest|face|neck|throat|lap|thighs?|hips|waist|ass|belly|stomach|head|mouth|lips|cheeks?|crotch|cock|dick|balls|body|tits|breasts|abs)\b|(?:him|you|me|us|them)\b|${HER_OBJECT})`,
);
const clothesOf = (owner: "his" | "her", garments: string) =>
  new RegExp(
    String.raw`(?:\b(${WEARING})\s+(?:(?:a|an|the|one of|just|only|nothing but)\s+)*)?${STILL_WORN}\b${owner}\s+(?:(?:${GARMENT_ADJECTIVE})\s+){0,3}(${garments})\b`,
    "gi",
  );
const HIS_CLOTHES = clothesOf("his", HIS_GARMENTS);
const HER_CLOTHES = clothesOf("her", HER_GARMENTS);

// The text without the clothes in it that the character wears, so their
// owner's pronoun isn't read as someone there.
function withoutWorn(text: string, clothes: RegExp) {
  return text.replace(clothes, (match: string, worn: string | undefined, garment: string, offset: number) => {
    if (worn) return ",";
    const rest = text.slice(offset + match.length);
    if (COMING_OFF.test(rest) || (FOOTWEAR.test(garment) && FEET_ON.test(rest))) return match;
    return ",";
  });
}

// "They" doing something to a woman or a man: "they kiss her neck", "they bend
// her over", "their hands on him", "them on top of her". A non-binary
// character's own they is theirs. Lifting, turning and making are things
// waves, light and shadows do too, to her hair, skin or face: "the waves, they
// lift her hair", "the shadows, they turn her skin gold".
const THEY_MOVES = String.raw`(?:(?:pin(?:s|ned|ning)?|tak(?:e|es|ing)|took|part(?:s|ed|ing)?|bend(?:s|ing)?|bent|flip(?:s|ped|ping)?|lay(?:s|ing)?|laid|carr(?:y|ies|ied|ying)|press(?:es|ed|ing)?|position(?:s|ed|ing)?|ti(?:e|es|ed)|tying|shov(?:e|es|ed|ing)|us(?:e|es|ed|ing))\s+(?:her|him|me|you|us)\b|(?:lift(?:s|ed|ing)?|roll(?:s|ed|ing)?|turn(?:s|ed|ing)?|mak(?:e|es|ing)|made|throw(?:s|ing|n)?|threw|grip(?:s|ped|ping)?|guid(?:e|es|ed|ing))\s+(?:her(?!\s+(?:hair|skin|face|gaze|eyes|body|curves|figure|silhouette|shadow|reflection|outline|complexion|dress|skirt|hem|gown|robe|scarf|veil|thighs|legs|toys?|dildo|vibrator|fingers|hands?)\b)|him|me|you|us)\b)(?!\s+(?:[a-z]+\s+)?(?:look|looks|seem|seems|appear|appears)\b)`;
const THEY = new RegExp(
  [
    String.raw`\b(?:they|they're|theyre|they've|they'll|they'd)\s+(?:(?:are|were|is|slowly|gently|roughly|then|both|all|just|also|start|starting|begin|beginning|keep|keeping|want to|will|to)\s+)*(?:${PARTNER_VERBS}|${TOUCH_VERBS}|watch(?:es|ed|ing)?|join(?:s|ed|ing)?|enter(?:s|ed|ing)?|walk(?:s|ed|ing)? in|come in|comes in|kneel(?:s|ing)?|knelt|behind|beside|next to|on top|between|inside|surround(?:s|ed|ing)?|shar(?:e|es|ing)|take turns|taking turns|teas(?:e|es|ing)|spread(?:s|ing)?|cup(?:s|ped|ping)?|squeez(?:e|es|ed|ing)|bit(?:e|es|ing)|nibbl(?:e|es|ed|ing)|run(?:s|ning)? their|trac(?:e|es|ing)|pull(?:s|ed|ing)?|push(?:es|ed|ing)?|slid(?:e|es|ing)|${THEY_MOVES})\b`,
    String.raw`\btheir\s+${BODY_ADJECTIVE}(?:${BODY})\b`,
    // Them as someone there, not as her shoes ("holding them behind her back").
    String.raw`(?:^|[,.;:!?(]\s*|\b(?:with|and|see|sees|seeing|watch|watches|watching)\s+)them\s+(?:(?:lying|laying|sitting|kneeling|standing|right|still|both|now|all)\s+)*(?:on top of|behind|under|underneath|beneath|between|inside|in bed with)\s+(?:her|him)\b`,
  ].join("|"),
  "i",
);

// Places on a he or she the character can't be alone: "on his lap", "held in
// his arms", "kneeling between her legs", "in his hands". Their own knees,
// hands, chest and face are theirs ("on his knees", "hands on his thighs").
const placesOn = (pronoun: "his" | "her") => [
  String.raw`${POSE_LEAD}(?:(?:on|onto|across|over|astride)\s+${pronoun}\s+(?!own\b)${BODY_ADJECTIVE}(?:lap|cock|dick|penis|shaft)|(?:in|into)\s+${pronoun}\s+(?!own\b)${BODY_ADJECTIVE}(?:arms|embrace|lap)|between\s+${pronoun}\s+(?!own\b)${BODY_ADJECTIVE}(?:legs|thighs|knees))\b`,
  String.raw`${PERSON_LEAD}(?:in|into)\s+${pronoun}\s+(?!own\b)${BODY_ADJECTIVE}(?:hands?|grip)\b`,
];

// Without a gender, a he is someone else in those places, with his cock in
// someone, or with the character before, beneath or astride him.
const HIS_PLACE = new RegExp(
  [
    ...placesOn("his"),
    String.raw`\bhis\s+(?!own\b)${BODY_ADJECTIVE}(?:cock|dick|penis|shaft)\s+(?:(?:deep|deeper|all the way|balls deep|buried|sliding|slipping|pushing|thrusting|slowly|still)\s+)*(?:in|inside|into|between)\s+(?:of\s+)?(?:her|you|your|me|my|them|us|our|someone|somebody)\b${NOT_A_HAND}`,
    String.raw`${POSE_LEAD}(?:astride|atop|on top of)\s+him\b`,
    String.raw`${POSE_LEAD}(?:before|beneath|under|underneath)\s+him\b`,
  ].join("|"),
  "i",
);
const HER_PLACE = new RegExp(
  [...placesOn("her"), String.raw`${POSE_LEAD}(?:before|beneath|under|underneath|behind|astride|atop|on top of)\s+${HER_OBJECT}`].join("|"),
  "i",
);

// The other gender's pronouns are someone else, but for their clothes. Without
// a gender, a he counts next to a she ("his hands behind his head" may be a
// man alone) or as a place to be.
function otherPronoun(text: string, person: StudioPerson | null) {
  if (person === "woman") return HE_ANY.exec(withoutWorn(text, HIS_CLOTHES))?.[0] ?? THEY.exec(text)?.[0] ?? null;
  if (person === "man") return SHE.exec(withoutWorn(text, HER_CLOTHES))?.[0] ?? THEY.exec(text)?.[0] ?? null;
  const place = HIS_PLACE.exec(text);
  if (place) return place[0];
  const he = HE.exec(text);
  const she = he ? SHE.exec(text) : null;
  return he && she ? `${he[0]} … ${she[0]}` : null;
}

// The text as typed (lowercased, quotes and dashes made plain, "&" read as
// "and") and as the safety screen reads it ("b0yfr1end", "m3n", and spelled
// out: "m a n", "b-o-y-f-r-i-e-n-d"), so no spelling slips past. Spelled out is
// read from the screen's reading, where accents are already gone ("pérignon"
// would lose its é otherwise).
function readings(details: string) {
  const plain = details
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/[‐-―]/g, "-")
    .replace(/&/g, " and ")
    .replace(/\s+/g, " ")
    .trim();
  const unleet = normalize(plain).replace(/[‐-―]/g, "-").replace(/\s+/g, " ").trim();
  return [...new Set([plain, unleet, joinSpelled(unleet), joinPunctuated(unleet)])];
}

// A chat photo's hint that asks the character for themself ("a pic of you",
// "send me you in lingerie", "your tits", "you lying on the bed") makes them
// "you", so a he or she they're in a place on is someone else: "you on his
// lap", "you between her thighs", "kneeling before him". Not a bare "her
// hands" or "his cock", which is as often the character said the other way,
// and not a "you" she looks at, thinks of or poses for ("smiling at you",
// "thinking of you", "in front of you"), which is the viewer.
const ADDRESSED = new RegExp(
  String.raw`\b(?:yourself|your\s+${BODY_ADJECTIVE}(?:${CONTACT_BODY}|clit|outfit|lingerie|panties|bra|dress|shirt|clothes)\b|(?:pics?|photos?|pictures?|selfies?|snaps?|shots?|videos?|clips?|images?|nudes?|polaroids?)\s+of\s+you\b|(?:send|show)\s+me\s+(?:[a-z]+\s+){0,3}?you\b|(?<!\b(?:at|to|for|toward|towards|of|about|with|than|like)\s+)you(?:'re| are)?\s+(?:(?:just|all|completely|totally)\s+)?(?:in|on|wearing|lying|laying|sitting|kneeling|standing|naked|nude|topless|bottomless|bent|spread|spreading|touching|stroking|playing|riding|sucking|licking|holding|showing|posing|getting|taking|with|under|between|bending|squatting|straddling)\b)`,
  "i",
);
// "You" in a place on a he or she: "you on his lap", "you lying across her
// thighs", "you in her arms". Not lying on their own back or knees, which is
// the character said both ways.
const youOn = (pronoun: "his" | "her") =>
  String.raw`\byou(?:'re| are)?\s+${SUBJECT_FILLERS}(?:[a-z]+\s+)?(?!on\s+${pronoun}\s+(?:back|knees|stomach|belly|tummy|side|front|feet|toes|elbows|hands)\b)(?:on top of|in between|on|onto|in|into|across|over|astride|atop|between|under|underneath|beneath|behind|against|around|inside|straddling)\s+${pronoun}\s+(?!own\b)${BODY_ADJECTIVE}(?:${CONTACT_BODY})\b`;
const HIS_ON_YOU = `${youOn("his")}|${HIS_PLACE.source}`;
const HER_ON_YOU = `${youOn("her")}|${HER_PLACE.source}`;
const ADDRESSED_OTHER: Record<StudioPerson | "none", RegExp> = {
  man: new RegExp(HIS_ON_YOU, "i"),
  woman: new RegExp(HER_ON_YOU, "i"),
  person: new RegExp(`${HIS_ON_YOU}|${HER_ON_YOU}`, "i"),
  none: new RegExp(`${HIS_ON_YOU}|${HER_ON_YOU}`, "i"),
};

// Where "you" is the viewer, their body in the scene ("your hands on her hips",
// "on your lap", "your head in her lap"), them in a place in it ("you in bed",
// "you under the covers") or them moved or undressed ("pulling you closer",
// "unbuttoning your shirt") is them joining it. Their eyes and gaze are only
// where she looks. In a chat photo's hint "your" and "you" are the character's
// own, so bringsOthers leaves them alone.
const VIEWER_BODY = new RegExp(String.raw`\byour\s+${BODY_ADJECTIVE}(?:${BODY}|${POSITION_BODY}|head|throat|lip)\b`, "i");
const VIEWER_PLACE = new RegExp(
  String.raw`(?<!\b(?:for|at|to|toward|towards|on|over|show|shows|showing|give|gives|giving|let|lets|letting|tell|tells|telling|watch|watches|watching|tease|teases|teasing|want|wants|wanting|need|needs|needing|invite|invites|inviting|beckon|beckons|beckoning|call|calls|calling)\s+)\b(?:you|you're|you are)\s+(?:(?:lying|laying|sitting|kneeling|standing|naked|nude|both|right|already|still)\s+)*(?:on top|behind|under|underneath|beneath|between|inside|in bed|in the (?:bed|shower|bath|tub|pool|hot tub|jacuzzi)|on the (?:bed|couch|sofa|floor)|under the (?:covers|sheets|blanket))\b`,
  "i",
);
// The viewer's clothes she pulls on or moves on herself are only clothes:
// "pulling on your hoodie", "pulling your hoodie over her knees", "tugging your
// shirt down to cover herself", "tugging at your tie". Pulled off, down or open
// ("pulling your boxers down", "pulling off your shirt") they're still on the
// viewer, and unbuttoned, unzipped or stripped at all they're the viewer
// undressed: "unbuttoning your shirt", even "while you watch" (she's in it when
// the scene says so: "in your shirt, unbuttoning it"). Belts, jeans and flies
// are only undone on the viewer ("tugging at your belt").
const VIEWER_GARMENTS = String.raw`shirts?|t-?shirts?|tees?|button-?downs?|button-?ups?|sweaters?|jumpers?|hoodies?|sweatshirts?|cardigans?|flannels?|jerseys?|jackets?|blazers?|coats?|robes?|bathrobes?|pajamas|pyjamas|ties?|scarf|scarves|hats?|caps?|beanies?|boxers|briefs|socks|sweatpants|joggers|uniforms?|dog tags|chains?|watch|glasses|sunglasses|clothes`;
const NOT_ATTENTION = String.raw`(?!\s+(?:gaze|attention|eyes|focus|heart|heartstrings|mind|thoughts|buttons)\b)`;
const VIEWER_MOVED = new RegExp(
  [
    String.raw`\b(?:unbutton(?:s|ed|ing)?|unzip(?:s|ped|ping)?|undress(?:es|ed|ing)?|strip(?:s|ped|ping)?)\s+(?:(?:off|down|open)\s+)?(?:you\b|your\b${NOT_ATTENTION})`,
    String.raw`\b(?:pull(?:s|ed|ing)?|push(?:es|ed|ing)?|tug(?:s|ged|ging)?|drag(?:s|ged|ging)?)\s+(?:(?:off|down|open)\s+(?:you\b|your\b${NOT_ATTENTION})|(?:(?:at|on)\s+)?(?:you\b|your\b${NOT_ATTENTION}(?!\s+(?:(?:${GARMENT_ADJECTIVE})\s+){0,3}(?:${VIEWER_GARMENTS})\b(?!${COMING_OFF_SOURCE}))))`,
  ].join("|"),
  "i",
);

// "You" doing it to someone. In a chat photo's hint "you" is the character, so
// their own body after the verb stays theirs: "you hugging her knees" and "you
// touching her breasts" for a woman, "you stroking his cock" for a man, "you
// touching your thighs" for anyone, while "you kissing her" is someone else.
// Where "you" is the viewer, any she or he after it is: "you touching her
// breasts" is the viewer touching the character. Nobody kisses their own neck,
// though: "you kissing her neck" is someone else's.
const YOU = String.raw`\b(?:you|you're|you are)\s+(?:(?:slowly|gently|then|just|also|really|start|starting|begin|beginning|keep|keeping|want to|wanna|will|to)\s+)*`;
const youDo = (target: string, own?: "her" | "his") =>
  new RegExp(
    [
      String.raw`${YOU}(?:${PARTNER_VERBS}|${TOUCH_VERBS})\s+(?:${target})\b${NOT_A_KISS}`,
      ...(own ? [String.raw`${YOU}(?:(?:kiss|bit|nibbl|lick|suck)[a-z]*\s+${own}\s+(?:neck|throat|nape|ears?|back)|(?:lick|suck|eat|tongu|rim)[a-z]*(?:\s+out)?\s+${own}\s+(?:pussy|cunt|clit|asshole|cock|dick|balls)|kiss[a-z]*\s+${own}\s+lips)\b`] : []),
    ].join("|"),
    "i",
  );
const HIS_NOT_WORN = String.raw`his(?!\s+(?:(?:${GARMENT_ADJECTIVE})\s+){0,3}(?:${HIS_GARMENTS})\b)`;
const YOU_DO: Record<StudioPerson | "none" | "viewer", RegExp> = {
  woman: youDo(`${HER_OBJECT}|him|me|us|my|our|their|${HIS_NOT_WORN}`, "her"),
  man: youDo("her|him|me|us|my|our|their", "his"),
  person: youDo(`her|him|me|us|my|our|${HIS_NOT_WORN}`),
  none: youDo(`her|him|me|us|my|our|their|${HIS_NOT_WORN}`),
  viewer: youDo(`her|him|me|us|my|our|their|${HIS_NOT_WORN}`),
};

// A man's own cum on his own body, said to him in a chat photo's hint: "cum on
// your abs", "cum dripping down your shaft".
const HIS_OWN_CUM = new RegExp(
  String.raw`\b(?:${CUM})\s+(?:(?:is|still|slowly|already|dripping|drips|running|runs|leaking|leaks|spilling|spills|pooling|pooled|pools|splashed|splattered|shot|landing|landed|sliding|slides|trickling|trickles)\s+)*(?:on|over|all over|across|onto|down|along)\s+your\s+${BODY_ADJECTIVE}(?:abs|belly|stomach|tummy|chest|torso|thighs?|cock|dick|shaft|balls)\b`,
  "gi",
);

// The character named the way scenes often do: "a confident woman in black lace
// lingerie posing on the bed", "a photo of a handsome man in boxer briefs",
// "soft light, a stunning girl in a red bikini". It's them when it's in their
// own gender, at the start of the text or of a clause before anyone's been
// described, and not doing something to someone ("a woman kissing her"). Only
// the first, so a second is someone else: "a woman and a man", "a woman on the
// bed, a man behind her". "Two women" was never one.
const SELF_NOUNS: Record<StudioPerson, string> = { woman: "woman|girl|lady", man: "man|guy", person: "person" };
const SELF_ADJECTIVE = String.raw`confident|stunning|beautiful|gorgeous|pretty|lovely|handsome|attractive|sexy|hot|seductive|sultry|alluring|elegant|glamorous|graceful|playful|flirty|smiling|shy|naked|nude|topless|shirtless|tall|petite|curvy|curvaceous|slim|slender|athletic|muscular|fit|toned|busty|voluptuous|thick|chubby|plump|mature|blonde?|brunette|redheaded|ginger|dark|fair|pale|tanned|bronzed|freckled|tattooed|pierced|bearded|rugged|asian|black|white|latina|latino|ebony|[a-z]+-(?:haired|skinned|eyed|looking)`;
const SELF_FRAME = String.raw`(?:(?:a|an|the)\s+)?(?:[a-z-]+\s+){0,2}?(?:photo|photograph|pic|picture|portrait|shot|image|selfie|close-?up|snapshot|render|painting|drawing|illustration)\s+of\s+`;
const SELF_LEAD = String.raw`\s+(?:(?:is|was|slowly|gently|then|now|standing|kneeling|lying|crouching|leaning|waiting|lurking|sitting|squatting)\s+)*`;
const SELF_ACTS = String.raw`(?!${SELF_LEAD}(?:(?:${PARTNER_VERBS}|${TOUCH_VERBS}|watching|watches|staring at|stares at|eyeing)\s+(?:${HER_OBJECT}|her\s+(?:legs|thighs)\b|(?:him|you|your|me|my|us|our|them|their)\b|${PERSON})|(?:behind|before|in front of|beside|next to|on top of|over|under|underneath|beneath|between|inside|in bed with|atop|astride|straddling)\s+(?:her|his|him|you|your|me|my|us|our|them|their)\b|(?:kiss|bit|nibbl|lick|suck|eat|tongu|rim)[a-z]*(?:\s+out)?\s+(?:her|his)\s+(?:neck|throat|nape|ears?|back|pussy|cunt|clit|asshole|cock|dick|balls)\b))`;
const selfReference = (nouns: string) =>
  new RegExp(String.raw`(^|[,.;:!?(]\s*)(${SELF_FRAME})?(?:a|an|the)\s+(?:(?:${SELF_ADJECTIVE}),?\s+){0,3}(?:${nouns})\b(?!'s|-)${SELF_ACTS}`, "i");
const SELF: Record<StudioPerson, RegExp> = {
  woman: selfReference(SELF_NOUNS.woman),
  man: selfReference(SELF_NOUNS.man),
  person: selfReference(SELF_NOUNS.person),
};
// Someone described already: a pronoun, a pose or an act ("lying on the bed, a
// man watching", "smiling at the camera, a woman watching"). Not the room, the
// light or the weather ("an evening sky, candles flickering, rain falling").
const DESCRIBED = new RegExp(
  String.raw`\b(?:she|her|hers|herself|he|him|his|himself|they|them|their|you|your|i|me|my|we|us|our|lies|sits|sat|seated|perched|stands|stood|kneels|knelt|poses|leans|naked|nude|sprawled|curled|nestled|asleep|bent)\b|\b(?!(?:light|even|morn|ceil|build|cloth|r|str|wedd|bedd|sett|paint|draw|fram|noth|someth|everyth|anyth|k|spr|w|th|sw|rail|land|carpet|floor|cush|awn|stream|flicker|glow|sparkl|shimmer|twinkl|pour|blow|sway|crash|ris|fall|cast|filter|spill|fad|dimm|burn|dappl|drizzl|snow|rain|shin|reflect)ing\b)[a-z]+ing\b`,
  "i",
);

function withoutSelf(text: string, person: StudioPerson | null) {
  if (!person) return text;
  const match = SELF[person].exec(text);
  if (!match || DESCRIBED.test(text.slice(0, match.index))) return text;
  return `${text.slice(0, match.index)}${match[1]}${match[2] ?? ""},${text.slice(match.index + match[0].length)}`;
}

// Who "you" is: the character in a chat photo's hint, the viewer everywhere else.
function screen(details: string, gender: string | null | undefined, you: "character" | "viewer") {
  const person = gender ? studioPerson(gender) : null;
  for (const reading of readings(details)) {
    let text = withoutSelf(reading.replace(NOT_PEOPLE, ","), person);
    if (person === "man" && you === "character") text = text.replace(HIS_OWN_CUM, ",");
    for (const pattern of OTHERS) {
      const match = pattern.exec(text);
      if (match) return match[0];
    }
    const did = YOU_DO[you === "viewer" ? "viewer" : (person ?? "none")].exec(text);
    if (did) return did[0];
    const pronoun = otherPronoun(text, person);
    if (pronoun) return pronoun;
    const other =
      you === "character"
        ? ADDRESSED.test(text) && ADDRESSED_OTHER[person ?? "none"].exec(text)
        : (VIEWER_BODY.exec(text) ?? VIEWER_PLACE.exec(text) ?? VIEWER_MOVED.exec(text));
    if (other) return other[0];
  }
  return null;
}

// The words that bring someone else into the scene, or null when it's just the
// character, read as a chat photo's hint reads ("you" is the character).
// `gender` is the character's, so their own pronouns aren't read as someone
// else's.
export function bringsOthers(details: string, gender?: string | null) {
  return screen(details, gender, "character");
}

// The same, read with "you" as the viewer: the studio's details, a clip's
// motion and the photo's model-written scene.
export function studioBringsOthers(details: string, gender?: string | null) {
  return screen(details, gender, "viewer");
}

// Said plainly in every studio scene and every clip's motion, so the model keeps
// to the one person.
export const SOLO_ANCHOR = "alone, the only person in the scene";

// A clip's motion with the one-person anchor after it, or undefined for none
// (the video's own default motion). POST /api/media/[id]/animate screens the
// motion with studioBringsOthers first; this is the prompt's half of keeping a second
// person out, and OTHER_PEOPLE_NEGATIVE the negative prompt's. A studio motion
// already ends in "alone", which isn't said twice.
export function soloMotionPrompt(motion: string | null | undefined) {
  const text = (motion ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(?:(?:^|[\s,.;:]+)alone)?[\s,.;:]*$/i, "");
  return text ? `${text}, ${SOLO_ANCHOR}` : undefined;
}

// What the keyframe shows: the setting, the outfit for who the character is,
// the pose the motion starts from, and the user's details, with "alone" said
// plainly so the scene has exactly one person in it.
export function studioScene(character: Pick<CharacterRow, "gender">, input: StudioSceneChoice) {
  const setting = studioSetting(input.setting);
  const outfit = studioOutfit(input.outfit);
  const action = studioAction(input.action);
  if (!setting || !outfit || !action) throw new Error("Unknown studio preset.");
  const person = studioPerson(character.gender);
  return [
    SOLO_ANCHOR,
    setting.prompt,
    outfit.prompt[person],
    action.pose,
    input.details ? input.details.replace(/\s+/g, " ").trim() : null,
    "full body or three-quarter shot, cinematic lighting, sharp focus",
  ]
    .filter(Boolean)
    .join(", ");
}

// Every image prompt carries these now (buildImagePrompt adds them); exported
// here too for the photo route and a clip's negative prompt.
export { OTHER_PEOPLE_NEGATIVE } from "@/lib/portrait-prompt";

// The keyframe prompt: the shared builder (adult anchors first, then the minor,
// real-person and other-people negatives) with the scene above. Explicit only
// when the caller checked the user may see it AND the choice calls for it, so a
// lingerie scene stays lingerie.
export function studioFramePrompt(character: CharacterRow, input: StudioSceneChoice, explicit: boolean): ImagePrompt {
  return buildImagePrompt({ subject: subjectOf(character), scene: studioScene(character, input), explicit });
}
