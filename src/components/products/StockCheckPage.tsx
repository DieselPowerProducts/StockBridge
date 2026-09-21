import { useEffect, useRef, useState } from "react";
import { getStockCheckProducts } from "../../services/api";
import type {
  Product,
  FollowUpOverrides,
  ProductStockUpdate,
  StockCheckSort,
  VendorEmailSentUpdate
} from "../../types";
import { Pagination } from "./Pagination";
import { ProductsTable } from "./ProductsTable";
import { applyProductStockUpdate } from "./productStockUpdates";

type StockCheckPageProps = {
  productStockUpdate: ProductStockUpdate | null;
  followUpOverrides: FollowUpOverrides;
  vendorEmailSentUpdate: VendorEmailSentUpdate | null;
  onOpenNotes: (sku: string) => void;
};

const pageSize = 30;
const stockCheckSortOptions: Array<{ value: StockCheckSort; label: string }> = [
  { value: "yesterday", label: "Yesterday" },
  { value: "today", label: "Today" },
  { value: "tomorrow", label: "Tomorrow" },
  { value: "no-follow-up", label: "No follow up" },
  { value: "all", label: "All" }
];

function getLocalDateText() {
  const now = new Date();

  return new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
}

function addDaysToDateText(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);

  date.setDate(date.getDate() + days);

  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
}

function matchesStockCheckFilter(product: Product, sort: StockCheckSort) {
  const followUpDate = product.followUpDate || "";
  const isStockCheckProduct =
    product.availability !== "Available" || Boolean(followUpDate);

  if (!isStockCheckProduct) {
    return false;
  }

  if (sort === "all") {
    return true;
  }

  if (sort === "no-follow-up") {
    return !followUpDate;
  }

  const offsetBySort: Record<"yesterday" | "today" | "tomorrow", number> = {
    yesterday: -1,
    today: 0,
    tomorrow: 1
  };

  return followUpDate === addDaysToDateText(getLocalDateText(), offsetBySort[sort]);
}

function normalizeSku(value: string) {
  return value.trim().toUpperCase();
}

function compareStockCheckProducts(left: Product, right: Product) {
  const leftDate = left.followUpDate || "";
  const rightDate = right.followUpDate || "";

  if (leftDate && rightDate && leftDate !== rightDate) {
    return leftDate.localeCompare(rightDate);
  }

  if (leftDate && !rightDate) {
    return -1;
  }

  if (!leftDate && rightDate) {
    return 1;
  }

  return left.sku.localeCompare(right.sku, undefined, {
    sensitivity: "base"
  });
}

function applyAndFilterStockCheckProducts(
  products: Product[],
  productStockUpdate: ProductStockUpdate | null,
  followUpOverrides: FollowUpOverrides,
  sort: StockCheckSort,
  vendorEmailSentSkus: Set<string> = new Set()
) {
  return applyProductStockUpdate(products, productStockUpdate)
    .map((product) => {
      const overrideKey = normalizeSku(product.sku);
      const vendorEmailSent = vendorEmailSentSkus.has(overrideKey)
        ? true
        : product.vendorEmailSent;

      if (!Object.prototype.hasOwnProperty.call(followUpOverrides, overrideKey)) {
        return {
          ...product,
          vendorEmailSent
        };
      }

      return {
        ...product,
        followUpDate: followUpOverrides[overrideKey] || "",
        vendorEmailSent
      };
    })
    .filter((product) => matchesStockCheckFilter(product, sort))
    .sort(compareStockCheckProducts);
}

export function StockCheckPage({
  productStockUpdate,
  followUpOverrides,
  vendorEmailSentUpdate,
  onOpenNotes
}: StockCheckPageProps) {
  const latestProductStockUpdate = useRef(productStockUpdate);
  const latestFollowUpOverrides = useRef(followUpOverrides);
  const handledUpdate = useRef(productStockUpdate);
  const vendorEmailSentSkus = useRef(new Set<string>());
  const productsRef = useRef<Product[]>([]);
  const requestVersion = useRef(0);
  const tableRef = useRef<HTMLDivElement>(null);
  const [reservedHeight, setReservedHeight] = useState(0);
  const [products, setProducts] = useState<Product[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [sort, setSort] = useState<StockCheckSort>("all");
  const [refreshToken, setRefreshToken] = useState(0);

  function updateProducts(nextProducts: Product[]) {
    productsRef.current = nextProducts;
    setProducts(nextProducts);
  }

  function reserveTableHeight() {
    setReservedHeight(tableRef.current?.getBoundingClientRect().height || 0);
  }

  useEffect(() => {
    latestProductStockUpdate.current = productStockUpdate;
    latestFollowUpOverrides.current = followUpOverrides;
    if (!productStockUpdate || handledUpdate.current === productStockUpdate) return;
    handledUpdate.current = productStockUpdate;

    const currentProducts = productsRef.current;
    const previous = currentProducts.find(
      (product) => normalizeSku(product.sku) === normalizeSku(productStockUpdate.sku)
    );
    const changed = Boolean(
      productStockUpdate.followUpSaved ||
      !previous ||
      previous.availability !== productStockUpdate.availability ||
      previous.qtyAvailable !== productStockUpdate.qtyAvailable ||
      (productStockUpdate.followUpDate !== undefined &&
        previous.followUpDate !== productStockUpdate.followUpDate)
    );
    if (!changed) return;

    // Invalidate in-flight responses before the replacement request starts.
    requestVersion.current += 1;
    reserveTableHeight();
    if (productStockUpdate.followUpSaved) {
      vendorEmailSentSkus.current.delete(normalizeSku(productStockUpdate.sku));
    }
    const nextProducts = applyAndFilterStockCheckProducts(
      currentProducts, productStockUpdate, followUpOverrides, sort,
      vendorEmailSentSkus.current
    );
    updateProducts(nextProducts);
    setTotalItems((total) => Math.max(0, total - (currentProducts.length - nextProducts.length)));
    setRefreshToken((token) => token + 1);
  }, [productStockUpdate, followUpOverrides, sort]);

  useEffect(() => {
    let ignore = false;
    const version = ++requestVersion.current;
    const referenceDate = getLocalDateText();
    const isCurrent = () => !ignore && version === requestVersion.current;

    async function loadPage() {
      reserveTableHeight();
      setIsLoading(true);
      setError("");
      try {
        const result = await getStockCheckProducts({
          page: currentPage,
          limit: pageSize,
          search: "",
          sort,
          referenceDate,
          bypassCache: true
        });
        if (!isCurrent()) return;

        const lastPage = Math.max(1, result.totalPages);
        setTotalItems(result.total);
        if (currentPage > lastPage) {
          setCurrentPage(lastPage);
          return;
        }
        updateProducts(applyAndFilterStockCheckProducts(
          result.data,
          latestProductStockUpdate.current,
          latestFollowUpOverrides.current,
          sort,
          vendorEmailSentSkus.current
        ));
      } catch (err) {
        if (isCurrent()) {
          setError(err instanceof Error ? err.message : "Unable to load stock check products.");
        }
      } finally {
        if (isCurrent()) {
          setIsLoading(false);
          setReservedHeight(0);
        }
      }
    }
    void loadPage();
    return () => { ignore = true; };
  }, [currentPage, refreshToken, sort]);

  useEffect(() => {
    if (!vendorEmailSentUpdate?.sku) return;
    const emailedSku = normalizeSku(vendorEmailSentUpdate.sku);
    vendorEmailSentSkus.current.add(emailedSku);
    updateProducts(productsRef.current.map((product) =>
      normalizeSku(product.sku) === emailedSku
        ? { ...product, vendorEmailSent: true }
        : product
    ));
  }, [vendorEmailSentUpdate]);

  const emptyMessageBySort: Record<StockCheckSort, string> = {
    yesterday: "No stock check products with follow-up dates from yesterday.",
    today: "No stock check products with follow-up dates from today.",
    tomorrow: "No stock check products with follow-up dates from tomorrow.",
    "no-follow-up": "No stock check products without follow-up dates.",
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
      <p className="status-message" role="status" style={{ minHeight: "1.5em" }}>
        {isLoading ? "Loading stock check..." : "\u00a0"}
      </p>

      <div ref={tableRef} aria-busy={isLoading} style={{ minHeight: reservedHeight || undefined }}>
        <ProductsTable
          emptyMessage={emptyMessageBySort[sort]}
          products={products}
          onOpenNotes={onOpenNotes}
          showVendorEmailStatus
        />
      </div>

      <Pagination
        currentPage={currentPage}
        limit={pageSize}
        totalItems={totalItems}
        onPageChange={setCurrentPage}
      />
    </section>
  );
}
