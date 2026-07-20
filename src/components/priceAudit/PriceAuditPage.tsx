import { useEffect, useState } from "react";
import {
  confirmPriceAudit,
  denyPriceAudit,
  getPriceAudits
} from "../../services/api";
import type { PriceAuditItem } from "../../types";
import { Pagination } from "../products/Pagination";

type PriceAuditPageProps = {
  onOpenNotes: (sku: string) => void;
};

const pageSize = 50;
type PriceAuditAction = "confirm" | "deny";

function formatPrice(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "Not set";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(value);
}

function getSafeSourceUrl(value: string) {
  try {
    const url = new URL(value);

    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

export function PriceAuditPage({ onOpenNotes }: PriceAuditPageProps) {
  const [items, setItems] = useState<PriceAuditItem[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [totalItems, setTotalItems] = useState(0);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({});
  const [actionsById, setActionsById] = useState<
    Record<string, PriceAuditAction>
  >({});
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

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
        const result = await getPriceAudits({
          page: currentPage,
          limit: pageSize,
          search: searchQuery
        });

        if (!ignore) {
          if (currentPage > result.totalPages) {
            setCurrentPage(result.totalPages);
            return;
          }

          setItems(result.data);
          setTotalItems(result.total);
          setPriceDrafts(
            Object.fromEntries(
              result.data.map((item) => [
                item.vendorProductId,
                String(item.newProductCost)
              ])
            )
          );
        }
      } catch (loadError) {
        if (!ignore) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load price audits."
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

  function startAction(vendorProductId: string, action: PriceAuditAction) {
    setActionsById((current) => ({
      ...current,
      [vendorProductId]: action
    }));
    setError("");
    setStatus("");
  }

  function finishAction(vendorProductId: string) {
    setActionsById((current) => {
      const next = { ...current };
      delete next[vendorProductId];
      return next;
    });
  }

  function removeAudit(item: PriceAuditItem) {
    setItems((current) =>
      current.filter(
        (currentItem) => currentItem.vendorProductId !== item.vendorProductId
      )
    );
    setPriceDrafts((current) => {
      const next = { ...current };
      delete next[item.vendorProductId];
      return next;
    });
    setTotalItems((current) => Math.max(0, current - 1));
    setRefreshNonce((current) => current + 1);
  }

  async function handleConfirm(item: PriceAuditItem) {
    const draft = String(priceDrafts[item.vendorProductId] ?? "").trim();
    const newProductCost = Number(draft);

    if (!draft || !Number.isFinite(newProductCost) || newProductCost < 0) {
      setError("Enter a new price of zero or greater before confirming.");
      return;
    }

    startAction(item.vendorProductId, "confirm");

    try {
      const result = await confirmPriceAudit(
        item.vendorProductId,
        newProductCost
      );
      removeAudit(item);
      setStatus(`${item.sku} was updated to ${formatPrice(result.currentPrice)}.`);
    } catch (confirmError) {
      setError(
        confirmError instanceof Error
          ? confirmError.message
          : "Unable to confirm this price."
      );
    } finally {
      finishAction(item.vendorProductId);
    }
  }

  async function handleDeny(item: PriceAuditItem) {
    startAction(item.vendorProductId, "deny");

    try {
      await denyPriceAudit(item.vendorProductId);
      removeAudit(item);
      setStatus(`${item.sku} price proposal was denied.`);
    } catch (denyError) {
      setError(
        denyError instanceof Error
          ? denyError.message
          : "Unable to deny this price."
      );
    } finally {
      finishAction(item.vendorProductId);
    }
  }

  return (
    <section className="page price-audit-page" aria-labelledby="priceAuditHeading">
      <div className="price-audit-header">
        <div>
          <h1 id="priceAuditHeading">Price Audit</h1>
          <span>{totalItems} pending</span>
        </div>

        <div className="price-audit-toolbar">
          <input
            type="search"
            className="search-bar price-audit-search"
            value={searchInput}
            placeholder="Search SKU or vendor..."
            aria-label="Search price audits"
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
      {status && <p className="status-message success-message">{status}</p>}
      {isLoading && <p className="status-message">Loading price audits...</p>}

      <div className="price-audit-table-wrap">
        <table className="price-audit-table">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Current Price</th>
              <th>New Price</th>
              <th>Source URL</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {!isLoading && items.length === 0 ? (
              <tr>
                <td colSpan={5}>No pending price audits.</td>
              </tr>
            ) : (
              items.map((item) => {
                const safeSourceUrl = getSafeSourceUrl(item.priceSourceUrl);
                const activeAction = actionsById[item.vendorProductId];
                const isProcessing = Boolean(activeAction);

                return (
                  <tr key={item.vendorProductId}>
                    <td>
                      <button
                        type="button"
                        className="sku-link"
                        onClick={() => onOpenNotes(item.sku)}
                      >
                        {item.sku}
                      </button>
                      <small className="price-audit-vendor">
                        {item.vendorName}
                        {item.vendorSku && item.vendorSku !== item.sku
                          ? ` | ${item.vendorSku}`
                          : ""}
                      </small>
                    </td>
                    <td>{formatPrice(item.currentPrice)}</td>
                    <td>
                      <div className="price-audit-price-input-wrap">
                        <span aria-hidden="true">$</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          inputMode="decimal"
                          className="price-audit-price-input"
                          value={priceDrafts[item.vendorProductId] ?? ""}
                          aria-label={`New price for ${item.sku}`}
                          disabled={isProcessing}
                          onChange={(event) =>
                            setPriceDrafts((current) => ({
                              ...current,
                              [item.vendorProductId]: event.target.value
                            }))
                          }
                        />
                      </div>
                    </td>
                    <td>
                      {safeSourceUrl ? (
                        <a
                          className="price-audit-source-link"
                          href={safeSourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          title={item.priceSourceUrl}
                        >
                          {item.priceSourceUrl}
                        </a>
                      ) : (
                        <span>{item.priceSourceUrl || "No source provided"}</span>
                      )}
                    </td>
                    <td className="price-audit-action-cell">
                      <div className="price-audit-row-actions">
                        <button
                          type="button"
                          className="price-audit-confirm"
                          disabled={isProcessing}
                          onClick={() => void handleConfirm(item)}
                        >
                          {activeAction === "confirm" ? "Updating..." : "Confirm"}
                        </button>
                        <button
                          type="button"
                          className="price-audit-deny"
                          disabled={isProcessing}
                          onClick={() => void handleDeny(item)}
                        >
                          {activeAction === "deny" ? "Denying..." : "Deny"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
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
