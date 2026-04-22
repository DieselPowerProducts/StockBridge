import type { VendorDetails, VendorProduct } from "../../types";

type VendorProductsTableProps = {
  vendor: VendorDetails;
  products: VendorProduct[];
  totalItems: number;
  searchValue: string;
  buildTimeValue: string;
  isSavingSettings: boolean;
  settingsStatus: string;
  onSearchChange: (value: string) => void;
  onBuiltToOrderChange: (checked: boolean) => void;
  onBuildTimeChange: (value: string) => void;
  onBuildTimeBlur: () => void;
  onBackToVendors: () => void;
};

function getAvailabilityClass(product: VendorProduct) {
  if (product.availability === "Available") {
    return "availability-available";
  }

  if (product.availability === "Built to Order") {
    return "availability-built-to-order";
  }

  return "availability-backorder";
}

export function VendorProductsTable({
  vendor,
  products,
  totalItems,
  searchValue,
  buildTimeValue,
  isSavingSettings,
  settingsStatus,
  onSearchChange,
  onBuiltToOrderChange,
  onBuildTimeChange,
  onBuildTimeBlur,
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
        <div className="vendor-products-title-row">
          <h1>{vendor.vendor}</h1>

          <label className="vendor-built-to-order-toggle">
            <input
              type="checkbox"
              checked={vendor.builtToOrder}
              disabled={isSavingSettings}
              onChange={(event) => onBuiltToOrderChange(event.target.checked)}
            />
            <span>Built to Order</span>
          </label>
        </div>

        <p>
          {totalItems} product{totalItems === 1 ? "" : "s"}
        </p>

        {vendor.builtToOrder && (
          <label className="vendor-build-time-field">
            <span>Build Time</span>
            <input
              type="text"
              value={buildTimeValue}
              placeholder="e.g. 4-6 weeks"
              disabled={isSavingSettings}
              onBlur={onBuildTimeBlur}
              onChange={(event) => onBuildTimeChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.currentTarget.blur();
                }
              }}
            />
          </label>
        )}

        {settingsStatus && <p className="vendor-settings-status">{settingsStatus}</p>}
      </div>

      <input
        type="text"
        value={searchValue}
        placeholder="Search SKU or name..."
        className="search-bar"
        aria-label={`Search ${vendor.vendor} products`}
        onChange={(event) => onSearchChange(event.target.value)}
      />

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
              <tr key={product.vendorProductId}>
                <td>{product.sku}</td>
                <td>{product.name}</td>
                <td>
                  <span
                    className={`availability-badge ${getAvailabilityClass(product)}`}
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
