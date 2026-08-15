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
export function EnvBadge({ dispatch }: { dispatch: (a: Action) => void }) {
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
    <Menu>
      <MenuTrigger disableButtonEnhancement>
        <Button
          appearance="subtle"
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
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}
