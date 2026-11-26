/** Only default a quote's CRM line when the name is exact or an unambiguous
 * equivalent. Substring matching maps Home to Builders Risk/Home Construction. */
export function quoteLobMatch<T extends {name:string}>(rows:T[],source:string):T|undefined {
  const key=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]+/g,"");
  const wanted=key(source);
  if(!wanted)return undefined;
  const exact=rows.filter(r=>key(r.name)===wanted);
  if(exact.length)return exact.length===1?exact[0]:undefined;
  const aliases:Record<string,string[]>={
    home:["homeowners","homeowner","homeownersinsurance","homeinsurance"],
    auto:["personalauto","personalautomobile","privatepassengerauto","automobile"]
  };
  const matches=rows.filter(r=>aliases[wanted]?.includes(key(r.name)));
  return matches.length===1?matches[0]:undefined;
}
