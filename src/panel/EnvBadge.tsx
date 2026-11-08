import { useEffect, useState } from "react";
import {
  Menu,
  MenuTrigger,
  MenuPopover,
  MenuList,
  MenuItem,
  Button,
  tokens
} from "@fluentui/react-components";
import { SettingsRegular } from "@fluentui/react-icons";
import type { CrmEnvironment } from "@/crm/environments";
import { getActiveEnvironment } from "@/crm/environments";
import { send } from "./api";
import type { Action } from "./state";

const BACKGROUND_TOKEN: Record<CrmEnvironment["color"], string> = {
  green: tokens.colorPaletteGreenBackground2,
  red: tokens.colorPaletteRedBackground2,
  blue: tokens.colorPaletteBlueBackground2,
  orange: tokens.colorPaletteDarkOrangeBackground2
};

const FOREGROUND_TOKEN: Record<CrmEnvironment["color"], string> = {
  green: tokens.colorPaletteGreenForeground2,
  red: tokens.colorPaletteRedForeground2,
  blue: tokens.colorPaletteBlueForeground2,
  orange: tokens.colorPaletteDarkOrangeForeground2
};

/** Always-visible header pill naming the active environment (spec: Environments -
 * "the panel header shows the active environment name, colour-coded, at all times"). */
export function EnvBadge({ dispatch, onOpenMappings }: { dispatch: (a: Action) => void; onOpenMappings?: () => void }) {
  const [envs, setEnvs] = useState<CrmEnvironment[]>([]);
  const [active, setActive] = useState<CrmEnvironment | null>(null);

  async function refresh() {
    const [list, act] = await Promise.all([
      send<CrmEnvironment[]>({ type: "env/list" }),
      getActiveEnvironment()
    ]);
    setEnvs(list);
    setActive(act);
  }

  useEffect(() => {
    refresh();
    // Environments are edited on the Options page while the panel stays open -
    // without this, a newly saved environment never appears in the menu.
    const onChanged = (changes: Record<string, unknown>, area: string) => {
      if (area !== "local") return;
      if ("env/list" in changes || "env/active" in changes) void refresh();
      // switching the active org from the Options page invalidates the panel's
      // CRM selections exactly like switching from this menu does
      if ("env/active" in changes) dispatch({ t: "reset" });
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  async function choose(id: string) {
    if (active && id === active.id) return;
    await send({ type: "env/setActive", id });
    await refresh();
    // worker clears stored CRM-side selections; mirror that locally, keep the captured run
    dispatch({ t: "reset" });
  }

  if (!active) return null;

  return (
    <Menu onOpenChange={(_, d) => { if (d.open) void refresh(); }}>
      <MenuTrigger disableButtonEnhancement>
        <Button
          appearance="subtle"
          icon={<SettingsRegular />}
          iconPosition="after"
          title="Settings: environment, field mappings"
          style={{
            backgroundColor: BACKGROUND_TOKEN[active.color],
            color: FOREGROUND_TOKEN[active.color],
            fontWeight: 600
          }}
        >
          {active.name}
        </Button>
      </MenuTrigger>
      <MenuPopover>
        <MenuList>
          {envs.map(e => (
            <MenuItem key={e.id} onClick={() => choose(e.id)}>
              {e.name}
              {e.id === active.id ? " (active)" : ""}
            </MenuItem>
          ))}
          {onOpenMappings && (
            <MenuItem onClick={onOpenMappings}>
              Field mappings
            </MenuItem>
          )}
          <MenuItem onClick={() => chrome.runtime.openOptionsPage()}>
            Manage environments…
          </MenuItem>
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}
