export async function getCarrierAliases(): Promise<Record<number, string>> {
  const { "carrier/aliases": a } = await chrome.storage.local.get("carrier/aliases");
  return (a as Record<number, string> | undefined) ?? {};
}
export async function saveCarrierAlias(ezlynxId: number, crmCarrierId: string): Promise<void> {
  const all = await getCarrierAliases();
  all[ezlynxId] = crmCarrierId;
  await chrome.storage.local.set({ "carrier/aliases": all });
}
