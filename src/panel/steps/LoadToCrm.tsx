import { useState } from "react";
import { Button, Checkbox, Dropdown, Input, Option, Radio, RadioGroup, Spinner, makeStyles, tokens } from "@fluentui/react-components";
import { send, PanelError } from "../api";
import { ErrorBar } from "../ErrorBar";
import type { CapturedApplication } from "@/messages";
import type { AccountMatch, BatchItemResult, LobRow, PipelineStages } from "@/crm/dataverse";
import { applicantFromIdentity, carrierGuess, identityFromCapture, type CaptureIdentity } from "@/crm/appCommit";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    paddingTop: "10px"
  },
  title: { fontSize: "13px", fontWeight: 600 },
  hint: { fontSize: "12px", color: tokens.colorNeutralForeground3 },
  label: { fontSize: "11px", color: tokens.colorNeutralForeground3, marginBottom: "-6px" },
  row: { display: "flex", gap: "6px" },
  grow: { flex: 1, minWidth: 0 },
  match: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "8px",
    fontSize: "12px",
    backgroundColor: tokens.colorNeutralBackground3,
    borderRadius: "4px",
    padding: "6px 8px"
  },
  matchText: { minWidth: 0, overflowWrap: "anywhere" },
  result: { fontSize: "12px" },
  resultErr: { fontSize: "12px", color: tokens.colorStatusDangerForeground1 }
});

interface OppState { create: boolean; lobId: string | null; name: string; nameEdited: boolean }

/** Loads the held captured application into the active CRM environment.
 * Step 1 reviews and EDITS the identity (captured data is a starting point,
 * not gospel), picks Insured-vs-Lead and Personal/Commercial. Step 2 targets
 * the record (account search/create, or lead create) and optionally creates
 * the carrier opportunity. Worker runs enrichment + risk-data logging. */
export function LoadToCrm({ app }: { app: CapturedApplication }) {
  const styles = useStyles();
  const [step, setStep] = useState<"closed" | "review" | "target">("closed");
  const [identity, setIdentity] = useState<CaptureIdentity>(() => identityFromCapture(app));
  const [target, setTarget] = useState<"insured" | "lead">("insured");
  const [insuredType, setInsuredType] = useState<1 | 2>(() => identityFromCapture(app).businessName ? 2 : 1);
  const [opp, setOpp] = useState<OppState>({ create: false, lobId: null, name: "", nameEdited: false });
  const [lobs, setLobs] = useState<LobRow[] | null>(null);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<AccountMatch[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<PanelError | null>(null);
  const [results, setResults] = useState<BatchItemResult[] | null>(null);
  const [loadedInto, setLoadedInto] = useState<string | null>(null);

  const asPanelError = (e: unknown) =>
    e instanceof PanelError ? e : new PanelError("unknown", String((e as Error).message ?? e));
  const set = (patch: Partial<CaptureIdentity>) => setIdentity(prev => ({ ...prev, ...patch }));

  const personName = `${identity.firstName} ${identity.lastName}`.trim();
  const recordName = (insuredType === 2 && identity.businessName ? identity.businessName : personName) || identity.businessName;
  const oppName = (lobName: string | null) =>
    `${carrierGuess(app)}${lobName ? ` ${lobName}` : ""} Quote`;

  const openReview = () => { setStep("review"); setError(null); };

  const toTarget = async () => {
    setStep("target");
    setQuery(recordName);
    setError(null);
    if (target === "insured") {
      setBusy("search");
      try {
        setMatches(await send<AccountMatch[]>({ type: "panel/searchAccounts", name: recordName, postalCode: identity.postalCode || null }));
      } catch (e) { setError(asPanelError(e)); } finally { setBusy(null); }
    }
  };

  const search = async () => {
    setBusy("search"); setError(null);
    try {
      setMatches(await send<AccountMatch[]>({ type: "panel/searchAccounts", name: query, postalCode: identity.postalCode || null }));
    } catch (e) { setError(asPanelError(e)); } finally { setBusy(null); }
  };

  const toggleOpp = async (create: boolean) => {
    setOpp(o => ({ ...o, create }));
    if (create && lobs === null) {
      try { setLobs(await send<LobRow[]>({ type: "panel/getLobs" })); } catch { setLobs([]); }
    }
  };

  const commit = async (accountId: string, accountName: string) => {
    setBusy(accountId); setError(null);
    try {
      const rows = await send<BatchItemResult[]>({
        type: "panel/appCommit",
        accountId,
        applicant: applicantFromIdentity(identity, insuredType === 2),
        insuredType
      });
      if (opp.create && opp.lobId) {
        const lobName = lobs?.find(l => l.lobId === opp.lobId)?.name ?? null;
        const name = opp.name.trim() || oppName(lobName);
        try {
          const stages = await send<PipelineStages | null>({ type: "panel/getStagesForLob", lobId: opp.lobId });
          await send({
            type: "panel/createOpportunity",
            accountId, lobId: opp.lobId, name,
            pipelineId: stages?.pipelineId ?? null,
            stageId: stages?.stages[0]?.stageId ?? null
          });
          rows.push({ key: `Opportunity — created "${name}"`, status: 204, error: null, entityId: null });
        } catch (e) {
          rows.push({ key: "Opportunity", status: 0, error: String((e as Error).message ?? e), entityId: null });
        }
      }
      setResults(rows);
      setLoadedInto(accountName);
    } catch (e) { setError(asPanelError(e)); } finally { setBusy(null); }
  };

  const createAndCommit = async () => {
    setBusy("create"); setError(null);
    try {
      const created = await send<{ accountId: string; name: string }>({
        type: "panel/createAccount",
        fields: {
          name: query.trim() || recordName,
          street: identity.street || null, city: identity.city || null,
          state: identity.state || null, postalCode: identity.postalCode || null,
          phone: identity.phone || null, email: identity.email || null
        }
      });
      await commit(created.accountId, created.name);
    } catch (e) { setError(asPanelError(e)); setBusy(null); }
  };

  const createLead = async () => {
    setBusy("lead"); setError(null);
    try {
      const lobName = opp.lobId ? lobs?.find(l => l.lobId === opp.lobId)?.name ?? null : null;
      const created = await send<{ leadId: string; name: string }>({
        type: "panel/createLead",
        fields: {
          topic: `${oppName(lobName)} — ${recordName}`,
          name: insuredType === 2 ? identity.businessName || recordName : personName,
          firstName: identity.firstName || null, lastName: identity.lastName || null,
          street: identity.street || null, city: identity.city || null,
          state: identity.state || null, postalCode: identity.postalCode || null,
          phone: identity.phone || null, phoneIsMobile: identity.phoneIsMobile,
          email: identity.email || null
        }
      });
      setResults([{ key: `Lead created — ${created.name}`, status: 204, error: null, entityId: null },
        { key: "Risk-data logging requires an insured Account — convert the lead to load it", status: 204, error: null, entityId: null }]);
      setLoadedInto(created.name);
    } catch (e) { setError(asPanelError(e)); } finally { setBusy(null); }
  };

  if (results) {
    return (
      <div className={styles.root}>
        <div className={styles.title}>Loaded into {loadedInto}</div>
        {results.map(r => (
          <div key={r.key} className={r.error ? styles.resultErr : styles.result}>
            {r.error ? `${r.key}: ${r.error}` : r.key}
          </div>
        ))}
      </div>
    );
  }

  if (step === "closed") {
    return (
      <div className={styles.root}>
        <Button appearance="primary" onClick={openReview}>Load into CRM ({app.fields.length} fields)</Button>
      </div>
    );
  }

  if (step === "review") {
    return (
      <div className={styles.root}>
        <div className={styles.title}>Review before loading — edit anything that's wrong</div>
        {error && <ErrorBar error={error} />}
        <div className={styles.row}>
          <Input className={styles.grow} value={identity.firstName} onChange={(_, d) => set({ firstName: d.value })} placeholder="First name" />
          <Input className={styles.grow} value={identity.lastName} onChange={(_, d) => set({ lastName: d.value })} placeholder="Last name" />
        </div>
        <Input value={identity.businessName} onChange={(_, d) => set({ businessName: d.value })} placeholder="Business name (commercial only)" />
        <Input value={identity.street} onChange={(_, d) => set({ street: d.value })} placeholder="Street" />
        <div className={styles.row}>
          <Input className={styles.grow} value={identity.city} onChange={(_, d) => set({ city: d.value })} placeholder="City" />
          <Input style={{ width: 56 }} value={identity.state} onChange={(_, d) => set({ state: d.value })} placeholder="ST" />
          <Input style={{ width: 90 }} value={identity.postalCode} onChange={(_, d) => set({ postalCode: d.value })} placeholder="ZIP" />
        </div>
        <div className={styles.row}>
          <Input className={styles.grow} value={identity.phone} onChange={(_, d) => set({ phone: d.value })} placeholder="Phone" />
          <Checkbox checked={identity.phoneIsMobile} onChange={(_, d) => set({ phoneIsMobile: Boolean(d.checked) })} label="Mobile" />
        </div>
        <div className={styles.row}>
          <Input className={styles.grow} value={identity.email} onChange={(_, d) => set({ email: d.value })} placeholder="Email" />
          <Input style={{ width: 110 }} value={identity.dateOfBirth} onChange={(_, d) => set({ dateOfBirth: d.value })} placeholder="DOB m/d/yyyy" />
        </div>
        <div className={styles.label}>Insured type</div>
        <RadioGroup layout="horizontal" value={String(insuredType)} onChange={(_, d) => setInsuredType(d.value === "2" ? 2 : 1)}>
          <Radio value="1" label="Personal" />
          <Radio value="2" label="Commercial" />
        </RadioGroup>
        <div className={styles.label}>Create as</div>
        <RadioGroup layout="horizontal" value={target} onChange={(_, d) => setTarget(d.value as "insured" | "lead")}>
          <Radio value="insured" label="Insured (Account)" />
          <Radio value="lead" label="Lead" />
        </RadioGroup>
        <Checkbox
          checked={opp.create}
          onChange={(_, d) => void toggleOpp(Boolean(d.checked))}
          label={target === "insured" ? "Create carrier opportunity" : "Name the lead after a carrier quote"}
        />
        {opp.create && (
          <>
            <Dropdown
              placeholder="Line of business"
              value={lobs?.find(l => l.lobId === opp.lobId)?.name ?? ""}
              selectedOptions={opp.lobId ? [opp.lobId] : []}
              onOptionSelect={(_, d) => {
                const lobId = d.optionValue ?? null;
                const lobName = lobs?.find(l => l.lobId === lobId)?.name ?? null;
                setOpp(o => ({ ...o, lobId, name: o.nameEdited ? o.name : oppName(lobName) }));
              }}
            >
              {(lobs ?? []).map(l => <Option key={l.lobId} value={l.lobId}>{l.name}</Option>)}
            </Dropdown>
            {target === "insured" && (
              <Input
                value={opp.name || oppName(lobs?.find(l => l.lobId === opp.lobId)?.name ?? null)}
                onChange={(_, d) => setOpp(o => ({ ...o, name: d.value, nameEdited: true }))}
                placeholder="Opportunity name"
              />
            )}
          </>
        )}
        <div className={styles.row}>
          <Button appearance="primary" disabled={!recordName || (opp.create && target === "insured" && !opp.lobId)} onClick={target === "insured" ? toTarget : createLead}>
            {busy === "lead" ? <Spinner size="tiny" /> : target === "insured" ? "Continue" : "Create lead"}
          </Button>
          <Button onClick={() => setStep("closed")}>Cancel</Button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.title}>Pick the insured account</div>
      {error && <ErrorBar error={error} onRetry={search} />}
      <div className={styles.row}>
        <Input className={styles.grow} value={query} onChange={(_, d) => setQuery(d.value)}
          onKeyDown={e => { if (e.key === "Enter") void search(); }} placeholder="Account name" />
        <Button disabled={busy !== null} onClick={search}>
          {busy === "search" ? <Spinner size="tiny" /> : "Search"}
        </Button>
      </div>
      {matches?.map(m => (
        <div key={m.accountId} className={styles.match}>
          <span className={styles.matchText}>
            {m.name}{m.city ? ` — ${m.city}` : ""}{m.postalCode ? ` ${m.postalCode}` : ""}
          </span>
          <Button size="small" disabled={busy !== null} onClick={() => commit(m.accountId, m.name)}>
            {busy === m.accountId ? <Spinner size="tiny" /> : "Load"}
          </Button>
        </div>
      ))}
      {matches && matches.length === 0 && <div className={styles.hint}>No matching accounts.</div>}
      <Button disabled={busy !== null} onClick={createAndCommit}>
        {busy === "create" ? <Spinner size="tiny" /> : `Create "${query.trim() || recordName}" and load`}
      </Button>
      <div className={styles.row}>
        <Button onClick={() => setStep("review")}>Back</Button>
      </div>
      <div className={styles.hint}>
        Loading fills empty insured-profile fields, finds or creates the contact,
        sets the insured type, and logs every captured field to the risk-data
        tables. Agent-entered CRM data is never overwritten.
      </div>
    </div>
  );
}
