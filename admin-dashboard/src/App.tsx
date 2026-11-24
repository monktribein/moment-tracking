import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import {
  CalendarCheck,
  ClipboardList,
  LayoutDashboard,
  Map as MapIcon,
  MapPin,
  UserCog,
  Users,
} from "lucide-react";
import { useAuth } from "./auth";
import { Layout, type NavItem } from "./components/Layout";
import { Spinner } from "./components/ui";
import { place, roleLabel } from "./format";
import Login from "./pages/Login";
import Overview from "./pages/admin/Overview";
import Leads from "./pages/admin/Leads";
import StaffPage from "./pages/admin/Staff";
import Attendance from "./pages/admin/Attendance";
import Regions from "./pages/admin/Regions";
import Account from "./pages/admin/Account";
import MyLeads from "./pages/staff/MyLeads";
import FieldAgents from "./pages/staff/FieldAgents";

// The map library loads only when Live tracking is opened.
const Tracking = lazy(() => import("./pages/admin/Tracking"));

const ADMIN_NAV: NavItem[] = [
  { to: "/", label: "Overview", icon: <LayoutDashboard size={18} />, end: true },
  { to: "/leads", label: "Leads", icon: <ClipboardList size={18} /> },
  { to: "/staff", label: "Staff", icon: <Users size={18} /> },
  { to: "/attendance", label: "Attendance", icon: <CalendarCheck size={18} /> },
  { to: "/tracking", label: "Live tracking", icon: <MapPin size={18} /> },
  { to: "/regions", label: "Regions", icon: <MapIcon size={18} /> },
  { to: "/account", label: "My account", icon: <UserCog size={18} /> },
];

const STAFF_NAV: NavItem[] = [
  { to: "/", label: "My leads", icon: <ClipboardList size={18} />, end: true },
  { to: "/agents", label: "Field agents", icon: <Users size={18} /> },
];

export default function App() {
  const { state } = useAuth();

  if (state.status === "loading")
    return (
      <div className="fullscreen-center">
        <Spinner label="Signing you in…" />
      </div>
    );

  if (state.status === "signedOut") return <Login message={state.message} />;

  if (state.status === "admin")
    return (
      <Layout nav={ADMIN_NAV} userName={state.admin.name || state.admin.email} userLine="Super Admin">
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/leads" element={<Leads />} />
          <Route path="/staff" element={<StaffPage />} />
          <Route path="/attendance" element={<Attendance />} />
          <Route path="/tracking" element={<Suspense fallback={<Spinner label="Loading map…" />}><Tracking /></Suspense>} />
          <Route path="/regions" element={<Regions />} />
          <Route path="/account" element={<Account />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    );

  const user = state.user;
  return (
    <Layout nav={STAFF_NAV} userName={user.name} userLine={`${roleLabel(user.role)} · ${place(user)}`}>
      <Routes>
        <Route path="/" element={<MyLeads user={user} />} />
        <Route path="/agents" element={<FieldAgents user={user} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
