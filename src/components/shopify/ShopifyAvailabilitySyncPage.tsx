import { useRef, useState } from "react";
import { syncShopifyAvailabilityState } from "../../services/api";
import type {
  ShopifyAvailabilityStatus,
  ShopifyAvailabilitySyncResponse
} from "../../types";

type SyncTotals = {
  availabilityCounts: Record<ShopifyAvailabilityStatus, number>;
  pages: number;
  scannedVariantCount: number;
  skippedCount: number;
  skippedSamples: ShopifyAvailabilitySyncResponse["skippedSamples"];
  updatedCount: number;
};

const emptyAvailabilityCounts: Record<ShopifyAvailabilityStatus, number> = {
  backordered: 0,
  built_to_order: 0,
  in_stock: 0,
  out_of_stock: 0
};

const availabilityLabels: Array<{
  key: ShopifyAvailabilityStatus;
  label: string;
}> = [
  { key: "in_stock", label: "In Stock" },
  { key: "out_of_stock", label: "Out of Stock" },
  { key: "backordered", label: "Backordered" },
  { key: "built_to_order", label: "Built to Order" }
];

function createEmptyTotals(): SyncTotals {
  return {
    availabilityCounts: { ...emptyAvailabilityCounts },
    pages: 0,
    scannedVariantCount: 0,
    skippedCount: 0,
    skippedSamples: [],
    updatedCount: 0
  };
}

function addSyncResult(
  totals: SyncTotals,
  result: ShopifyAvailabilitySyncResponse
): SyncTotals {
  const nextCounts = { ...totals.availabilityCounts };

  for (const option of availabilityLabels) {
    nextCounts[option.key] += result.availabilityCounts[option.key] || 0;
  }

  return {
    availabilityCounts: nextCounts,
    pages: totals.pages + 1,
    scannedVariantCount:
      totals.scannedVariantCount + result.scannedVariantCount,
    skippedCount: totals.skippedCount + result.skippedCount,
    skippedSamples: [...totals.skippedSamples, ...result.skippedSamples].slice(
      0,
      25
    ),
    updatedCount: totals.updatedCount + result.updatedCount
  };
}

export function ShopifyAvailabilitySyncPage() {
  const [isSyncing, setIsSyncing] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [totals, setTotals] = useState<SyncTotals>(() => createEmptyTotals());
  const shouldStopRef = useRef(false);

  async function handleStartSync() {
    if (isSyncing) {
      return;
    }

    let cursor = "";
    let page = 0;
    shouldStopRef.current = false;
    setIsSyncing(true);
    setError("");
    setStatus("Syncing Shopify availability...");
    setTotals(createEmptyTotals());

    try {
      while (!shouldStopRef.current) {
        const result = await syncShopifyAvailabilityState({
          cursor,
          first: 250
        });

        page += 1;
        setTotals((current) => addSyncResult(current, result));
        setStatus(
          result.hasNextPage
            ? `Synced page ${page}. Continuing...`
            : `Sync complete after ${page} page${page === 1 ? "" : "s"}.`
        );

        if (!result.hasNextPage || !result.nextCursor) {
          break;
        }

        cursor = result.nextCursor;
      }

      if (shouldStopRef.current) {
        setStatus(`Stopped after ${page} page${page === 1 ? "" : "s"}.`);
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to sync Shopify availability."
      );
      setStatus("");
    } finally {
      setIsSyncing(false);
      shouldStopRef.current = false;
    }
  }

  function handleStopSync() {
    shouldStopRef.current = true;
    setStatus("Stopping after the current page...");
  }

  return (
    <section className="page shopify-sync-page">
      <header className="shopify-sync-header">
        <div>
          <p className="eyebrow">Shopify</p>
          <h1>Availability Sync</h1>
        </div>

        <div className="shopify-sync-actions">
          <button type="button" disabled={isSyncing} onClick={handleStartSync}>
            Start Sync
          </button>
          <button type="button" disabled={!isSyncing} onClick={handleStopSync}>
            Stop
          </button>
        </div>
      </header>

      {status && <p className="status-message">{status}</p>}
      {error && <p className="status-message error-message">{error}</p>}

      <dl className="shopify-sync-stats">
        <div>
          <dt>Pages</dt>
          <dd>{totals.pages}</dd>
        </div>
        <div>
          <dt>Variants</dt>
          <dd>{totals.scannedVariantCount}</dd>
        </div>
        <div>
          <dt>Updated</dt>
          <dd>{totals.updatedCount}</dd>
        </div>
        <div>
          <dt>Skipped</dt>
          <dd>{totals.skippedCount}</dd>
        </div>
      </dl>

      <div className="shopify-sync-counts" aria-label="Availability counts">
        {availabilityLabels.map((option) => (
          <div key={option.key}>
            <span>{option.label}</span>
            <strong>{totals.availabilityCounts[option.key]}</strong>
          </div>
        ))}
      </div>

      {totals.skippedSamples.length > 0 && (
        <section className="shopify-sync-skips">
          <h2>Skipped Samples</h2>
          <table>
            <thead>
              <tr>
                <th scope="col">SKU</th>
                <th scope="col">Reason</th>
                <th scope="col">Value</th>
              </tr>
            </thead>
            <tbody>
              {totals.skippedSamples.map((sample, index) => (
                <tr key={`${sample.sku || sample.variantId || "skip"}-${index}`}>
                  <td>{sample.sku || sample.variantId || "-"}</td>
                  <td>{sample.reason}</td>
                  <td>{sample.value || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </section>
  );
}
