import type { VendorProduct } from "../../types";

type VendorProductsTableProps = {
  vendor: string;
  products: VendorProduct[];
  totalItems: number;
  onBackToVendors: () => void;
};

export function VendorProductsTable({
  vendor,
  products,
  totalItems,
  onBackToVendors
}: VendorProductsTableProps) {
  return (
    <section aria-label="Vendor products">
      <button
        type="button"
        className="secondary-action"
        onClick={onBackToVendors}
      >
        Back to vendors
      </button>

      <div className="vendor-products-header">
        <h1>{vendor}</h1>
        <p>
          {totalItems} product{totalItems === 1 ? "" : "s"}
        </p>
      </div>

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
              <td colSpan={3}>No products found for this vendor.</td>
            </tr>
          ) : (
            products.map((product) => (
              <tr key={product.id}>
                <td>{product.sku}</td>
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
    </section>
  );
}
