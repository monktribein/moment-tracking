/** Shapes returned by the Movement Tracking API (only the fields the dashboard uses). */

export type StaffRole = "field_agent" | "field_supervisor" | "lead_executive" | "document_verifier";
export type StaffStatus = "active" | "suspended";
export type LeadStatus = "pending" | "approved" | "rejected" | "converted";
export type LeadInterest = "Interested" | "Not Interested" | "Follow-up Required";

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export interface AdminProfile {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  lastLoginAt: string | null;
  createdAt?: string;
}

export interface AdminSession {
  token: string;
  expiresIn: string;
  admin: AdminProfile;
}

/** A signed-in lead user (lead executive, supervisor…), from /lead-collection/auth. */
export interface StaffUser {
  id: string;
  name: string;
  phone: string;
  email: string;
  role: StaffRole;
  status: string;
  region: string;
  state: string;
  district: string;
  employeeCode?: string;
}

export interface StaffSession {
  token: string;
  expiresIn: string;
  user: StaffUser;
}

export interface TrackingConsent {
  granted: boolean;
  grantedAt: string | null;
  revokedAt: string | null;
  deviceLabel: string;
}

/** A lead user account as the admin API lists it. */
export interface Staff {
  _id: string;
  name: string;
  phone: string;
  email: string;
  role: StaffRole;
  status: StaffStatus;
  region: string;
  state: string;
  district: string;
  employeeCode: string;
  notes: string;
  lastLoginAt: string | null;
  createdByAdminName: string;
  createdAt?: string;
  trackingConsent?: TrackingConsent;
  leadCount?: number;
}

export interface Region {
  state: string;
  district: string;
  source: "builtin" | "custom";
}

export interface Lead {
  _id: string;
  name: string;
  location: {
    address: string;
    googleMapsUrl?: string;
    city: string;
    district: string;
    state: string;
    coordinates: { lat: number | null; lng: number | null };
  };
  roomInventory: {
    totalRooms: number | null;
    roomPrice: number | null;
    onlineRooms: number | null;
    offlineRooms: number | null;
  };
  contact: { ownerName: string; phone: string };
  notes: string;
  agentNotes?: string;
  interest: LeadInterest;
  meeting: { requested: boolean; time: string; mode: string };
  images: string[];
  status: LeadStatus;
  capturedBy: string | null;
  capturedByName: string;
  capturedAt: string;
  assignedAgentId?: string | null;
  assignedAgentName?: string;
  assignedAgentCode?: string;
  fieldVerified?: boolean;
  fieldVerifiedAt?: string | null;
  fieldVerifiedByName?: string;
  lastUpdatedByName?: string;
  lastUpdatedByRole?: string;
  reviewedByAdminName: string;
  reviewedAt: string | null;
  reviewNote: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface LeadStats {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  converted: number;
  interested: number;
  meetingsRequested: number;
  capturedLast7Days: number;
}

/** Body of POST / PUT on the lead routes. */
export interface SaveLead {
  name?: string;
  location?: {
    address?: string;
    googleMapsUrl?: string;
    city?: string;
    district?: string;
    state?: string;
    coordinates?: { lat?: number | null; lng?: number | null };
  };
  roomInventory?: {
    totalRooms?: number | null;
    roomPrice?: number | null;
    onlineRooms?: number | null;
    offlineRooms?: number | null;
  };
  contact?: { ownerName?: string; phone?: string };
  notes?: string;
  interest?: LeadInterest;
  meeting?: { requested?: boolean; time?: string; mode?: string };
  assignedAgentId?: string;
  status?: LeadStatus;
}

export interface Coords {
  lat: number | null;
  lng: number | null;
  accuracy?: number | null;
}

export interface AttendanceLog {
  _id: string;
  agentId: string;
  agentName: string;
  role: string;
  date: string;
  checkedIn: boolean;
  checkInTime: string | null;
  checkInCoords?: Coords;
  checkInAddress?: string;
  checkedOut: boolean;
  checkOutTime: string | null;
  checkOutCoords?: Coords;
  totalWorkingMinutes: number;
  status: string;
  notes?: string;
  distanceKm?: number | null;
}

export interface AttendanceSummary {
  summaryMap: Record<string, { daysPresent: number; totalHours: string; lastAttendanceDate: string }>;
  todayMap: Record<string, AttendanceLog>;
}

export interface AgentAttendance {
  summary?: { totalDistanceKm?: number; totalDaysPresent?: number; averageKmPerDay?: number };
  records: AttendanceLog[];
}

export interface LiveFix {
  agentId: string;
  agentName: string;
  lat: number;
  lng: number;
  recordedAt: string;
  minutesAgo: number;
}

export interface RoutePoint {
  lat: number;
  lng: number;
  recordedAt: string;
  accuracy?: number | null;
}

export interface TimelineLeg {
  kind: "move" | "stop" | "gap";
  km?: number;
  minutes?: number;
  startedAt: string;
  endedAt: string;
  from: { lat: number; lng: number };
  to: { lat: number; lng: number };
}

export interface TrackingDay {
  /** YYYY-MM-DD (the backend sends it; set by the dashboard for range views). */
  date?: string;
  totalKm: number;
  movingMinutes: number;
  idleMinutes: number;
  fixes: number;
  startedAt: string | null;
  endedAt: string | null;
  route: RoutePoint[];
  visited: { lat: number; lng: number; minutes: number; arrivedAt: string; leftAt: string }[];
  timeline: TimelineLeg[];
  latest?: (RoutePoint & { address?: string }) | null;
}

export interface TrackedDay {
  date: string;
  totalKm: number;
  firstAt: string;
  lastAt: string;
  fixes: number;
}

export interface ShiftPoint extends Coords {
  at: string;
  address?: string;
}

export interface ShiftRoute {
  date: string;
  onDuty: boolean;
  shiftMinutes: number;
  checkIn: ShiftPoint;
  checkOut: ShiftPoint | null;
  summary: TrackingDay;
}
