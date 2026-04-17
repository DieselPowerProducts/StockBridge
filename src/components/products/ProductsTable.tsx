import type { Product } from "../../types";

type ProductsTableProps = {
  emptyMessage?: string;
  products: Product[];
  onOpenNotes: (sku: string) => void;
};

function getAvailabilityClass(product: Product) {
  if (product.availability === "Available") {
    return "availability-available";
  }

  return "availability-backorder";
}

function formatFollowUpDate(value: string) {
  if (!value) {
    return "";
  }

  const [year, month, day] = value.split("-").map(Number);

  if (!year || !month || !day) {
    return value;
  }

  return new Date(year, month - 1, day).toLocaleDateString();
}

export function ProductsTable({
  emptyMessage = "No products found yet.",
  products,
  onOpenNotes
}: ProductsTableProps) {
  return (
    <table>
      <thead>
        <tr>
          <th>SKU</th>
          <th>Name</th>
          <th>Availability</th>
          <th>Follow Up</th>
        </tr>
      </thead>
      <tbody>
        {products.length === 0 ? (
          <tr>
            <td colSpan={4}>{emptyMessage}</td>
          </tr>
        ) : (
          products.map((product) => (
            <tr key={product.id}>
              <td>
                <button
                  type="button"
                  className="sku-link"
                  onClick={() => onOpenNotes(product.sku)}
                >
                  {product.sku}
                </button>
              </td>
              <td>{product.name}</td>
              <td>
                <span
                  className={`availability-badge ${getAvailabilityClass(product)}`}
                  title={`Quantity available: ${product.qtyAvailable}`}
                >
                  {product.availability}
                </span>
              </td>
              <td>
                {product.availability === "Backorder"
                  ? formatFollowUpDate(product.followUpDate)
                  : ""}
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}
