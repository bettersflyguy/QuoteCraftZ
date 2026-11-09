import { useEffect, useState } from "react";
import { Button, Checkbox, Combobox, Dropdown, Input, Option, Radio, RadioGroup, Spinner, makeStyles, tokens } from "@fluentui/react-components";
import { send, PanelError } from "../api";
import { ErrorBar } from "../ErrorBar";
import type { CapturedApplication } from "@/messages";
import type { AccountMatch, BatchItemResult, CarrierRow, ExistingMatch, LobRow, OppSummary, PipelineStages, UserRow } from "@/crm/dataverse";
import type { CapturedApplicant } from "@/types";
import { getActiveEnvironment, crmRecordUrl, type CrmEnvironment } from "@/crm/environments";
import { applicantFromIdentity, noteOutcomeText, buildTimelineNote, carrierGuess, coApplicantsFromCapture, crmGroup, guessInsuredType, policyDraftsFromCapture, identityFromCapture, leadSourceGuess, parseMoney, policyFromCapture, quoteFromCapture, toIsoDate, type CaptureIdentity } from "@/crm/appCommit";

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
  resultErr: { fontSize: "12px", color: tokens.colorStatusDangerForeground1 },
  warn: {
    fontSize: "12px",
    color: tokens.colorStatusWarningForeground1,
    backgroundColor: tokens.colorStatusWarningBackground1,
    borderRadius: "4px",
    padding: "8px"
  }
});

interface OppState { create: boolean; lobId: string | null; name: string; nameEdited: boolean }
interface PolicyRow {
  number: string; premium: string; effective: string; expiration: string; carrierId: string | null; lobId: string | null;
  /** Taught CRM columns for this policy row (raw text; coerced worker-side). */
  extra?: Record<string, string>;
}
interface PolicyState { create: boolean; rows: PolicyRow[] }
interface QuoteGroupChoice { lobId: string | null; mode: "reuse" | "new" }
interface PendingOpp { accountId: string; accountName: string; opps: OppSummary[] }

/** Loads the held captured application into the active CRM environment.
 * Step 1 reviews and EDITS the identity (captured data is a starting point,
 * not gospel), picks Insured-vs-Lead and Personal/Commercial. Step 2 targets
 * the record (account search/create, or lead create) and optionally creates
 * the carrier opportunity. Worker runs enrichment + risk-data logging. */
const MATCH_LABEL = { email: "email match", phone: "phone match", name: "name match" } as const;

export function LoadToCrm({ app, onFlowActive, onLoaded }: { app: CapturedApplication; onFlowActive?: (active: boolean) => void; onLoaded?: () => void }) {
  const styles = useStyles();
  const [step, setStep] = useState<"closed" | "review" | "target">("closed");
  const [identity, setIdentity] = useState<CaptureIdentity>(() => identityFromCapture(app));
  const [target, setTarget] = useState<"insured" | "lead">("insured");
  const [insuredType, setInsuredType] = useState<1 | 2>(() => guessInsuredType(app));
  const [opp, setOpp] = useState<OppState>({ create: false, lobId: null, name: "", nameEdited: false });
  // A captured policy number means the ingest happened on a SALE screen -
  // policy creation offers itself pre-checked with the captured terms.
  // Policies are an array: a taught AMS policies list yields one row per
  // captured policy (with its mapped columns); otherwise the single draft.
  const [policy, setPolicy] = useState<PolicyState>(() => {
    const taught = policyDraftsFromCapture(app).filter(d => d.hasPolicy);
    if (taught.length) {
      return {
        create: true,
        rows: taught.map(d => ({ number: d.number, premium: d.premiumText, effective: d.effectiveDate, expiration: d.expirationDate, carrierId: null, lobId: null, extra: d.extra }))
      };
    }
    const d = policyFromCapture(app);
    return { create: d.hasPolicy, rows: [{ number: d.number, premium: d.premiumText, effective: d.effectiveDate, expiration: d.expirationDate, carrierId: null, lobId: null }] };
  });

  const setPolicyRow = (i: number, patch: Partial<PolicyRow>) =>
    setPolicy(p => ({ ...p, rows: p.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) }));
  // Quotes held from any source (EZLynx data service, carrier quote pages):
  // selected, carrier-mapped and Firm/Estimated on the Quotes tab; here each
  // line of business picks its CRM LOB and opportunity.
  const heldQuotes = (app.quotes ?? []).filter(q => q.selected);
  const quoteLobs = [...new Set(heldQuotes.map(q => q.lob))];
  const [quoteGroups, setQuoteGroups] = useState<Record<string, QuoteGroupChoice>>({});
  const setGroup = (lob: string, patch: Partial<QuoteGroupChoice>) =>
    setQuoteGroups(g => ({ ...g, [lob]: { lobId: null, mode: "reuse", ...g[lob], ...patch } }));
  // servicing agent (record owner) - required when quotes are written; shared
  // rating logins make the signed-in identity no safe default
  const [owner, setOwner] = useState<UserRow | null>(null);
  const [ownerQuery, setOwnerQuery] = useState("");
  const [ownerOptions, setOwnerOptions] = useState<UserRow[]>([]);
  const [carriers, setCarriers] = useState<CarrierRow[] | null>(null);
  const [lobs, setLobs] = useState<LobRow[] | null>(null);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<AccountMatch[] | null>(null);
  const [dupes, setDupes] = useState<ExistingMatch[] | null>(null);
  const [env, setEnv] = useState<CrmEnvironment | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<PanelError | null>(null);
  const [results, setResults] = useState<BatchItemResult[] | null>(null);
  const [loadedInto, setLoadedInto] = useState<string | null>(null);
  const [loadedRecord, setLoadedRecord] = useState<{ etn: string; id: string } | null>(null);

  const asPanelError = (e: unknown) =>
    e instanceof PanelError ? e : new PanelError("unknown", String((e as Error).message ?? e));
  const set = (patch: Partial<CaptureIdentity>) => setIdentity(prev => ({ ...prev, ...patch }));

  const personName = `${identity.firstName} ${identity.lastName}`.trim();
  const recordName = (insuredType === 2 && identity.businessName ? identity.businessName : personName) || identity.businessName;
  const oppName = (lobName: string | null) =>
    `${carrierGuess(app)}${lobName ? ` ${lobName}` : ""} Quote`;

  const openReview = () => { setStep("review"); setError(null); };

  /** EZLynx captures carry license numbers: they go to the field-secured
   * license columns exactly as the dedicated importer always wrote them. */
  const withServiceLicenses = (a: CapturedApplicant): CapturedApplicant => {
    const run = app.dataService?.run;
    if (!run) return a;
    const nameKey = (f: string, l: string) => `${f} ${l}`.trim().toLowerCase();
    const byName = new Map(run.applicant.coApplicants.map(c => [nameKey(c.firstName, c.lastName), c]));
    return {
      ...a,
      dlNumber: a.dlNumber ?? run.applicant.dlNumber,
      dlState: a.dlState ?? run.applicant.dlState,
      coApplicants: a.coApplicants.map(c => {
        const m = byName.get(nameKey(c.firstName, c.lastName));
        return m ? { ...c, dlNumber: c.dlNumber ?? m.dlNumber, dlState: c.dlState ?? m.dlState } : c;
      })
    };
  };

  useEffect(() => {
    getActiveEnvironment().then(async e => {
      setEnv(e);
      // sticky servicing-agent default, per environment
      const key = `owner/default:${e.orgUrl}`;
      const d = (await chrome.storage.local.get(key))[key] as UserRow | undefined;
      if (d) { setOwner(d); setOwnerQuery(d.fullName); }
    }).catch(() => {});
  }, []);

  const searchOwners = async (q: string) => {
    setOwnerQuery(q);
    setOwner(null);
    if (q.trim().length < 2) { setOwnerOptions([]); return; }
    try { setOwnerOptions(await send<UserRow[]>({ type: "panel/searchUsers", query: q.trim() })); } catch (e) { setError(asPanelError(e)); }
  };
  const pickOwner = async (userId: string) => {
    const u = ownerOptions.find(o => o.userId === userId);
    if (!u || !env) return;
    setOwner(u);
    setOwnerQuery(u.fullName);
    await chrome.storage.local.set({ [`owner/default:${env.orgUrl}`]: u });
  };

  // pin the panel's mode while this flow is open or a write is in flight -
  // the sign-in popup stealing focus must not unmount an in-progress load
  const flowActive = step !== "closed" || busy !== null;
  useEffect(() => {
    onFlowActive?.(flowActive);
    return () => onFlowActive?.(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowActive]);

  /** The duplicate gate. Existing accounts and open leads are matched by email,
   * then phone, then name. */
  const runMatch = async () => {
    setBusy("dupes");
    try {
      setDupes(await send<ExistingMatch[]>({
        type: "panel/findMatches",
        query: {
          email: identity.email.trim() || null,
          phone: identity.phone.trim() || null,
          firstName: identity.firstName.trim() || null,
          lastName: identity.lastName.trim() || null,
          businessName: insuredType === 2 ? identity.businessName.trim() || null : null
        }
      }));
    } catch (e) { setError(asPanelError(e)); } finally { setBusy(null); }
  };

  /** The gate runs while the producer is still REVIEWING, not after they have already
   * decided to create something: an existing insured is the most important fact on the
   * screen, and deciding "Insured vs Lead" without it is deciding blind. Re-runs as the
   * identity is edited, because a corrected phone or spelling is often what finds the
   * record the first pass missed. */
  useEffect(() => {
    if (step !== "review") return;
    const t = setTimeout(() => { void runMatch(); }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, identity.email, identity.phone, identity.firstName, identity.lastName, identity.businessName, insuredType]);

  /** BOTH targets pass through here; the gate is re-checked so a match found during
   * review cannot go stale between the two screens. */
  const toTarget = async () => {
    setStep("target");
    setQuery(recordName);
    setError(null);
    setMatches(null);
    await runMatch();
  };

  const search = async () => {
    setBusy("search"); setError(null);
    try {
      setMatches(await send<AccountMatch[]>({ type: "panel/searchAccounts", name: query, postalCode: identity.postalCode || null }));
    } catch (e) { setError(asPanelError(e)); } finally { setBusy(null); }
  };

  const loadLobs = async () => {
    if (lobs !== null) return;
    try { setLobs(await send<LobRow[]>({ type: "panel/getLobs" })); } catch { setLobs([]); }
  };

  const toggleOpp = async (create: boolean) => {
    setOpp(o => ({ ...o, create }));
    if (create) await loadLobs();
  };

  const loadCarriers = async () => {
    if (carriers !== null) return;
    try {
      const list = await send<CarrierRow[]>({ type: "panel/getCarriers" });
      setCarriers(list);
      const guess = carrierGuess(app).toLowerCase();
      const hit = list.find(c => c.name.toLowerCase().includes(guess) || guess.includes(c.name.toLowerCase()));
      if (hit) {
        setPolicy(p => ({ ...p, rows: p.rows.map(r => (r.carrierId ? r : { ...r, carrierId: hit.carrierId })) }));
      }
    } catch { setCarriers([]); }
  };

  const togglePolicy = async (create: boolean) => {
    setPolicy(p => ({ ...p, create }));
    if (create) { await loadLobs(); await loadCarriers(); }
  };


  // sale/quote captures arrive with the checkboxes pre-checked: hydrate dropdowns
  useEffect(() => {
    if (step === "review" && (policy.create || heldQuotes.length)) { void loadLobs(); void loadCarriers(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  useEffect(() => {
    if (!lobs) return;
    for (const lob of quoteLobs) {
      if (quoteGroups[lob]?.lobId) continue;
      const match = lob ? lobs.find(l => l.name.toLowerCase().includes(lob.toLowerCase())) : undefined;
      if (match) setGroup(lob, { lobId: match.lobId });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lobs]);

  /** Load an account: `existingOppId` attaches the quote to that opportunity,
   * `createOpp` forces one even when the review checkbox is off (the picker's
   * "create new" path). */
  const commit = async (accountId: string, accountName: string, opts?: { existingOppId?: string; createOpp?: boolean; created?: boolean }) => {
    setBusy(accountId); setError(null);
    try {
      const rows = await send<BatchItemResult[]>({
        type: "panel/appCommit",
        accountId,
        // identity is agent-reviewed; related contacts (contact2/contact3
        // entity slots) ride along and are find-or-created AFTER the account
        applicant: withServiceLicenses({ ...applicantFromIdentity(identity, insuredType === 2), coApplicants: coApplicantsFromCapture(app) }),
        insuredType
      });
      let createdOppId: string | null = null;
      const oppLobId = opp.lobId;
      if ((opp.create || opts?.createOpp) && oppLobId) {
        const lobName = lobs?.find(l => l.lobId === oppLobId)?.name ?? null;
        const name = opp.name.trim() || oppName(lobName);
        try {
          const stages = await send<PipelineStages | null>({ type: "panel/getStagesForLob", lobId: oppLobId, insuredType, lobName });
          const createdOpp = await send<OppSummary>({
            type: "panel/createOpportunity",
            accountId, lobId: oppLobId, name,
            pipelineId: stages?.pipelineId ?? null,
            stageId: stages?.stages[0]?.stageId ?? null,
            leadSource: leadSourceGuess(app),
            extra: crmGroup(app, "crm:opportunity") ?? undefined
          });
          createdOppId = createdOpp.opportunityId;
          rows.push({ key: `Opportunity: created "${name}"`, status: 204, error: null, entityId: null });
        } catch (e) {
          rows.push({ key: "Opportunity", status: 0, error: String((e as Error).message ?? e), entityId: null });
        }
      }
      const policyIds: string[] = [];
      const quoteIds: string[] = [];
      const quoteOppIds: string[] = [];
      if (policy.create) {
        for (const pr of policy.rows) {
          if (!pr.number.trim()) continue;
          try {
            const createdPolicy = await send<{ policyId: string }>({
              type: "panel/createPolicy",
              fields: {
                // policy name convention: the policy NUMBER, nothing else
                name: pr.number.trim(),
                policyNumber: pr.number.trim(),
                premium: parseMoney(pr.premium),
                effectiveDate: toIsoDate(pr.effective.trim() || null),
                expirationDate: toIsoDate(pr.expiration.trim() || null),
                accountId,
                carrierId: pr.carrierId,
                lobId: pr.lobId ?? opp.lobId,
                opportunityId: createdOppId,
                extra: pr.extra
              }
            });
            policyIds.push(createdPolicy.policyId);
            rows.push({ key: `Policy: created ${pr.number.trim()}${pr.extra ? "" : " (Active)"}`, status: 204, error: null, entityId: null });
          } catch (e) {
            rows.push({ key: `Policy ${pr.number.trim()}`, status: 0, error: String((e as Error).message ?? e), entityId: null });
          }
        }
      }
      if (target === "insured" && heldQuotes.length) {
        // one opportunity per line of business: the open one for that line
        // (re-captures update it) unless the agent asked for a new one
        try {
          const open = await send<OppSummary[]>({ type: "panel/getOpportunities", accountId });
          const groups: { lob: string; opportunityId: string; lobId: string | null; desiredEffectiveDate: string | null; created: boolean }[] = [];
          for (const lob of quoteLobs) {
            const g = quoteGroups[lob];
            const lobId = g?.lobId ?? null;
            const lobName = lobs?.find(l => l.lobId === lobId)?.name ?? lob;
            const hit = g?.mode !== "new" && lobId ? open.find(o => o.lobId === lobId) : undefined;
            if (hit) {
              groups.push({ lob, opportunityId: hit.opportunityId, lobId, desiredEffectiveDate: hit.desiredEffectiveDate?.slice(0, 10) ?? null, created: false });
              continue;
            }
            if (!lobId) continue;
            const stages = await send<PipelineStages | null>({ type: "panel/getStagesForLob", lobId, insuredType, lobName });
            const name = `${accountName || recordName} - ${lobName}`;
            const made = await send<OppSummary>({
              type: "panel/createOpportunity", accountId, lobId, name,
              pipelineId: stages?.pipelineId ?? null, stageId: stages?.stages[0]?.stageId ?? null,
              leadSource: leadSourceGuess(app), extra: crmGroup(app, "crm:opportunity") ?? undefined
            });
            rows.push({ key: `Opportunity: created "${name}"`, status: 204, error: null, entityId: null });
            groups.push({ lob, opportunityId: made.opportunityId, lobId, desiredEffectiveDate: null, created: true });
          }
          quoteOppIds.push(...groups.map(g => g.opportunityId));
          const written = await send<BatchItemResult[]>({
            type: "panel/writeQuotes",
            accountId, recordName,
            accountCreatedByPanel: Boolean(opts?.created),
            ownerId: owner?.userId ?? null, ownerName: owner?.fullName ?? null,
            groups
          });
          rows.push(...written);
          quoteIds.push(...written.filter(r => r.entityId && r.key.startsWith("Quote:")).map(r => r.entityId!));
        } catch (e) {
          rows.push({ key: "Quotes", status: 0, error: String((e as Error).message ?? e), entityId: null });
        }
      }
      // values tagged for an opportunity / quote / policy timeline land on the
      // records this load created (or the opportunity the quote attached to)
      const recordNotes: { record: "opportunity" | "quote" | "policy"; label: string; ids: string[] }[] = [
        { record: "opportunity", label: "Opportunity", ids: [...new Set([...(createdOppId ? [createdOppId] : []), ...quoteOppIds])] },
        { record: "quote", label: "Quote", ids: quoteIds },
        { record: "policy", label: "Policy", ids: policyIds }
      ];
      for (const rn of recordNotes) {
        const tl = buildTimelineNote(app, rn.record);
        if (!tl) continue;
        if (!rn.ids.length) {
          rows.push({ key: `Notes for ${rn.label}: no ${rn.label.toLowerCase()} in this load`, status: 0, error: "skipped", entityId: null });
          continue;
        }
        for (const id of rn.ids) {
          try {
            const outcome = await send<"created" | "updated" | "unchanged">({ type: "panel/upsertNote", record: rn.record, id, subject: tl.subject, html: tl.html });
            rows.push({ key: `Notes for ${rn.label}: ${noteOutcomeText(outcome)} (${tl.count} value${tl.count === 1 ? "" : "s"})`, status: 204, error: null, entityId: null });
          } catch (e) {
            rows.push({ key: `Notes for ${rn.label}`, status: 0, error: String((e as Error).message ?? e), entityId: null });
          }
        }
      }
      setResults(rows);
      setLoadedInto(accountName);
      setLoadedRecord({ etn: "account", id: accountId });
      onLoaded?.();
    } catch (e) { setError(asPanelError(e)); } finally { setBusy(null); }
  };

  const loadAccount = (accountId: string, accountName: string) => commit(accountId, accountName);

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
      await commit(created.accountId, created.name, { created: true });
    } catch (e) { setError(asPanelError(e)); setBusy(null); }
  };

  const createLead = async () => {
    setBusy("lead"); setError(null);
    try {
      const lobName = opp.lobId ? lobs?.find(l => l.lobId === opp.lobId)?.name ?? null : null;
      const created = await send<{ leadId: string; name: string }>({
        type: "panel/createLead",
        fields: {
          topic: `${oppName(lobName)} - ${recordName}`,
          name: insuredType === 2 ? identity.businessName || recordName : personName,
          firstName: identity.firstName || null, lastName: identity.lastName || null,
          street: identity.street || null, city: identity.city || null,
          state: identity.state || null, postalCode: identity.postalCode || null,
          phone: identity.phone || null, phoneIsMobile: identity.phoneIsMobile,
          email: identity.email || null,
          leadSource: leadSourceGuess(app)
        }
      });
      setResults([{ key: `Lead created: ${created.name} (source: ${leadSourceGuess(app)})`, status: 204, error: null, entityId: null },
        { key: "Risk-data logging requires an insured Account. Convert the lead to load it.", status: 204, error: null, entityId: null }]);
      setLoadedInto(created.name);
      setLoadedRecord({ etn: "lead", id: created.leadId });
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
        <div className={styles.row}>
          {loadedRecord && env && (
            <Button as="a" href={crmRecordUrl(env, loadedRecord.etn, loadedRecord.id)} target="_blank" appearance="primary">
              Open in CRM
            </Button>
          )}
          <Button onClick={() => { setResults(null); setStep("closed"); }}>Done</Button>
        </div>
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
    const identityEmpty = !personName && !identity.businessName;
    const missing: string[] = [];
    if (!recordName) missing.push("the insured's name (or business name)");
    if (opp.create && target === "insured" && !opp.lobId) missing.push("a line of business for the opportunity");
    if (policy.create && target === "insured" && policy.rows.some(r => !r.number.trim())) missing.push("a policy number on every policy row (or remove the empty row)");
    if (target === "insured" && heldQuotes.length) {
      if (quoteLobs.some(l => !quoteGroups[l]?.lobId)) missing.push("a CRM line of business for each group of quotes");
      if (!owner) missing.push("the servicing agent for the quotes");
    }
    return (
      <div className={styles.root}>
        <div className={styles.title}>Review before loading</div>
        {error && <ErrorBar error={error} />}
        {identityEmpty && (
          <div className={styles.warn}>
            This capture has no insured identity yet. It only holds page details.
            Open the Policyholder / Named Insured section (or the purchase
            confirmation) and hit <b>Ingest this page</b> there too; captures for
            the same client merge into one application.
          </div>
        )}
        {busy === "dupes" && <Spinner size="tiny" label="Checking CRM for this person…" />}
        {dupes && dupes.length > 0 && (
          <>
            <div className={styles.hint}>
              Already in CRM. Load into one of these instead of creating a duplicate:
            </div>
            {dupes.map(d => (
              <div key={`${d.kind}:${d.id}`} className={styles.match}>
                <span className={styles.matchText}>
                  <b>{d.kind === "lead" ? "Lead" : "Account"}</b>: {d.name}
                  {d.city ? `, ${d.city}` : ""}{d.postalCode ? ` ${d.postalCode}` : ""} ({MATCH_LABEL[d.matchedBy]})
                </span>
                {d.kind === "account" ? (
                  <span style={{ display: "flex", gap: "4px", flexShrink: 0 }}>
                    {env && <Button size="small" as="a" href={crmRecordUrl(env, "account", d.id)} target="_blank">Open</Button>}
                    <Button size="small" disabled={busy !== null} onClick={() => loadAccount(d.id, d.name)}>
                      {busy === d.id ? <Spinner size="tiny" /> : "Load"}
                    </Button>
                  </span>
                ) : (
                  env && <Button size="small" as="a" href={crmRecordUrl(env, "lead", d.id)} target="_blank">Open</Button>
                )}
              </div>
            ))}
          </>
        )}
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
        {!(target === "insured" && heldQuotes.length > 0) && (
          <Checkbox
            checked={opp.create}
            onChange={(_, d) => void toggleOpp(Boolean(d.checked))}
            label={target === "insured" ? "Create carrier opportunity" : "Name the lead after a carrier quote"}
          />
        )}
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
        {target === "insured" && heldQuotes.length > 0 && (
          <>
            <div className={styles.label}>Quotes: {heldQuotes.length} selected (choose on the Quotes tab)</div>
            {quoteLobs.map(lob => (
              <div key={lob || "none"} className={styles.row}>
                <span style={{ width: 64, flexShrink: 0, fontSize: 12 }}>
                  {lob || "Quote"} ({heldQuotes.filter(q => q.lob === lob).length})
                </span>
                <Dropdown
                  className={styles.grow}
                  style={{ minWidth: 0 }}
                  placeholder="CRM line of business"
                  value={lobs?.find(l => l.lobId === quoteGroups[lob]?.lobId)?.name ?? ""}
                  selectedOptions={quoteGroups[lob]?.lobId ? [quoteGroups[lob]!.lobId!] : []}
                  onOptionSelect={(_, d) => setGroup(lob, { lobId: d.optionValue ?? null })}
                >
                  {(lobs ?? []).map(l => <Option key={l.lobId} value={l.lobId}>{l.name}</Option>)}
                </Dropdown>
                <select
                  aria-label="Opportunity"
                  style={{ fontSize: 12 }}
                  value={quoteGroups[lob]?.mode ?? "reuse"}
                  onChange={e => setGroup(lob, { mode: e.target.value as "reuse" | "new" })}
                >
                  <option value="reuse">Open opportunity, else new</option>
                  <option value="new">New opportunity</option>
                </select>
              </div>
            ))}
            <Combobox
              placeholder="Servicing agent (record owner)"
              value={ownerQuery}
              onInput={e => void searchOwners((e.target as HTMLInputElement).value)}
              onOptionSelect={(_, d) => d.optionValue && void pickOwner(d.optionValue)}
            >
              {ownerOptions.map(u => (
                <Option key={u.userId} value={u.userId} text={u.fullName}>
                  {u.fullName}{u.email ? ` (${u.email})` : ""}
                </Option>
              ))}
            </Combobox>
          </>
        )}
        {target === "insured" && (
          <Checkbox
            checked={policy.create}
            onChange={(_, d) => void togglePolicy(Boolean(d.checked))}
            label="Create policy (sold, policy number captured)"
          />
        )}
        {target === "insured" && policy.create && (
          <>
            {policy.rows.map((pr, i) => (
              <div key={i} style={{ display: "flex", flexDirection: "column", gap: "6px", borderLeft: "2px solid #d0d0d0", paddingLeft: "8px" }}>
                <div className={styles.row}>
                  <Input className={styles.grow} value={pr.number} onChange={(_, d) => setPolicyRow(i, { number: d.value })} placeholder="Policy number" />
                  <Input style={{ width: 100 }} value={pr.premium} onChange={(_, d) => setPolicyRow(i, { premium: d.value })} placeholder="Premium $" />
                  {policy.rows.length > 1 && (
                    <Button size="small" onClick={() => setPolicy(p => ({ ...p, rows: p.rows.filter((_, j) => j !== i) }))}>✕</Button>
                  )}
                </div>
                <div className={styles.row}>
                  <Input className={styles.grow} value={pr.effective} onChange={(_, d) => setPolicyRow(i, { effective: d.value })} placeholder="Effective m/d/yyyy" />
                  <Input className={styles.grow} value={pr.expiration} onChange={(_, d) => setPolicyRow(i, { expiration: d.value })} placeholder="Expiration m/d/yyyy" />
                </div>
                <div className={styles.row}>
                  <Dropdown
                    className={styles.grow}
                    style={{ minWidth: 0 }}
                    placeholder="Carrier"
                    value={carriers?.find(c => c.carrierId === pr.carrierId)?.name ?? ""}
                    selectedOptions={pr.carrierId ? [pr.carrierId] : []}
                    onOptionSelect={(_, d) => setPolicyRow(i, { carrierId: d.optionValue ?? null })}
                  >
                    {(carriers ?? []).map(c => <Option key={c.carrierId} value={c.carrierId}>{c.name}</Option>)}
                  </Dropdown>
                  <Dropdown
                    className={styles.grow}
                    style={{ minWidth: 0 }}
                    placeholder="Line of business"
                    value={lobs?.find(l => l.lobId === pr.lobId)?.name ?? ""}
                    selectedOptions={pr.lobId ? [pr.lobId] : []}
                    onOptionSelect={(_, d) => setPolicyRow(i, { lobId: d.optionValue ?? null })}
                  >
                    {(lobs ?? []).map(l => <Option key={l.lobId} value={l.lobId}>{l.name}</Option>)}
                  </Dropdown>
                </div>
              </div>
            ))}
            <Button
              size="small"
              onClick={() => setPolicy(p => {
                const first = p.rows[0];
                return { ...p, rows: [...p.rows, { number: "", premium: "", effective: first?.effective ?? "", expiration: first?.expiration ?? "", carrierId: first?.carrierId ?? null, lobId: null }] };
              })}
            >
              + Add another policy (another line of business)
            </Button>
          </>
        )}
        {target === "lead" && policy.create && (
          <div className={styles.hint}>
            A policy number was captured. Policies attach to insured Accounts.
            Switch "Create as" to Insured to write the policy.
          </div>
        )}
        {missing.length > 0 && (
          <div className={styles.hint}>To continue, provide {missing.join("; ")}.</div>
        )}
        <div className={styles.row}>
          <Button appearance="primary" disabled={missing.length > 0} onClick={toTarget}>
            Continue
          </Button>
          <Button onClick={() => setStep("closed")}>Cancel</Button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.title}>{target === "insured" ? "Pick the insured account" : "Create the lead"}</div>
      {error && <ErrorBar error={error} onRetry={toTarget} />}
      {busy === "dupes" && <Spinner size="tiny" label="Checking for existing records…" />}
      {dupes && dupes.length > 0 && (
        <>
          <div className={styles.hint}>
            Existing records for this person. Load into one instead of creating a duplicate:
          </div>
          {dupes.map(d => (
            <div key={`${d.kind}:${d.id}`} className={styles.match}>
              <span className={styles.matchText}>
                <b>{d.kind === "lead" ? "Lead" : "Account"}</b>: {d.name}
                {d.city ? `, ${d.city}` : ""}{d.postalCode ? ` ${d.postalCode}` : ""} ({MATCH_LABEL[d.matchedBy]})
              </span>
              {d.kind === "account" ? (
                <span style={{ display: "flex", gap: "4px", flexShrink: 0 }}>
                  {env && <Button size="small" as="a" href={crmRecordUrl(env, "account", d.id)} target="_blank">Open</Button>}
                  <Button size="small" disabled={busy !== null} onClick={() => loadAccount(d.id, d.name)}>
                    {busy === d.id ? <Spinner size="tiny" /> : "Load"}
                  </Button>
                </span>
              ) : (
                env && <Button size="small" as="a" href={crmRecordUrl(env, "lead", d.id)} target="_blank">Open</Button>
              )}
            </div>
          ))}
        </>
      )}
      {dupes && dupes.length === 0 && <div className={styles.hint}>No existing account or lead matched by email, phone, or name.</div>}

      {target === "lead" && dupes && (
        <Button appearance="primary" disabled={busy !== null} onClick={createLead}>
          {busy === "lead" ? <Spinner size="tiny" /> : dupes.length ? "Create lead anyway" : "Create lead"}
        </Button>
      )}

      {target === "insured" && dupes && (
        <>
          <div className={styles.row}>
            <Input className={styles.grow} value={query} onChange={(_, d) => setQuery(d.value)}
              onKeyDown={e => { if (e.key === "Enter") void search(); }} placeholder="Search other accounts" />
            <Button disabled={busy !== null} onClick={search}>
              {busy === "search" ? <Spinner size="tiny" /> : "Search"}
            </Button>
          </div>
          {matches?.map(m => (
            <div key={m.accountId} className={styles.match}>
              <span className={styles.matchText}>
                {m.name}{m.city ? `, ${m.city}` : ""}{m.postalCode ? ` ${m.postalCode}` : ""}
              </span>
              <span style={{ display: "flex", gap: "4px", flexShrink: 0 }}>
                {env && <Button size="small" as="a" href={crmRecordUrl(env, "account", m.accountId)} target="_blank">Open</Button>}
                <Button size="small" disabled={busy !== null} onClick={() => loadAccount(m.accountId, m.name)}>
                  {busy === m.accountId ? <Spinner size="tiny" /> : "Load"}
                </Button>
              </span>
            </div>
          ))}
          {matches && matches.length === 0 && <div className={styles.hint}>No matching accounts.</div>}
          <Button disabled={busy !== null} onClick={createAndCommit}>
            {busy === "create" ? <Spinner size="tiny" /> : `Create "${query.trim() || recordName}"${dupes.length ? " anyway" : ""} and load`}
          </Button>
        </>
      )}
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
