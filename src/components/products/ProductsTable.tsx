import type { Backorder } from "../../types";

type ProductsTableProps = {
  backorders: Backorder[];
  onOpenNotes: (sku: string) => void;
  onStatusChange: (id: number, status: string) => void;
};

const statusOptions = ["Backordered", "Available"];

export function ProductsTable({
  backorders,
  onOpenNotes,
  onStatusChange
}: ProductsTableProps) {
  return (
    <table>
      <thead>
        <tr>
          <th>SKU</th>
          <th>Vendor</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {backorders.length === 0 ? (
          <tr>
            <td colSpan={3}>No products found yet.</td>
          </tr>
        ) : (
          backorders.map((item) => (
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
              <td>{item.vendor || ""}</td>
              <td>
                <select
                  value={item.status}
                  aria-label={`Status for ${item.sku}`}
                  onChange={(event) => onStatusChange(item.id, event.target.value)}
                >
                  {statusOptions.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}
