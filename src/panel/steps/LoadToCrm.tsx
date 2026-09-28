import { useEffect, useState } from "react";
import { Button, Checkbox, Dropdown, Input, Option, Radio, RadioGroup, Spinner, makeStyles, tokens } from "@fluentui/react-components";
import { send, PanelError } from "../api";
import { ErrorBar } from "../ErrorBar";
import type { CapturedApplication } from "@/messages";
import type { AccountMatch, BatchItemResult, CarrierRow, ExistingMatch, LobRow, OppSummary, PipelineStages } from "@/crm/dataverse";
import { getActiveEnvironment, crmRecordUrl, type CrmEnvironment } from "@/crm/environments";
import { applicantFromIdentity, carrierGuess, identityFromCapture, leadSourceGuess, parseMoney, policyFromCapture, quoteFromCapture, toIsoDate, type CaptureIdentity } from "@/crm/appCommit";

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
interface PolicyState { create: boolean; number: string; premium: string; effective: string; expiration: string; carrierId: string | null; lobId: string | null }
interface QuoteState { create: boolean; premium: string; carrierId: string | null; lobId: string | null }
interface PendingOpp { accountId: string; accountName: string; opps: OppSummary[] }

/** Loads the held captured application into the active CRM environment.
 * Step 1 reviews and EDITS the identity (captured data is a starting point,
 * not gospel), picks Insured-vs-Lead and Personal/Commercial. Step 2 targets
 * the record (account search/create, or lead create) and optionally creates
 * the carrier opportunity. Worker runs enrichment + risk-data logging. */
const MATCH_LABEL = { email: "email match", phone: "phone match", name: "name match" } as const;

export function LoadToCrm({ app, onFlowActive }: { app: CapturedApplication; onFlowActive?: (active: boolean) => void }) {
  const styles = useStyles();
  const [step, setStep] = useState<"closed" | "review" | "target">("closed");
  const [identity, setIdentity] = useState<CaptureIdentity>(() => identityFromCapture(app));
  const [target, setTarget] = useState<"insured" | "lead">("insured");
  const [insuredType, setInsuredType] = useState<1 | 2>(() => identityFromCapture(app).businessName ? 2 : 1);
  const [opp, setOpp] = useState<OppState>({ create: false, lobId: null, name: "", nameEdited: false });
  // A captured policy number means the ingest happened on a SALE screen —
  // policy creation offers itself pre-checked with the captured terms.
  const [policy, setPolicy] = useState<PolicyState>(() => {
    const d = policyFromCapture(app);
    return { create: d.hasPolicy, number: d.number, premium: d.premiumText, effective: d.effectiveDate, expiration: d.expirationDate, carrierId: null, lobId: null };
  });
  // A quoted premium with NO policy number = a rating-portal quote — offer
  // writing it as an iacrm_quote on a picked-or-created opportunity.
  const [quote, setQuote] = useState<QuoteState>(() => {
    const d = quoteFromCapture(app);
    return { create: d.hasQuote, premium: d.premiumText, carrierId: null, lobId: null };
  });
  const [pendingOpp, setPendingOpp] = useState<PendingOpp | null>(null);
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

  const asPanelError = (e: unknown) =>
    e instanceof PanelError ? e : new PanelError("unknown", String((e as Error).message ?? e));
  const set = (patch: Partial<CaptureIdentity>) => setIdentity(prev => ({ ...prev, ...patch }));

  const personName = `${identity.firstName} ${identity.lastName}`.trim();
  const recordName = (insuredType === 2 && identity.businessName ? identity.businessName : personName) || identity.businessName;
  const oppName = (lobName: string | null) =>
    `${carrierGuess(app)}${lobName ? ` ${lobName}` : ""} Quote`;

  const openReview = () => { setStep("review"); setError(null); };

  useEffect(() => { getActiveEnvironment().then(setEnv).catch(() => {}); }, []);

  // pin the panel's mode while this flow is open or a write is in flight —
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
        setPolicy(p => (p.carrierId ? p : { ...p, carrierId: hit.carrierId }));
        setQuote(q => (q.carrierId ? q : { ...q, carrierId: hit.carrierId }));
      }
    } catch { setCarriers([]); }
  };

  const togglePolicy = async (create: boolean) => {
    setPolicy(p => ({ ...p, create }));
    if (create) { await loadLobs(); await loadCarriers(); }
  };

  const toggleQuote = async (create: boolean) => {
    setQuote(q => ({ ...q, create }));
    if (create) { await loadLobs(); await loadCarriers(); }
  };

  // sale/quote captures arrive with the checkboxes pre-checked: hydrate dropdowns
  useEffect(() => {
    if (step === "review" && (policy.create || quote.create)) { void loadLobs(); void loadCarriers(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  /** Load an account: `existingOppId` attaches the quote to that opportunity,
   * `createOpp` forces one even when the review checkbox is off (the picker's
   * "create new" path). */
  const commit = async (accountId: string, accountName: string, opts?: { existingOppId?: string; createOpp?: boolean }) => {
    setBusy(accountId); setError(null);
    try {
      const rows = await send<BatchItemResult[]>({
        type: "panel/appCommit",
        accountId,
        applicant: applicantFromIdentity(identity, insuredType === 2),
        insuredType
      });
      let createdOppId: string | null = null;
      const oppLobId = opp.lobId ?? quote.lobId;
      if ((opp.create || opts?.createOpp) && oppLobId) {
        const lobName = lobs?.find(l => l.lobId === oppLobId)?.name ?? null;
        const name = opp.name.trim() || oppName(lobName);
        try {
          const stages = await send<PipelineStages | null>({ type: "panel/getStagesForLob", lobId: oppLobId });
          const createdOpp = await send<OppSummary>({
            type: "panel/createOpportunity",
            accountId, lobId: oppLobId, name,
            pipelineId: stages?.pipelineId ?? null,
            stageId: stages?.stages[0]?.stageId ?? null
          });
          createdOppId = createdOpp.opportunityId;
          rows.push({ key: `Opportunity — created "${name}"`, status: 204, error: null, entityId: null });
        } catch (e) {
          rows.push({ key: "Opportunity", status: 0, error: String((e as Error).message ?? e), entityId: null });
        }
      }
      const quoteOppId = createdOppId ?? opts?.existingOppId ?? null;
      if (policy.create && policy.number.trim()) {
        try {
          const carrierName = carriers?.find(c => c.carrierId === policy.carrierId)?.name ?? carrierGuess(app);
          const lobName = lobs?.find(l => l.lobId === (policy.lobId ?? opp.lobId))?.name ?? null;
          await send<{ policyId: string }>({
            type: "panel/createPolicy",
            fields: {
              name: `${carrierName}${lobName ? ` ${lobName}` : ""} — ${policy.number.trim()}`,
              policyNumber: policy.number.trim(),
              premium: parseMoney(policy.premium),
              effectiveDate: toIsoDate(policy.effective.trim() || null),
              expirationDate: toIsoDate(policy.expiration.trim() || null),
              accountId,
              carrierId: policy.carrierId,
              lobId: policy.lobId ?? opp.lobId,
              opportunityId: createdOppId
            }
          });
          rows.push({ key: `Policy — created ${policy.number.trim()} (Active)`, status: 204, error: null, entityId: null });
        } catch (e) {
          rows.push({ key: "Policy", status: 0, error: String((e as Error).message ?? e), entityId: null });
        }
      }
      if (quote.create && quoteOppId) {
        try {
          const draft = quoteFromCapture(app);
          const carrierName = carriers?.find(c => c.carrierId === quote.carrierId)?.name ?? carrierGuess(app);
          await send({
            type: "panel/createQuote",
            fields: {
              accountId,
              opportunityId: quoteOppId,
              carrierId: quote.carrierId,
              lobId: quote.lobId ?? opp.lobId,
              name: `${carrierName} — ${recordName}`,
              premium: parseMoney(quote.premium),
              coverageSummary: draft.coverageSummary,
              effectiveDate: toIsoDate(draft.effectiveDate.trim() || null),
              sourceUrl: app.source.url
            }
          });
          rows.push({ key: `Quote — ${carrierName} ${quote.premium || ""} on the opportunity (re-captures update it)`, status: 204, error: null, entityId: null });
        } catch (e) {
          rows.push({ key: "Quote", status: 0, error: String((e as Error).message ?? e), entityId: null });
        }
      }
      setResults(rows);
      setLoadedInto(accountName);
      setPendingOpp(null);
    } catch (e) { setError(asPanelError(e)); } finally { setBusy(null); }
  };

  /** When a quote needs an opportunity and none is being created up front,
   * picking an account opens this: choose an open opportunity or create one. */
  const pickOpportunity = async (accountId: string, accountName: string) => {
    setBusy(accountId); setError(null);
    try {
      const opps = await send<OppSummary[]>({ type: "panel/getOpportunities", accountId });
      setPendingOpp({ accountId, accountName, opps });
    } catch (e) { setError(asPanelError(e)); } finally { setBusy(null); }
  };

  const needsOppPick = quote.create && !opp.create;
  const loadAccount = (accountId: string, accountName: string) =>
    needsOppPick ? pickOpportunity(accountId, accountName) : commit(accountId, accountName);

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
      // a brand-new account has no opportunities: create one for the quote
      await commit(created.accountId, created.name, needsOppPick ? { createOpp: true } : undefined);
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
          email: identity.email || null,
          leadSource: leadSourceGuess(app)
        }
      });
      setResults([{ key: `Lead created — ${created.name} (source: ${leadSourceGuess(app)})`, status: 204, error: null, entityId: null },
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
        <div className={styles.row}>
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
    if (policy.create && target === "insured" && !policy.number.trim()) missing.push("the policy number (or uncheck Create policy)");
    if (quote.create && target === "insured" && !quote.premium.trim()) missing.push("the quoted premium (or uncheck Create quote)");
    if (quote.create && target === "insured" && !quote.lobId && !opp.lobId) missing.push("a line of business for the quote's opportunity");
    return (
      <div className={styles.root}>
        <div className={styles.title}>Review before loading — edit anything that's wrong</div>
        {error && <ErrorBar error={error} />}
        {identityEmpty && (
          <div className={styles.warn}>
            This capture has no insured identity yet — it only holds page details.
            Open the Policyholder / Named Insured section (or the purchase
            confirmation) and hit <b>Ingest this page</b> there too; captures for
            the same client merge into one application.
          </div>
        )}
        {busy === "dupes" && <Spinner size="tiny" label="Checking CRM for this person…" />}
        {dupes && dupes.length > 0 && (
          <>
            <div className={styles.hint}>
              Already in CRM — load into one of these instead of creating a duplicate:
            </div>
            {dupes.map(d => (
              <div key={`${d.kind}:${d.id}`} className={styles.match}>
                <span className={styles.matchText}>
                  <b>{d.kind === "lead" ? "Lead" : "Account"}</b> — {d.name}
                  {d.city ? `, ${d.city}` : ""}{d.postalCode ? ` ${d.postalCode}` : ""} ({MATCH_LABEL[d.matchedBy]})
                </span>
                {d.kind === "account" ? (
                  <Button size="small" disabled={busy !== null} onClick={() => loadAccount(d.id, d.name)}>
                    {busy === d.id ? <Spinner size="tiny" /> : "Load"}
                  </Button>
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
        {target === "insured" && (
          <Checkbox
            checked={quote.create}
            onChange={(_, d) => void toggleQuote(Boolean(d.checked))}
            label="Create quote on an opportunity (premium captured)"
          />
        )}
        {target === "insured" && quote.create && (
          <>
            <div className={styles.row}>
              <Input style={{ width: 120 }} value={quote.premium} onChange={(_, d) => setQuote(q => ({ ...q, premium: d.value }))} placeholder="Premium $" />
              <Dropdown
                className={styles.grow}
                style={{ minWidth: 0 }}
                placeholder="Carrier"
                value={carriers?.find(c => c.carrierId === quote.carrierId)?.name ?? ""}
                selectedOptions={quote.carrierId ? [quote.carrierId] : []}
                onOptionSelect={(_, d) => setQuote(q => ({ ...q, carrierId: d.optionValue ?? null }))}
              >
                {(carriers ?? []).map(c => <Option key={c.carrierId} value={c.carrierId}>{c.name}</Option>)}
              </Dropdown>
            </div>
            <Dropdown
              placeholder="Line of business (for a new opportunity)"
              value={lobs?.find(l => l.lobId === quote.lobId)?.name ?? ""}
              selectedOptions={quote.lobId ? [quote.lobId] : []}
              onOptionSelect={(_, d) => setQuote(q => ({ ...q, lobId: d.optionValue ?? null }))}
            >
              {(lobs ?? []).map(l => <Option key={l.lobId} value={l.lobId}>{l.name}</Option>)}
            </Dropdown>
            <div className={styles.hint}>
              After you pick the insured, you'll choose which opportunity the
              quote attaches to — or create one.
            </div>
          </>
        )}
        {target === "insured" && (
          <Checkbox
            checked={policy.create}
            onChange={(_, d) => void togglePolicy(Boolean(d.checked))}
            label="Create policy (sold — policy number captured)"
          />
        )}
        {target === "insured" && policy.create && (
          <>
            <div className={styles.row}>
              <Input className={styles.grow} value={policy.number} onChange={(_, d) => setPolicy(p => ({ ...p, number: d.value }))} placeholder="Policy number" />
              <Input style={{ width: 110 }} value={policy.premium} onChange={(_, d) => setPolicy(p => ({ ...p, premium: d.value }))} placeholder="Premium $" />
            </div>
            <div className={styles.row}>
              <Input className={styles.grow} value={policy.effective} onChange={(_, d) => setPolicy(p => ({ ...p, effective: d.value }))} placeholder="Effective m/d/yyyy" />
              <Input className={styles.grow} value={policy.expiration} onChange={(_, d) => setPolicy(p => ({ ...p, expiration: d.value }))} placeholder="Expiration m/d/yyyy" />
            </div>
            <Dropdown
              placeholder="Carrier"
              value={carriers?.find(c => c.carrierId === policy.carrierId)?.name ?? ""}
              selectedOptions={policy.carrierId ? [policy.carrierId] : []}
              onOptionSelect={(_, d) => setPolicy(p => ({ ...p, carrierId: d.optionValue ?? null }))}
            >
              {(carriers ?? []).map(c => <Option key={c.carrierId} value={c.carrierId}>{c.name}</Option>)}
            </Dropdown>
            <Dropdown
              placeholder={opp.create && opp.lobId ? `Line of business (${lobs?.find(l => l.lobId === opp.lobId)?.name ?? "from opportunity"})` : "Line of business"}
              value={lobs?.find(l => l.lobId === policy.lobId)?.name ?? ""}
              selectedOptions={policy.lobId ? [policy.lobId] : []}
              onOptionSelect={(_, d) => setPolicy(p => ({ ...p, lobId: d.optionValue ?? null }))}
            >
              {(lobs ?? []).map(l => <Option key={l.lobId} value={l.lobId}>{l.name}</Option>)}
            </Dropdown>
          </>
        )}
        {target === "lead" && policy.create && (
          <div className={styles.hint}>
            A policy number was captured — policies attach to insured Accounts.
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

  if (pendingOpp) {
    return (
      <div className={styles.root}>
        <div className={styles.title}>Attach the quote — {pendingOpp.accountName}</div>
        {error && <ErrorBar error={error} />}
        {pendingOpp.opps.map(o => (
          <div key={o.opportunityId} className={styles.match}>
            <span className={styles.matchText}>{o.name}{o.lobName ? ` — ${o.lobName}` : ""}</span>
            <Button size="small" disabled={busy !== null} onClick={() => commit(pendingOpp.accountId, pendingOpp.accountName, { existingOppId: o.opportunityId })}>
              {busy === pendingOpp.accountId ? <Spinner size="tiny" /> : "Use"}
            </Button>
          </div>
        ))}
        {pendingOpp.opps.length === 0 && <div className={styles.hint}>No open opportunities on this account.</div>}
        <Button appearance="primary" disabled={busy !== null} onClick={() => commit(pendingOpp.accountId, pendingOpp.accountName, { createOpp: true })}>
          {busy === pendingOpp.accountId ? <Spinner size="tiny" /> : `Create "${oppName(lobs?.find(l => l.lobId === (opp.lobId ?? quote.lobId))?.name ?? null)}" and attach`}
        </Button>
        <div className={styles.row}>
          <Button onClick={() => setPendingOpp(null)}>Back</Button>
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
            Existing records for this person — load into one instead of creating a duplicate:
          </div>
          {dupes.map(d => (
            <div key={`${d.kind}:${d.id}`} className={styles.match}>
              <span className={styles.matchText}>
                <b>{d.kind === "lead" ? "Lead" : "Account"}</b> — {d.name}
                {d.city ? `, ${d.city}` : ""}{d.postalCode ? ` ${d.postalCode}` : ""} ({MATCH_LABEL[d.matchedBy]})
              </span>
              {d.kind === "account" ? (
                <Button size="small" disabled={busy !== null} onClick={() => loadAccount(d.id, d.name)}>
                  {busy === d.id ? <Spinner size="tiny" /> : "Load"}
                </Button>
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
                {m.name}{m.city ? ` — ${m.city}` : ""}{m.postalCode ? ` ${m.postalCode}` : ""}
              </span>
              <Button size="small" disabled={busy !== null} onClick={() => loadAccount(m.accountId, m.name)}>
                {busy === m.accountId ? <Spinner size="tiny" /> : "Load"}
              </Button>
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
