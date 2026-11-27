/** Report areas and the role that owns each (admin sees all). */
export const REPORT_KINDS: { kind: "sales" | "purchases" | "service" | "hr"; label: string; role: string }[] = [
  { kind: "sales", label: "Sales", role: "sales_manager" },
  { kind: "purchases", label: "Purchases", role: "sales_manager" },
  { kind: "service", label: "Service", role: "support_manager" },
  { kind: "hr", label: "HR", role: "hr" },
];
