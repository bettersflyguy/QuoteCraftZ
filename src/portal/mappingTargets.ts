/** Existing one-target strings remain unchanged. Ordered fan-out bindings
 * keep their preferred fill source first and capture into every target. */
export const MAX_MAPPING_TARGETS = 8;
const PREFIX = "targets:";
export function mappingTargets(value: string | undefined): string[] {
  if (!value) return [];
  if (!value.startsWith(PREFIX)) return [value];
  try {
    const parsed: unknown = JSON.parse(value.slice(PREFIX.length));
    if (!Array.isArray(parsed) || parsed.length < 2 || parsed.length > MAX_MAPPING_TARGETS ||
        parsed.some(p => typeof p !== "string" || !p || p.length > 200 || p.startsWith(PREFIX) || p === "skip" || p.startsWith("secure:"))) return [];
    return [...new Set(parsed as string[])];
  } catch { return []; }
}
export function packMappingTargets(targets: string[]): string {
  const unique = [...new Set(targets.filter(Boolean))];
  if (unique.length > MAX_MAPPING_TARGETS) throw new Error(`A field can have at most ${MAX_MAPPING_TARGETS} targets.`);
  if (unique.length > 1 && unique.some(t => t === "skip" || t.startsWith("secure:") || t.startsWith(PREFIX))) throw new Error("Secured and Never fill mappings must have a single target.");
  return unique.length > 1 ? PREFIX + JSON.stringify(unique) : unique[0] || "";
}
export const preferredTarget = (value: string | undefined): string => mappingTargets(value)[0] || "";
export function preferredFieldMap(map: Record<string,string>): Record<string,string> {
  return Object.fromEntries(Object.entries(map).map(([k,v])=>[k,preferredTarget(v) || (v ? "skip" : "")]));
}
export function expandedFieldMap(map: Record<string,string>): [string,string][] {
  return Object.entries(map).flatMap(([k,v])=>mappingTargets(v).map(t=>[k,t] as [string,string]));
}

/** PL Rater lays records across columns. The index is instance identity in
 * the DOM, not a part of the reusable field mapping. */
const NATIVE_COLLECTION = /^(text|select|checkbox):(Driver|Auto)Ctl(Header|Body)_(\d+|\*)\$(\w+)$/;
export function nativeCollectionKey(key: string): string | null {
  const m = NATIVE_COLLECTION.exec(key);
  return m ? `${m[1]}:${m[2]}Ctl${m[3]}_*$${m[5]}` : null;
}
export function nativeCollectionTarget(target: string): string {
  return target
    .replace(/^(crm:|secure:)?(?:primarycontact|contact\d*|contacts\[\])\./, (_,prefix='')=>`${prefix}contacts[].`)
    .replace(/^(crm:)?vehicle\d+\./, (_,prefix='')=>`${prefix}vehicles[].`)
    .replace(/^note:contact\d*$/, 'note:contacts[]')
    .replace(/^note:vehicle\d+$/, 'note:vehicles[]');
}
export function collectionFieldMap(map: Record<string,string>): Record<string,string> {
  const out: Record<string,string> = {};
  const explicit=new Set(Object.keys(map).filter(k=>nativeCollectionKey(k)===k));
  // Existing explicit collection mappings win over migrated instance maps.
  for (const [key,value] of Object.entries(map)) if (!nativeCollectionKey(key) || key.includes('_*$')) out[key]=value;
  for (const [key,value] of Object.entries(map)) {
    const family=nativeCollectionKey(key);
    if (!family || explicit.has(family)) continue;
    const targets=mappingTargets(value).map(nativeCollectionTarget);
    const previous=mappingTargets(out[family]);
    if(targets.length && targets[0]!=='skip') {
      out[family]=packMappingTargets([...previous.filter(t=>t!=='skip'),...targets]);
    } else if(!previous.length) out[family]=packMappingTargets(targets);
  }
  // Older PL Rater templates confused occupation tenure with employer tenure.
  // Only migrate those known defaults; leave custom destinations untouched.
  const occupation='text:DriverCtlBody_*$rniYearsAtOccupation';
  if(mappingTargets(out[occupation]).includes('crm:contacts[].iacrm_yearsemployed')) {
    out[occupation]=packMappingTargets([...mappingTargets(out[occupation]).filter(t=>t!=='crm:contacts[].iacrm_yearsemployed'),'note:contacts[]']);
  }
  const employer='text:DriverCtlBody_*$rniYearsCurrentEmployer';
  if(out[employer]==='note:contacts[]')out[employer]='crm:contacts[].iacrm_yearsemployed';
  return out;
}
/** Use all visible record columns, including empty controls, to establish
 * position. A missing field cannot shift the next person's/vehicle's values. */
export function resolveCollectionFieldMap(map: Record<string,string>, keys: string[]): Record<string,string> {
  const normalized=collectionFieldMap(map), out={...normalized};
  const columns:Record<string,string[]>={Driver:[],Auto:[]};
  for(const key of keys){const m=NATIVE_COLLECTION.exec(key);if(m&&m[4]!=='*'&&!columns[m[2]!]!.includes(m[4]!))columns[m[2]!]!.push(m[4]!);}
  for(const key of keys){
    const m=NATIVE_COLLECTION.exec(key),family=nativeCollectionKey(key);
    if(!m||!family||!normalized[family])continue;
    const slot=columns[m[2]!]!.indexOf(m[4]!)+1;
    out[key]=packMappingTargets(mappingTargets(normalized[family]).map(target=>target
      .replace(/^(crm:|secure:)?contacts\[\]\./,(_,prefix='')=>prefix==='secure:'?(slot===1?'secure:primarycontact.':`secure:contact${slot}.`):prefix==='crm:'?(slot===1?'crm:primarycontact.':`crm:contact${slot}.`):(slot===1?'contact.':`contact${slot}.`))
      .replace(/^(crm:)?vehicles\[\]\./,(_,prefix='')=>`${prefix}vehicle${slot}.`)
      .replace(/^note:contacts\[\]$/,slot===1?'note:contact':`note:contact${slot}`)
      .replace(/^note:vehicles\[\]$/,`note:vehicle${slot}`)));
  }
  return out;
}
