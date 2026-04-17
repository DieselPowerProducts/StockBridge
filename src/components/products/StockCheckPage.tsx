import { useEffect, useState } from "react";
import { getStockCheckProducts } from "../../services/api";
import type { Product } from "../../types";
import { Pagination } from "./Pagination";
import { ProductsTable } from "./ProductsTable";

type StockCheckPageProps = {
  onOpenNotes: (sku: string) => void;
  refreshKey: number;
};

const pageSize = 30;

export function StockCheckPage({
  onOpenNotes,
  refreshKey
}: StockCheckPageProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

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
          setProducts(result.data);
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
  }, [currentPage, refreshKey]);

  return (
    <section className="page" aria-labelledby="stockCheckHeading">
      <h1 id="stockCheckHeading">Stock Check</h1>

      {error && <p className="status-message error-message">{error}</p>}
      {isLoading && <p className="status-message">Loading stock check...</p>}

      <ProductsTable
        emptyMessage="No backordered products found."
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
