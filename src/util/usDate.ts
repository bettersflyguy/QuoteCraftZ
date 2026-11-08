/** Dates as people read them: US MM-DD-YYYY. Only a value that IS a date
 * converts ("1972-03-11", "1972-03-11T05:00:00Z", "3/11/1972", "03-11-1972");
 * anything else (text that merely contains a date) is returned unchanged.
 * Storage keeps its own formats; this is for display, exports and notes. */
const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const US = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/;

export function usDate(value: string): string {
  const v = String(value ?? "").trim();
  const iso = ISO.exec(v);
  if (iso) return `${iso[2]}-${iso[3]}-${iso[1]}`;
  const us = US.exec(v);
  if (us && Number(us[1]) >= 1 && Number(us[1]) <= 12 && Number(us[2]) >= 1 && Number(us[2]) <= 31) {
    return `${us[1]!.padStart(2, "0")}-${us[2]!.padStart(2, "0")}-${us[3]}`;
  }
  return value;
}
