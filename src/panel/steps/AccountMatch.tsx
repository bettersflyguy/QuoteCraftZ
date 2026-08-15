import { useEffect, useState } from "react";
import { Button, Input, Spinner, Card, CardHeader, Text, Field } from "@fluentui/react-components";
import { send, PanelError } from "../api";
import { ErrorBar } from "../ErrorBar";
import type { Action, ImportState } from "../state";
import type { AccountMatch as AccountMatchRow, NewAccountFields } from "@/crm/dataverse";

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
  // inline create-new-insured form, prefilled from the captured applicant.
  // Still an explicit act (spec: never automatic) - just without leaving the panel.
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const co = applicant?.coApplicants[0] ?? null;
  const [form, setForm] = useState<NewAccountFields>({
    name: applicant
      ? `${applicant.firstName} ${applicant.lastName}${co ? ` & ${co.firstName} ${co.lastName}` : ""}`
      : "",
    street: applicant?.address?.street ?? null,
    city: applicant?.address?.city ?? null,
    state: applicant?.address?.state ?? null,
    postalCode: applicant?.address?.postalCode ?? null,
    phone: applicant?.phones[0] ?? null,
    email: applicant?.emails[0] ?? null
  });

  async function createInsured() {
    setSaving(true);
    setErr(null);
    try {
      const created = await send<{ accountId: string; name: string }>({
        type: "panel/createAccount",
        fields: form
      });
      dispatch({ t: "account", id: created.accountId, name: created.name });
    } catch (e) {
      setErr(e as PanelError);
    } finally {
      setSaving(false);
    }
  }

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
        {!creating ? (
          <Button onClick={() => setCreating(true)}>Create new insured…</Button>
        ) : (
          <Card>
            <CardHeader header={<Text weight="semibold">New insured (from EZLynx applicant)</Text>} />
            <Field label="Account name" required>
              <Input value={form.name} onChange={(_, d) => setForm(f => ({ ...f, name: d.value }))} />
            </Field>
            <Field label="Street">
              <Input value={form.street ?? ""} onChange={(_, d) => setForm(f => ({ ...f, street: d.value || null }))} />
            </Field>
            <div style={{ display: "flex", gap: 8 }}>
              <Field label="City" style={{ flex: 2 }}>
                <Input value={form.city ?? ""} onChange={(_, d) => setForm(f => ({ ...f, city: d.value || null }))} />
              </Field>
              <Field label="State" style={{ flex: 1 }}>
                <Input value={form.state ?? ""} onChange={(_, d) => setForm(f => ({ ...f, state: d.value || null }))} />
              </Field>
              <Field label="ZIP" style={{ flex: 1 }}>
                <Input value={form.postalCode ?? ""} onChange={(_, d) => setForm(f => ({ ...f, postalCode: d.value || null }))} />
              </Field>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <Field label="Phone" style={{ flex: 1 }}>
                <Input value={form.phone ?? ""} onChange={(_, d) => setForm(f => ({ ...f, phone: d.value || null }))} />
              </Field>
              <Field label="Email" style={{ flex: 1 }}>
                <Input value={form.email ?? ""} onChange={(_, d) => setForm(f => ({ ...f, email: d.value || null }))} />
              </Field>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <Button appearance="primary" disabled={saving || !form.name.trim()} onClick={createInsured}>
                {saving ? <Spinner size="tiny" /> : "Create insured"}
              </Button>
              <Button disabled={saving} onClick={() => setCreating(false)}>Cancel</Button>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
