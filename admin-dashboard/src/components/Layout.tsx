import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Bell, CalendarDays, LogOut, Menu, Phone, X } from "lucide-react";
import { useAuth } from "../auth";
import { requestPage, apiRequest } from "../api";
import { useInterval } from "../hooks";

export interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  end?: boolean;
  /** Starts a titled group in the sidebar (e.g. "Sales"). */
  section?: string;
}

/** Support line shown in the sidebar's "Need help?" card (VITE_SUPPORT_PHONE); hidden when not set. */
const SUPPORT_PHONE = String(import.meta.env.VITE_SUPPORT_PHONE ?? "").trim();

interface Note {
  id: string;
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string;
}

/** Bell with the unread count and the latest notifications (Eco Sor sessions only). */
function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<Note[]>([]);
  const box = useRef<HTMLDivElement>(null);
  const load = () =>
    requestPage<Note>("/v1/notifications", { query: { limit: 6 } })
      .then((r) => {
        setItems(r.items);
        setUnread(Number(r.unread) || 0);
      })
      .catch(() => undefined);
  useEffect(() => void load(), []);
  useInterval(load, 60_000);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div className="bell" ref={box}>
      <button type="button" className="icon-btn bell-btn" onClick={() => setOpen((v) => !v)} aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}>
        <Bell size={20} />
        {unread > 0 && <span className="bell-count">{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && (
        <div className="bell-menu" role="dialog" aria-label="Notifications">
          <div className="bell-head">
            <strong>Notifications</strong>
            {unread > 0 && (
              <button type="button" className="link-button" onClick={() => apiRequest("/v1/notifications/read-all", { method: "POST", body: {} }).then(load)}>
                Mark all read
              </button>
            )}
          </div>
          {!items.length ? (
            <p className="muted small" style={{ padding: "8px 12px" }}>Nothing yet.</p>
          ) : (
            <ul>
              {items.map((n) => (
                <li key={n.id} className={n.isRead ? "" : "unread"}>
                  <div className="cell-title">{n.title}</div>
                  {n.body && <div className="cell-sub">{n.body}</div>}
                  <div className="cell-sub">{new Date(n.createdAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useInterval(() => setNow(new Date()), 30_000);
  return (
    <div className="topbar-clock">
      <CalendarDays size={20} />
      <div>
        <div>{now.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</div>
        <div className="muted">{now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })}</div>
      </div>
    </div>
  );
}

export function Layout({
  nav,
  userName,
  userLine,
  children,
  notifications,
}: {
  nav: NavItem[];
  userName: string;
  userLine: string;
  children: ReactNode;
  /** Show the notification bell (Eco Sor sessions). */
  notifications?: boolean;
}) {
  const { signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();

  // Close the mobile menu after navigating.
  useEffect(() => setOpen(false), [location.pathname]);

  const initials = userName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

  return (
    <div className={`shell${open ? " menu-open" : ""}`}>
      <aside className="sidebar">
        <div className="brand">
          <span className="eco-wordmark" aria-label="Eco Sor">
            <span className="eco-bolt" aria-hidden="true">⚡</span>ECO <span className="eco-accent">SOR</span>
          </span>
          <button type="button" className="icon-btn menu-close" onClick={() => setOpen(false)} aria-label="Close menu">
            <X size={18} />
          </button>
        </div>
        <nav className="nav">
          {nav.map((item) => (
            <div key={item.to} className="nav-entry">
              {item.section && <div className="nav-section">{item.section}</div>}
              <NavLink to={item.to} end={item.end} className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}>
                {item.icon}
                <span>{item.label}</span>
              </NavLink>
            </div>
          ))}
        </nav>
        {SUPPORT_PHONE && (
          <a className="help-card" href={`tel:${SUPPORT_PHONE.replace(/\s/g, "")}`}>
            <span className="help-icon"><Phone size={16} /></span>
            <span>
              <b>Need help?</b>
              <span>{SUPPORT_PHONE}</span>
            </span>
          </a>
        )}
        <div className="sidebar-user">
          <span className="avatar">{initials || "?"}</span>
          <div className="sidebar-user-text">
            <div className="sidebar-user-name">{userName}</div>
            <div className="sidebar-user-line">{userLine}</div>
          </div>
        </div>
      </aside>
      <div className="scrim" onClick={() => setOpen(false)} />
      <div className="main">
        <header className="topbar">
          <button type="button" className="icon-btn menu-open-btn" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu size={20} />
          </button>
          <span className="avatar topbar-avatar">{initials || "?"}</span>
          <div className="topbar-welcome">
            <div className="topbar-title">Welcome, {userName}</div>
            <div className="muted">{userLine}</div>
          </div>
          <span className="spacer" />
          {notifications && <NotificationBell />}
          <Clock />
          <button type="button" className="btn btn-primary logout-btn" onClick={() => signOut()}>
            <LogOut size={16} /> <span>Logout</span>
          </button>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
