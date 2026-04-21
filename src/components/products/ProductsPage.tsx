import { useEffect, useRef, useState } from "react";
import { getProducts } from "../../services/api";
import type { Product, ProductStockUpdate } from "../../types";
import { Pagination } from "./Pagination";
import { ProductsTable } from "./ProductsTable";
import { applyProductStockUpdate } from "./productStockUpdates";

type ProductsPageProps = {
  productStockUpdate: ProductStockUpdate | null;
  onOpenNotes: (sku: string) => void;
};

const pageSize = 30;
const productSearchStorageKey = "stockbridge:products-search";

function getStoredProductSearch() {
  try {
    return window.localStorage.getItem(productSearchStorageKey) || "";
  } catch {
    return "";
  }
}

function storeProductSearch(value: string) {
  try {
    const search = value.trim();

    if (search) {
      window.localStorage.setItem(productSearchStorageKey, search);
      return;
    }

    window.localStorage.removeItem(productSearchStorageKey);
  } catch {
    // The search still works if browser storage is unavailable.
  }
}

export function ProductsPage({
  productStockUpdate,
  onOpenNotes
}: ProductsPageProps) {
  const latestProductStockUpdate = useRef(productStockUpdate);
  const [products, setProducts] = useState<Product[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchInput, setSearchInput] = useState(getStoredProductSearch);
  const [searchQuery, setSearchQuery] = useState(getStoredProductSearch);
  const [totalItems, setTotalItems] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    storeProductSearch(searchInput);
  }, [searchInput]);

  useEffect(() => {
    latestProductStockUpdate.current = productStockUpdate;
  }, [productStockUpdate]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearchQuery(searchInput.trim());
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
          setProducts(
            applyProductStockUpdate(result.data, latestProductStockUpdate.current)
          );
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
  }, [currentPage, searchQuery]);

  useEffect(() => {
    if (!productStockUpdate) {
      return;
    }

    setProducts((current) =>
      applyProductStockUpdate(current, productStockUpdate)
    );
  }, [productStockUpdate]);

  const hasSearch = Boolean(searchQuery.trim());

  return (
    <section className="page products-page" aria-labelledby="productsHeading">
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
            showFollowUp={false}
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
