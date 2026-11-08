import { useState, type ReactElement } from "react";
import { Button, MessageBar, MessageBarBody, Tooltip } from "@fluentui/react-components";
import { ArrowDownloadRegular, ArrowUploadRegular } from "@fluentui/react-icons";
import { getAllFieldMaps } from "@/portal/fieldMaps";
import {
  applySettings, buildSettingsFile, describeImport, downloadSettingsFile, parseSettingsFile,
  type SettingsImport, type TransferScope
} from "./settingsBundle";

const scopeName = (s: TransferScope): string =>
  s.kind === "all" ? "all settings" : s.kind === "site" ? s.origin : `the ${s.source === "ezlynx" ? "EZLynx" : s.source} data service`;
const fileTag = (s: TransferScope): string =>
  s.kind === "all" ? "settings" : s.kind === "site" ? `mappings-${new URL(s.origin).hostname}` : `${s.source}-data-service`;

/** Export / import icons for one scope (all settings, one site, or a data
 * service) plus the review line an import shows before it applies. */
export function useSettingsTransfer(scope: TransferScope, onApplied?: () => void): { icons: ReactElement; panel: ReactElement | null } {
  const [pending, setPending] = useState<{ parsed: SettingsImport; summary: string } | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const exportNow = async () => {
    const file = await buildSettingsFile(scope);
    downloadSettingsFile(file, `quotecraftz-${fileTag(scope)}-${new Date().toISOString().slice(0, 10)}.json`);
  };
  const pick = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      setNote(null);
      try {
        const parsed = parseSettingsFile(await f.text());
        const summary = describeImport(parsed, scope, new Set(Object.keys(await getAllFieldMaps())));
        if (!summary) { setNote({ ok: false, text: `This file has nothing for ${scopeName(scope)}.` }); return; }
        setPending({ parsed, summary });
      } catch (e) {
        setNote({ ok: false, text: String((e as Error).message ?? e) });
      }
    };
    input.click();
  };
  const apply = async () => {
    if (!pending) return;
    const changed = await applySettings(pending.parsed, scope);
    setPending(null);
    setNote(changed ? { ok: true, text: `Imported ${pending.summary}.` } : { ok: false, text: `This file has nothing for ${scopeName(scope)}.` });
    if (changed) onApplied?.();
  };

  const icons = (
    <>
      <Tooltip content={`Import ${scopeName(scope)} from a file`} relationship="label" withArrow>
        <Button size="small" icon={<ArrowUploadRegular />} onClick={pick} />
      </Tooltip>
      <Tooltip content={`Export ${scopeName(scope)} to a file`} relationship="label" withArrow>
        <Button size="small" icon={<ArrowDownloadRegular />} onClick={() => void exportNow()} />
      </Tooltip>
    </>
  );
  const panel = pending ? (
    <MessageBar intent="warning" style={{ marginTop: 8 }}>
      <MessageBarBody>
        Review before applying: {pending.summary}.{" "}
        <Button size="small" appearance="primary" onClick={() => void apply()}>Apply import</Button>{" "}
        <Button size="small" onClick={() => setPending(null)}>Cancel</Button>
      </MessageBarBody>
    </MessageBar>
  ) : note ? (
    <MessageBar intent={note.ok ? "success" : "error"} style={{ marginTop: 8 }}>
      <MessageBarBody>{note.text}</MessageBarBody>
    </MessageBar>
  ) : null;
  return { icons, panel };
}
