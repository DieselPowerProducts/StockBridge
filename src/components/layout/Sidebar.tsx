import { useState, type ReactNode } from "react";
import type { AuthUser, PageName } from "../../types";

type SidebarProps = {
  currentPage: PageName;
  user: AuthUser;
  onNavigate: (page: PageName) => void;
  onLogout: () => void;
  notifications: ReactNode;
};

const navItems: Array<{ page: PageName; label: string }> = [
  { page: "products", label: "Products" },
  { page: "stock-check", label: "Stock Check" },
  { page: "packing-lists", label: "Packing Lists" },
  { page: "vendors", label: "Vendors" },
  { page: "audit", label: "Audit" },
  { page: "sheet-imports", label: "Sheet Imports" }
];

export function Sidebar({
  currentPage,
  notifications,
  onNavigate,
  onLogout,
  user
}: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside className={`sidebar${collapsed ? " collapsed" : ""}`} id="sidebar">
      <div className="sidebar-controls">
        <button
          id="sidebarToggle"
          type="button"
          aria-label="Toggle sidebar"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((value) => !value)}
        >
          <span className="sidebar-toggle-icon" aria-hidden="true" />
        </button>
        {notifications}
      </div>

      <nav aria-label="Main navigation">
        <ul>
          {navItems.map((item) => (
            <li key={item.page}>
              <a
                href={`#/${item.page}`}
                className={currentPage === item.page ? "active-nav" : ""}
                aria-current={currentPage === item.page ? "page" : undefined}
                onClick={(event) => {
                  if (
                    event.defaultPrevented ||
                    event.button !== 0 ||
                    event.metaKey ||
                    event.ctrlKey ||
                    event.shiftKey ||
                    event.altKey
                  ) {
                    return;
                  }

                  event.preventDefault();
                  onNavigate(item.page);
                }}
              >
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="sidebar-user">
        {user.picture && (
          <img src={user.picture} alt="" className="sidebar-user-avatar" />
        )}
        <div className="sidebar-user-copy">
          <span>{user.name}</span>
          <small>{user.email}</small>
        </div>
        <button type="button" className="logout-button" onClick={onLogout}>
          Sign out
        </button>
      </div>
    </aside>
  );
}
