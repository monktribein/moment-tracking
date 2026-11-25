import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { LogOut, Menu, X } from "lucide-react";
import { useAuth } from "../auth";

export interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  end?: boolean;
}

export function Layout({
  nav,
  userName,
  userLine,
  children,
}: {
  nav: NavItem[];
  userName: string;
  userLine: string;
  children: ReactNode;
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
          <img src="/favicon.svg" alt="" width={32} height={32} />
          <div>
            <div className="brand-name">Movement Tracking</div>
            <div className="brand-sub">Dashboard</div>
          </div>
          <button type="button" className="icon-btn menu-close" onClick={() => setOpen(false)} aria-label="Close menu">
            <X size={18} />
          </button>
        </div>
        <nav className="nav">
          {nav.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}>
              {item.icon}
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-user">
          <span className="avatar">{initials || "?"}</span>
          <div className="sidebar-user-text">
            <div className="sidebar-user-name">{userName}</div>
            <div className="sidebar-user-line">{userLine}</div>
          </div>
          <button type="button" className="icon-btn" onClick={() => signOut()} title="Sign out" aria-label="Sign out">
            <LogOut size={18} />
          </button>
        </div>
      </aside>
      <div className="scrim" onClick={() => setOpen(false)} />
      <div className="main">
        <div className="topbar">
          <button type="button" className="icon-btn" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu size={20} />
          </button>
          <span className="topbar-title">Movement Tracking</span>
        </div>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
