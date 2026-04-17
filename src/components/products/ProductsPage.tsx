import { useEffect, useState } from "react";
import { getProducts } from "../../services/api";
import type { Product } from "../../types";
import { Pagination } from "./Pagination";
import { ProductsTable } from "./ProductsTable";

type ProductsPageProps = {
  onOpenNotes: (sku: string) => void;
  refreshKey: number;
};

const pageSize = 30;

export function ProductsPage({ onOpenNotes, refreshKey }: ProductsPageProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [totalItems, setTotalItems] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearchQuery(searchInput);
      setCurrentPage(1);
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => {
    const search = searchQuery.trim();

    if (!search) {
      setProducts([]);
      setTotalItems(0);
      setIsLoading(false);
      setError("");

      return;
    }

    let ignore = false;

    async function loadProducts() {
      setIsLoading(true);
      setError("");

      try {
        const result = await getProducts({
          page: currentPage,
          limit: pageSize,
          search
        });

        if (!ignore) {
          setProducts(result.data);
          setTotalItems(result.total);
        }
      } catch (err) {
        if (!ignore) {
          setError(
            err instanceof Error ? err.message : "Unable to load products."
          );
        }
      } finally {
        if (!ignore) {
          setIsLoading(false);
        }
      }
    }

    loadProducts();

    return () => {
      ignore = true;
    };
  }, [currentPage, refreshKey, searchQuery]);

  const hasSearch = Boolean(searchQuery.trim());

  return (
    <section
      className={`page products-page${hasSearch ? "" : " products-page-empty"}`}
      aria-labelledby="productsHeading"
    >
      <div className="products-search-panel">
        <h1 id="productsHeading">Products</h1>

        <input
          type="text"
          value={searchInput}
          placeholder="Search SKU or name..."
          className="search-bar product-search-bar"
          aria-label="Search products"
          onChange={(event) => setSearchInput(event.target.value)}
        />
      </div>

      {error && <p className="status-message error-message">{error}</p>}
      {isLoading && <p className="status-message">Loading products...</p>}

      {hasSearch && (
        <>
          <ProductsTable
            emptyMessage="No products found."
            products={products}
            onOpenNotes={onOpenNotes}
          />

          <Pagination
            currentPage={currentPage}
            limit={pageSize}
            totalItems={totalItems}
            onPageChange={setCurrentPage}
          />
        </>
      )}
    </section>
  );
}
