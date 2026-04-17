import type { VendorSummary } from "../../types";

type VendorsTableProps = {
  vendors: VendorSummary[];
  onSelectVendor: (vendor: string) => void;
};

export function VendorsTable({ vendors, onSelectVendor }: VendorsTableProps) {
  return (
    <div className="vendor-list-panel" aria-label="Vendor list">
      <table>
        <thead>
          <tr>
            <th>Vendor</th>
            <th>Products</th>
          </tr>
        </thead>
        <tbody>
          {vendors.length === 0 ? (
            <tr>
              <td colSpan={2}>No vendors found yet.</td>
            </tr>
          ) : (
            vendors.map((vendor) => (
              <tr key={vendor.id}>
                <td>
                  <button
                    type="button"
                    className="vendor-link"
                    onClick={() => onSelectVendor(vendor.id)}
                  >
                    {vendor.vendor}
                  </button>
                </td>
                <td>{vendor.productCount}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
