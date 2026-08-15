import { describe, it, expect, beforeEach } from "vitest";
import { backing, reset } from "./helpers/chromeStub";
import { getEnvironments, getActiveEnvironment, setActiveEnvironment } from "@/crm/environments";

beforeEach(() => reset());

describe("environments", () => {
  it("ships DEV as the default and default-active", async () => {
    const envs = await getEnvironments();
    expect(envs[0]).toMatchObject({
      id: "dev", name: "DEV", orgUrl: "https://agentcrmdev.crm.dynamics.com", color: "green"
    });
    expect((await getActiveEnvironment()).id).toBe("dev");
  });

  it("setActiveEnvironment persists and clears pinned selections", async () => {
    backing["panel/selections"] = { accountId: "abc" };
    await setActiveEnvironment("dev");
    expect(backing["env/active"]).toBe("dev");
    expect(backing["panel/selections"]).toBeUndefined();
  });
});
