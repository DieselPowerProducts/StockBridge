import { useEffect, useState } from "react";
import {
  approveInventorySheetImport,
  getInventorySheetImport,
  getInventorySheetImportFileUrl,
  getInventorySheetImportPreview,
  getInventorySheetImports,
  rejectInventorySheetImport,
  retryInventorySheetImport,
  updateInventorySheetImportMapping,
  updateInventorySheetImportRowSelection
} from "../../services/api";
import type {
  InventorySheetImport,
  InventorySheetImportDetails,
  InventorySheetImportStatus
} from "../../types";
import { Pagination } from "../products/Pagination";

const pageSize = 25;
const rowPageSize = 100;
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

function formatSheetStockValue(
  row: InventorySheetImportDetails["rows"][number],
  inventoryMode: "numerical" | "alphabetical" | undefined,
  previous: boolean
) {
  const quantity = previous ? row.previousSheetQuantity : row.sheetQuantity;

  if (quantity === null) return "Not recorded";
  return inventoryMode === "alphabetical"
    ? formatAvailability(quantity)
    : String(quantity);
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
  const [rowPage, setRowPage] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [activeAction, setActiveAction] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [skuHeader, setSkuHeader] = useState("");
  const [inventoryHeader, setInventoryHeader] = useState("");
  const [subtractiveColumn, setSubtractiveColumn] = useState("");
  const [saveMappingToVendor, setSaveMappingToVendor] = useState(false);
  const [isMappingOpen, setIsMappingOpen] = useState(false);

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
    const hasProcessingImport = items.some((item) =>
      ["retrying", "approved", "applying"].includes(item.status)
    );

    if (!hasProcessingImport) return;

    const interval = window.setInterval(() => {
      setRefreshNonce((current) => current + 1);
    }, 4000);

    return () => window.clearInterval(interval);
  }, [items]);

  useEffect(() => {
    if (!selectedId) {
      setDetails(null);
      return;
    }

    let ignore = false;
    setIsLoadingDetails(true);
    setIsLoadingPreview(false);
    setPreviewError("");
    setError("");

    void getInventorySheetImport(selectedId, rowPage, rowPageSize)
      .then((result) => {
        if (ignore) return;
        setDetails(result);
        setItems((current) =>
          current.map((item) =>
            item.id === result.id ? { ...item, ...result } : item
          )
        );
        setSkuHeader(result.mapping.skuHeader || "");
        setInventoryHeader(result.mapping.inventoryHeader || "");
        setSubtractiveColumn(result.mapping.subtractiveColumn || "");
        setSaveMappingToVendor(false);
        setIsMappingOpen(
          result.status === "needs_mapping" ||
            (result.status === "failed" && result.rows.length === 0)
        );

        if (!result.isLegacy && result.previewRows.length === 0) {
          setIsLoadingPreview(true);
          void getInventorySheetImportPreview(result.id)
            .then((preview) => {
              if (ignore) return;
              setDetails((current) =>
                current?.id === result.id
                  ? {
                      ...current,
                      availableHeaders: preview.availableHeaders,
                      previewRows: preview.previewRows
                    }
                  : current
              );
            })
            .catch((previewLoadError) => {
              if (!ignore) {
                setPreviewError(
                  previewLoadError instanceof Error
                    ? previewLoadError.message
                    : "Unable to load the spreadsheet preview."
                );
              }
            })
            .finally(() => {
              if (!ignore) setIsLoadingPreview(false);
            });
        }
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
  }, [selectedId, refreshNonce, rowPage]);

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
      `Apply ${details.selectedChangedRows} selected inventory change${
        details.selectedChangedRows === 1 ? "" : "s"
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
        subtractiveColumn,
        saveToVendor: saveMappingToVendor
      });
      refreshAfterAction(
        saveMappingToVendor
          ? "The mapping was applied to this sheet, saved for the vendor, and queued again."
          : "The mapping was applied to this sheet only and queued again."
      );
    });
  }

  function handleRowSelection(
    rowNumber: number,
    productSku: string,
    selected: boolean
  ) {
    if (!details) return;

    void runAction(`row-${rowNumber}`, async () => {
      const result = await updateInventorySheetImportRowSelection(
        details.id,
        rowNumber,
        selected
      );
      setDetails((current) =>
        current
          ? {
              ...current,
              selectedChangedRows: result.audit.selectedChangedRows,
              rows: current.rows.map((row) =>
                row.rowNumber === rowNumber ? result.row : row
              )
            }
          : current
      );
      setItems((current) =>
        current.map((item) =>
          item.id === result.audit.id ? { ...item, ...result.audit } : item
        )
      );
      setMessage(
        selected
          ? `${productSku} was restored to this import.`
          : `${productSku} was removed from this import.`
      );
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
  const canMap = Boolean(
    details &&
      !details.isLegacy &&
      details.availableHeaders.length > 0 &&
      ["ready_for_review", "needs_mapping", "failed"].includes(details.status)
  );

  function getColumnLabel(header: string, index: number) {
    const samples = Array.from(
      new Set(
        (details?.previewRows || [])
          .map((row) => row[index])
          .filter(Boolean)
      )
    ).slice(0, 2);

    return samples.length > 0 ? `${header} — e.g. ${samples.join(", ")}` : header;
  }

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
                onClick={() => {
                  setSelectedId(item.id);
                  setRowPage(1);
                }}
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
                    ? `${item.changedRows} proposed · ${item.selectedChangedRows} selected`
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

              {!details.isLegacy ? (
                <section className="sheet-import-preview" aria-label="Original spreadsheet preview">
                  <header>
                    <div>
                      <h3>Original spreadsheet preview</h3>
                      <span>
                        Detected column labels and the first 10 parsed rows. If a label looks like
                        data, the file may not contain a header row.
                      </span>
                    </div>
                    <a
                      className="price-audit-refresh"
                      href={getInventorySheetImportFileUrl(details.id)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open original spreadsheet
                    </a>
                  </header>
                  {isLoadingPreview ? (
                    <p className="status-message">Loading spreadsheet preview...</p>
                  ) : null}
                  {previewError ? (
                    <p className="sheet-import-preview-error">{previewError}</p>
                  ) : null}
                  {details.availableHeaders.length > 0 && details.previewRows.length > 0 ? (
                    <div className="sheet-import-preview-table-wrap">
                      <table>
                        <thead>
                          <tr>
                            {details.availableHeaders.map((header, index) => (
                              <th key={`${header}-${index}`}>{header}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {details.previewRows.map((row, rowIndex) => (
                            <tr key={rowIndex}>
                              {details.availableHeaders.map((header, columnIndex) => (
                                <td key={`${header}-${columnIndex}`}>
                                  {row[columnIndex] || "Blank"}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                </section>
              ) : null}

              {canMap && !isMappingOpen ? (
                <div className="sheet-import-map-actions">
                  <button
                    type="button"
                    className="price-audit-refresh"
                    onClick={() => setIsMappingOpen(true)}
                  >
                    Change column mapping
                  </button>
                </div>
              ) : null}

              {canMap && isMappingOpen ? (
                <div className="sheet-import-mapping-panel">
                  <h3>Map this sheet&apos;s columns</h3>
                  <p>
                    This mapping controls vendor stock availability, not product pricing. It applies
                    to this card unless you choose to save it as the vendor default.
                  </p>
                  <label>
                    <span>Sheet SKU column</span>
                    <select value={skuHeader} onChange={(event) => setSkuHeader(event.target.value)}>
                      <option value="">Select a column</option>
                      {details.availableHeaders.map((header, index) => (
                        <option value={header} key={`${header}-${index}`}>
                          {getColumnLabel(header, index)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Sheet stock value column</span>
                    <select value={inventoryHeader} onChange={(event) => setInventoryHeader(event.target.value)}>
                      <option value="">Select a column</option>
                      {details.availableHeaders.map((header, index) => (
                        <option value={header} key={`${header}-${index}`}>
                          {getColumnLabel(header, index)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Quantity to subtract (optional)</span>
                    <select value={subtractiveColumn} onChange={(event) => setSubtractiveColumn(event.target.value)}>
                      <option value="">None</option>
                      {details.availableHeaders.map((header, index) => (
                        <option value={header} key={`${header}-${index}`}>
                          {getColumnLabel(header, index)}
                        </option>
                      ))}
                    </select>
                    <small>
                      Use only when available stock equals the stock value minus an allocated,
                      committed, or reserved quantity.
                    </small>
                  </label>
                  <label className="sheet-import-save-mapping">
                    <input
                      type="checkbox"
                      checked={saveMappingToVendor}
                      onChange={(event) => setSaveMappingToVendor(event.target.checked)}
                    />
                    <span>Save this mapping as the default for future {details.vendorName} sheets</span>
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
                    Apply mapping to this sheet
                  </button>
                </div>
              ) : null}

              {details.rows.length > 0 ? (
                <div className="price-audit-table-wrap">
                  <table className="sheet-import-proposals-table">
                    <thead>
                      <tr>
                        <th>Include</th>
                        <th>Product SKU</th>
                        <th>Sheet SKU</th>
                        <th>This vendor&apos;s stock</th>
                        <th>Sheet stock value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {details.rows.map((row) => (
                        <tr
                          className={`${row.changeRequired ? "changed" : "unchanged"}${row.selected ? "" : " excluded"}`}
                          key={`${row.rowNumber}-${row.vendorProductId}`}
                        >
                          <td>
                            {row.changeRequired && details.status === "ready_for_review" ? (
                              <button
                                type="button"
                                className="sheet-import-row-toggle"
                                disabled={activeAction !== ""}
                                onClick={() =>
                                  handleRowSelection(
                                    row.rowNumber,
                                    row.productSku,
                                    !row.selected
                                  )
                                }
                              >
                                {row.selected ? "Remove" : "Restore"}
                              </button>
                            ) : row.selected ? (
                              "Included"
                            ) : (
                              "Removed"
                            )}
                          </td>
                          <td><strong>{row.productSku}</strong></td>
                          <td>{row.sheetSku}</td>
                          <td>
                            <span className="sheet-import-change">
                              <span>{formatAvailability(row.currentQuantity)}</span>
                              <span aria-hidden="true">&rarr;</span>
                              <strong>{formatAvailability(row.proposedQuantity)}</strong>
                            </span>
                          </td>
                          <td>
                            <span className="sheet-import-value-change">
                              <span>
                                {formatSheetStockValue(
                                  row,
                                  details.mapping.inventoryMode,
                                  true
                                )}
                              </span>
                              <span aria-hidden="true">&rarr;</span>
                              <strong>
                                {formatSheetStockValue(
                                  row,
                                  details.mapping.inventoryMode,
                                  false
                                )}
                              </strong>
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {details.rowTotal > details.rows.length ? (
                    <p className="sheet-import-row-limit">
                      Showing {details.rows.length} of {details.rowTotal} matched rows.
                    </p>
                  ) : null}
                  {details.rowTotalPages > 1 ? (
                    <Pagination
                      currentPage={details.rowPage}
                      limit={rowPageSize}
                      totalItems={details.rowTotal}
                      onPageChange={setRowPage}
                    />
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
                  <button
                    type="button"
                    className="price-audit-confirm"
                    disabled={
                      activeAction !== "" ||
                      (details.changedRows > 0 && details.selectedChangedRows === 0)
                    }
                    onClick={handleApprove}
                  >
                    Approve {details.selectedChangedRows} selected change{details.selectedChangedRows === 1 ? "" : "s"}
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
