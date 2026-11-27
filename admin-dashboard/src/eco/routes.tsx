import { lazy, type ComponentType, type ReactElement, type ReactNode } from "react";
import {
  BarChart3,
  CalendarCheck,
  CalendarDays,
  ClipboardList,
  CreditCard,
  FileClock,
  LayoutDashboard,
  ListChecks,
  Package,
  PhoneCall,
  Receipt,
  ScrollText,
  Store,
  Trophy,
  UserCog,
  Users,
  Wallet,
  Wrench,
} from "lucide-react";
import type { NavItem } from "../components/Layout";
import { can, type Viewer } from "./access";
import { REPORT_KINDS } from "./reportKinds";
// Pages load on first use, so the field-tracking screens and the portal stay small.
const page = <T,>(load: () => Promise<T>, name: keyof T) => lazy(() => load().then((m) => ({ default: m[name] as unknown as ComponentType })));
const EcoDashboard = page(() => import("../pages/admin/EcoDashboard"), "default");
const Employees = page(() => import("../pages/admin/Employees"), "default");
const Products = page(() => import("../pages/admin/Products"), "default");
const Distributors = page(() => import("../pages/admin/Distributors"), "default");
const DistributorDetail = page(() => import("../pages/admin/DistributorDetail"), "default");
const PurchaseRequests = page(() => import("../pages/admin/PurchaseRequests"), "default");
const PurchaseCreate = page(() => import("../pages/admin/PurchaseRequests"), "PurchaseCreate");
const PurchaseRequestDetail = page(() => import("../pages/admin/PurchaseRequestDetail"), "default");
const PaymentQueue = page(() => import("../pages/admin/PaymentQueue"), "default");
const AuditLogs = page(() => import("../pages/admin/AuditLogs"), "default");
const Visits = page(() => import("../pages/sales/Visits"), "default");
const VisitDetail = page(() => import("../pages/sales/VisitDetail"), "default");
const sales = () => import("../pages/sales/SalesWork");
const CallLogs = page(sales, "CallLogs");
const Followups = page(sales, "Followups");
const salesDash = () => import("../pages/sales/SalesDashboards");
const MyDistributors = page(salesDash, "MyDistributors");
const SalesManagerHome = page(salesDash, "SalesManagerHome");
const TeamPage = page(sales, "TeamPage");
const support = () => import("../pages/support/Support");
const ComplaintDetail = page(support, "ComplaintDetail");
const Complaints = page(support, "Complaints");
const SupportHome = page(() => import("../pages/support/SupportHome"), "SupportHome");
const hr = () => import("../pages/hr/Hr");
const Expenses = page(hr, "Expenses");
const HrAttendance = page(hr, "HrAttendance");
const HrHome = page(() => import("../pages/hr/HrHome"), "HrHome");
const Leaves = page(hr, "Leaves");
const Payroll = page(hr, "Payroll");
const Reports = page(() => import("../pages/reports/Reports"), "default");

export interface EcoRoute {
  path: string;
  element: ReactElement;
  /** Any one of these permissions opens the page (admin opens everything). */
  perms?: string[];
  /** Only these roles (admin always passes). */
  roles?: string[];
  nav?: { label: string; icon: ReactNode; section: string; end?: boolean };
}

const SECTION = { home: "Eco Sor", sales: "Sales", orders: "Orders & payments", service: "Service", hr: "HR", admin: "Administration" };

/** Every Eco Sor page with who may open it. The sidebar and the route guards are both built from this. */
export const ECO_ROUTES: EcoRoute[] = [
  { path: "/eco", element: <EcoDashboard />, roles: ["admin"], nav: { label: "Dashboard", icon: <LayoutDashboard size={18} />, section: SECTION.home } },
  { path: "/sales", element: <SalesManagerHome />, roles: ["sales_manager"], nav: { label: "Sales dashboard", icon: <LayoutDashboard size={18} />, section: SECTION.home, end: true } },
  { path: "/support", element: <SupportHome />, perms: ["complaints.assign"], nav: { label: "Service dashboard", icon: <LayoutDashboard size={18} />, section: SECTION.home } },
  { path: "/hr", element: <HrHome />, roles: ["hr"], nav: { label: "HR dashboard", icon: <LayoutDashboard size={18} />, section: SECTION.home, end: true } },

  { path: "/sales/my-distributors", element: <MyDistributors />, roles: ["tele_sales", "field_sales"], nav: { label: "My distributors", icon: <Store size={18} />, section: SECTION.sales } },
  { path: "/sales/visits", element: <Visits />, perms: ["visits.view"], nav: { label: "Visits", icon: <CalendarCheck size={18} />, section: SECTION.sales } },
  { path: "/sales/visits/:id", element: <VisitDetail />, perms: ["visits.view"] },
  { path: "/sales/followups", element: <Followups />, perms: ["followups.manage"], nav: { label: "Follow-ups", icon: <ListChecks size={18} />, section: SECTION.sales } },
  { path: "/sales/calls", element: <CallLogs />, perms: ["calls.log"], nav: { label: "Call log", icon: <PhoneCall size={18} />, section: SECTION.sales } },
  { path: "/sales/team", element: <TeamPage />, perms: ["visits.assign"], nav: { label: "Team performance", icon: <Trophy size={18} />, section: SECTION.sales } },
  { path: "/distributors", element: <Distributors />, perms: ["distributors.manage"], nav: { label: "Distributors", icon: <Store size={18} />, section: SECTION.sales } },
  { path: "/distributors/:id", element: <DistributorDetail />, perms: ["distributors.view", "distributors.manage"] },

  { path: "/purchase-requests", element: <PurchaseRequests />, perms: ["purchases.view"], nav: { label: "Purchase requests", icon: <ClipboardList size={18} />, section: SECTION.orders } },
  { path: "/purchase-requests/new", element: <PurchaseCreate />, perms: ["purchases.create"] },
  { path: "/purchase-requests/:id", element: <PurchaseRequestDetail />, perms: ["purchases.view"] },
  { path: "/payments", element: <PaymentQueue />, perms: ["payments.verify"], nav: { label: "Payment verification", icon: <CreditCard size={18} />, section: SECTION.orders } },
  { path: "/products", element: <Products />, perms: ["products.manage"], nav: { label: "Products", icon: <Package size={18} />, section: SECTION.orders } },

  { path: "/complaints", element: <Complaints />, perms: ["complaints.assign"], nav: { label: "Complaints", icon: <Wrench size={18} />, section: SECTION.service } },
  { path: "/complaints/:id", element: <ComplaintDetail />, perms: ["complaints.view"] },

  { path: "/hr/attendance", element: <HrAttendance />, perms: ["attendance.view"], nav: { label: "Attendance", icon: <CalendarDays size={18} />, section: SECTION.hr } },
  { path: "/hr/expenses", element: <Expenses />, perms: ["expenses.approve"], nav: { label: "Expenses", icon: <Receipt size={18} />, section: SECTION.hr } },
  { path: "/hr/leaves", element: <Leaves />, perms: ["leaves.approve", "holidays.manage"], nav: { label: "Leave & holidays", icon: <FileClock size={18} />, section: SECTION.hr } },
  { path: "/hr/payroll", element: <Payroll />, perms: ["payroll.manage"], nav: { label: "Payroll", icon: <Wallet size={18} />, section: SECTION.hr } },

  { path: "/employees", element: <Employees />, perms: ["employees.manage"], nav: { label: "Employees", icon: <Users size={18} />, section: SECTION.admin } },
  { path: "/reports/:kind", element: <Reports />, perms: ["reports.view"] },
  { path: "/audit-logs", element: <AuditLogs />, roles: ["admin"], nav: { label: "Audit log", icon: <ScrollText size={18} />, section: SECTION.admin } },
];

export const allowed = (v: Viewer, r: Pick<EcoRoute, "perms" | "roles">): boolean =>
  (!r.roles || v.role === "admin" || r.roles.includes(v.role)) && (!r.perms || can(v, ...r.perms));

/** Sidebar for this viewer: only pages they may open, grouped by section. */
export function ecoNav(v: Viewer, extra: NavItem[] = []): NavItem[] {
  const items: (NavItem & { group: string })[] = ECO_ROUTES.filter((r) => r.nav && allowed(v, r)).map((r) => ({ to: r.path, label: r.nav!.label, icon: r.nav!.icon, end: r.nav!.end, group: r.nav!.section }));
  const report = REPORT_KINDS.find((k) => v.role === "admin" || k.role === v.role);
  if (report && can(v, "reports.view")) {
    const at = items.findIndex((i) => i.group === SECTION.admin);
    items.splice(at < 0 ? items.length : at, 0, { to: `/reports/${report.kind}`, label: "Reports", icon: <BarChart3 size={18} />, group: SECTION.admin });
  }
  // Extra items keep the group of the last item that named one.
  let group = "Account";
  for (const e of extra) {
    if (e.section) group = e.section;
    items.push({ ...e, group });
  }
  let last = "";
  return items.map(({ group, ...i }) => {
    const out = { ...i, section: group !== last ? group : undefined };
    last = group;
    return out;
  });
}

export const ACCOUNT_ICON = <UserCog size={18} />;
