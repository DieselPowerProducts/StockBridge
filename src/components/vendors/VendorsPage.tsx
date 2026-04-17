import { useEffect, useState } from "react";
import { getVendorProducts, getVendors } from "../../services/api";
import type { VendorProduct, VendorSummary } from "../../types";
import { Pagination } from "../products/Pagination";
import { VendorProductsTable } from "./VendorProductsTable";
import { VendorsTable } from "./VendorsTable";

type VendorsPageProps = {
  selectedVendor: string;
  onBackToVendors: () => void;
  onSelectVendor: (vendor: string) => void;
};

const pageSize = 30;

export function VendorsPage({
  selectedVendor,
  onBackToVendors,
  onSelectVendor
}: VendorsPageProps) {
  const [vendors, setVendors] = useState<VendorSummary[]>([]);
  const [products, setProducts] = useState<VendorProduct[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let ignore = false;

    async function loadVendors() {
      setIsLoading(true);
      setError("");

      try {
        const result = await getVendors();

        if (!ignore) {
          setVendors(result);
        }
      } catch (err) {
        if (!ignore) {
          setError(err instanceof Error ? err.message : "Unable to load vendors.");
        }
      } finally {
        if (!ignore) {
          setIsLoading(false);
        }
      }
    }

    loadVendors();

    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [selectedVendor]);

  useEffect(() => {
    let ignore = false;

    async function loadVendorProducts() {
      if (!selectedVendor) {
        setProducts([]);
        return;
      }

      setIsLoading(true);
      setError("");

      try {
        const result = await getVendorProducts({
          vendorId: selectedVendor,
          page: currentPage,
          limit: pageSize
        });

        if (!ignore) {
          setProducts(result.data);
          setTotalItems(result.total);
        }
      } catch (err) {
        if (!ignore) {
          setError(
            err instanceof Error ? err.message : "Unable to load vendor products."
          );
        }
      } finally {
        if (!ignore) {
          setIsLoading(false);
        }
      }
    }

    loadVendorProducts();

    return () => {
      ignore = true;
    };
  }, [selectedVendor, currentPage]);

  const selectedVendorSummary = vendors.find(
    (vendor) => vendor.id === selectedVendor
  );
  const selectedVendorName = selectedVendorSummary?.vendor || selectedVendor;

  return (
    <section className="page" aria-labelledby="vendorsHeading">
      {error && <p className="status-message error-message">{error}</p>}
      {isLoading && <p className="status-message">Loading vendors...</p>}

      {selectedVendor ? (
        <>
          <VendorProductsTable
            vendor={selectedVendorName}
            products={products}
            totalItems={totalItems}
            onBackToVendors={onBackToVendors}
          />

          <Pagination
            currentPage={currentPage}
            limit={pageSize}
            totalItems={totalItems}
            onPageChange={setCurrentPage}
          />
        </>
      ) : (
        <>
          <h1 id="vendorsHeading">Vendors</h1>
          <VendorsTable vendors={vendors} onSelectVendor={onSelectVendor} />
        </>
      )}
    </section>
  );
}
