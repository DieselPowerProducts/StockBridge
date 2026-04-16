import { useEffect, useState } from "react";
import { getVendorBackorders, getVendors } from "../../services/api";
import type { VendorBackorder, VendorSummary } from "../../types";
import { VendorProductsTable } from "./VendorProductsTable";
import { VendorsTable } from "./VendorsTable";

type VendorsPageProps = {
  selectedVendor: string;
  dataVersion: number;
  onBackToVendors: () => void;
  onSelectVendor: (vendor: string) => void;
};

export function VendorsPage({
  selectedVendor,
  dataVersion,
  onBackToVendors,
  onSelectVendor
}: VendorsPageProps) {
  const [vendors, setVendors] = useState<VendorSummary[]>([]);
  const [products, setProducts] = useState<VendorBackorder[]>([]);
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
  }, [dataVersion]);

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
        const result = await getVendorBackorders(selectedVendor);

        if (!ignore) {
          setProducts(result);
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
  }, [selectedVendor, dataVersion]);

  return (
    <section className="page" aria-labelledby="vendorsHeading">
      {error && <p className="status-message error-message">{error}</p>}
      {isLoading && <p className="status-message">Loading vendors...</p>}

      {selectedVendor ? (
        <VendorProductsTable
          vendor={selectedVendor}
          products={products}
          onBackToVendors={onBackToVendors}
        />
      ) : (
        <>
          <h1 id="vendorsHeading">Vendors</h1>
          <VendorsTable vendors={vendors} onSelectVendor={onSelectVendor} />
        </>
      )}
    </section>
  );
}
