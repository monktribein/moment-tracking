import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import {
  Building2,
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
import Companies from "./pages/platform/Companies";
import { ForgotPassword, ResetPassword } from "./pages/PasswordReset";
import EcoAccount from "./pages/EcoAccount";
import Portal from "./pages/portal/Portal";
import { ACCOUNT_ICON, ECO_ROUTES, allowed, ecoNav } from "./eco/routes";
import { ROLE_NAMES, SUPER_ADMIN_VIEWER, homeFor, viewerFromEco, type Viewer } from "./eco/access";
import { NoAccess } from "./eco/ui";

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

/** The platform owner: companies and their Super Admins only, no company's data. */
const PLATFORM_NAV: NavItem[] = [
  { to: "/", label: "Companies", icon: <Building2 size={18} />, end: true },
  { to: "/account", label: "My account", icon: <UserCog size={18} /> },
];

const STAFF_NAV: NavItem[] = [
  { to: "/", label: "My leads", icon: <ClipboardList size={18} />, end: true },
  { to: "/agents", label: "Field agents", icon: <Users size={18} /> },
];

/** Every Eco Sor route; pages the viewer may not open show "no access" instead. */
const ecoRoutes = (viewer: Viewer) =>
  ECO_ROUTES.map((r) => (
    <Route key={r.path} path={r.path} element={allowed(viewer, r) ? <Suspense fallback={<Spinner />}>{r.element}</Suspense> : <NoAccess />} />
  ));

export default function App() {
  const { state } = useAuth();

  if (state.status === "loading")
    return (
      <div className="fullscreen-center">
        <Spinner label="Signing you in…" />
      </div>
    );

  if (state.status === "signedOut")
    return (
      <Routes>
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="*" element={<Login message={state.message} />} />
      </Routes>
    );

  if (state.status === "eco" && state.user.role === "distributor") return <Portal user={state.user} />;

  if (state.status === "eco") {
    const user = state.user;
    const viewer = viewerFromEco(user);
    const home = homeFor(user.role);
    return (
      <Layout notifications nav={ecoNav(viewer, [{ to: "/my-account", label: "My account", icon: ACCOUNT_ICON, section: "Account" }])} userName={user.name} userLine={`${ROLE_NAMES[user.role]}${user.company ? ` · ${user.company.name}` : ""}`}>
        <Routes>
          {ecoRoutes(viewer)}
          <Route path="/my-account" element={<EcoAccount user={user} />} />
          <Route path="/" element={<Navigate to={home} replace />} />
          <Route path="*" element={<Navigate to={home} replace />} />
        </Routes>
      </Layout>
    );
  }

  if (state.status === "admin" && state.admin.role === "platform_owner")
    return (
      <Layout nav={PLATFORM_NAV} userName={state.admin.name || state.admin.email} userLine="Platform Owner">
        <Routes>
          <Route path="/" element={<Companies />} />
          <Route path="/account" element={<Account />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    );

  if (state.status === "admin")
    return (
      <Layout
        notifications
        // The company Super Admin runs both: Eco Sor operations and the existing field tracking pages.
        nav={ecoNav(SUPER_ADMIN_VIEWER(state.admin.name), ADMIN_NAV.map((n, i) => ({ ...n, section: n.to === "/account" ? "Account" : i === 0 ? "Field tracking" : undefined })))}
        userName={state.admin.name || state.admin.email}
        userLine={state.admin.company ? `Super Admin · ${state.admin.company.name}` : "Super Admin"}
      >
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/leads" element={<Leads />} />
          <Route path="/staff" element={<StaffPage />} />
          <Route path="/attendance" element={<Attendance />} />
          <Route path="/tracking" element={<Suspense fallback={<Spinner label="Loading map…" />}><Tracking /></Suspense>} />
          <Route path="/regions" element={<Regions />} />
          <Route path="/account" element={<Account />} />
          {ecoRoutes(SUPER_ADMIN_VIEWER(state.admin.name))}
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
