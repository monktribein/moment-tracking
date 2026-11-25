import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarCheck, CalendarX, Clock, LogOut, RefreshCw, Search } from "lucide-react";
import { adminApi } from "../../api";
import { RoleBadge } from "../../components/badges";
import { Badge, Button, Empty, ErrorBox, PageHeader, Spinner, StatCard, Tabs } from "../../components/ui";
import { fmtDate, fmtDuration, fmtKm, fmtTime, place } from "../../format";
import { useAsync, useInterval } from "../../hooks";

type Show = "all" | "duty" | "out" | "absent";

export default function Attendance() {
  const navigate = useNavigate();
  const data = useAsync(() => Promise.all([adminApi.allStaff(), adminApi.attendanceSummary()]), []);
  useInterval(() => data.reload(true), 60_000);
  const [show, setShow] = useState<Show>("all");
  const [search, setSearch] = useState("");

  const rows = useMemo(() => {
    if (!data.data) return [];
    const [staff, attendance] = data.data;
    return staff
      .filter((s) => s.role === "field_agent" || s.role === "field_supervisor" || attendance.todayMap[s._id])
      .map((s) => {
        const today = attendance.todayMap[s._id] ?? null;
        const totals = attendance.summaryMap[s._id];
        const onDuty = Boolean(today?.checkedIn && !today?.checkedOut);
        const out = Boolean(today?.checkedOut);
        return { staff: s, today, totals, onDuty, out, absent: !today?.checkedIn };
      })
      .sort((a, b) => Number(b.onDuty) - Number(a.onDuty) || Number(b.out) - Number(a.out) || a.staff.name.localeCompare(b.staff.name));
  }, [data.data]);

  const counts = {
    all: rows.length,
    duty: rows.filter((r) => r.onDuty).length,
    out: rows.filter((r) => r.out).length,
    absent: rows.filter((r) => r.absent).length,
  };

  const shown = rows.filter((r) => {
    if (show === "duty" && !r.onDuty) return false;
    if (show === "out" && !r.out) return false;
    if (show === "absent" && !r.absent) return false;
    const q = search.trim().toLowerCase();
    return !q || [r.staff.name, r.staff.phone, r.staff.district, r.staff.employeeCode].some((v) => String(v ?? "").toLowerCase().includes(q));
  });

  return (
    <>
      <PageHeader
        title="Attendance"
        subtitle={`Today, ${fmtDate(new Date())}. Open someone to see their shifts and routes.`}
        actions={
          <Button icon={<RefreshCw size={16} />} onClick={() => data.reload(true)}>
            Refresh
          </Button>
        }
      />
      {data.error && !data.data ? (
        <ErrorBox error={data.error} onRetry={() => data.reload()} />
      ) : !data.data ? (
        <Spinner />
      ) : (
        <>
          <div className="stat-grid stat-grid-4">
            <StatCard label="Field team" value={counts.all} icon={<CalendarCheck size={20} />} onClick={() => setShow("all")} />
            <StatCard label="On duty now" value={counts.duty} tone="green" icon={<Clock size={20} />} onClick={() => setShow("duty")} />
            <StatCard label="Checked out" value={counts.out} tone="blue" icon={<LogOut size={20} />} onClick={() => setShow("out")} />
            <StatCard label="Not checked in" value={counts.absent} tone="amber" icon={<CalendarX size={20} />} onClick={() => setShow("absent")} />
          </div>
          <div className="card">
            <div className="toolbar">
              <Tabs<Show>
                value={show}
                onChange={setShow}
                items={[
                  { value: "all", label: "Everyone", count: counts.all },
                  { value: "duty", label: "On duty", count: counts.duty },
                  { value: "out", label: "Checked out", count: counts.out },
                  { value: "absent", label: "Not checked in", count: counts.absent },
                ]}
              />
              <div className="toolbar-right">
                <div className="search">
                  <Search size={16} />
                  <input placeholder="Search name, phone, district…" value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
              </div>
            </div>
            {!shown.length ? (
              <Empty title={rows.length ? "Nobody here" : "No field agents yet"}>{rows.length ? "Try another filter." : "Add field agents under Staff."}</Empty>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>District</th>
                      <th>Today</th>
                      <th>Check-in</th>
                      <th>Check-out</th>
                      <th className="num">Hours</th>
                      <th className="num">Distance</th>
                      <th className="num">Days present</th>
                      <th>Last present</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map(({ staff, today, totals, onDuty, out }) => (
                      <tr key={staff._id} className="clickable" onClick={() => navigate(`/tracking?agent=${staff._id}&tab=shifts`)}>
                        <td>
                          <div className="cell-title">{staff.name}</div>
                          <div className="cell-sub">
                            <RoleBadge role={staff.role} />
                          </div>
                        </td>
                        <td>{place(staff) || "—"}</td>
                        <td>{onDuty ? <Badge tone="green">On duty</Badge> : out ? <Badge tone="blue">Checked out</Badge> : <Badge tone="amber">Not checked in</Badge>}</td>
                        <td className="nowrap">{today?.checkInTime ? fmtTime(today.checkInTime) : "—"}</td>
                        <td className="nowrap">{today?.checkOutTime ? fmtTime(today.checkOutTime) : "—"}</td>
                        <td className="num">{today?.totalWorkingMinutes ? fmtDuration(today.totalWorkingMinutes) : "—"}</td>
                        <td className="num">{today?.distanceKm !== null && today?.distanceKm !== undefined ? fmtKm(today.distanceKm) : "—"}</td>
                        <td className="num">{totals?.daysPresent ?? 0}</td>
                        <td className="nowrap">{totals?.lastAttendanceDate ? fmtDate(totals.lastAttendanceDate) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
