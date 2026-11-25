import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CheckCircle2, ClipboardList, Clock, Plus, RefreshCw, Search, Sparkles, UserPlus } from "lucide-react";
import { staffApi } from "../../api";
import { LeadStatusBadge } from "../../components/badges";
import { LeadDrawer } from "../../components/LeadDrawer";
import { LeadForm } from "../../components/LeadForm";
import { Badge, Button, Empty, ErrorBox, PageHeader, Pagination, Spinner, StatCard, Tabs } from "../../components/ui";
import { fmtDate, place, roleLabel } from "../../format";
import { useAsync, useDebounced } from "../../hooks";
import type { Lead, LeadStatus, StaffUser } from "../../types";

const LIMIT = 20;
type StatusTab = "all" | LeadStatus;

export default function MyLeads({ user }: { user: StaffUser }) {
  const [params, setParams] = useSearchParams();
  const openId = params.get("lead");
  const [status, setStatus] = useState<StatusTab>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const term = useDebounced(search.trim(), 300);
  const area = { state: user.state, district: user.district };
  const isSupervisor = user.role === "field_supervisor";

  const open = (id: string | null) =>
    setParams((p) => {
      const next = new URLSearchParams(p);
      if (id) next.set("lead", id);
      else next.delete("lead");
      return next;
    });

  const agents = useAsync(() => staffApi.fieldAgents(), []);
  const stats = useAsync(() => staffApi.stats(), []);
  const list = useAsync(
    () => staffApi.leads({ status: status === "all" ? undefined : status, search: term || undefined, page, limit: LIMIT }),
    [status, term, page],
  );
  const activeAgents = (agents.data ?? []).filter((a) => a.status === "active").length;

  const refresh = () => {
    list.reload(true);
    stats.reload(true);
    agents.reload(true);
  };

  const s = stats.data;

  return (
    <>
      <PageHeader
        title={isSupervisor ? "Leads" : "My leads"}
        subtitle={
          <>
            {roleLabel(user.role)} · {place(user)}.{" "}
            {isSupervisor ? "Leads of your district: assign them to your field agents." : "Add property leads and assign each one to a field agent of your district."}
          </>
        }
        actions={
          <>
            <Button icon={<RefreshCw size={16} />} onClick={refresh}>
              Refresh
            </Button>
            <Button variant="primary" icon={<Plus size={16} />} onClick={() => setCreating(true)}>
              New lead
            </Button>
          </>
        }
      />

      <div className="stat-grid stat-grid-4">
        <StatCard label={isSupervisor ? "Leads" : "Leads added"} value={s?.total ?? "—"} icon={<ClipboardList size={20} />} hint={s ? `${s.capturedLast7Days} in the last 7 days` : undefined} />
        <StatCard label="Pending review" value={s?.pending ?? "—"} tone="amber" icon={<Clock size={20} />} />
        <StatCard label="Approved" value={s?.approved ?? "—"} tone="green" icon={<CheckCircle2 size={20} />} />
        <StatCard label="Converted" value={s?.converted ?? "—"} tone="violet" icon={<Sparkles size={20} />} />
      </div>

      {agents.data && activeAgents === 0 && (
        <div className="notice">
          <UserPlus size={18} />
          <span>
            There are no active field agents in {user.district} yet, so leads cannot be assigned. Ask the Super Admin to add field agents for your district.
          </span>
        </div>
      )}

      <div className="card">
        <div className="toolbar">
          <Tabs<StatusTab>
            value={status}
            onChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
            items={[
              { value: "all", label: "All", count: s?.total },
              { value: "pending", label: "Pending", count: s?.pending },
              { value: "approved", label: "Approved", count: s?.approved },
              { value: "converted", label: "Converted", count: s?.converted },
              { value: "rejected", label: "Rejected", count: s?.rejected },
            ]}
          />
          <div className="toolbar-right">
            <div className="search">
              <Search size={16} />
              <input
                placeholder="Search name, owner, phone…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
            </div>
          </div>
        </div>

        {list.error ? (
          <ErrorBox error={list.error} onRetry={() => list.reload()} />
        ) : list.loading && !list.data ? (
          <Spinner />
        ) : !list.data?.items.length ? (
          <Empty icon={<ClipboardList size={28} />} title={term || status !== "all" ? "No leads match" : "No leads yet"}>
            {term || status !== "all" ? (
              "Try another filter."
            ) : (
              <>
                Add your first lead with <strong>New lead</strong> and pick the field agent who should visit it.
              </>
            )}
          </Empty>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Property</th>
                    <th>Owner</th>
                    <th>Field agent</th>
                    <th>Visit</th>
                    <th>Status</th>
                    <th>Added</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.items.map((lead: Lead) => (
                    <tr key={lead._id} className="clickable" onClick={() => open(lead._id)}>
                      <td>
                        <div className="cell-title">{lead.name}</div>
                        <div className="cell-sub">{lead.location?.city || lead.location?.address || "—"}</div>
                      </td>
                      <td>
                        <div>{lead.contact?.ownerName || "—"}</div>
                        <div className="cell-sub">{lead.contact?.phone}</div>
                      </td>
                      <td>{lead.assignedAgentName ? lead.assignedAgentName : <Badge tone="amber">Not assigned</Badge>}</td>
                      <td>
                        {!lead.assignedAgentName ? (
                          <span className="muted">—</span>
                        ) : lead.fieldVerified ? (
                          <span className="inline-gap text-green">
                            <CheckCircle2 size={15} /> Visited
                          </span>
                        ) : (
                          <span className="muted">Pending</span>
                        )}
                      </td>
                      <td>
                        <LeadStatusBadge status={lead.status} />
                      </td>
                      <td className="nowrap">{fmtDate(lead.capturedAt ?? lead.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} limit={LIMIT} total={list.data.total} onPage={setPage} />
          </>
        )}
      </div>

      {creating && (
        <LeadForm
          mode="staff"
          fieldAgents={agents.data ?? []}
          fixedArea={area}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            setStatus("all");
            setPage(1);
            refresh();
          }}
        />
      )}

      {openId && (
        <LeadDrawer
          mode="staff"
          leadId={openId}
          fieldAgents={agents.data ?? []}
          fixedArea={area}
          onClose={() => open(null)}
          onChanged={() => refresh()}
        />
      )}
    </>
  );
}
