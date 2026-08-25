import { useEffect, useState } from "react";
import {
  approveInventorySheetImport,
  getInventorySheetImport,
  getInventorySheetImports,
  rejectInventorySheetImport,
  retryInventorySheetImport,
  updateInventorySheetImportMapping
} from "../../services/api";
import type {
  InventorySheetImport,
  InventorySheetImportDetails,
  InventorySheetImportStatus
} from "../../types";
import { Pagination } from "../products/Pagination";

const pageSize = 25;
const maximumManualRetries = 3;

const statusLabels: Record<InventorySheetImportStatus, string> = {
  ready_for_review: "Ready for review",
  needs_mapping: "Needs mapping",
  failed: "Failed",
  retrying: "Retrying",
  approved: "Approved",
  applying: "Applying",
  applied: "Success",
  rejected: "Rejected"
};

function formatDate(value: string) {
  if (!value) return "Unknown time";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatAvailability(quantity: number) {
  return quantity > 0 ? "In stock" : "Out of stock";
}

function getStatusClass(status: InventorySheetImportStatus) {
  if (status === "applied") return "success";
  if (status === "failed" || status === "rejected") return "danger";
  if (status === "needs_mapping" || status === "ready_for_review") return "warning";
  return "processing";
}

export function InventorySheetImportsPage() {
  const [view, setView] = useState<"pending" | "history">("pending");
  const [items, setItems] = useState<InventorySheetImport[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [details, setDetails] = useState<InventorySheetImportDetails | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [activeAction, setActiveAction] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [skuHeader, setSkuHeader] = useState("");
  const [inventoryHeader, setInventoryHeader] = useState("");
  const [subtractiveColumn, setSubtractiveColumn] = useState("");

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearchQuery(searchInput.trim());
      setCurrentPage(1);
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => {
    let ignore = false;

    async function loadImports() {
      setIsLoading(true);
      setError("");

      try {
        const result = await getInventorySheetImports({
          page: currentPage,
          limit: pageSize,
          search: searchQuery,
          view
        });

        if (!ignore) {
          setItems(result.data);
          setTotalItems(result.total);
          if (currentPage > result.totalPages) setCurrentPage(result.totalPages);
        }
      } catch (loadError) {
        if (!ignore) {
          setError("Unable to load sheet imports. Try again in a moment.");
        }
      } finally {
        if (!ignore) setIsLoading(false);
      }
    }

    void loadImports();
    return () => {
      ignore = true;
    };
  }, [currentPage, refreshNonce, searchQuery, view]);

  useEffect(() => {
    if (!selectedId) {
      setDetails(null);
      return;
    }

    let ignore = false;
    setIsLoadingDetails(true);
    setError("");

    void getInventorySheetImport(selectedId)
      .then((result) => {
        if (ignore) return;
        setDetails(result);
        setSkuHeader(result.mapping.skuHeader || "");
        setInventoryHeader(result.mapping.inventoryHeader || "");
        setSubtractiveColumn(result.mapping.subtractiveColumn || "");
      })
      .catch((loadError) => {
        if (!ignore) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load this sheet import."
          );
        }
      })
      .finally(() => {
        if (!ignore) setIsLoadingDetails(false);
      });

    return () => {
      ignore = true;
    };
  }, [selectedId, refreshNonce]);

  function refreshAfterAction(successMessage: string) {
    setMessage(successMessage);
    setSelectedId("");
    setDetails(null);
    setRefreshNonce((current) => current + 1);
  }

  async function runAction(action: string, callback: () => Promise<unknown>) {
    setActiveAction(action);
    setError("");
    setMessage("");

    try {
      await callback();
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "Unable to update this sheet import."
      );
    } finally {
      setActiveAction("");
    }
  }

  function handleApprove() {
    if (!details) return;
    const confirmed = window.confirm(
      `Apply ${details.changedRows} proposed inventory change${
        details.changedRows === 1 ? "" : "s"
      } for ${details.vendorName}?`
    );
    if (!confirmed) return;

    void runAction("approve", async () => {
      await approveInventorySheetImport(details.id);
      refreshAfterAction("The approved sheet is queued for application.");
    });
  }

  function handleReject() {
    if (!details) return;
    const confirmed = window.confirm(
      `Reject ${details.attachmentFilename || "this sheet"}? No inventory will be changed.`
    );
    if (!confirmed) return;

    void runAction("reject", async () => {
      await rejectInventorySheetImport(details.id);
      refreshAfterAction("The sheet import was rejected.");
    });
  }

  function handleRetry() {
    if (!details) return;
    void runAction("retry", async () => {
      await retryInventorySheetImport(details.id);
      refreshAfterAction("The sheet import retry was queued.");
    });
  }

  function handleCardRetry(item: InventorySheetImport) {
    void runAction(`retry-${item.id}`, async () => {
      await retryInventorySheetImport(item.id);
      refreshAfterAction("The sheet import retry was queued.");
    });
  }

  function handleSaveMapping() {
    if (!details) return;
    void runAction("mapping", async () => {
      await updateInventorySheetImportMapping(details.id, {
        skuHeader,
        inventoryHeader,
        subtractiveColumn
      });
      refreshAfterAction("The vendor mapping was saved and the sheet was queued again.");
    });
  }

  const canReject = Boolean(
    details &&
      !details.isLegacy &&
      ["ready_for_review", "needs_mapping", "failed"].includes(details.status)
  );
  const canRetry = Boolean(
    details &&
      !details.isLegacy &&
      details.status === "failed" &&
      details.manualRetryCount < maximumManualRetries
  );

  return (
    <section className="page sheet-imports-page" aria-labelledby="sheetImportsHeading">
      <header className="sheet-imports-header">
        <div>
          <h1 id="sheetImportsHeading">Sheet Imports</h1>
          <span>Review Gmail vendor inventory sheets before changes reach SKU Nexus.</span>
        </div>
        <div className="sheet-imports-toolbar">
          <input
            type="search"
            className="search-bar"
            value={searchInput}
            placeholder="Search vendor, sender, or filename..."
            aria-label="Search sheet imports"
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
      </header>

      <div className="sheet-imports-view-tabs" role="group" aria-label="Import view">
        <button
          type="button"
          className={view === "pending" ? "active" : ""}
          onClick={() => {
            setView("pending");
            setCurrentPage(1);
            setSelectedId("");
          }}
        >
          Pending
        </button>
        <button
          type="button"
          className={view === "history" ? "active" : ""}
          onClick={() => {
            setView("history");
            setCurrentPage(1);
            setSelectedId("");
          }}
        >
          History
        </button>
        <span>{totalItems} import{totalItems === 1 ? "" : "s"}</span>
      </div>

      {error ? (
        <div className="sheet-import-load-error" role="alert">
          <span>{error}</span>
          <button
            type="button"
            className="price-audit-refresh"
            onClick={() => setRefreshNonce((current) => current + 1)}
          >
            Try again
          </button>
        </div>
      ) : null}
      {message ? <p className="status-message success-message">{message}</p> : null}

      <div className="sheet-imports-layout">
        <div className="sheet-imports-list" aria-busy={isLoading}>
          {isLoading ? <p className="status-message">Loading sheet imports...</p> : null}
          {!isLoading && items.length === 0 ? (
            <p className="sheet-imports-empty">
              {view === "pending"
                ? "No vendor sheets are waiting for review."
                : "No completed sheet-import history is available yet."}
            </p>
          ) : null}
          {items.map((item) => (
            <article
              className={`sheet-import-list-item${selectedId === item.id ? " selected" : ""}`}
              key={item.id}
            >
              <button
                type="button"
                className="sheet-import-list-select"
                onClick={() => setSelectedId(item.id)}
              >
                <span className="sheet-import-list-main">
                  <strong>{item.vendorName || item.vendorId}</strong>
                  <small>{item.attachmentFilename || "Historical import"}</small>
                </span>
                <span className={`sheet-import-status ${getStatusClass(item.status)}`}>
                  {statusLabels[item.status] || item.status}
                </span>
                <span className="sheet-import-list-meta">
                  {item.isLegacy
                    ? `${item.appliedCount} applied · Summary only`
                    : item.changedRows > 0
                    ? `${item.changedRows} proposed change${item.changedRows === 1 ? "" : "s"}`
                    : `${item.appliedCount} applied`}
                  <small>{formatDate(item.updatedAt)}</small>
                </span>
              </button>
              {item.status === "failed" &&
              !item.isLegacy &&
              item.manualRetryCount < maximumManualRetries ? (
                <div className="sheet-import-list-actions">
                  <button
                    type="button"
                    className="price-audit-refresh"
                    disabled={activeAction !== ""}
                    onClick={() => handleCardRetry(item)}
                  >
                    Retry ({item.manualRetryCount}/{maximumManualRetries})
                  </button>
                </div>
              ) : null}
            </article>
          ))}
          <Pagination
            currentPage={currentPage}
            limit={pageSize}
            totalItems={totalItems}
            onPageChange={setCurrentPage}
          />
        </div>

        <div className="sheet-import-details">
          {!selectedId ? (
            <p className="sheet-imports-empty">Select an import to review its details.</p>
          ) : null}
          {isLoadingDetails ? <p className="status-message">Loading import details...</p> : null}
          {details && !isLoadingDetails ? (
            <>
              <div className="sheet-import-details-header">
                <div>
                  <h2>{details.vendorName || details.vendorId}</h2>
                  <span>{details.attachmentFilename || "Historical import"}</span>
                </div>
                <span className={`sheet-import-status ${getStatusClass(details.status)}`}>
                  {statusLabels[details.status] || details.status}
                </span>
              </div>

              {details.isLegacy ? (
                <>
                  <dl className="sheet-import-metadata">
                    <div><dt>Sender</dt><dd>{details.senderEmail || "Unknown"}</dd></div>
                    <div><dt>First imported</dt><dd>{formatDate(details.createdAt)}</dd></div>
                    <div><dt>Last seen</dt><dd>{formatDate(details.updatedAt)}</dd></div>
                    <div><dt>Applied</dt><dd>{details.appliedCount}</dd></div>
                    <div><dt>Skipped</dt><dd>{details.skippedCount}</dd></div>
                    <div><dt>Errors</dt><dd>{details.errorCount}</dd></div>
                  </dl>
                  <div className="sheet-import-legacy-note">
                    <strong>Historical summary only</strong>
                    <span>
                      This sheet ran before row-level import tracking was added.
                      StockBridge saved the result counts, but not the individual
                      SKUs or their previous values. New imports retain every row
                      and show the exact availability changes here.
                    </span>
                  </div>
                </>
              ) : (
                <dl className="sheet-import-metadata">
                  <div><dt>Sender</dt><dd>{details.senderEmail || "Unknown"}</dd></div>
                  <div><dt>Received</dt><dd>{formatDate(details.createdAt)}</dd></div>
                  <div><dt>Rows</dt><dd>{details.totalRows || details.matchedRows}</dd></div>
                  <div><dt>Matched</dt><dd>{details.matchedRows}</dd></div>
                  <div><dt>Unmatched</dt><dd>{details.unmatchedRows}</dd></div>
                  <div><dt>Changed</dt><dd>{details.changedRows}</dd></div>
                </dl>
              )}

              {details.errorMessage ? (
                <p className="sheet-import-error">{details.errorMessage}</p>
              ) : null}

              {details.availableHeaders.length > 0 &&
              (details.status === "needs_mapping" ||
                (details.status === "failed" && details.rows.length === 0)) ? (
                <div className="sheet-import-mapping-panel">
                  <h3>Map this vendor’s columns</h3>
                  <p>The saved mapping will be reused for later sheets from this vendor.</p>
                  <label>
                    <span>Vendor SKU column</span>
                    <select value={skuHeader} onChange={(event) => setSkuHeader(event.target.value)}>
                      <option value="">Select a column</option>
                      {details.availableHeaders.map((header) => <option key={header}>{header}</option>)}
                    </select>
                  </label>
                  <label>
                    <span>Inventory column</span>
                    <select value={inventoryHeader} onChange={(event) => setInventoryHeader(event.target.value)}>
                      <option value="">Select a column</option>
                      {details.availableHeaders.map((header) => <option key={header}>{header}</option>)}
                    </select>
                  </label>
                  <label>
                    <span>Subtractive column (optional)</span>
                    <select value={subtractiveColumn} onChange={(event) => setSubtractiveColumn(event.target.value)}>
                      <option value="">None</option>
                      {details.availableHeaders.map((header) => <option key={header}>{header}</option>)}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="price-audit-confirm"
                    disabled={
                      activeAction !== "" ||
                      !skuHeader ||
                      !inventoryHeader ||
                      skuHeader === inventoryHeader ||
                      subtractiveColumn === skuHeader ||
                      subtractiveColumn === inventoryHeader
                    }
                    onClick={handleSaveMapping}
                  >
                    Save mapping &amp; retry
                  </button>
                </div>
              ) : null}

              {details.rows.length > 0 ? (
                <div className="price-audit-table-wrap">
                  <table className="sheet-import-proposals-table">
                    <thead>
                      <tr>
                        <th>Product SKU</th>
                        <th>Sheet SKU</th>
                        <th>Availability change</th>
                        <th>Sheet value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {details.rows.map((row) => (
                        <tr className={row.changeRequired ? "changed" : "unchanged"} key={`${row.rowNumber}-${row.vendorProductId}`}>
                          <td><strong>{row.productSku}</strong></td>
                          <td>{row.sheetSku}</td>
                          <td className="sheet-import-change">
                            <span>{formatAvailability(row.currentQuantity)}</span>
                            <span aria-hidden="true">&rarr;</span>
                            <strong>{formatAvailability(row.proposedQuantity)}</strong>
                          </td>
                          <td>{row.inventoryValue || "Blank"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {details.rowTotal > details.rows.length ? (
                    <p className="sheet-import-row-limit">
                      Showing the first {details.rows.length} of {details.rowTotal} matched rows.
                    </p>
                  ) : null}
                </div>
              ) : null}

              {details.reviewedByName ? (
                <p className="sheet-import-reviewer">
                  Reviewed by {details.reviewedByName} · {formatDate(details.reviewedAt)}
                </p>
              ) : null}

              <div className="sheet-import-actions">
                {canReject ? (
                  <button type="button" className="price-audit-deny" disabled={activeAction !== ""} onClick={handleReject}>
                    Reject
                  </button>
                ) : null}
                {canRetry ? (
                  <button type="button" className="price-audit-refresh" disabled={activeAction !== ""} onClick={handleRetry}>
                    Retry ({details.manualRetryCount}/{maximumManualRetries})
                  </button>
                ) : null}
                {details.status === "ready_for_review" ? (
                  <button type="button" className="price-audit-confirm" disabled={activeAction !== ""} onClick={handleApprove}>
                    Approve {details.changedRows} change{details.changedRows === 1 ? "" : "s"}
                  </button>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}
