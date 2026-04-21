import { useState } from "react";
import type { AuthUser, PageName } from "../../types";

type SidebarProps = {
  currentPage: PageName;
  user: AuthUser;
  onNavigate: (page: PageName) => void;
  onLogout: () => void;
};

const navItems: Array<{ page: PageName; label: string }> = [
  { page: "products", label: "Products" },
  { page: "stock-check", label: "Stock Check" },
  { page: "vendors", label: "Vendors" }
];

export function Sidebar({
  currentPage,
  onNavigate,
  onLogout,
  user
}: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside className={`sidebar${collapsed ? " collapsed" : ""}`} id="sidebar">
      <button
        id="sidebarToggle"
        type="button"
        aria-label="Toggle sidebar"
        onClick={() => setCollapsed((value) => !value)}
      >
        Menu
      </button>

      <nav aria-label="Main navigation">
        <ul>
          {navItems.map((item) => (
            <li key={item.page}>
              <button
                type="button"
                className={currentPage === item.page ? "active-nav" : ""}
                onClick={() => onNavigate(item.page)}
              >
                {item.label}
              </button>
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
