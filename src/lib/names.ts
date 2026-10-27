// The rule for a character's name, shared by the creator and the character
// route: one to three words of letters (any script) with apostrophes, hyphens
// or periods inside, like "Zoë", "D'Angelo", "Mary-Jane" or "J. Park". No
// digits, brackets or commas, so "Yuki (17)" or "Yuki, 17" can't put an age in
// the chat prompt; minor-coded words are the classifier's to catch.

export const NAME_MAX = 30;
export const GIVEN_NAME = /^\p{L}[\p{L}\p{M}'’.-]*(?: \p{L}[\p{L}\p{M}'’.-]*){0,2}$/u;
export const NAME_RULE = "1 to 3 words, letters only. Apostrophes, hyphens and periods are fine. Up to 30 characters.";

export const NAME_MESSAGES = {
  empty: "Add a name.",
  long: `Keep the name to ${NAME_MAX} characters or fewer.`,
  shape: "Use a first name, or first and last: letters only, up to three words.",
};

export function tidyName(raw: string) {
  return raw.trim().replace(/\s+/g, " ");
}

export function nameProblem(raw: string): string | null {
  const value = tidyName(raw);
  if (!value) return NAME_MESSAGES.empty;
  if (value.length > NAME_MAX) return NAME_MESSAGES.long;
  if (!GIVEN_NAME.test(value)) return NAME_MESSAGES.shape;
  return null;
}
