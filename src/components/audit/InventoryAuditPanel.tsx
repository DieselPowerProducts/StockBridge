import { useEffect, useState } from "react";
import { getInventoryAudits } from "../../services/api";
import type { InventoryAuditItem } from "../../types";
import { Pagination } from "../products/Pagination";

type InventoryAuditPanelProps = {
  onOpenNotes: (sku: string) => void;
};

const pageSize = 50;

export function InventoryAuditPanel({
  onOpenNotes
}: InventoryAuditPanelProps) {
  const [items, setItems] = useState<InventoryAuditItem[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [totalItems, setTotalItems] = useState(0);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearchQuery(searchInput.trim());
      setCurrentPage(1);
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => {
    let ignore = false;

    async function loadAudits() {
      setIsLoading(true);
      setError("");

      try {
        const result = await getInventoryAudits({
          page: currentPage,
          limit: pageSize,
          search: searchQuery
        });

        if (ignore) {
          return;
        }

        if (currentPage > result.totalPages) {
          setCurrentPage(result.totalPages);
          return;
        }

        setItems(result.data);
        setTotalItems(result.total);
      } catch (loadError) {
        if (!ignore) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load inventory audits."
          );
        }
      } finally {
        if (!ignore) {
          setIsLoading(false);
        }
      }
    }

    void loadAudits();

    return () => {
      ignore = true;
    };
  }, [currentPage, refreshNonce, searchQuery]);

  return (
    <section
      className="inventory-audit-panel"
      aria-labelledby="inventoryAuditHeading"
    >
      <div className="price-audit-header">
        <div>
          <h2 id="inventoryAuditHeading">Inventory Audit</h2>
          <span>{totalItems} pending</span>
        </div>

        <div className="price-audit-toolbar">
          <input
            type="search"
            className="search-bar price-audit-search"
            value={searchInput}
            placeholder="Search SKU, vendor, or response..."
            aria-label="Search inventory audits"
            onChange={(event) => setSearchInput(event.target.value)}
          />
          <button
            type="button"
            className="price-audit-refresh"
            disabled={isLoading}
            onClick={() => setRefreshNonce((current) => current + 1)}
          >
            Refresh
          </button>
        </div>
      </div>

      {error && <p className="status-message error-message">{error}</p>}
      {isLoading && (
        <p className="status-message">Loading inventory audits...</p>
      )}

      <div className="price-audit-table-wrap">
        <table className="inventory-audit-table">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Vendor</th>
              <th>Response</th>
            </tr>
          </thead>
          <tbody>
            {!isLoading && items.length === 0 ? (
              <tr>
                <td colSpan={3}>No pending inventory audits.</td>
              </tr>
            ) : (
              items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <button
                      type="button"
                      className="sku-link"
                      onClick={() => onOpenNotes(item.sku)}
                    >
                      {item.sku}
                    </button>
                  </td>
                  <td>{item.vendorName || item.senderEmail}</td>
                  <td className="inventory-audit-response">
                    {item.responseText}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Pagination
        currentPage={currentPage}
        limit={pageSize}
        totalItems={totalItems}
        onPageChange={setCurrentPage}
      />
    </section>
  );
}
