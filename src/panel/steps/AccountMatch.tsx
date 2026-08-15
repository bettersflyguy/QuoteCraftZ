import { useEffect, useState } from "react";
import { Button, Input, Spinner, Card, CardHeader, Text } from "@fluentui/react-components";
import { send, PanelError } from "../api";
import { ErrorBar } from "../ErrorBar";
import type { Action, ImportState } from "../state";
import { getActiveEnvironment } from "@/crm/environments";
import type { AccountMatch as AccountMatchRow } from "@/crm/dataverse";

export function AccountMatch({
  state,
  dispatch
}: {
  state: ImportState;
  dispatch: (a: Action) => void;
}) {
  const applicant = state.captured?.applicant ?? null;
  const [name, setName] = useState(applicant?.lastName ?? "");
  const [results, setResults] = useState<AccountMatchRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<PanelError | null>(null);
  const [orgHost, setOrgHost] = useState<string | null>(null);

  useEffect(() => {
    getActiveEnvironment().then(env => setOrgHost(new URL(env.orgUrl).host));
  }, []);

  async function search() {
    setLoading(true);
    setErr(null);
    try {
      const rows = await send<AccountMatchRow[]>({
        type: "panel/searchAccounts",
        name,
        postalCode: applicant?.address?.postalCode ?? null
      });
      setResults(rows);
    } catch (e) {
      setErr(e as PanelError);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (name) search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function createNew() {
    if (!orgHost) return;
    window.open(`https://${orgHost}/main.aspx?pagetype=entityrecord&etn=account`, "_blank");
  }

  return (
    <div>
      {applicant && (
        <Card style={{ marginBottom: 12 }}>
          <CardHeader
            header={
              <Text weight="semibold">
                {applicant.firstName} {applicant.lastName}
              </Text>
            }
            description={
              <Text size={200}>
                {applicant.address
                  ? `${applicant.address.street}, ${applicant.address.city}, ${applicant.address.state} ${applicant.address.postalCode}`
                  : "No address on file"}
                {applicant.dateOfBirth ? ` · DOB ${applicant.dateOfBirth}` : ""}
              </Text>
            }
          />
        </Card>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <Input
          value={name}
          onChange={(_, d) => setName(d.value)}
          placeholder="Account name"
          style={{ flex: 1 }}
        />
        <Button appearance="primary" onClick={search} disabled={loading}>
          Search
        </Button>
      </div>

      {err && (
        <div style={{ marginTop: 8 }}>
          <ErrorBar error={err} onRetry={search} />
        </div>
      )}
      {loading && <Spinner label="Searching…" style={{ marginTop: 12 }} />}

      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        {(results ?? []).map(a => (
          <Card
            key={a.accountId}
            style={{ cursor: "pointer" }}
            onClick={() => dispatch({ t: "account", id: a.accountId, name: a.name })}
          >
            <CardHeader
              header={<Text weight="semibold">{a.name}</Text>}
              description={
                <Text size={200}>
                  {a.city ?? "—"} {a.postalCode ?? ""} · {a.openOppCount} open opps
                </Text>
              }
            />
          </Card>
        ))}
        {results && results.length === 0 && <Text>No matching accounts.</Text>}
      </div>

      <div style={{ marginTop: 16 }}>
        <Button onClick={createNew} disabled={!orgHost}>
          Create new account…
        </Button>
      </div>
    </div>
  );
}
