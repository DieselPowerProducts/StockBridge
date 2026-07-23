import { Fragment, useEffect, useMemo, useState } from "react";
import {
  confirmPriceAudit,
  denyPriceAudit,
  getPriceAudits
} from "../../services/api";
import type { PriceAuditItem } from "../../types";
import { Pagination } from "../products/Pagination";

type PriceAuditPageProps = {
  embedded?: boolean;
  onOpenNotes: (sku: string) => void;
};

const pageSize = 50;
type PriceAuditAction = "confirm" | "deny";
type PriceAuditGroup = {
  sku: string;
  items: PriceAuditItem[];
};

function groupPriceAudits(items: PriceAuditItem[]) {
  const groups = new Map<string, PriceAuditGroup>();

  for (const item of items) {
    const key = item.sku.trim().toUpperCase();
    const group = groups.get(key);

    if (group) {
      group.items.push(item);
      continue;
    }

    groups.set(key, { sku: item.sku, items: [item] });
  }

  return Array.from(groups.values());
}

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

export function PriceAuditPage({
  embedded = false,
  onOpenNotes
}: PriceAuditPageProps) {
  const [items, setItems] = useState<PriceAuditItem[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [totalItems, setTotalItems] = useState(0);
  const [totalAudits, setTotalAudits] = useState(0);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({});
  const [actionsById, setActionsById] = useState<
    Record<string, PriceAuditAction>
  >({});
  const [expandedSkus, setExpandedSkus] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const groupedItems = useMemo(() => groupPriceAudits(items), [items]);

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
          setTotalAudits(result.totalAudits);
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
    const matchingSkuCount = items.filter(
      (currentItem) =>
        currentItem.sku.trim().toUpperCase() === item.sku.trim().toUpperCase()
    ).length;

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
    if (matchingSkuCount <= 1) {
      setTotalItems((current) => Math.max(0, current - 1));
    }
    setTotalAudits((current) => Math.max(0, current - 1));
    setRefreshNonce((current) => current + 1);
  }

  function toggleSku(sku: string) {
    const key = sku.trim().toUpperCase();

    setExpandedSkus((current) => {
      const next = new Set(current);

      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }

      return next;
    });
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

  function renderAuditRow(item: PriceAuditItem, showProductSku: boolean) {
    const safeSourceUrl = getSafeSourceUrl(item.priceSourceUrl);
    const activeAction = actionsById[item.vendorProductId];
    const isProcessing = Boolean(activeAction);

    return (
      <tr
        key={item.vendorProductId}
        className={showProductSku ? undefined : "price-audit-vendor-row"}
      >
        <td>
          {showProductSku ? (
            <>
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
            </>
          ) : (
            <>
              <strong className="price-audit-child-vendor">
                {item.vendorName}
              </strong>
              {item.vendorSku && (
                <small className="price-audit-vendor">{item.vendorSku}</small>
              )}
            </>
          )}
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
              aria-label={`New price for ${item.sku} from ${item.vendorName}`}
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
  }

  return (
    <section
      className={`${embedded ? "" : "page "}price-audit-page`}
      aria-labelledby="priceAuditHeading"
    >
      <div className="price-audit-header">
        <div>
          {embedded ? (
            <h2 id="priceAuditHeading">Price Audit</h2>
          ) : (
            <h1 id="priceAuditHeading">Price Audit</h1>
          )}
          <span>
            {totalAudits === totalItems
              ? `${totalAudits} pending`
              : `${totalAudits} pending across ${totalItems} ${
                  totalItems === 1 ? "SKU" : "SKUs"
                }`}
          </span>
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
              groupedItems.map((group) => {
                if (group.items.length === 1) {
                  return renderAuditRow(group.items[0], true);
                }

                const groupKey = group.sku.trim().toUpperCase();
                const isExpanded = expandedSkus.has(groupKey);

                return (
                  <Fragment key={groupKey}>
                    <tr className="price-audit-group-row">
                      <td colSpan={5}>
                        <div className="price-audit-group-summary">
                          <button
                            type="button"
                            className={`price-audit-group-toggle${
                              isExpanded ? " expanded" : ""
                            }`}
                            aria-label={`${isExpanded ? "Hide" : "Show"} vendor price audits for ${group.sku}`}
                            aria-expanded={isExpanded}
                            onClick={() => toggleSku(group.sku)}
                          >
                            <svg
                              aria-hidden="true"
                              viewBox="0 0 24 24"
                              focusable="false"
                            >
                              <path d="m8.6 9.2 3.4 3.4 3.4-3.4 1.4 1.4-4.8 4.8-4.8-4.8 1.4-1.4Z" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            className="sku-link"
                            onClick={() => onOpenNotes(group.sku)}
                          >
                            {group.sku}
                          </button>
                          <span>{group.items.length} vendors</span>
                        </div>
                      </td>
                    </tr>
                    {isExpanded &&
                      group.items.map((item) => renderAuditRow(item, false))}
                  </Fragment>
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
