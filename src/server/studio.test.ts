import { describe, expect, it } from "vitest";
import { bringsOthers, SOLO_ANCHOR, soloMotionPrompt, studioBringsOthers, studioScene } from "@/server/studio";
import { checkImagePrompt } from "@/server/safety/text";
import { EXPLICIT_PHOTO_IDEAS, EXPLICIT_PHOTO_IDEAS_MAN, PHOTO_IDEAS } from "@/components/chat/format";
import { STUDIO_ACTIONS, STUDIO_OUTFITS, STUDIO_SETTINGS, studioMotion } from "@/lib/studio";
import { PRESET_SCENES_BY_PERSON } from "@/app/api/threads/[id]/photo/scenes";

// bringsOthers screens a chat photo's hint ("you" is the character), and
// studioBringsOthers the studio's details, a clip's motion and the photo's
// model-written scene ("you" is the viewer): one character, alone. They refuse
// anyone else by default and any act that takes a partner, and leave solo
// scenes alone. Decisions worth knowing are spelled out below.

type Check = (text: string) => string | null;

function refused(list: string[], check: Check = bringsOthers) {
  for (const text of list) expect(check(text), text).not.toBeNull();
}

function allowed(list: string[], check: Check = bringsOthers) {
  for (const text of list) expect(check(text), text).toBeNull();
}

const as =
  (gender: string): Check =>
  (text) =>
    bringsOthers(text, gender);

describe("bringsOthers refuses", () => {
  it("other people, however they're named or counted", () => {
    refused([
      "with my boyfriend watching",
      "her girlfriend joins",
      "kissing another woman",
      "and a man behind",
      "next to two girls",
      "two people on the bed",
      "a threesome",
      "a crowd watching",
      "an audience",
      "joined by someone",
      "with friends",
      "other people around",
      "her lover waiting by the door",
      "a stranger at the bar",
      "a man behind her",
      "a guy standing next to her",
      "a man watching from the doorway",
      "both of them on the sofa",
      "kissing each other",
      "in bed with her husband",
      "lying underneath him",
      "a voyeur at the window",
    ]);
  });

  it("sex with someone, whoever they are", () => {
    refused([
      "sex with him",
      "having sex on the balcony",
      "making love by the fire",
      "making out on the couch",
      "fucked by a stranger",
      "fucked by him",
      "fucking him",
      "fucking her hard",
      "fucking someone",
      "fucking them",
      "sleeping with her boss",
      "railing her from behind",
      "penetrated by him",
    ]);
  });

  it("acts that take a partner", () => {
    refused([
      "riding a cock",
      "riding his dick",
      "riding his face",
      "sitting on his face",
      "giving a blowjob",
      "a blow job in the shower",
      "a bj",
      "sucking a cock",
      "sucking his dick",
      "sucking cock",
      "a handjob",
      "a titjob",
      "a footjob",
      "going down on him",
      "eating her out",
      "jerking him off",
      "a cumshot on her face",
      "a cum facial",
      "getting a facial",
      "cum on her tits",
      "cumming inside her",
      "a creampie",
      "covered in cum",
      "filling her up",
      "a gangbang",
      "a gang bang",
      "bukkake",
      "double penetration",
      "dp",
      "spit roasted",
      "taking turns with her",
      "a cock in her mouth",
      "two cocks",
    ]);
  });

  it("positions, which imply a partner (on all fours is the solo way to say it)", () => {
    refused(["doggy", "doggystyle", "doggy style on the bed", "missionary", "cowgirl position", "in cowgirl", "riding cowgirl", "reverse cowgirl", "69", "sixty-nine", "scissoring"]);
  });

  it("someone else's body in the scene", () => {
    refused([
      "a man's hand on her thigh",
      "a man's hands around her waist",
      "someone's hand between her legs",
      "someone's lips on her neck",
      "her lover's tongue",
      "a stranger's fingers",
      "male hands on her hips",
      "unseen hands undressing her",
      // A he and a she in one scene are two people.
      "his hands on her hips",
      "his hands all over her",
      "his fingers in her hair",
      "her hands on his chest",
      "he kisses her neck",
      "she straddles him",
    ]);
  });

  it("someone doing something to her", () => {
    refused([
      "being touched",
      "being touched all over",
      "getting fucked",
      "getting fucked hard against the wall",
      "being kissed slowly",
      "being undressed",
      "being held down",
      "kissed by him",
      "touched by a stranger",
      "someone touching her",
      "someone kissing her neck",
      "someone else watching",
      "kissing her slowly",
      "holding her in place",
      "grabbing her from behind",
      "touching him",
    ]);
  });

  it("the viewer as a participant", () => {
    refused([
      "kissing me",
      "kiss me",
      "dancing with you",
      "riding you",
      "fucking you slowly",
      "sucking my cock",
      "sitting on my face",
      "on my lap",
      "in my arms",
      "my hands on her hips",
      "pressed against you",
      "leaning into you",
      "touching you",
      "between us",
      "join us",
      "I kiss her neck",
      "I'm touching her",
      "we fuck",
      "cum on me",
      "wanting you inside her",
      "pov sex",
      "POV: blowjob",
      "pov riding",
      "riding in pov",
      "a lap dance for you",
    ]);
  });

  it("whatever the typography", () => {
    refused(["a man’s hand on her thigh", "BLOWJOB", "Doggy  Style", "some guy’s hands"]);
  });

  it("whatever the spelling", () => {
    refused(["b0yfriend", "a m4n watching", "her g1rlfriend"]);
  });
});

// Someone else is refused wherever they're named, not only after "with" or "and".
describe("bringsOthers refuses anyone else, by default", () => {
  it("a person, whatever they're called and wherever they are in the text", () => {
    refused([
      "a man",
      "the man at the bar",
      "a woman smiling at her",
      "the guy is waiting outside",
      "a girl at the window",
      "the boy",
      "a lady in red",
      "a person in the doorway",
      "people at the pool",
      "her friend",
      "her partner",
      "a lover",
      "a stranger in the hallway",
      "her boyfriend",
      "her girlfriend",
      "her husband",
      "his wife",
      "a hunk",
      "a stud",
      "daddy",
      "mommy",
      "a gentleman",
      "dudes",
      "someone",
      "her ex",
    ]);
  });

  it("family, home, work and school", () => {
    refused([
      "her sister",
      "his brother",
      "my roommate",
      "the neighbour",
      "her neighbor",
      "stepbrother",
      "her stepsister",
      "step-mom",
      "her stepdad",
      "her mom",
      "his dad",
      "her cousin",
      "her boss",
      "the teacher",
      "a student",
      "a coworker",
      "her colleague",
      "a classmate",
      "my landlord",
      "her patient waiting",
    ]);
  });

  it("someone there for a job", () => {
    refused([
      "the delivery guy",
      "a pool boy",
      "the pizza guy",
      "the plumber",
      "an electrician",
      "a mechanic",
      "a doctor",
      "the nurse",
      "a bartender",
      "the waiter",
      "a masseur",
      "the masseuse",
      "a photographer",
      "the cameraman",
      "a camera crew",
      "her personal trainer",
      "the trainer",
      "a cop",
      "a security guard",
      "a lifeguard",
      "the bellboy",
      "her secretary",
      "the butler",
      "a maid",
    ]);
  });

  it("people counted, however they're named", () => {
    refused([
      "two naked women",
      "three silhouettes",
      "two figures on the bed",
      "two bodies intertwined",
      "several blondes",
      "a group of guys",
      "both of them",
      "the two of them",
      "a couple",
      "the couple",
      "a couples massage",
      "the pair",
      "2girls",
      "3 girls",
      "multiple girls",
      "a 3some",
    ]);
  });

  it("gestures that take two", () => {
    refused(["holding hands", "hand in hand", "arm in arm", "sharing a bed", "dancing together", "in bed together"]);
  });

  it("someone else's hands, named by who they are", () => {
    refused(["her roommate's hands", "a man's hand", "the stranger's lips", "her lover's fingers on her thigh"]);
  });

  it("the viewer in the scene: me, you, us", () => {
    refused([
      "on top of me",
      "next to me",
      "with me",
      "with you",
      "you and me",
      "you and her",
      "you kissing her",
      "you're touching my thighs",
      "the two of us",
      "us together",
      "join us",
    ]);
  });

  it("whatever else comes with an allowed phrase", () => {
    refused([
      "a man's shirt and a man's hand",
      "boyfriend jeans and her boyfriend",
      "with you in mind, riding you",
      "dressed as a nurse for her patient",
      "being touched by sunlight and a stranger",
      "a nurse costume, the doctor watching",
    ]);
  });
});

// The character's gender says whose "his" and "her" are.
describe("bringsOthers with the character's gender", () => {
  it("leaves a woman's own body hers, and refuses a he", () => {
    allowed(
      ["her hands on her hips", "her hands in her hair", "licking her lips", "touching herself", "with her hair down", "wearing his shirt"],
      as("Woman"),
    );
    refused(["his hands", "his fingers in her hair", "he kisses her", "touching himself", "in his arms", "on his lap", "him"], as("Woman"));
  });

  it("leaves a man's own body his, and refuses a she", () => {
    allowed(
      [
        "his hands behind his head",
        "stroking his cock",
        "his hand slick with oil",
        "running his hands through his hair",
        "flexing his abs",
        "touching himself",
        "a man bun",
      ],
      as("Man"),
    );
    refused(["her hands on his chest", "her lips", "she kisses him", "her hands on her hips", "with her hair down", "touching herself"], as("Man"));
  });

  it("reads anyone else's pronouns as before: a he only next to a she", () => {
    for (const check of [as("Non-binary"), bringsOthers]) {
      allowed(["his hands behind his head", "her hands on her hips", "touching himself"], check);
      refused(["his hands on her hips", "he kisses her neck"], check);
    }
  });

  it("refuses other people whoever the character is", () => {
    for (const gender of ["Woman", "Man", "Non-binary"]) refused(["her roommate", "riding you", "a blowjob"], as(gender));
    // "A man" for a man is him, named the way scenes do (withoutSelf).
    refused(["a man"], as("Woman"));
    refused(["a man"], as("Non-binary"));
    refused(["a woman"], as("Man"));
  });
});

describe("bringsOthers allows", () => {
  it("solo scenes", () => {
    allowed([
      "masturbating slowly on the bed",
      "touching herself",
      "touching himself",
      "playing with herself",
      "fingering herself",
      "fucking herself with a dildo",
      "riding a dildo",
      "with a pink wand vibrator",
      "a toy deep inside her",
      "getting fucked by a machine",
      "spreading her legs",
      "legs spread on the sofa",
      "on all fours, arching her back",
      "bent over the bed",
      "slowly undressing",
      "getting undressed",
      "slipping off her panties",
      "stripping off her dress",
      "stroking his cock",
      "his hands behind his head",
      "his hand slick with oil",
      "cumming hard, toes curled",
      "covered in his own cum",
      "moaning, eyes closed",
      "hands tied above her head",
      "wearing a strap-on",
    ]);
  });

  it("her and her body", () => {
    allowed([
      "with her hair down",
      "her hands on her hips",
      "hands on her hips",
      "licking her lips",
      "biting her lip",
      "sucking her finger",
      "touching her lips",
      "trailing her fingers along her thigh",
      "kissing her own shoulder",
      "holding her breath",
      "holding her hair up",
      "a strap of her bra slipping",
      "her facial expression soft",
    ]);
  });

  it("the viewer as the one she poses for", () => {
    allowed([
      "looking at you over red sunglasses",
      "holding your gaze",
      "eyes on you",
      "blowing you a kiss",
      "blows you a soft kiss",
      "walking toward you",
      "smiling at you",
      "posing for you",
      "stripping for you",
      "teasing you",
      "for your eyes only",
      "waiting for you",
    ]);
  });

  it("light, water and fabric, which touch her too", () => {
    allowed([
      "kissed by the sun",
      "sun-kissed skin",
      "lit by candlelight",
      "surrounded by roses",
      "warm water caressing her",
      "a dress hugging her curves",
      "the breeze touching her skin",
      "silk sheets wrapped around her",
    ]);
  });

  it("everyday words that sound like more", () => {
    allowed([
      "rain on the window, red silk sheets",
      "gold jewelry and a glass of champagne",
      "with a single rose",
      "soft focus, film grain",
      "with bangs",
      "fucking gorgeous",
      "a cowgirl hat and boots",
      "dressed as a cowgirl",
      "a cocktail in hand",
      "riding the waves",
      "a dress made out of silk",
      "holding her heels, dangling them",
      "leaning on the railing",
      "a facial mask",
      "a sex toy on the nightstand",
    ]);
  });

  it("clothes someone else owns, which aren't a person (naming who still brings them in)", () => {
    allowed(["wearing a man's shirt", "in an oversized men's shirt", "she wears his shirt"]);
    refused(["wearing her boyfriend's shirt", "a man's hand"]);
  });

  it("clothes, looks and turns of phrase named after someone", () => {
    allowed([
      "a man's shirt",
      "boyfriend jeans",
      "a boyfriend shirt",
      "a boyfriend blazer",
      "a relaxed boyfriend fit",
      "a trophy wife look",
      "trophy wife aesthetic",
      "wife material",
      "a girl next door look",
      "boss energy",
      "with you in mind",
      "being touched by sunlight",
      "kissed by the warm morning sun",
      "a facial at the spa",
      "getting a facial at the spa",
      "a cowgirl hat",
      "cowgirl boots",
      "her hands on her hips",
      "with her hair down",
      "mom jeans",
      "lace boyshorts",
      "a pin-up girl pose",
    ]);
  });

  it("costumes, jewellery and places named for someone", () => {
    allowed([
      "a sexy nurse costume",
      "dressed as a french maid",
      "a french maid outfit",
      "dressed up as a cop",
      "a red lifeguard swimsuit",
      "on a lifeguard tower",
      "diamond studs",
      "stud earrings",
      "a coach bag",
      "in the guest bedroom",
      "in the driver's seat",
      "mother of pearl buttons",
    ]);
  });

  it("everyday words that only look like people", () => {
    allowed([
      "white trainers",
      "a couple of candles",
      "a pair of heels",
      "a patient smile",
      "in the studio",
      "a personal touch",
      "getting ready for a date",
      "the only person in the frame",
      "no other people around",
    ]);
  });

  it("you as the character in a chat photo, and the viewer she poses for", () => {
    allowed(["a pic of you in the shower", "send me a selfie", "you touching your thighs", "you holding your breath", "you blowing me a kiss"]);
  });

  it("the studio's own presets and the chat's photo ideas", () => {
    allowed([
      ...STUDIO_SETTINGS.flatMap((option) => [option.label, option.blurb, option.prompt]),
      ...STUDIO_OUTFITS.flatMap((option) => [option.label, option.blurb, ...Object.values(option.prompt)]),
      ...STUDIO_ACTIONS.flatMap((option) => [option.label, option.blurb, option.pose, option.motion]),
      ...[...PHOTO_IDEAS, ...EXPLICIT_PHOTO_IDEAS, ...EXPLICIT_PHOTO_IDEAS_MAN].map((idea) => idea.hint),
    ]);
  });

  it("each character's own studio scenes, motions and photo ideas", () => {
    const people = [
      { gender: "Woman", ideas: EXPLICIT_PHOTO_IDEAS },
      { gender: "Man", ideas: EXPLICIT_PHOTO_IDEAS_MAN },
      { gender: "Non-binary", ideas: EXPLICIT_PHOTO_IDEAS },
    ];
    for (const { gender, ideas } of people) {
      const scenes = STUDIO_OUTFITS.flatMap((outfit) =>
        STUDIO_ACTIONS.map((action) => studioScene({ gender }, { setting: "bedroom", outfit: outfit.id, action: action.id })),
      );
      const motions = STUDIO_ACTIONS.flatMap((action) => [studioMotion(action.id), soloMotionPrompt(studioMotion(action.id))!]);
      allowed([...scenes, ...motions, ...[...PHOTO_IDEAS, ...ideas].map((idea) => idea.hint)], as(gender));
    }
  });
});

// Gaps the word list used to leave open. The classifier's scene policy
// (moderation.ts) backs it up; these are the phrasings it now reads itself.
const studioAs =
  (gender: string | null): Check =>
  (text) =>
    studioBringsOthers(text, gender);

describe("bringsOthers closes the gaps", () => {
  it("the viewer, or anyone, in a position with her", () => {
    for (const check of [studioAs(null), studioAs("Woman"), bringsOthers, as("Woman")]) {
      refused(
        [
          "you on top of her",
          "you behind her",
          "me behind her",
          "I'm under her",
          "we're in bed",
          "you between her legs",
          "you inside her",
          "you in bed with her",
          "you on her lap",
          "me in your arms",
          "me and her",
          "her and me",
          "us kissing",
          "us in bed",
          "a photo of us",
          "you on top",
          "I'm on top",
          "you both",
        ],
        check,
      );
    }
    refused(["me on his lap", "you in his arms"], as("Man"));
  });

  it("her body on the viewer's, or the viewer's on hers", () => {
    for (const check of [studioAs("Woman"), as("Woman"), bringsOthers]) {
      refused(
        [
          "her legs wrapped around you",
          "her legs locked around your waist",
          "her arms around me",
          "her lips on yours",
          "her lips pressed to yours",
          "her body against us",
          "her tongue in your mouth",
          "your legs around me",
          "your lips on mine",
        ],
        check,
      );
    }
  });

  it("a man's clothes on a woman, but not him: 'his' is someone else but for a garment", () => {
    allowed(["wearing his shirt", "in his oversized hoodie", "his jersey and nothing else", "wearing his tie and watch", "slipping into his boxers", "his varsity jacket"], as("Woman"));
    refused(
      ["his erection", "his bulge", "his car", "his voice in her ear", "unbuttoning his shirt", "her hands under his shirt", "pulling his boxers down", "a hand slipping into his boxers", "taking his shirt off"],
      as("Woman"),
    );
  });

  it("a woman's clothes on a man, but not her (her lipstick is a trace of her)", () => {
    allowed(["wearing her dress", "in her lace panties", "her silk robe"], as("Man"));
    refused(["her hands", "her lipstick on his collar", "her red lipstick", "unzipping her dress", "hands under her skirt"], as("Man"));
  });

  it("clothes still on their owner: coming off, or with feet in them on someone", () => {
    refused(["her heels on his shoulders", "her heels digging into his back", "her heels on him", "taking her panties off slowly", "her panties down slowly"], as("Man"));
    allowed(["wearing her heels", "in her heels and nothing else", "her heels kicked off by the bed", "her panties in his mouth"], as("Man"));
    refused(["his boots on her back", "his boots on her"], as("Woman"));
    allowed(
      ["his boots on her feet", "his jacket around her shoulders", "his tie around her wrists", "wearing his shirt off the shoulder", "his shirt off one shoulder", "in his boxers, hands on her hips"],
      as("Woman"),
    );
  });

  it("they doing more to a woman or a man, and them in a place on her", () => {
    refused(
      [
        "they pin her down",
        "they take her from behind",
        "they part her legs",
        "they bend her over the desk",
        "they make her cum",
        "they flip her over",
        "they lay her down",
        "they lift her up",
        "they carry her to bed",
        "they roll her over",
        "they turn her around",
        "they press her against the wall",
        "they position her on the bed",
        "them on top of her",
        "with them behind her",
      ],
      as("Woman"),
    );
    refused(["they bend him over", "them under him"], as("Man"));
    // Her shoes and hands are them too, and they're the non-binary character.
    allowed(["her heels, they make her legs look longer", "holding them behind her back", "her eyes, they turn to the camera", "the lights, they make the room glow"], as("Woman"));
    allowed(["they bend over the desk", "they lay on the bed"], as("Non-binary"));
  });

  it("without a gender, a he where the character can't be", () => {
    for (const check of [as("Non-binary"), bringsOthers]) {
      refused(["on his lap", "in his arms", "kneeling before him", "beneath him", "under him", "on his cock", "in his hands"], check);
      refused(["held in his arms", "sitting on his lap", "bouncing on his cock", "kneeling between his legs", "astride him", "lying under him", "his cock deep inside her"], check);
      allowed(["stroking his cock", "his hands behind his head", "his hand slick with oil"], check);
    }
  });

  it("without a gender, a he's own body, and things on it, stay his", () => {
    for (const check of [as("Non-binary"), bringsOthers]) {
      allowed(
        [
          "his hands on his knees",
          "kneeling, hands on his thighs",
          "oil glistening on his chest",
          "resting his chin on his hands",
          "on his knees, looking up",
          "on his hands and knees",
          "his face in his hands",
          "a book open on his lap",
          "a mug cradled in his hands",
          "the city stretched out before him",
          "the sheets tangled under him",
          "lube on his cock",
          "sweat on his body",
        ],
        check,
      );
    }
  });

  it("a chat photo's he or she on or under the character addressed as you", () => {
    // "You holding his cock" is the man addressed as you, said both ways.
    refused(["his cock in your mouth", "your mouth on his cock", "a pic of you on his lap", "you lying across his lap", "a pic of you kneeling before him"], as("Man"));
    refused(
      ["her tongue in your mouth", "you between her thighs", "your hands on her hips", "show me you under her", "a pic of you sitting on her face", "a pic of you in her arms", "a pic of you, kneeling between her legs"],
      as("Woman"),
    );
    // The viewer she looks at isn't the character, and her own body stays hers.
    allowed(["her hands on her hips, smiling at you", "a selfie of her looking at you", "looking at you between her legs", "a pic of you in the shower, her hair wet"], as("Woman"));
    allowed(["your cock in your hand", "you stroking your cock"], as("Man"));
    allowed(["show me between your legs", "a pic of you under the covers", "a pic of you behind the bar"], as("Woman"));
  });

  // A bare "her hands" or "his cock" next to "you" is as often the character
  // said both ways as someone else; the classifier and the worker's tagger read
  // those. Only a place on or under them is refused by the word list.
  it("the character addressed as you keeps their own body, said either way", () => {
    allowed(
      [
        "a pic of you, his cock hard",
        "selfie of you showing off his abs",
        "a pic of you flexing his abs",
        "a pic of you, his hands on his abs",
        "a pic of you, his cock in his hand",
      ],
      as("Man"),
    );
    allowed(
      [
        "send me a pic of you with her tits out",
        "a pic of you in front of the mirror with your hands on your hips, her hands in her hair",
        "a selfie of you, her hands on her thighs",
        "a pic of you lying on her back",
        "a pic of you on her knees",
      ],
      as("Woman"),
    );
    // Touching the character addressed as you is still someone else.
    refused(["a pic of you in front of the mirror with your hands on your hips, her hands on your waist"], as("Woman"));
  });

  it("a you she thinks of, stands before or can't do without isn't the character", () => {
    allowed(
      [
        "thinking of you, lying on her bed",
        "thinking of you, on her thighs",
        "in front of you, her hands on her knees",
        "because of you, her hands trembling",
        "I'd love to see you, her hands on her hips",
        "imagine you in lingerie, her hands on her thighs",
        "picture you on the bed, her legs spread",
      ],
      as("Woman"),
    );
  });

  it("they, for a woman or a man, and not for someone non-binary", () => {
    refused(["they kiss her neck", "their hands on her", "they're behind her"], as("Woman"));
    refused(["they kiss his neck", "their lips on his chest"], as("Man"));
    allowed(["they kiss the mirror", "their hands on their hips", "touching themselves"], as("Non-binary"));
  });

  it("compounds and slang for someone else", () => {
    refused([
      "her stepdaddy",
      "step-mommy",
      "the poolboy",
      "a pizzaman",
      "the deliveryguy",
      "the milkman",
      "a businessman",
      "a cowboy",
      "her toyboy",
      "a milf",
      "a twink",
      "some chick",
      "another babe",
      "with a babe",
      "her master",
      "his mistress",
      "with a dom",
      "her sub",
      "my slave",
      "MMF",
      "an ffm scene",
      "mfm",
      "a throuple",
      "ménage à trois",
      "a menage",
      "double-teamed",
      "double teamed",
    ]);
    allowed(["send me a pic babe", "in the master bedroom", "a master's degree cap and gown", "a sub-zero morning", "dressed as a dominatrix", "playing a sub", "champagne with dom pérignon", "mmm, in the shower", "milf energy", "a tomboy look"]);
    allowed(["a cowboy hat", "cowboy boots", "dressed as a cowboy"], as("Man"));
    refused(["riding cowgirl style", "cowgirl style"]);
  });

  it("other beings, counted or plural, and figures", () => {
    refused([
      "two catgirls",
      "foxgirls",
      "three elves",
      "two goddesses",
      "two angels",
      "three witches",
      "two vampires",
      "two succubi",
      "two nymphs",
      "two demons",
      "two princesses",
      "three queens",
      "a figure in the doorway",
      "the silhouette at the window",
      "a shadowy figure",
      "figures",
      "silhouettes behind her",
    ]);
    allowed(["as a catgirl", "dressed as an elf", "angel wings", "an hourglass figure", "her silhouette against the window", "a figure-hugging dress", "a curvy figure"]);
  });

  it("figures and silhouettes that are scenery or props, and a lone figure", () => {
    allowed([
      "palm silhouettes at sunset",
      "silhouettes of palm trees against the sky",
      "the silhouette of the city behind her",
      "tree silhouettes outside the window",
      "mountain silhouettes in the distance",
      "two palm silhouettes",
      "action figures on the shelf behind her",
      "a few action figures on the desk",
      "stick figures drawn in the sand",
      "a lone figure on the beach at dusk",
      "a shelf of catgirls figurines",
      "two cold tallboys on the table",
    ]);
    refused(["shadowy figures watching", "figures in the doorway", "two figures on the bed", "silhouettes behind her", "two catgirls", "catgirls", "a figure in the doorway"]);
  });

  it("another being of any kind, or one doing something to her", () => {
    refused([
      "another catgirl",
      "a second elf",
      "another angel",
      "another demon",
      "other vampires",
      "a second succubus",
      "another incubus",
      "another werewolf",
      "another monster",
      "more creatures",
      "another alien",
      "a second robot",
      "a demon behind her",
      "the vampire on top of her",
      "an alien touching her",
      "a werewolf between her legs",
      "the incubus hovering over her",
      "an angel next to her",
      "a tall dark vampire kissing her neck",
    ]);
    // The character as one, and things named after them.
    allowed(["her other angel wing", "a can of monster energy", "a vampire biting her lip", "a succubus touching her breasts", "a vampire with fangs, licking her lips", "as a demon, horns and tail, on the bed"]);
  });

  it("step-family however it's spaced, and & for and", () => {
    refused(["her step sister", "my step mom", "step sis", "you & me", "her & her boyfriend", "me & her in bed"]);
    allowed(["step by step, slowly undressing", "b&w photo, soft light", "r&b playing, candles", "black & white lingerie"]);
  });

  it("hands, mouths and cum nobody owns", () => {
    refused([
      "a tongue on her",
      "a tongue between her thighs",
      "strong arms around her",
      "muscular hands on her hips",
      "a bearded face between her thighs",
      "hairy chest against her",
      "hands all over her",
      "cum dripping down her thighs",
      "cum running from her",
      "cum leaking out of her",
      "a load on her face",
      "his load in her",
    ]);
    allowed(["hands on her hips", "a hand on her hip", "her own cum dripping down her thighs"]);
    allowed(["her strong hands on her hips", "running her hands all over her body"], as("Woman"));
    allowed(["cum dripping down his shaft", "his load on his belly"], as("Man"));
  });

  it("a cock nobody owns in someone, and cum by any name", () => {
    for (const check of [bringsOthers, as("Woman"), studioAs("Woman")]) {
      refused(
        [
          "cock deep inside her",
          "dick down her throat",
          "a shaft between her thighs",
          "strap-on in her",
          "cock all the way in her",
          "cock in your mouth",
          "dick between your tits",
          "her mouth full of cum",
          "filled with cum",
          "stuffed with cock",
          "a cum-filled pussy",
          "cum covered face",
          "jizz on her face",
          "spunk inside her",
          "semen on your tits",
          "loads on her face",
          "two loads on her face",
          "covered in spunk",
        ],
        check,
      );
    }
    refused(["cock deep in her"], as("Man"));
    // His own, a toy's, light, and "loads of".
    allowed(["his cock in his hand", "your cock in your hand", "covered in his own spunk", "cum dripping down his shaft"], as("Man"));
    allowed([
      "a dildo's shaft deep inside her",
      "a glass cock inside her",
      "a dick-shaped toy inside her",
      "a cock ring on the nightstand",
      "a shaft of light down her back",
      "covered in loads of glitter",
      "loads of candles around her",
      "her own cum-stained sheets",
      "her own cum dripping down her thighs",
    ]);
  });

  it("any part of someone on the character, or of the character on someone", () => {
    for (const check of [bringsOthers, as("Woman"), studioAs("Woman")]) {
      refused(
        [
          "her nails down your back",
          "your head between her thighs",
          "her foot on your chest",
          "my head on her lap",
          "her cheek against yours",
          "her lip between your teeth",
          "her head on your shoulder",
          "you with your head on her chest",
        ],
        check,
      );
    }
    allowed(["her back to you", "her head tilted back, eyes on you", "looking back over her shoulder at you"], studioAs("Woman"));
  });

  it("someone smuggled in through an allowed phrase", () => {
    refused(["the bartender's look", "a nurse's uniform", "dressed as a nurse's patient", "a little stud", "a small stud", "a stud"]);
    allowed(["a nurse outfit", "a nurse look", "stud earrings", "a nose stud", "a tongue stud", "gold stud", "silver studs", "a stud in her nose"]);
  });

  it("someone spelled out", () => {
    refused(["m a n", "b-o-y-f-r-i-e-n-d", "a m.a.n", "b o y f r i e n d watching", "her b.f"]);
  });

  it("allowed phrases however they're written", () => {
    allowed([
      "at the spa getting a facial",
      "getting a facial, relaxing at the spa",
      "being touched by golden hour light",
      "being touched by golden-hour light",
      "wife-material",
      "boyfriend denim",
      "boyfriend jean shorts",
      "a cowgirl-style hat",
      "a man's t-shirt",
      "in a men's oversized t-shirt",
    ]);
    refused(["getting a facial", "getting a big facial at the spa", "getting a cum facial at the spa"]);
  });
});

// The word list is the fast first check; the classifier and the worker's
// people check read every scene after it. A false hit costs a paying user
// their request, so ordinary solo wording passes, and what's added to it is
// only what can mean nothing but a second person.
describe("the word list reads ordinary solo wording as solo", () => {
  it("the viewer's clothes on her, where 'you' is the viewer", () => {
    allowed(
      ["pulling on your hoodie", "pulling your hoodie over her knees", "tugging your shirt down to cover herself", "pulling your shirt over her head", "tugging at your tie", "in your oversized hoodie"],
      studioAs("Woman"),
    );
    // The viewer moved, or their clothes coming off or undone on them.
    refused(
      ["pulling you closer", "unbuttoning your shirt while you watch", "pulling your boxers down", "pulling down your boxers", "pulling off your shirt", "tugging at your belt", "unzips your jeans"],
      studioAs("Woman"),
    );
  });

  it("a man's own cock and cum in his own hand, addressed as you", () => {
    allowed(["a pic of you, hard cock in your hand", "dick in your fist", "cock between your fingers", "cum dripping down your fingers", "cum on your abs", "a pic of you, cum on your abs"], as("Man"));
    refused(["cock in your mouth", "cum on your face", "cum on your back"], as("Man"));
    // Where "you" is the viewer, that's the viewer's hand.
    refused(["cock in your hand", "cum on your fingers", "cum on your abs"], studioAs("Man"));
  });

  it("her own on her own fingers or toy: a hand or a toy is never someone", () => {
    allowed(["cum dripping down your fingers", "cum on your toy", "your cum on your fingers", "cum dripping down her fingers", "her own cum on her thighs"], as("Woman"));
    refused(["cum on your tits", "cum dripping down your thighs", "cum dripping down her thighs"], as("Woman"));
  });

  it("the character addressed as you, doing it to their own body", () => {
    allowed(["a pic of you hugging her knees", "a pic of you sitting on her heels", "a pic of you touching her breasts", "a pic of you licking her lips"], as("Woman"));
    allowed(["a pic of you stroking his cock", "you holding his cock"], as("Man"));
    // Her as the object is someone else, and so is a neck she can't reach.
    refused(["a pic of you kissing her", "you touching her", "you holding her close", "a pic of you kissing her neck"], as("Woman"));
    refused(["you stroking him", "you kissing his neck"], as("Man"));
    // Where "you" is the viewer, it's the viewer touching her.
    refused(["you hugging her knees", "you touching her breasts", "you kissing her"], studioAs("Woman"));
    refused(["you stroking his cock"], studioAs("Man"));
  });

  it("a thing or a pet on or under him, not someone", () => {
    for (const check of [as("Non-binary"), bringsOthers, studioAs("Man"), studioAs(null)]) {
      allowed(["a book resting on his lap", "a cat curled up in his lap", "a heavy blanket on top of him", "sheets beneath him", "a dog asleep on top of him"], check);
      refused(["lying beneath him", "climbing on top of him", "she is sitting on his lap"], check);
    }
    for (const check of [as("Non-binary"), bringsOthers]) refused(["sitting on his lap", "naked, curled up in his lap", "astride him", "you on top of him"], check);
  });

  it("her silhouette, a silhouette shot, scenery, decor and a team's jersey", () => {
    for (const check of [bringsOthers, studioAs("Woman")]) {
      allowed(
        [
          "the silhouette of her body against the window",
          "a silhouette shot against the sunset",
          "wearing a Dallas Cowboys jersey",
          "forest silhouettes at dusk",
          "rooftop silhouettes at dusk",
          "neon figures on the wall",
        ],
        check,
      );
      refused(["the silhouette at the window", "a silhouette of a man", "a cowboy", "two cowboys"], check);
    }
  });

  it("waves and shadows on her hair and skin, which aren't 'they'", () => {
    allowed(["the waves, they lift her hair", "the shadows, they turn her skin gold", "the lights, they make her skin glow"], as("Woman"));
    refused(["they lift her up", "they turn her around", "they make her cum", "they part her legs"], as("Woman"));
  });

  it("the character named the way scenes name them", () => {
    for (const check of [studioAs("Woman"), as("Woman")]) {
      allowed(
        [
          "a confident woman in black lace lingerie posing on the bed",
          "a stunning girl in a red bikini",
          "soft light, a stunning girl in a red bikini",
          "a photo of a curvy blonde woman in lingerie",
          "the woman lying on the bed, her hands on her hips",
          "a woman touching her breasts",
          "morning light streaming in, a woman in lingerie on the bed",
          "snow falling outside, a woman by the window",
        ],
        check,
      );
      refused(
        [
          "a woman and a man",
          "a woman kissing a man",
          "two women",
          "a woman kissing her",
          "a woman on the bed, a man behind her",
          "lying on the bed, a woman watching",
          "smiling at the camera, a woman watching",
          "the other woman",
          "a woman's hand on her thigh",
          "a handsome man in boxer briefs",
        ],
        check,
      );
    }
    allowed(["a handsome man in boxer briefs", "a tall man, shirtless, leaning on the railing", "a man"], studioAs("Man"));
    refused(["a man behind him", "a man and a woman", "a woman in lingerie", "the delivery guy"], studioAs("Man"));
    allowed(["a confident person lounging on the sofa"], studioAs("Non-binary"));
    // Without a gender nobody can say who "a woman" is.
    refused(["a woman in lingerie", "a man in boxer briefs"], studioAs(null));
  });
});

describe("the word list adds only what can't be solo", () => {
  it("a partner's clothes pushed aside, pulled up or undone", () => {
    refused(["her panties pushed aside", "her skirt pulled up", "her bra unhooked", "her blouse unbuttoned", "her dress unzipped", "her panties halfway down"], as("Man"));
    refused(["his pants pulled down", "his boxers pushed down", "his shirt ripped off", "his pants are down", "his shirt unbuttoned"], as("Woman"));
    // On her, they stay hers.
    allowed(
      ["his shirt riding up her thighs", "his shirt unbuttoned over her bra", "his hoodie with the hood up", "his shirt slipping off her shoulder", "wearing his shirt, unbuttoned", "his boxers down to her thighs"],
      as("Woman"),
    );
    allowed(["her heels kicked off by the bed", "wearing her dress"], as("Man"));
  });

  it("counted figures and catgirls, whatever they're made of, and a lone figure on her", () => {
    refused(["two anime figures kissing", "two nude marble figures entwined", "two neon figures kissing", "two catgirls art, nude", "a lone figure watching her", "a lone figure behind her", "the lone figure kissing her"]);
    allowed(["anime figurines on the shelf", "marble statues in the garden", "two palm silhouettes", "a few action figures on the desk", "a lone figure on the beach at dusk", "a lone figure watching the sunset"]);
  });

  it("her as the object, and a creature with her or on her", () => {
    for (const check of [bringsOthers, as("Woman"), studioAs("Woman")]) {
      refused(
        ["holding her close", "bending her over the desk", "pinning her down", "a demon fucking her ass", "a vampire licking her pussy", "with a vampire", "kissing an orc", "riding the werewolf", "and a demon behind her"],
        check,
      );
      allowed(
        [
          "as a vampire, fangs bared",
          "dressed as a vampire",
          "with angel wings",
          "with a pair of angel wings",
          "horns and a demon tail",
          "an angel's face",
          "a succubus fucking her ass with a dildo",
          "holding her breath",
          "her open mouth",
          "holding her back straight",
          "pinning her hair up",
          "bending her knees",
        ],
        check,
      );
    }
  });

  it("cum on her, a cock on her face or entering her, a strap-on however it's spelled", () => {
    for (const check of [bringsOthers, as("Woman"), studioAs("Woman")]) {
      refused(["cum all over her", "cum on her neck", "cum on her feet", "cum on her glasses", "dick on her face", "cock against her lips", "cock entering her", "strap on in her", "riding a strap on"], check);
      allowed(["wearing a strap on", "a cock-shaped lollipop on her tongue"], check);
    }
  });

  it("they doing more to her", () => {
    refused(["they tie her up", "they use her", "they shove her against the wall", "they throw her onto the bed", "they grip her hips"], as("Woman"));
    // Throw, grip and guide on her own hair, legs, hands or toy are as often her
    // stockings, the waves or her fingers; the classifier reads the rest.
    allowed(["black stockings, they grip her thighs", "the waves, they throw her hair back", "her hands, they guide her toy deeper", "they guide her hand"], studioAs("Woman"));
  });

  it("someone else called a girl or a woman, doing it to the viewer", () => {
    refused(
      ["a girl licking your pussy", "a pic of a girl licking your pussy", "a girl kneeling between your legs", "a woman between your thighs", "a woman sitting on top of you"],
      as("Woman"),
    );
    refused(["a guy licking your cock", "a man behind you"], as("Man"));
    // Still the character, named generically.
    allowed(["a confident woman in black lace lingerie posing on the bed", "a stunning woman in a red bikini on a sunny beach"], studioAs("Woman"));
  });

  it("oral sex and kissing on the lips can't be done to yourself", () => {
    refused(["a pic of you licking her pussy", "a pic of you kissing her lips", "a pic of you sucking her clit", "a pic of you eating her pussy"], as("Woman"));
    refused(["a pic of you licking his cock", "a pic of you sucking his balls"], as("Man"));
    allowed(["a pic of you licking her lips", "a pic of you rubbing her clit", "a pic of you spreading her pussy"], as("Woman"));
    allowed(["a pic of you grabbing his cock"], as("Man"));
  });

  it("pinning and bending only with her or him as the object", () => {
    for (const check of [as("Woman"), studioAs("Woman")]) {
      allowed(
        ["looking over her shoulder, pinning you with her gaze", "she pins you with a look", "pinning you with a sultry stare", "bending her back in a deep stretch", "slowly bending her back into an arch"],
        check,
      );
      refused(["pinning her against the wall", "bending her over the bed", "pinning him down"], check);
    }
  });

  it("costumes, decor and toys named after a creature", () => {
    allowed(
      [
        "posing by the Christmas tree with an angel on top",
        "a sexy elf costume with a little elf hat",
        "in elf ears and an elf hat",
        "with a demon horn headband",
        "with a monster cock dildo",
        "a shelf of anime figures behind her",
        "gamer bedroom, anime figures on the shelf",
        "a museum with marble figures",
        "bronze figures in the garden",
      ],
      studioAs("Woman"),
    );
    refused(["two anime figures kissing", "with a vampire", "kissing an orc"], studioAs("Woman"));
  });
});

describe("soloMotionPrompt", () => {
  it("says plainly that the person in the photo is alone", () => {
    expect(soloMotionPrompt("dances slowly to the music")).toBe(`dances slowly to the music, ${SOLO_ANCHOR}`);
    expect(soloMotionPrompt("  turns   to the camera. ")).toBe(`turns to the camera, ${SOLO_ANCHOR}`);
  });

  it("doesn't say alone twice after a studio motion", () => {
    const motion = studioMotion("tease");
    expect(motion.endsWith(", alone")).toBe(true);
    expect(soloMotionPrompt(motion)).toBe(`${motion.slice(0, -", alone".length)}, ${SOLO_ANCHOR}`);
  });

  it("leaves no motion as none, so the video's default stands", () => {
    for (const blank of [undefined, null, "", "   ", "alone"]) expect(soloMotionPrompt(blank), String(blank)).toBeUndefined();
  });

  it("passes the image prompt screen", () => {
    expect(checkImagePrompt(SOLO_ANCHOR)).toEqual({ ok: true });
    for (const action of STUDIO_ACTIONS) {
      const motion = soloMotionPrompt(studioMotion(action.id))!;
      expect(checkImagePrompt(motion), motion).toEqual({ ok: true });
    }
  });
});

describe("studioBringsOthers", () => {
  it("also refuses the viewer's body in the scene, since there 'you' is the viewer", () => {
    refused(["your hands on her hips", "on your lap", "your lips on her neck", "riding you"], studioBringsOthers);
    allowed(["holding your gaze", "for your eyes only", "eyes on you", "blowing you a kiss"], studioBringsOthers);
  });

  it("leaves 'your' alone in a chat photo, where it's the character's own", () => {
    allowed(["your hands on your hips", "show me your body", "your lips, up close"]);
  });

  it("reads the character's gender too", () => {
    expect(studioBringsOthers("his hands behind his head", "Man")).toBeNull();
    expect(studioBringsOthers("his hands behind his head", "Woman")).not.toBeNull();
    expect(studioBringsOthers("your hands on her hips", "Woman")).not.toBeNull();
  });

  it("reads a clip's motion with 'you' as the viewer: the animate route's check", () => {
    refused(["you in the shower with her", "you under the covers", "you on the bed", "your hand on her thigh", "you in bed"], studioAs("Woman"));
    allowed(
      ["waiting for you in bed", "smiling at you from the shower", "crawling toward you on the bed", "beckoning you into bed", "blowing you a kiss from the bed", "turns her back to you"],
      studioAs("Woman"),
    );
    // The same words in a chat photo are the character in the shower.
    allowed(["you in the shower", "you under the covers", "a pic of you in bed"], as("Woman"));
  });

  it("reads the viewer pulled, pushed or undressed as joining in", () => {
    refused(["pulling you closer", "unbuttoning your shirt", "unzips your jeans", "pushes you onto the bed", "strips you slowly", "tugging at your belt", "kissing your throat", "her lips on your lip"], studioAs("Woman"));
    allowed(["stripping for you", "pulls off her top for you", "pulling at your heartstrings", "holding your gaze"], studioAs("Woman"));
    // In a chat photo the same "your" is the character's own.
    allowed(["pulling your panties down", "unbuttoning your shirt"], as("Woman"));
  });

  it("passes the photo's own fallback scenes, which a model-written scene is read beside", () => {
    const GENDER = { woman: "Woman", man: "Man", person: "Non-binary" } as const;
    for (const { person, scene } of PRESET_SCENES_BY_PERSON) expect(studioBringsOthers(scene, GENDER[person]), `${person}: ${scene}`).toBeNull();
    allowed(
      [
        "lying on the bed, looking at you with a slow smile",
        "in your oversized hoodie on the couch, warm lamp light",
        "kneeling in front of you on the rug, looking up at the camera",
        "sitting on the edge of your bed in lace lingerie",
        "a lone figure on the balcony at dusk, palm silhouettes behind her",
      ],
      studioAs("Woman"),
    );
  });

  it("passes the studio's own scenes and motions for every character", () => {
    for (const gender of ["Woman", "Man", "Non-binary", null]) {
      const scenes = STUDIO_OUTFITS.flatMap((outfit) =>
        STUDIO_ACTIONS.map((action) => studioScene({ gender: gender ?? "" }, { setting: "bedroom", outfit: outfit.id, action: action.id })),
      );
      const motions = STUDIO_ACTIONS.flatMap((action) => [studioMotion(action.id), soloMotionPrompt(studioMotion(action.id))!]);
      const presets = [...STUDIO_SETTINGS, ...STUDIO_OUTFITS, ...STUDIO_ACTIONS].flatMap((option) => [option.label, option.blurb]);
      allowed([...scenes, ...motions, ...presets], studioAs(gender));
    }
  });
});
