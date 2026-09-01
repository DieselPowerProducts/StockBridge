import { FormEvent, useMemo, useState } from "react";
import { createPackingListReport } from "../../services/api";
import type { PackingListOrder, PackingListReport } from "../../types";

type ReportGroup = {
  key: keyof PackingListReport["groups"];
  label: string;
  emptyMessage: string;
};

const reportGroups: ReportGroup[] = [
  {
    key: "warehouse",
    label: "Warehouse Fulfillment",
    emptyMessage: "No matching warehouse fulfillments are still open."
  },
  {
    key: "backordered",
    label: "Vendor Backorder",
    emptyMessage: "No matching parts are backordered with their assigned vendor."
  },
  {
    key: "missingTracking",
    label: "Missing Tracking",
    emptyMessage: "No matching vendor fulfillments are missing tracking."
  },
  {
    key: "undecided",
    label: "Undecided",
    emptyMessage: "No matching quantities are waiting for a fulfillment decision."
  }
];

function getToday() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function parsePurchaseOrders(value: string) {
  return value
    .split(/[\s,;/]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatDate(value: string) {
  if (!value) {
    return "";
  }

  const date = new Date(value.replace(" ", "T"));
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, {
        month: "numeric",
        day: "numeric",
        year: "numeric"
      });
}

function formatState(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function escapeCsvValue(value: string | number) {
  const text = String(value ?? "");
  const safeText = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safeText.replaceAll('"', '""')}"`;
}

function downloadReportCsv(report: PackingListReport) {
  const headers = [
    "Category",
    "Order",
    "Order Date",
    "Customer",
    "Order State",
    "SKU",
    "Product",
    "Ordered Qty",
    "Packing List Qty",
    "Source POs",
    "Fulfillment State",
    "Tracking",
    "Status",
    "Order URL"
  ];
  const rows = reportGroups.flatMap((group) =>
    report.groups[group.key].flatMap((order) =>
      order.items.map((item) => [
        group.label,
        order.orderNumber,
        formatDate(order.createdAt),
        order.customerName || "Unknown",
        formatState(order.orderState),
        item.sku,
        item.name,
        item.orderedQuantity,
        item.packingListQuantity,
        item.poNumbers.join(", "),
        formatState(item.fulfillmentState),
        item.trackingCode,
        item.reason,
        order.orderUrl
      ])
    )
  );
  const csv = [headers, ...rows]
    .map((row) => row.map(escapeCsvValue).join(","))
    .join("\r\n");
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const vendorLabel =
    report.vendors.length === 1 ? report.vendors[0] : "multiple-vendors";
  const vendor = vendorLabel
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "vendor";

  link.href = url;
  link.download = `packing-list-report-${vendor}-${report.receivedFrom}-${report.receivedTo}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function OrderRows({ orders }: { orders: PackingListOrder[] }) {
  return (
    <>
      {orders.map((order) => (
        <tr key={order.orderId}>
          <td>
            <a href={order.orderUrl} target="_blank" rel="noreferrer">
              {order.orderNumber}
            </a>
            <small>{formatDate(order.createdAt)}</small>
          </td>
          <td>{order.customerName || "Unknown"}</td>
          <td>{formatState(order.orderState)}</td>
          <td>
            <div className="packing-list-order-items">
              {order.items.map((item, index) => (
                <div
                  className="packing-list-order-item"
                  key={`${item.sku}-${item.fulfillmentState}-${index}`}
                >
                  <strong>{item.sku}</strong>
                  <span>
                    Ordered {item.orderedQuantity} | Received {item.packingListQuantity}
                    {item.poNumbers.length > 0
                      ? ` | PO ${item.poNumbers.join(", ")}`
                      : ""}
                  </span>
                </div>
              ))}
            </div>
          </td>
          <td>
            <div className="packing-list-order-items">
              {order.items.map((item, index) => (
                <div
                  className="packing-list-order-item"
                  key={`${item.sku}-status-${index}`}
                >
                  {item.fulfillmentState ? (
                    <strong>{formatState(item.fulfillmentState)}</strong>
                  ) : null}
                  <span>{item.reason}</span>
                  {item.trackingCode ? (
                    <small>Tracking: {item.trackingCode}</small>
                  ) : null}
                </div>
              ))}
            </div>
          </td>
        </tr>
      ))}
    </>
  );
}

export function PackingListsPage() {
  const today = useMemo(getToday, []);
  const [purchaseOrders, setPurchaseOrders] = useState("");
  const [receivedFrom, setReceivedFrom] = useState(today);
  const [receivedTo, setReceivedTo] = useState(today);
  const [report, setReport] = useState<PackingListReport | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    setReport(null);
    setIsLoading(true);

    try {
      const result = await createPackingListReport({
        purchaseOrders: parsePurchaseOrders(purchaseOrders),
        receivedFrom,
        receivedTo
      });
      setReport(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create the packing list report.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <section className="page packing-lists-page" aria-labelledby="packingListsHeading">
      <header className="packing-lists-header">
        <div>
          <p className="eyebrow">Processing</p>
          <h1 id="packingListsHeading">Packing Lists</h1>
        </div>
        {report ? (
          <span>
            {report.parts.length} received SKU{report.parts.length === 1 ? "" : "s"}
          </span>
        ) : null}
      </header>

      <form className="packing-lists-form" onSubmit={handleSubmit}>
        <label className="packing-list-po-field">
          <span>Purchase orders</span>
          <textarea
            value={purchaseOrders}
            onChange={(event) => setPurchaseOrders(event.target.value)}
            placeholder="Enter PO numbers separated by commas, slashes, or new lines"
            required
          />
        </label>
        <label className="packing-list-from-field">
          <span>Received from</span>
          <input
            type="date"
            value={receivedFrom}
            onChange={(event) => setReceivedFrom(event.target.value)}
            required
          />
        </label>
        <label className="packing-list-through-field">
          <span>Received through</span>
          <input
            type="date"
            value={receivedTo}
            onChange={(event) => setReceivedTo(event.target.value)}
            required
          />
        </label>
        <button className="packing-list-submit" type="submit" disabled={isLoading}>
          {isLoading ? "Checking SKU Nexus..." : "Create report"}
        </button>
      </form>

      {error ? <p className="status-message error-message">{error}</p> : null}

      {report ? (
        <div className="packing-list-report">
          <div className="packing-list-report-actions">
            <button type="button" onClick={() => downloadReportCsv(report)}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 3v12m0 0 5-5m-5 5-5-5M5 20h14" />
              </svg>
              Download CSV
            </button>
          </div>

          {report.warnings.length > 0 ? (
            <div className="packing-list-warnings" role="status">
              {report.warnings.map((warning) => <p key={warning}>{warning}</p>)}
            </div>
          ) : null}

          <section className="packing-list-receipts" aria-labelledby="packingListReceiptsHeading">
            <header>
              <h2 id="packingListReceiptsHeading">Receipts</h2>
              <span>{formatDate(report.receivedFrom)} through {formatDate(report.receivedTo)}</span>
            </header>
            <div className="packing-list-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>PO</th>
                    <th>Vendor</th>
                    <th>Received SKUs</th>
                    <th>Received Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {report.purchaseOrders.map((purchaseOrder) => (
                    <tr key={purchaseOrder.id}>
                      <td><a href={purchaseOrder.url} target="_blank" rel="noreferrer">{purchaseOrder.poNumber}</a></td>
                      <td>{purchaseOrder.vendorName}</td>
                      <td>{purchaseOrder.receivedSkuCount}</td>
                      <td>{purchaseOrder.receivedQuantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <details className="packing-list-parts">
            <summary>Received parts ({report.parts.length})</summary>
            <div className="packing-list-table-wrap">
              <table>
                <thead><tr><th>SKU</th><th>Name</th><th>Qty</th><th>Source POs</th></tr></thead>
                <tbody>
                  {report.parts.map((part) => (
                    <tr key={part.sku}>
                      <td>{part.sku}</td>
                      <td>{part.name}</td>
                      <td>{part.receivedQuantity}</td>
                      <td>{part.sources.map((source) => `${source.poNumber} (${source.quantity})`).join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          {reportGroups.map((group) => {
            const orders = report.groups[group.key];
            return (
              <section className="packing-list-group" key={group.key}>
                <header>
                  <h2>{group.label}</h2>
                  <span>{orders.length} order{orders.length === 1 ? "" : "s"}</span>
                </header>
                {orders.length === 0 ? (
                  <p className="packing-list-empty">{group.emptyMessage}</p>
                ) : (
                  <div className="packing-list-table-wrap">
                    <table className="packing-list-orders-table">
                      <thead><tr><th>Order</th><th>Customer</th><th>Order State</th><th>Matching Parts</th><th>Status</th></tr></thead>
                      <tbody><OrderRows orders={orders} /></tbody>
                    </table>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
