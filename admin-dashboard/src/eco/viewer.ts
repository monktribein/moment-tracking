import { useAuth } from "../auth";
import { SUPER_ADMIN_VIEWER, viewerFromEco, type Viewer } from "./access";

/** The signed-in person as the Eco Sor screens see them (a Super Admin acts as `admin`). */
export function useViewer(): Viewer {
  const { state } = useAuth();
  if (state.status === "eco") return viewerFromEco(state.user);
  if (state.status === "admin") return SUPER_ADMIN_VIEWER(state.admin.name || state.admin.email);
  return { role: "customer", permissions: [], name: "", employeeId: null, distributorId: null, isConsoleAdmin: false };
}
