import type { Product } from "../../types";

type ProductsTableProps = {
  products: Product[];
  onOpenNotes: (sku: string) => void;
};

export function ProductsTable({ products, onOpenNotes }: ProductsTableProps) {
  return (
    <table>
      <thead>
        <tr>
          <th>SKU</th>
          <th>Name</th>
          <th>Availability</th>
        </tr>
      </thead>
      <tbody>
        {products.length === 0 ? (
          <tr>
            <td colSpan={3}>No products found yet.</td>
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
                  className={`availability-badge ${
                    product.availability === "Available"
                      ? "availability-available"
                      : "availability-backorder"
                  }`}
                  title={`Quantity available: ${product.qtyAvailable}`}
                >
                  {product.availability}
                </span>
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}
