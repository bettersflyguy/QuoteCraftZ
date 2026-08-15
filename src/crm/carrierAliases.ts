// Aliases map EZLynx carrier ids to iacrm_carrier GUIDs. GUIDs are org-specific,
// so the store is keyed per org URL - an alias learned in DEV must never leak
// into another environment's imports.
export async function getCarrierAliases(orgUrl: string): Promise<Record<number, string>> {
  const key = `carrier/aliases:${orgUrl}`;
  const o = await chrome.storage.local.get(key);
  return (o[key] as Record<number, string> | undefined) ?? {};
}

export async function saveCarrierAlias(orgUrl: string, ezlynxId: number, crmCarrierId: string): Promise<void> {
  const key = `carrier/aliases:${orgUrl}`;
  const all = await getCarrierAliases(orgUrl);
  all[ezlynxId] = crmCarrierId;
  await chrome.storage.local.set({ [key]: all });
}
