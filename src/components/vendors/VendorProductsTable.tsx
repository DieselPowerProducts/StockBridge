import type { VendorBackorder } from "../../types";

type VendorProductsTableProps = {
  vendor: string;
  products: VendorBackorder[];
  onBackToVendors: () => void;
};

export function VendorProductsTable({
  vendor,
  products,
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
          {products.length} product{products.length === 1 ? "" : "s"}
        </p>
      </div>

      <table>
        <thead>
          <tr>
            <th>SKU</th>
            <th>Status</th>
            <th>Last Updated</th>
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
                <td>{product.status || ""}</td>
                <td>{product.updated_at || ""}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </section>
  );
}
