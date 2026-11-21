/** Names are not evidence of a person's locale. Two surnames is an explicit
 * source mapping choice, never inferred from spelling or accents. */
export type NameFormat = "auto" | "two-surnames";
export interface PersonName {
  original: string;
  firstName: string;
  middleName: string;
  lastName: string;
  suffix: string;
  needsReview: boolean;
}
const tidy = (s: string) => s.normalize("NFC").replace(/\s+/g, " ").trim();
const particles = new Set(["de", "del", "la", "las", "los", "da", "das", "do", "dos", "di", "du", "van", "von"]);
const suffixRx = /^(?:jr\.?|sr\.?|ii|iii|iv|v)$/i;
/** Accent-insensitive comparisons only; display and stored names keep accents. */
export const personNameKey = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

export function parsePersonName(value: string, format: NameFormat = "auto"): PersonName {
  const original = tidy(value);
  let text = tidy(original.replace(/\s*\((?:pni|primary|applicant|spouse|insured)\)/gi, " "));
  text = text.replace(/^(?:(?:mr|mrs|ms|miss|dr|dra|sr|sra|srta|don|doña|prof)\.?\s+)+/iu, "");
  const result: PersonName = { original, firstName:"", middleName:"", lastName:"", suffix:"", needsReview:false };
  // Joint names require the agent to identify the people, not a guessed split.
  if (/\s(?:&|and|y\/o)\s|\//i.test(text)) return { ...result, needsReview:true };
  let words = text.split(" ").filter(Boolean);
  if (words.length > 1 && suffixRx.test(words.at(-1)!)) {
    result.suffix = words.pop()!;
    words[words.length - 1] = words.at(-1)!.replace(/,$/, "");
  }
  text = words.join(" ");
  const comma = text.indexOf(",");
  if (comma >= 0) {
    const family = tidy(text.slice(0, comma));
    const given = tidy(text.slice(comma + 1));
    // "Name, Jr." is a suffix, not surname-first notation.
    if (suffixRx.test(given)) return { ...parsePersonName(family, format), original, suffix:given };
    return { ...result, firstName:given, lastName:family, needsReview:!given || !family || given.includes(",") };
  }
  if (words.length < 2) return { ...result, firstName:words[0] || "", needsReview:Boolean(words.length) };
  // Take one family-name unit, including its particles, from the right.
  const unitStart = (end: number) => {
    let start = end - 1;
    while (start > 1 && particles.has(words[start - 1]!.toLowerCase())) start -= 1;
    return start;
  };
  let boundary = unitStart(words.length);
  // García y López / Silva e Costa is a connected family-name unit.
  if (boundary > 2 && /^(y|e)$/i.test(words[boundary - 1]!)) boundary = unitStart(boundary - 1);
  else if (format === "two-surnames" && boundary > 1) boundary = unitStart(boundary);
  const given = words.slice(0, boundary);
  result.firstName = format === "two-surnames" || boundary < words.length - 1 ? given.join(" ") : given[0]!;
  result.middleName = result.firstName === given[0] ? given.slice(1).join(" ") : "";
  result.lastName = words.slice(boundary).join(" ");
  result.needsReview = words.length > 2 || Boolean(result.suffix);
  return result;
}
