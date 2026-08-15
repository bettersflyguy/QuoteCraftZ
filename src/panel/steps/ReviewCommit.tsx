import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Checkbox,
  Table,
  TableHeader,
  TableRow,
  TableHeaderCell,
  TableBody,
  TableCell,
  Text,
  Accordion,
  AccordionItem,
  AccordionHeader,
  AccordionPanel,
  Spinner,
  tokens
} from "@fluentui/react-components";
import { CheckmarkCircleRegular, ErrorCircleRegular } from "@fluentui/react-icons";
import { Combobox, Option, Field } from "@fluentui/react-components";
import { send, PanelError } from "../api";
import type { UserRow } from "@/crm/dataverse";
import { ErrorBar } from "../ErrorBar";
import type { Action, ImportState } from "../state";
import type { CommitPayload, BlockSelection } from "@/crm/mapping";
import type { BatchItemResult } from "@/crm/dataverse";
import { getActiveEnvironment, type CrmEnvironment } from "@/crm/environments";

const COLOR_TOKEN: Record<CrmEnvironment["color"], string> = {
  green: tokens.colorPaletteGreenForeground2,
  red: tokens.colorPaletteRedForeground2,
  blue: tokens.colorPaletteBlueForeground2,
  orange: tokens.colorPaletteDarkOrangeForeground2
};

interface ReviewRow {
  key: string;
  carrier: string;
  lob: string;
  kind: string;
  premium: number | null;
  term: number | null;
  coverage: string;
}

export function ReviewCommit({
  state,
  dispatch
}: {
  state: ImportState;
  dispatch: (a: Action) => void;
}) {
  const [env, setEnv] = useState<CrmEnvironment | null>(null);
  const [committing, setCommitting] = useState(false);
  const [err, setErr] = useState<PanelError | null>(null);
  const [lastAttemptKeys, setLastAttemptKeys] = useState<string[] | undefined>(undefined);
  // Servicing agent (record owner). Required - shared rating logins mean the
  // signed-in identity is NOT a safe default for who services the account.
  const [owner, setOwner] = useState<UserRow | null>(null);
  const [ownerQuery, setOwnerQuery] = useState("");
  const [ownerOptions, setOwnerOptions] = useState<UserRow[]>([]);

  useEffect(() => {
    getActiveEnvironment().then(async e => {
      setEnv(e);
      // sticky default, per environment
      const key = `owner/default:${e.orgUrl}`;
      const stored = await chrome.storage.local.get(key);
      const d = stored[key] as UserRow | undefined;
      if (d) { setOwner(d); setOwnerQuery(d.fullName); }
    });
  }, []);

  async function searchOwners(q: string) {
    setOwnerQuery(q);
    setOwner(null); // typing invalidates the previous pick until a new one is chosen
    if (q.trim().length < 2) return setOwnerOptions([]);
    try {
      setOwnerOptions(await send<UserRow[]>({ type: "panel/searchUsers", query: q.trim() }));
    } catch (e) {
      setErr(e as PanelError);
    }
  }

  async function pickOwner(userId: string) {
    const u = ownerOptions.find(o => o.userId === userId);
    if (!u || !env) return;
    setOwner(u);
    setOwnerQuery(u.fullName);
    await chrome.storage.local.set({ [`owner/default:${env.orgUrl}`]: u });
  }

  const rows = useMemo<ReviewRow[]>(() => {
    const out: ReviewRow[] = [];
    for (const b of state.captured?.blocks ?? []) {
      if (!state.blockSelections[b.lob]) continue; // skipped blocks import nothing (spec)
      for (const q of b.quotes) {
        out.push({
          key: q.key,
          carrier: q.carrierName,
          lob: b.lob,
          kind: q.kind === "requested" ? "Req" : "Alt",
          premium: q.premium,
          term: q.termMonths,
          coverage: q.coverageSummary.split("\n")[0] ?? ""
        });
      }
    }
    return out;
  }, [state.captured, state.blockSelections]);

  function buildPayload(keysOverride?: string[]): CommitPayload | null {
    if (!state.captured || !state.accountId) return null;
    const blockSelections: Record<string, BlockSelection> = {};
    for (const [lob, sel] of Object.entries(state.blockSelections)) {
      if (sel) blockSelections[lob] = sel;
    }
    return {
      run: state.captured,
      accountId: state.accountId,
      quotingMethodId: null,
      blockSelections,
      carrierMap: state.carrierMap,
      selectedKeys: keysOverride ?? state.selectedKeys,
      ownerId: owner?.userId ?? null
    };
  }

  async function commit(keysOverride?: string[]) {
    const payload = buildPayload(keysOverride);
    if (!payload) return;
    setLastAttemptKeys(keysOverride);
    setCommitting(true);
    setErr(null);
    try {
      const results = await send<BatchItemResult[]>({ type: "panel/commit", payload });
      dispatch({ t: "results", r: results });
    } catch (e) {
      setErr(e as PanelError);
    } finally {
      setCommitting(false);
    }
  }

  const selectedCount = state.selectedKeys.filter(k => rows.some(r => r.key === k)).length;

  if (state.step === "done") {
    const results = state.results ?? [];
    const failedKeys = results.filter(r => r.status >= 400).map(r => r.key);
    return (
      <div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Quote</TableHeaderCell>
              <TableHeaderCell>HTTP</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {results.map(r => {
              const row = rows.find(x => x.key === r.key);
              const ok = r.status < 400;
              return (
                <TableRow key={r.key}>
                  <TableCell>
                    {ok ? (
                      <>
                        <CheckmarkCircleRegular /> Created/updated
                      </>
                    ) : (
                      <>
                        <ErrorCircleRegular /> {r.error ?? `HTTP ${r.status}`}
                      </>
                    )}
                  </TableCell>
                  <TableCell>{row ? `${row.carrier} — ${row.lob} (${row.kind})` : r.key}</TableCell>
                  <TableCell>{r.status}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        {err && (
          <div style={{ marginTop: 8 }}>
            <ErrorBar error={err} onRetry={() => commit(lastAttemptKeys)} />
          </div>
        )}

        <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
          {failedKeys.length > 0 && (
            <Button appearance="primary" disabled={committing} onClick={() => commit(failedKeys)}>
              {committing ? <Spinner size="tiny" /> : `Retry failed (${failedKeys.length})`}
            </Button>
          )}
          <Button onClick={() => dispatch({ t: "startOver" })}>Start over</Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {(state.captured?.blocks ?? [])
        .filter(b => b.errors.length > 0)
        .map(b => (
          <Accordion key={b.lob} collapsible style={{ marginBottom: 8 }}>
            <AccordionItem value={b.lob}>
              <AccordionHeader>
                {b.lob}: {b.errors.length} carrier{b.errors.length === 1 ? "" : "s"} returned no
                quote
              </AccordionHeader>
              <AccordionPanel>
                {b.errors.map((e, i) => (
                  <Text key={i} block>
                    {e.carrierName}: {e.message}
                  </Text>
                ))}
              </AccordionPanel>
            </AccordionItem>
          </Accordion>
        ))}

      <Table style={{ marginTop: 12 }}>
        <TableHeader>
          <TableRow>
            <TableHeaderCell />
            <TableHeaderCell>Carrier</TableHeaderCell>
            <TableHeaderCell>LOB</TableHeaderCell>
            <TableHeaderCell>Kind</TableHeaderCell>
            <TableHeaderCell>Premium</TableHeaderCell>
            <TableHeaderCell>Term</TableHeaderCell>
            <TableHeaderCell>Coverage</TableHeaderCell>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(r => (
            <TableRow key={r.key}>
              <TableCell>
                <Checkbox
                  checked={state.selectedKeys.includes(r.key)}
                  onChange={() => dispatch({ t: "toggleKey", key: r.key })}
                />
              </TableCell>
              <TableCell>{r.carrier}</TableCell>
              <TableCell>{r.lob}</TableCell>
              <TableCell>{r.kind}</TableCell>
              <TableCell>{r.premium != null ? `$${r.premium.toFixed(2)}` : "—"}</TableCell>
              <TableCell>{r.term ?? "—"}</TableCell>
              <TableCell>{r.coverage}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {err && (
        <div style={{ marginTop: 8 }}>
          <ErrorBar error={err} onRetry={() => commit(lastAttemptKeys)} />
        </div>
      )}

      <Field
        label="Servicing agent (record owner)"
        required
        validationState={owner ? "none" : "warning"}
        validationMessage={owner ? undefined : "Pick who these quotes belong to — required."}
        style={{ marginTop: 12 }}
      >
        <Combobox
          placeholder="Type a name…"
          value={ownerQuery}
          selectedOptions={owner ? [owner.userId] : []}
          onInput={e => searchOwners((e.target as HTMLInputElement).value)}
          onOptionSelect={(_, d) => { if (d.optionValue) void pickOwner(d.optionValue); }}
        >
          {ownerOptions.map(u => (
            <Option key={u.userId} value={u.userId} text={u.fullName}>
              {u.fullName}
            </Option>
          ))}
        </Combobox>
      </Field>

      <div style={{ marginTop: 12 }}>
        <Button
          appearance="primary"
          disabled={committing || !env || selectedCount === 0 || !owner}
          onClick={() => commit()}
        >
          {committing ? (
            <Spinner size="tiny" />
          ) : (
            <>
              Write {selectedCount} quotes to{" "}
              <span style={{ fontWeight: 700, color: env ? COLOR_TOKEN[env.color] : undefined }}>
                {env?.name}
              </span>
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
