import { useCallback, useEffect, useState } from "react";
import { Button } from "@fluentui/react-components";
import { send } from "./api";
import type { AuthStatus } from "@/messages";
import type { FieldCatalog } from "@/crm/fieldCatalog";
import { catalogUnavailableNote, isNotMemberRefusal, notMemberText } from "@/crm/catalogNote";
import { diagnosticNote, diagnosticText, requestCatalog, safeText } from "@/crm/catalogDiagnostics";

/** AB#3745: one place for the CRM field list's state in the panel: what was
 * read (or why not), which account and environment the extension is signed
 * in to, and the actions (Retry, Refresh CRM fields, Copy details, Sign out /
 * switch account). Used by both Mappings editors. Every failure is kept and
 * shown, never swallowed. */
export function useCrmCatalog() {
  const [catalog, setCatalog] = useState<FieldCatalog | null>(null);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  const loadAuth = useCallback(async () => {
    try {
      setAuth(await send<AuthStatus>({ type: "auth/status" }));
      setAuthError(null);
    } catch (e) {
      setAuth(null);
      setAuthError(safeText(String((e as { message?: unknown } | null)?.message ?? e)) || "unknown error");
    }
  }, []);

  const load = useCallback(async (refresh: boolean) => {
    setBusy(true);
    const r = await requestCatalog<FieldCatalog>(m => send<FieldCatalog>(m), refresh);
    setCatalog(r.catalog);
    setMessageError(r.messageError);
    setBusy(false);
    // the read may have just signed in (first CRM call of a session)
    await loadAuth();
  }, [loadAuth]);

  useEffect(() => { void load(false); }, [load]);

  const refusal = catalog?.diagnostics?.refusal;
  const notMember = Boolean(
    catalog?.unavailable?.kind === "notMember" ||
    (refusal && isNotMemberRefusal({ dvCode: refusal.code, dvMessage: refusal.message }))
  );
  const refusedAccount = catalog?.diagnostics?.account ?? (catalog?.unavailable as { upn?: string } | undefined)?.upn;
  const note = diagnosticNote(catalog, messageError, catalogUnavailableNote(catalog?.unavailable), busy);
  return { catalog, messageError, busy, auth, authError, load, loadAuth, note, notMember, refusedAccount };
}

export type CrmCatalogState = ReturnType<typeof useCrmCatalog>;

const buildVersion = (() => { try { return chrome.runtime.getManifest().version; } catch { return "unknown"; } })();

/** Account, environment, warning and actions for the CRM field list. */
export function CrmCatalogStatus({ state, noteClassName }: { state: CrmCatalogState; noteClassName?: string }) {
  const { catalog, messageError, busy, auth, authError, load, loadAuth, note, notMember, refusedAccount } = state;
  const [actionNote, setActionNote] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const copyDetails = async () => {
    try {
      await navigator.clipboard.writeText(diagnosticText(catalog, { buildVersion, messageError, loading: busy }));
      setActionNote("Copied.");
    } catch {
      setActionNote("Could not copy; select the text manually.");
    }
  };

  // sign out (forget the cached token), then sign in again with the account
  // picker so another account can be chosen; the field list is then re-read
  const switchAccount = async () => {
    setWorking(true);
    setActionNote(null);
    try {
      await send({ type: "auth/signOut" });
      await loadAuth();
      await send({ type: "auth/signIn" });
      setActionNote("Signed in again; re-reading the CRM fields.");
      await load(true);
    } catch (e) {
      setActionNote(`Sign-in did not finish: ${safeText(String((e as { message?: unknown } | null)?.message ?? e)) || "unknown error"}. You are signed out; use Sign in to try again.`);
      await loadAuth();
    } finally {
      setWorking(false);
    }
  };
  const signInOnly = async () => {
    setWorking(true);
    setActionNote(null);
    try {
      await send({ type: "auth/signIn" });
      await load(true);
    } catch (e) {
      setActionNote(`Sign-in did not finish: ${safeText(String((e as { message?: unknown } | null)?.message ?? e)) || "unknown error"}.`);
      await loadAuth();
    } finally {
      setWorking(false);
    }
  };

  const account = auth?.account ?? null;
  const env = auth?.envName ?? catalog?.diagnostics?.envName ?? null;
  const host = auth?.orgHost ?? catalog?.diagnostics?.orgHost ?? null;
  const disabled = busy || working;

  return (
    <div className={noteClassName} role="status">
      <div>
        {authError
          ? `Could not read the sign-in status: ${authError}`
          : auth
            ? <>Signed in as <b>{account ?? "nobody (not signed in)"}</b>{env ? <> to <b>{env}</b></> : null}{host ? ` (${host})` : null}</>
            : "Reading sign-in status…"}
      </div>
      {notMember && (
        <div role="alert" style={{ color: "#a4262c", fontWeight: 600, marginTop: 2 }}>
          {notMemberText(refusedAccount ?? account)}
        </div>
      )}
      <div style={{ marginTop: 2 }}>{note ?? "CRM field list read OK."}</div>
      <div style={{ marginTop: 2 }}>
        {note && <><Button size="small" appearance="secondary" disabled={disabled} onClick={() => void load(true)}>Retry</Button>{" "}</>}
        <Button size="small" appearance="secondary" disabled={disabled} onClick={() => void load(true)}>Refresh CRM fields</Button>{" "}
        <Button size="small" appearance={notMember ? "primary" : "subtle"} disabled={disabled} onClick={() => void switchAccount()}>Sign out / switch account</Button>{" "}
        {auth && !account && <><Button size="small" appearance="subtle" disabled={disabled} onClick={() => void signInOnly()}>Sign in</Button>{" "}</>}
        <Button size="small" appearance="subtle" disabled={busy} onClick={() => void copyDetails()}>Copy details</Button>
        {actionNote && <> {actionNote}</>}
      </div>
    </div>
  );
}
