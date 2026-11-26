export function matchesMappingSearch(query:string,...values:(string|undefined)[]):boolean {
  const text=values.filter(Boolean).join(" ").toLocaleLowerCase();
  return query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean).every(word=>text.includes(word));
}
