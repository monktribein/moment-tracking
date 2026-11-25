import { useMemo, useState, type FormEvent } from "react";
import { Map as MapIcon, Plus, Trash2 } from "lucide-react";
import { adminApi } from "../../api";
import { regionKey } from "../../components/LeadForm";
import { Badge, Button, Empty, ErrorBox, Field, PageHeader, Spinner, errorText, useFeedback } from "../../components/ui";
import { useAsync } from "../../hooks";
import type { Region } from "../../types";

export default function Regions() {
  const { toast, confirm } = useFeedback();
  const data = useAsync(() => Promise.all([adminApi.regions(), adminApi.allStaff()]), []);
  const [state, setState] = useState("");
  const [district, setDistrict] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  const [regions, staff] = data.data ?? [[], []];
  const staffCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of staff) counts.set(regionKey(s).toLowerCase(), (counts.get(regionKey(s).toLowerCase()) ?? 0) + 1);
    return counts;
  }, [staff]);
  const states = useMemo(() => [...new Set(regions.map((r) => r.state))].sort(), [regions]);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (state.trim().length < 2 || district.trim().length < 2) return setError("Enter both the state and the district.");
    setBusy("add");
    try {
      await adminApi.addRegion(state.trim(), district.trim());
      toast(`${district.trim()} added`);
      setDistrict("");
      data.reload(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (r: Region) => {
    if (!(await confirm({ title: `Remove ${r.district}?`, message: "Staff can no longer be placed in this district.", confirmLabel: "Remove", danger: true }))) return;
    setBusy(regionKey(r));
    try {
      await adminApi.removeRegion(r.state, r.district);
      toast(`${r.district} removed`);
      data.reload(true);
    } catch (err) {
      toast(errorText(err), "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader title="Regions" subtitle="The districts staff work in. Every account and every lead belongs to one district." />
      <div className="two-col two-col-wide-left">
        <section className="card">
          <div className="card-head">
            <h2>Districts</h2>
          </div>
          {data.error ? (
            <ErrorBox error={data.error} onRetry={() => data.reload()} />
          ) : data.loading && !data.data ? (
            <Spinner />
          ) : !regions.length ? (
            <Empty icon={<MapIcon size={28} />} title="No districts yet" />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>District</th>
                    <th>State</th>
                    <th className="num">Staff</th>
                    <th>Type</th>
                    <th className="actions-col">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {regions.map((r) => {
                    const count = staffCount.get(regionKey(r).toLowerCase()) ?? 0;
                    return (
                      <tr key={regionKey(r)}>
                        <td className="cell-title">{r.district}</td>
                        <td>{r.state}</td>
                        <td className="num">{count}</td>
                        <td>{r.source === "builtin" ? <Badge>Built in</Badge> : <Badge tone="blue">Added</Badge>}</td>
                        <td className="actions-col">
                          {r.source === "custom" && (
                            <button
                              type="button"
                              className="icon-btn danger-text"
                              title={count ? "Move its staff to another district first" : "Remove"}
                              aria-label={`Remove ${r.district}`}
                              disabled={busy === regionKey(r) || count > 0}
                              onClick={() => remove(r)}
                            >
                              <Trash2 size={16} />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Add a district</h2>
          </div>
          <form className="form" onSubmit={add}>
            <Field label="State">
              {(id) => (
                <>
                  <input id={id} list="state-list" value={state} onChange={(e) => setState(e.target.value)} placeholder="e.g. Uttar Pradesh" />
                  <datalist id="state-list">
                    {states.map((s) => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
                </>
              )}
            </Field>
            <Field label="District">
              {(id) => <input id={id} value={district} onChange={(e) => setDistrict(e.target.value)} placeholder="e.g. Agra" />}
            </Field>
            {error && <ErrorBox error={error} />}
            <Button type="submit" variant="primary" icon={<Plus size={16} />} busy={busy === "add"}>
              Add district
            </Button>
          </form>
        </section>
      </div>
    </>
  );
}
