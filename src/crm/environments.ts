export interface CrmEnvironment {
  id: string;
  name: string;
  orgUrl: string;
  color: "green" | "red" | "blue" | "orange";
}

export const DEFAULT_ENVIRONMENTS: CrmEnvironment[] = [
  { id: "dev", name: "DEV", orgUrl: "https://agentcrmdev.crm.dynamics.com", color: "green" }
];

export async function getEnvironments(): Promise<CrmEnvironment[]> {
  const { "env/list": list } = await chrome.storage.local.get("env/list");
  return (list as CrmEnvironment[] | undefined)?.length ? (list as CrmEnvironment[]) : DEFAULT_ENVIRONMENTS;
}

export async function saveEnvironments(envs: CrmEnvironment[]): Promise<void> {
  await chrome.storage.local.set({ "env/list": envs });
}

export async function getActiveEnvironment(): Promise<CrmEnvironment> {
  const envs = await getEnvironments();
  const { "env/active": id } = await chrome.storage.local.get("env/active");
  return envs.find(e => e.id === id) ?? envs[0]!;
}

export async function setActiveEnvironment(id: string): Promise<void> {
  await chrome.storage.local.set({ "env/active": id });
  // record IDs are meaningless in another org (spec: Environments)
  await chrome.storage.local.remove("panel/selections");
}
