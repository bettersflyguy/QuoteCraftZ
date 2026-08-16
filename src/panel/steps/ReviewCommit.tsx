import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Checkbox,
  Link,
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
import { getActiveEnvironment, crmRecordUrl, type CrmEnvironment } from "@/crm/environments";

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
      ownerId: owner?.userId ?? null,
      ownerName: owner?.fullName ?? null,
      accountCreatedByPanel: state.accountCreatedByPanel,
      createdOpportunityIds: state.createdOpportunityIds
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

  const accountLink = env && state.accountId ? (
    <div style={{ marginBottom: 8 }}>
      <Link href={crmRecordUrl(env, "account", state.accountId)} target="_blank">
        Open {state.accountName ?? "insured"} in CRM ↗
      </Link>
    </div>
  ) : null;

  if (state.step === "done") {
    const results = state.results ?? [];
    const failedKeys = results.filter(r => r.status >= 400).map(r => r.key);
    return (
      <div>
        {accountLink}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {results.map(r => {
            const row = rows.find(x => x.key === r.key);
            const ok = r.status < 400;
            return (
              <div
                key={r.key}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                  padding: 8,
                  borderRadius: 4,
                  border: `1px solid ${ok ? tokens.colorNeutralStroke2 : tokens.colorPaletteRedBorder1}`
                }}
              >
                <Text weight="semibold" style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  {ok ? <CheckmarkCircleRegular /> : <ErrorCircleRegular />}
                  {row ? `${row.carrier} — ${row.lob} (${row.kind})` : r.key}
                </Text>
                <Text size={200}>{ok ? "Created/updated" : r.error ?? `HTTP ${r.status}`}</Text>
                {ok && r.entityId && env && (
                  <Link href={crmRecordUrl(env, "iacrm_quote", r.entityId)} target="_blank">
                    Open quote in CRM ↗
                  </Link>
                )}
              </div>
            );
          })}
        </div>

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
      {accountLink}
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

      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map(r => {
          const checked = state.selectedKeys.includes(r.key);
          return (
            <div
              key={r.key}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 4,
                padding: 8,
                borderRadius: 4,
                border: `1px solid ${tokens.colorNeutralStroke2}`,
                opacity: checked ? 1 : 0.55,
                minWidth: 0
              }}
            >
              <Checkbox checked={checked} onChange={() => dispatch({ t: "toggleKey", key: r.key })} />
              <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <Text weight="semibold" truncate wrap={false} style={{ minWidth: 0 }}>
                    {r.carrier}
                    {r.kind === "Alt" ? " (Alt)" : ""}
                  </Text>
                  <Text weight="semibold" wrap={false}>
                    {r.premium != null ? `$${r.premium.toFixed(2)}` : "—"}
                  </Text>
                </div>
                <Text size={200}>
                  {r.lob}
                  {r.term != null ? ` · ${r.term} mo` : ""}
                </Text>
                {r.coverage && (
                  <Text size={200} truncate wrap={false} style={{ minWidth: 0, color: tokens.colorNeutralForeground3 }}>
                    {r.coverage}
                  </Text>
                )}
              </div>
            </div>
          );
        })}
      </div>

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
              {/* Destination named in the button text (spec). Colour-coding stays on
                  the header badge - palette colours on the brand-blue button fail
                  WCAG contrast and are invisible to colourblind users anyway. */}
              Write {selectedCount} {selectedCount === 1 ? "quote" : "quotes"} to{" "}
              <span style={{ fontWeight: 700 }}>&nbsp;{env?.name}</span>
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
