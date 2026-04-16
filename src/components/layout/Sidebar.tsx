import { useState } from "react";
import type { PageName } from "../../types";

type SidebarProps = {
  currentPage: PageName;
  onNavigate: (page: PageName) => void;
};

const navItems: Array<{ page: PageName; label: string }> = [
  { page: "products", label: "Products" },
  { page: "import", label: "Import" },
  { page: "vendors", label: "Vendors" }
];

export function Sidebar({ currentPage, onNavigate }: SidebarProps) {
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
          <li>
            <button type="button" disabled>
              Logs
            </button>
          </li>
        </ul>
      </nav>
    </aside>
  );
}
