# Pre-release E2E checklist

Manual walk, run before every release (spec: one e2e, manual, not CI). Run it in
Chrome AND Edge - the pinned extension ID makes the same `dist/` valid in both.

Prereqs: an EZLynx login with at least one completed Auto or Home rate run; a
Dataverse account with a security role in the target environment (DEV:
`agentcrmdev.crm.dynamics.com`).

| # | Step | Expected |
|---|---|---|
| 1 | `npm run build`; load `dist/` unpacked | Extension ID is `nppecoclmgfkccogikgalbgpkimljhch` in both browsers |
| 2 | Sign into EZLynx; open an applicant with a completed rate | - |
| 3 | Open the side panel | Header shows active env badge (**DEV**, green); runs list shows the applicant's rate runs newest-first, one row per run |
| 4 | Pick the run | Capture succeeds; account step shows applicant name/address/DOB summary |
| 5 | Search accounts | Matching Account ranked first when postal code matches; open-opp counts shown; "Create new account…" is a button, never automatic |
| 6 | Pin the Auto block to an Opportunity, explicitly skip Home | Continue enables only after every block has a pin-or-skip decision |
| 7 | Carrier map | Previously mapped carriers preselected from aliases; unmapped rows warn "will import without carrier link" |
| 8 | Review | One row per quote (requested + alternates); coverage text matches EZLynx's screen verbatim; errored-carriers notice shows count + messages |
| 9 | Commit | Button reads "Write N quotes to **DEV**"; all rows report success |
| 10 | In the CRM: Opportunity → Quotes (Quick Compare) | Rows present; COVERAGE cell text matches EZLynx; premium/term/carrier correct; quote link opens the EZLynx result; premium status = Estimated |
| 11 | Re-commit the same run unchanged | Row count in CRM unchanged (upsert, not duplicate) |
| 12 | In the CRM set one imported quote's premium status to Firm; re-commit | That quote stays **Firm** |
| 13 | Options → add a second environment, set it active | Panel badge changes color/name; pinned CRM selections cleared; captured run survives |
| 14 | Switch back to DEV | Prior token reused - no interactive sign-in inside the same browser session |
| 15 | Worker devtools → `chrome.storage.session.clear()` → retry a CRM call | Panel drops to sign-in button; after sign-in (account picker appears), the captured run is still present |
| 16 | EZLynx: sign out, then try to capture | Panel shows "EZLynx session expired" warning, not a crash |

Any FAIL blocks release. Record date, browser, and failures at the bottom of this
file per run.

## Run log

| Date | Browser | Result | Notes |
|---|---|---|---|
