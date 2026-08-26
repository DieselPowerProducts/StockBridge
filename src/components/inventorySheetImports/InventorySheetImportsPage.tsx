import { useEffect, useState } from "react";
import {
  addInventorySheetMissingSkuException,
  getAutoInventoryVendors,
  getInventorySheetData,
  getInventorySheetImport,
  getInventorySheetImportFileUrl,
  getInventorySheetImports,
  rejectInventorySheetImport,
  retryInventorySheetImport,
  updateInventorySheetImportMapping
} from "../../services/api";
import type {
  AutoInventoryVendor,
  InventorySheetData,
  InventorySheetImport,
  InventorySheetImportDetails,
  InventorySheetImportStatus
} from "../../types";
import { Pagination } from "../products/Pagination";
import { AutoInventorySettingsModal } from "./AutoInventorySettingsModal";

const pageSize = 25;
const rowPageSize = 100;
const sheetPageSize = 100;
const maximumManualRetries = 3;

const statusLabels: Record<InventorySheetImportStatus, string> = {
  ready_for_review: "Needs review",
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

function getStatusClass(status: InventorySheetImportStatus) {
  if (status === "applied") return "success";
  if (status === "failed" || status === "rejected") return "danger";
  if (status === "needs_mapping" || status === "ready_for_review") return "warning";
  return "processing";
}

type ImportsView = "pending" | "history" | "vendors";

export function InventorySheetImportsPage() {
  const [view, setView] = useState<ImportsView>("pending");
  const [items, setItems] = useState<InventorySheetImport[]>([]);
  const [vendors, setVendors] = useState<AutoInventoryVendor[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [details, setDetails] = useState<InventorySheetImportDetails | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [rowPage, setRowPage] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [sheetSearchInput, setSheetSearchInput] = useState("");
  const [sheetSearchQuery, setSheetSearchQuery] = useState("");
  const [sheetPage, setSheetPage] = useState(1);
  const [sheetData, setSheetData] = useState<InventorySheetData | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [isLoadingSheet, setIsLoadingSheet] = useState(false);
  const [activeAction, setActiveAction] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [skuHeader, setSkuHeader] = useState("");
  const [inventoryHeader, setInventoryHeader] = useState("");
  const [subtractiveColumn, setSubtractiveColumn] = useState("");
  const [saveMappingToVendor, setSaveMappingToVendor] = useState(false);
  const [isMappingOpen, setIsMappingOpen] = useState(false);
  const [settingsVendor, setSettingsVendor] = useState<{ id: string; name: string } | null>(null);
  const [isAddVendorOpen, setIsAddVendorOpen] = useState(false);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearchQuery(searchInput.trim());
      setCurrentPage(1);
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSheetSearchQuery(sheetSearchInput.trim());
      setSheetPage(1);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [sheetSearchInput]);

  useEffect(() => {
    let ignore = false;
    setIsLoading(true);
    setError("");
    const request = view === "vendors"
      ? getAutoInventoryVendors({ page: currentPage, limit: pageSize, search: searchQuery })
      : getInventorySheetImports({ page: currentPage, limit: pageSize, search: searchQuery, view });

    void request
      .then((result) => {
        if (ignore) return;
        if (view === "vendors") {
          setVendors((result as Awaited<ReturnType<typeof getAutoInventoryVendors>>).data);
        } else {
          setItems((result as Awaited<ReturnType<typeof getInventorySheetImports>>).data);
        }
        setTotalItems(result.total);
        if (currentPage > result.totalPages) setCurrentPage(result.totalPages);
      })
      .catch((loadError) => {
        if (!ignore) setError(loadError instanceof Error ? loadError.message : "Unable to load sheet imports.");
      })
      .finally(() => {
        if (!ignore) setIsLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [currentPage, refreshNonce, searchQuery, view]);

  useEffect(() => {
    if (!selectedId || view === "vendors") {
      setDetails(null);
      return;
    }
    let ignore = false;
    setIsLoadingDetails(true);
    setError("");
    void getInventorySheetImport(selectedId, rowPage, rowPageSize)
      .then((result) => {
        if (ignore) return;
        setDetails(result);
        setSkuHeader(result.mapping.skuHeader || "");
        setInventoryHeader(result.mapping.inventoryHeader || "");
        setSubtractiveColumn(result.mapping.subtractiveColumn || "");
        setSaveMappingToVendor(false);
        setIsMappingOpen(result.status === "needs_mapping");
      })
      .catch((loadError) => {
        if (!ignore) setError(loadError instanceof Error ? loadError.message : "Unable to load this import.");
      })
      .finally(() => {
        if (!ignore) setIsLoadingDetails(false);
      });
    return () => {
      ignore = true;
    };
  }, [selectedId, refreshNonce, rowPage, view]);

  useEffect(() => {
    if (!selectedId || view !== "pending") {
      setSheetData(null);
      return;
    }
    let ignore = false;
    setIsLoadingSheet(true);
    void getInventorySheetData({
      importId: selectedId,
      page: sheetPage,
      limit: sheetPageSize,
      search: sheetSearchQuery
    })
      .then((result) => {
        if (!ignore) setSheetData(result);
      })
      .catch((loadError) => {
        if (!ignore) setError(loadError instanceof Error ? loadError.message : "Unable to load the spreadsheet.");
      })
      .finally(() => {
        if (!ignore) setIsLoadingSheet(false);
      });
    return () => {
      ignore = true;
    };
  }, [selectedId, sheetPage, sheetSearchQuery, refreshNonce, view]);

  useEffect(() => {
    const processing = items.some((item) => ["retrying", "approved", "applying"].includes(item.status));
    if (!processing) return;
    const interval = window.setInterval(() => setRefreshNonce((current) => current + 1), 4000);
    return () => window.clearInterval(interval);
  }, [items]);

  function switchView(nextView: ImportsView) {
    setView(nextView);
    setCurrentPage(1);
    setSelectedId("");
    setDetails(null);
    setSearchInput("");
    setSearchQuery("");
  }

  async function runAction(action: string, callback: () => Promise<void>) {
    setActiveAction(action);
    setError("");
    setMessage("");
    try {
      await callback();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Unable to update this sheet import.");
    } finally {
      setActiveAction("");
    }
  }

  function refreshAfterAction(successMessage: string) {
    setMessage(successMessage);
    setSelectedId("");
    setDetails(null);
    setRefreshNonce((current) => current + 1);
  }

  function handleRetry() {
    if (!details) return;
    void runAction("retry", async () => {
      await retryInventorySheetImport(details.id);
      refreshAfterAction("The spreadsheet is being parsed again.");
    });
  }

  function handleReject() {
    if (!details || !window.confirm(`Reject ${details.attachmentFilename}?`)) return;
    void runAction("reject", async () => {
      await rejectInventorySheetImport(details.id);
      refreshAfterAction("The sheet import was rejected.");
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
      refreshAfterAction("The new column mapping is being parsed.");
    });
  }

  function handleMissingSkuException(missingSku: InventorySheetImportDetails["missingSkus"][number]) {
    if (!details) return;
    void runAction(`missing-${missingSku.vendorProductId}`, async () => {
      const result = await addInventorySheetMissingSkuException(details.id, {
        vendorProductId: missingSku.vendorProductId,
        productSku: missingSku.productSku
      });
      setDetails((current) => current ? {
        ...current,
        missingSkuRows: result.audit.missingSkuRows,
        missingSkus: current.missingSkus.filter((item) => item.vendorProductId !== missingSku.vendorProductId)
      } : current);
      setMessage(`${missingSku.productSku} was added to this vendor's SKU exceptions.`);
    });
  }

  const canMap = Boolean(details && !details.isLegacy && details.availableHeaders.length > 0 && ["ready_for_review", "needs_mapping", "failed"].includes(details.status));
  const canRetry = Boolean(details && !details.isLegacy && ["ready_for_review", "needs_mapping", "failed"].includes(details.status) && details.manualRetryCount < maximumManualRetries);

  return (
    <section className="page sheet-imports-page" aria-labelledby="sheetImportsHeading">
      <header className="sheet-imports-header">
        <div>
          <h1 id="sheetImportsHeading">Sheet Imports</h1>
          <span>Clean vendor sheets apply automatically. Only imports needing attention appear in Pending.</span>
        </div>
        <div className="sheet-imports-toolbar">
          <input
            type="search"
            className="search-bar"
            value={searchInput}
            placeholder={view === "vendors" ? "Search auto inventory vendors..." : "Search vendor, sender, or filename..."}
            aria-label="Search sheet imports"
            onChange={(event) => setSearchInput(event.target.value)}
          />
          <button type="button" className="price-audit-refresh" disabled={isLoading} onClick={() => setRefreshNonce((current) => current + 1)}>
            Refresh
          </button>
        </div>
      </header>

      <div className="sheet-imports-view-tabs" role="tablist" aria-label="Sheet import views">
        {(["pending", "history", "vendors"] as ImportsView[]).map((tab) => (
          <button type="button" role="tab" aria-selected={view === tab} className={view === tab ? "active" : ""} key={tab} onClick={() => switchView(tab)}>
            {tab[0].toUpperCase() + tab.slice(1)}
          </button>
        ))}
        <button type="button" className="sheet-import-add-vendor" title="Add auto inventory vendor" aria-label="Add auto inventory vendor" onClick={() => setIsAddVendorOpen(true)}>
          +
        </button>
        <span>{totalItems} {view === "vendors" ? `vendor${totalItems === 1 ? "" : "s"}` : `import${totalItems === 1 ? "" : "s"}`}</span>
      </div>

      {error ? <div className="sheet-import-load-error" role="alert"><span>{error}</span></div> : null}
      {message ? <p className="status-message success-message">{message}</p> : null}

      {view === "vendors" ? (
        <section className="auto-inventory-vendors-list" aria-busy={isLoading}>
          {isLoading ? <p className="status-message">Loading vendors...</p> : null}
          {!isLoading && vendors.length === 0 ? <p className="sheet-imports-empty">No auto inventory vendors found.</p> : null}
          {vendors.map((vendor) => (
            <button type="button" className="auto-inventory-vendor-row" key={vendor.vendorId} onClick={() => setSettingsVendor({ id: vendor.vendorId, name: vendor.vendorName })}>
              <strong>{vendor.vendorName}</strong>
              <span>{vendor.senderEmail}</span>
              <span>{vendor.inventoryMode === "alphabetical" ? "Alphabetical" : "Numerical"}</span>
            </button>
          ))}
          <Pagination currentPage={currentPage} limit={pageSize} totalItems={totalItems} onPageChange={setCurrentPage} />
        </section>
      ) : (
        <div className="sheet-imports-layout">
          <div className="sheet-imports-list" aria-busy={isLoading}>
            {isLoading ? <p className="status-message">Loading sheet imports...</p> : null}
            {!isLoading && items.length === 0 ? <p className="sheet-imports-empty">{view === "pending" ? "No vendor sheets need attention." : "No completed sheet history is available."}</p> : null}
            {items.map((item) => (
              <button
                type="button"
                className={`sheet-import-list-select sheet-import-list-item${selectedId === item.id ? " selected" : ""}`}
                key={item.id}
                onClick={() => {
                  setSelectedId(item.id);
                  setRowPage(1);
                  setSheetPage(1);
                  setSheetSearchInput("");
                  setSheetSearchQuery("");
                }}
              >
                <span className="sheet-import-list-main"><strong>{item.vendorName || item.vendorId}</strong><small>{item.attachmentFilename || "Historical import"}</small></span>
                <span className={`sheet-import-status ${getStatusClass(item.status)}`}>{statusLabels[item.status]}</span>
                <span className="sheet-import-list-meta">
                  {item.missingSkuRows > 0 ? `${item.missingSkuRows} missing SKU${item.missingSkuRows === 1 ? "" : "s"}` : `${item.appliedCount} applied`}
                  <small>{formatDate(item.updatedAt)}</small>
                </span>
              </button>
            ))}
            <Pagination currentPage={currentPage} limit={pageSize} totalItems={totalItems} onPageChange={setCurrentPage} />
          </div>

          <div className="sheet-import-details">
            {!selectedId ? <p className="sheet-imports-empty">Select an import to view it.</p> : null}
            {isLoadingDetails ? <p className="status-message">Loading import details...</p> : null}
            {details && !isLoadingDetails ? (
              <>
                <div className="sheet-import-details-header">
                  <div><h2>{details.vendorName || details.vendorId}</h2><span>{details.attachmentFilename || "Historical import"}</span></div>
                  <span className={`sheet-import-status ${getStatusClass(details.status)}`}>{statusLabels[details.status]}</span>
                </div>

                <dl className="sheet-import-metadata">
                  <div><dt>Sender</dt><dd>{details.senderEmail || "Unknown"}</dd></div>
                  <div><dt>{view === "pending" ? "Received" : "Completed"}</dt><dd>{formatDate(details.updatedAt)}</dd></div>
                  <div><dt>Rows</dt><dd>{details.totalRows || details.matchedRows}</dd></div>
                  <div><dt>Matched</dt><dd>{details.matchedRows}</dd></div>
                  <div><dt>Missing</dt><dd>{details.missingSkuRows}</dd></div>
                  <div><dt>Changed</dt><dd>{details.changedRows}</dd></div>
                </dl>
                {details.errorMessage ? <p className="sheet-import-error">{details.errorMessage}</p> : null}

                {view === "pending" && !details.isLegacy ? (
                  <>
                    <div className="sheet-import-file-actions">
                      {canMap ? <button type="button" className="price-audit-refresh" onClick={() => setIsMappingOpen((current) => !current)}>Change column mapping</button> : null}
                      <a className="price-audit-refresh" href={getInventorySheetImportFileUrl(details.id)}>Download spreadsheet</a>
                      {canRetry ? <button type="button" className="price-audit-confirm sheet-import-retry" disabled={activeAction !== ""} onClick={handleRetry}>Retry</button> : null}
                    </div>

                    {canMap && isMappingOpen ? (
                      <div className="sheet-import-mapping-panel">
                        <h3>Map this sheet&apos;s columns</h3>
                        <label><span>Sheet SKU column</span><select value={skuHeader} onChange={(event) => setSkuHeader(event.target.value)}><option value="">Select a column</option>{details.availableHeaders.map((header) => <option value={header} key={header}>{header}</option>)}</select></label>
                        <label><span>Sheet stock value column</span><select value={inventoryHeader} onChange={(event) => setInventoryHeader(event.target.value)}><option value="">Select a column</option>{details.availableHeaders.map((header) => <option value={header} key={header}>{header}</option>)}</select></label>
                        <label><span>Quantity to subtract</span><select value={subtractiveColumn} onChange={(event) => setSubtractiveColumn(event.target.value)}><option value="">None</option>{details.availableHeaders.map((header) => <option value={header} key={header}>{header}</option>)}</select></label>
                        <label className="sheet-import-save-mapping"><input type="checkbox" checked={saveMappingToVendor} onChange={(event) => setSaveMappingToVendor(event.target.checked)} /><span>Save as the default for future {details.vendorName} sheets</span></label>
                        <button type="button" className="price-audit-confirm" disabled={activeAction !== "" || !skuHeader || !inventoryHeader || skuHeader === inventoryHeader} onClick={handleSaveMapping}>Apply mapping</button>
                      </div>
                    ) : null}

                    <div className="sheet-import-review-grid">
                      <section className="sheet-import-original" aria-label="Original spreadsheet">
                        <input type="search" className="search-bar" value={sheetSearchInput} placeholder="Find in spreadsheet..." aria-label="Find in original spreadsheet" onChange={(event) => setSheetSearchInput(event.target.value)} />
                        {isLoadingSheet ? <p className="status-message">Loading spreadsheet...</p> : null}
                        {sheetData ? (
                          <>
                            <div className="sheet-import-original-table-wrap">
                              <table><thead><tr>{sheetData.availableHeaders.map((header, index) => <th key={`${header}-${index}`}>{header}</th>)}</tr></thead><tbody>{sheetData.data.map((row, rowIndex) => <tr key={rowIndex}>{row.map((value, columnIndex) => <td key={columnIndex}>{value || ""}</td>)}</tr>)}</tbody></table>
                            </div>
                            <Pagination currentPage={sheetData.page} limit={sheetPageSize} totalItems={sheetData.total} onPageChange={setSheetPage} />
                          </>
                        ) : null}
                      </section>

                      <aside className="sheet-import-missing-skus">
                        <header><h3>Missing SKUs</h3><span>{details.missingSkus.length}</span></header>
                        {details.missingSkus.length === 0 ? <p>No unresolved missing SKUs.</p> : null}
                        {details.missingSkus.map((missingSku) => (
                          <label key={missingSku.vendorProductId}>
                            <input type="checkbox" disabled={activeAction !== ""} onChange={() => handleMissingSkuException(missingSku)} />
                            <span><strong>{missingSku.productSku}</strong>{missingSku.vendorSku && missingSku.vendorSku !== missingSku.productSku ? <small>Vendor SKU: {missingSku.vendorSku}</small> : null}</span>
                          </label>
                        ))}
                      </aside>
                    </div>
                  </>
                ) : null}

                {view === "history" && details.rows.length > 0 ? (
                  <div className="price-audit-table-wrap">
                    <table className="sheet-import-proposals-table">
                      <thead><tr><th>Product SKU</th><th>Sheet SKU</th><th>Previous status</th><th>Imported status</th></tr></thead>
                      <tbody>{details.rows.map((row) => <tr key={`${row.rowNumber}-${row.vendorProductId}`}><td>{row.productSku}</td><td>{row.sheetSku}</td><td>{row.currentQuantity > 0 ? "In stock" : "Out of stock"}</td><td>{row.proposedQuantity > 0 ? "In stock" : "Out of stock"}</td></tr>)}</tbody>
                    </table>
                    {details.rowTotalPages > 1 ? <Pagination currentPage={details.rowPage} limit={rowPageSize} totalItems={details.rowTotal} onPageChange={setRowPage} /> : null}
                  </div>
                ) : null}

                {view === "history" && !details.isLegacy ? <div className="sheet-import-file-actions"><a className="price-audit-refresh" href={getInventorySheetImportFileUrl(details.id)}>Download spreadsheet</a></div> : null}
                {view === "pending" ? <div className="sheet-import-actions"><button type="button" className="price-audit-deny" disabled={activeAction !== ""} onClick={handleReject}>Reject</button></div> : null}
              </>
            ) : null}
          </div>
        </div>
      )}

      {settingsVendor ? <AutoInventorySettingsModal vendorId={settingsVendor.id} vendorName={settingsVendor.name} onClose={() => setSettingsVendor(null)} onSaved={() => setRefreshNonce((current) => current + 1)} /> : null}
      {isAddVendorOpen ? <AutoInventorySettingsModal onClose={() => setIsAddVendorOpen(false)} onSaved={() => { setView("vendors"); setRefreshNonce((current) => current + 1); }} /> : null}
    </section>
  );
}
