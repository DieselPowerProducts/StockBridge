import { useEffect, useRef, useState } from "react";
import { getStockCheckProducts } from "../../services/api";
import type { Product, ProductStockUpdate } from "../../types";
import { Pagination } from "./Pagination";
import { ProductsTable } from "./ProductsTable";
import { applyProductStockUpdate } from "./productStockUpdates";

type StockCheckPageProps = {
  productStockUpdate: ProductStockUpdate | null;
  onOpenNotes: (sku: string) => void;
  refreshKey: number;
};

const pageSize = 30;

export function StockCheckPage({
  productStockUpdate,
  onOpenNotes,
  refreshKey
}: StockCheckPageProps) {
  const latestProductStockUpdate = useRef(productStockUpdate);
  const [products, setProducts] = useState<Product[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [refreshNonce, setRefreshNonce] = useState(0);
  const hasKitResults = products.some((product) => product.isKit);

  useEffect(() => {
    latestProductStockUpdate.current = productStockUpdate;
  }, [productStockUpdate]);

  useEffect(() => {
    let ignore = false;

    async function loadStockCheckProducts() {
      setIsLoading(true);
      setError("");

      try {
        const result = await getStockCheckProducts({
          page: currentPage,
          limit: pageSize,
          search: ""
        });

        if (!ignore) {
          setProducts(
            applyProductStockUpdate(result.data, latestProductStockUpdate.current)
          );
          setTotalItems(result.total);
        }
      } catch (err) {
        if (!ignore) {
          setError(
            err instanceof Error
              ? err.message
              : "Unable to load stock check products."
          );
        }
      } finally {
        if (!ignore) {
          setIsLoading(false);
        }
      }
    }

    loadStockCheckProducts();

    return () => {
      ignore = true;
    };
  }, [currentPage, refreshKey, refreshNonce]);

  useEffect(() => {
    if (!productStockUpdate) {
      return;
    }

    setProducts((current) =>
      applyProductStockUpdate(current, productStockUpdate)
    );

    if (hasKitResults) {
      setRefreshNonce((current) => current + 1);
    }
  }, [hasKitResults, productStockUpdate]);

  return (
    <section className="page" aria-labelledby="stockCheckHeading">
      <h1 id="stockCheckHeading">Stock Check</h1>

      {error && <p className="status-message error-message">{error}</p>}
      {isLoading && <p className="status-message">Loading stock check...</p>}

      <ProductsTable
        emptyMessage="No backordered or follow-up products found."
        products={products}
        onOpenNotes={onOpenNotes}
      />

      <Pagination
        currentPage={currentPage}
        limit={pageSize}
        totalItems={totalItems}
        onPageChange={setCurrentPage}
      />
    </section>
  );
}
