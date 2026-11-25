import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CheckCircle2, ClipboardList, Plus, RefreshCw, Search } from "lucide-react";
import { adminApi } from "../../api";
import { LeadStatusBadge } from "../../components/badges";
import { LeadDrawer } from "../../components/LeadDrawer";
import { LeadForm } from "../../components/LeadForm";
import { Badge, Button, Empty, ErrorBox, PageHeader, Pagination, Spinner, Tabs } from "../../components/ui";
import { fmtDate } from "../../format";
import { useAsync, useDebounced } from "../../hooks";
import type { Lead, LeadStatus } from "../../types";

const LIMIT = 20;
type StatusTab = "all" | LeadStatus;

export default function Leads() {
  const [params, setParams] = useSearchParams();
  const status = (params.get("status") as StatusTab) || "all";
  const [search, setSearch] = useState("");
  const [interest, setInterest] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const openId = params.get("lead");
  const term = useDebounced(search.trim(), 300);

  const setParam = (key: string, value: string | null) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: key === "lead" ? false : true },
    );

  const support = useAsync(() => Promise.all([adminApi.allStaff(), adminApi.regions()]), []);
  const stats = useAsync(() => adminApi.leadStats(), []);
  const list = useAsync(
    () =>
      adminApi.leads({
        status: status === "all" ? undefined : status,
        interest: interest || undefined,
        search: term || undefined,
        page,
        limit: LIMIT,
      }),
    [status, interest, term, page],
  );

  const [staff, regions] = support.data ?? [[], []];
  const s = stats.data;

  const refresh = () => {
    list.reload(true);
    stats.reload(true);
  };

  const changed = (lead: Lead | null) => {
    refresh();
    if (!lead) setParam("lead", null);
  };

  return (
    <>
      <PageHeader
        title="Leads"
        subtitle="Every property lead: review it, assign it to a field agent and follow it to conversion."
        actions={
          <>
            <Button icon={<RefreshCw size={16} />} onClick={refresh}>
              Refresh
            </Button>
            <Button variant="primary" icon={<Plus size={16} />} onClick={() => setCreating(true)} disabled={!support.data}>
              New lead
            </Button>
          </>
        }
      />

      <div className="card">
        <div className="toolbar">
          <Tabs<StatusTab>
            value={status}
            onChange={(v) => {
              setParam("status", v === "all" ? null : v);
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
                placeholder="Search name, owner, phone, city…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
            </div>
            <select
              value={interest}
              onChange={(e) => {
                setInterest(e.target.value);
                setPage(1);
              }}
              aria-label="Interest"
            >
              <option value="">Any interest</option>
              <option>Interested</option>
              <option>Follow-up Required</option>
              <option>Not Interested</option>
            </select>
          </div>
        </div>

        {list.error ? (
          <ErrorBox error={list.error} onRetry={() => list.reload()} />
        ) : list.loading && !list.data ? (
          <Spinner />
        ) : !list.data?.items.length ? (
          <Empty icon={<ClipboardList size={28} />} title={term || interest || status !== "all" ? "No leads match" : "No leads yet"}>
            {term || interest || status !== "all" ? "Try another filter." : "Add one with New lead, or wait for agents to send them from the app."}
          </Empty>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Property</th>
                    <th>Owner</th>
                    <th>Added by</th>
                    <th>Field agent</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.items.map((lead) => (
                    <tr key={lead._id} className="clickable" onClick={() => setParam("lead", lead._id)}>
                      <td>
                        <div className="cell-title">{lead.name}</div>
                        <div className="cell-sub">{[lead.location?.city, lead.location?.district].filter(Boolean).join(", ") || "—"}</div>
                      </td>
                      <td>
                        <div>{lead.contact?.ownerName || "—"}</div>
                        <div className="cell-sub">{lead.contact?.phone}</div>
                      </td>
                      <td>
                        <div>{lead.capturedByName || "—"}</div>
                        <div className="cell-sub">{fmtDate(lead.capturedAt ?? lead.createdAt)}</div>
                      </td>
                      <td>
                        {lead.assignedAgentName ? (
                          <span className="inline-gap">
                            {lead.assignedAgentName}
                            {lead.fieldVerified && <CheckCircle2 size={15} className="text-green" aria-label="Visited" />}
                          </span>
                        ) : (
                          <Badge>Unassigned</Badge>
                        )}
                      </td>
                      <td>
                        <LeadStatusBadge status={lead.status} />
                      </td>
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
          mode="admin"
          regions={regions}
          fieldAgents={staff}
          onClose={() => setCreating(false)}
          onSaved={(lead) => {
            setCreating(false);
            refresh();
            setParam("lead", lead._id);
          }}
        />
      )}

      {openId && (
        <LeadDrawer
          mode="admin"
          leadId={openId}
          fieldAgents={staff}
          regions={regions}
          onClose={() => setParam("lead", null)}
          onChanged={changed}
        />
      )}
    </>
  );
}
