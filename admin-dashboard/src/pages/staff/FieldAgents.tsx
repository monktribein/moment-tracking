import { useState } from "react";
import { Phone, Search, Users } from "lucide-react";
import { staffApi } from "../../api";
import { StaffStatusBadge } from "../../components/badges";
import { Empty, ErrorBox, PageHeader, Spinner } from "../../components/ui";
import { fmtDateTime } from "../../format";
import { useAsync } from "../../hooks";
import type { StaffUser } from "../../types";

export default function FieldAgents({ user }: { user: StaffUser }) {
  const agents = useAsync(() => staffApi.fieldAgents(), []);
  const [search, setSearch] = useState("");
  const q = search.trim().toLowerCase();
  const shown = (agents.data ?? []).filter(
    (a) => !q || [a.name, a.phone, a.employeeCode].some((v) => String(v ?? "").toLowerCase().includes(q)),
  );

  return (
    <>
      <PageHeader title="Field agents" subtitle={`The field agents of ${user.district}, who you can assign leads to.`} />
      <div className="card">
        <div className="toolbar">
          <div className="search">
            <Search size={16} />
            <input placeholder="Search name, phone, code…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        {agents.error ? (
          <ErrorBox error={agents.error} onRetry={() => agents.reload()} />
        ) : !agents.data ? (
          <Spinner />
        ) : !shown.length ? (
          <Empty icon={<Users size={28} />} title={agents.data.length ? "Nobody matches" : `No field agents in ${user.district} yet`}>
            {agents.data.length ? "Try another search." : "The Super Admin adds field agents under Staff."}
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Mobile</th>
                  <th className="num">Leads</th>
                  <th>Last sign-in</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((a) => (
                  <tr key={a._id}>
                    <td>
                      <div className="cell-title">{a.name}</div>
                      <div className="cell-sub">{a.employeeCode || "—"}</div>
                    </td>
                    <td>
                      <a href={`tel:${a.phone}`} className="inline-gap">
                        <Phone size={14} /> {a.phone}
                      </a>
                    </td>
                    <td className="num">{a.leadCount ?? 0}</td>
                    <td className="nowrap">{a.lastLoginAt ? fmtDateTime(a.lastLoginAt) : <span className="muted">Never</span>}</td>
                    <td>
                      <StaffStatusBadge status={a.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
