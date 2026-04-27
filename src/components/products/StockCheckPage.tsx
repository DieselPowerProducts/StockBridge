import { useEffect, useRef, useState } from "react";
import { getStockCheckProducts } from "../../services/api";
import type {
  Product,
  ProductStockUpdate,
  StockCheckSort,
  VendorEmailSentUpdate
} from "../../types";
import { Pagination } from "./Pagination";
import { ProductsTable } from "./ProductsTable";
import { applyProductStockUpdate } from "./productStockUpdates";

type StockCheckPageProps = {
  productStockUpdate: ProductStockUpdate | null;
  vendorEmailSentUpdate: VendorEmailSentUpdate | null;
  onOpenNotes: (sku: string) => void;
  refreshKey: number;
};

const pageSize = 30;
const stockCheckSortOptions: Array<{ value: StockCheckSort; label: string }> = [
  { value: "yesterday", label: "Yesterday" },
  { value: "today", label: "Today" },
  { value: "tomorrow", label: "Tomorrow" },
  { value: "all", label: "All" }
];

function getLocalDateText() {
  const now = new Date();

  return new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
}

export function StockCheckPage({
  productStockUpdate,
  vendorEmailSentUpdate,
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
  const [sort, setSort] = useState<StockCheckSort>("all");

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
          search: "",
          sort,
          referenceDate: getLocalDateText()
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
  }, [currentPage, refreshKey, refreshNonce, sort]);

  useEffect(() => {
    if (!productStockUpdate) {
      return;
    }

    setProducts((current) =>
      applyProductStockUpdate(current, productStockUpdate)
    );
    setRefreshNonce((current) => current + 1);
  }, [productStockUpdate]);

  useEffect(() => {
    if (!vendorEmailSentUpdate?.sku) {
      return;
    }

    setProducts((current) =>
      current.map((product) =>
        product.sku === vendorEmailSentUpdate.sku
          ? {
              ...product,
              vendorEmailSent: true
            }
          : product
      )
    );
  }, [vendorEmailSentUpdate]);

  const emptyMessageBySort: Record<StockCheckSort, string> = {
    yesterday: "No stock check products with follow-up dates from yesterday.",
    today: "No stock check products with follow-up dates from today.",
    tomorrow: "No stock check products with follow-up dates from tomorrow.",
    all: "No backordered or follow-up products found."
  };

  return (
    <section className="page stock-check-page" aria-labelledby="stockCheckHeading">
      <div className="stock-check-toolbar">
        <h1 id="stockCheckHeading">Stock Check</h1>

        <label className="stock-check-sort-control">
          <span>Show</span>
          <select
            value={sort}
            aria-label="Sort stock check products"
            onChange={(event) => {
              setSort(event.target.value as StockCheckSort);
              setCurrentPage(1);
            }}
          >
            {stockCheckSortOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <p className="status-message error-message">{error}</p>}
      {isLoading && <p className="status-message">Loading stock check...</p>}

      <ProductsTable
        emptyMessage={emptyMessageBySort[sort]}
        products={products}
        onOpenNotes={onOpenNotes}
        showVendorEmailStatus
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
