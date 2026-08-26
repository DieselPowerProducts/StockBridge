import { useEffect, useState } from "react";
import {
  getVendorProducts,
  getVendors,
  updateVendorSettings
} from "../../services/api";
import type {
  VendorDetails,
  VendorProduct,
  VendorSummary
} from "../../types";
import { Pagination } from "../products/Pagination";
import { VendorProductsTable } from "./VendorProductsTable";
import { VendorsTable } from "./VendorsTable";

type VendorsPageProps = {
  selectedVendor: string;
  onBackToVendors: () => void;
  onOpenNotes: (sku: string) => void;
  onSelectVendor: (vendor: string) => void;
};

const pageSize = 30;

export function VendorsPage({
  selectedVendor,
  onBackToVendors,
  onOpenNotes,
  onSelectVendor
}: VendorsPageProps) {
  const [vendors, setVendors] = useState<VendorSummary[]>([]);
  const [products, setProducts] = useState<VendorProduct[]>([]);
  const [selectedVendorDetails, setSelectedVendorDetails] = useState<VendorDetails | null>(null);
  const [buildTimeDraft, setBuildTimeDraft] = useState("");
  const [vendorCurrentPage, setVendorCurrentPage] = useState(1);
  const [vendorSearchInput, setVendorSearchInput] = useState("");
  const [vendorSearchQuery, setVendorSearchQuery] = useState("");
  const [vendorTotalItems, setVendorTotalItems] = useState(0);
  const [productCurrentPage, setProductCurrentPage] = useState(1);
  const [productSearchInput, setProductSearchInput] = useState("");
  const [productSearchQuery, setProductSearchQuery] = useState("");
  const [productTotalItems, setProductTotalItems] = useState(0);
  const [isVendorsLoading, setIsVendorsLoading] = useState(false);
  const [isProductsLoading, setIsProductsLoading] = useState(false);
  const [isVendorSettingsSaving, setIsVendorSettingsSaving] = useState(false);
  const [vendorSettingsStatus, setVendorSettingsStatus] = useState("");
  const [productRefreshNonce, setProductRefreshNonce] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setVendorSearchQuery(vendorSearchInput.trim());
      setVendorCurrentPage(1);
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [vendorSearchInput]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setProductSearchQuery(productSearchInput.trim());
      setProductCurrentPage(1);
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [productSearchInput]);

  useEffect(() => {
    if (selectedVendor) return;
    let ignore = false;
    setIsVendorsLoading(true);
    setError("");
    void getVendors({ page: vendorCurrentPage, limit: pageSize, search: vendorSearchQuery })
      .then((result) => {
        if (ignore) return;
        setVendors(result.data);
        setVendorTotalItems(result.total);
      })
      .catch((loadError) => {
        if (!ignore) setError(loadError instanceof Error ? loadError.message : "Unable to load vendors.");
      })
      .finally(() => {
        if (!ignore) setIsVendorsLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [selectedVendor, vendorCurrentPage, vendorSearchQuery]);

  useEffect(() => {
    setSelectedVendorDetails(null);
    setBuildTimeDraft("");
    setVendorSettingsStatus("");
    setProductCurrentPage(1);
    setProductSearchInput("");
    setProductSearchQuery("");
  }, [selectedVendor]);

  useEffect(() => {
    if (!selectedVendor) {
      setProducts([]);
      setProductTotalItems(0);
      return;
    }
    let ignore = false;
    setIsProductsLoading(true);
    setError("");
    void getVendorProducts({
      vendorId: selectedVendor,
      page: productCurrentPage,
      limit: pageSize,
      search: productSearchQuery
    })
      .then((result) => {
        if (ignore) return;
        setProducts(result.data);
        setSelectedVendorDetails(result.vendor);
        setBuildTimeDraft(result.vendor.buildTime || "");
        setProductTotalItems(result.total);
      })
      .catch((loadError) => {
        if (!ignore) setError(loadError instanceof Error ? loadError.message : "Unable to load vendor products.");
      })
      .finally(() => {
        if (!ignore) setIsProductsLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [selectedVendor, productCurrentPage, productRefreshNonce, productSearchQuery]);

  async function saveVendorDetails(nextBuiltToOrder: boolean, nextBuildTime: string) {
    if (!selectedVendor) return;
    setIsVendorSettingsSaving(true);
    setVendorSettingsStatus("Saving vendor settings...");
    setError("");
    try {
      const result = await updateVendorSettings({
        vendorId: selectedVendor,
        builtToOrder: nextBuiltToOrder,
        buildTime: nextBuildTime
      });
      setSelectedVendorDetails(result);
      setBuildTimeDraft(result.buildTime || "");
      const reconciliation = result.btoReconciliation;
      setVendorSettingsStatus(
        reconciliation?.converted
          ? `Vendor settings saved. ${reconciliation.converted} backordered product${reconciliation.converted === 1 ? "" : "s"} updated to Built to Order.${reconciliation.shopifyFailed ? ` ${reconciliation.shopifyFailed} Shopify updates could not be completed.` : ""}`
          : "Vendor settings saved."
      );
      setProductRefreshNonce((current) => current + 1);
    } catch (saveError) {
      setVendorSettingsStatus("");
      setError(saveError instanceof Error ? saveError.message : "Unable to save vendor settings.");
    } finally {
      setIsVendorSettingsSaving(false);
    }
  }

  const activeVendor: VendorDetails = selectedVendorDetails || {
    id: selectedVendor,
    vendor: selectedVendor,
    builtToOrder: false,
    buildTime: ""
  };

  return (
    <section className="page" aria-labelledby="vendorsHeading">
      {error ? <p className="status-message error-message">{error}</p> : null}
      {isVendorsLoading ? <p className="status-message">Loading vendors...</p> : null}
      {isProductsLoading ? <p className="status-message">Loading vendor products...</p> : null}

      {selectedVendor ? (
        <>
          <VendorProductsTable
            vendor={activeVendor}
            products={products}
            totalItems={productTotalItems}
            searchValue={productSearchInput}
            buildTimeValue={buildTimeDraft}
            isSavingSettings={isVendorSettingsSaving}
            settingsStatus={vendorSettingsStatus}
            onSearchChange={setProductSearchInput}
            onBuiltToOrderChange={(checked) => void saveVendorDetails(checked, buildTimeDraft)}
            onBuildTimeChange={setBuildTimeDraft}
            onBuildTimeBlur={() => {
              if (selectedVendorDetails?.builtToOrder && buildTimeDraft !== selectedVendorDetails.buildTime) {
                void saveVendorDetails(true, buildTimeDraft);
              }
            }}
            onBackToVendors={onBackToVendors}
            onOpenNotes={onOpenNotes}
          />
          <Pagination currentPage={productCurrentPage} limit={pageSize} totalItems={productTotalItems} onPageChange={setProductCurrentPage} />
        </>
      ) : (
        <>
          <h1 id="vendorsHeading">Vendors</h1>
          <input
            type="text"
            value={vendorSearchInput}
            placeholder="Search vendors..."
            className="search-bar"
            aria-label="Search vendors"
            onChange={(event) => setVendorSearchInput(event.target.value)}
          />
          <VendorsTable vendors={vendors} onSelectVendor={onSelectVendor} />
          <Pagination currentPage={vendorCurrentPage} limit={pageSize} totalItems={vendorTotalItems} onPageChange={setVendorCurrentPage} />
        </>
      )}
    </section>
  );
}
