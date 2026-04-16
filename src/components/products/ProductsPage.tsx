import { useCallback, useEffect, useState } from "react";
import { getBackorders, updateStatus } from "../../services/api";
import type { Backorder } from "../../types";
import { Pagination } from "./Pagination";
import { ProductsTable } from "./ProductsTable";

type ProductsPageProps = {
  dataVersion: number;
  onOpenNotes: (sku: string) => void;
  onStatusChanged: () => void;
};

const pageSize = 30;

export function ProductsPage({
  dataVersion,
  onOpenNotes,
  onStatusChanged
}: ProductsPageProps) {
  const [backorders, setBackorders] = useState<Backorder[]>([]);
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

  const loadBackorders = useCallback(async () => {
    setIsLoading(true);
    setError("");

    try {
      const result = await getBackorders({
        page: currentPage,
        limit: pageSize,
        search: searchQuery
      });

      setBackorders(result.data);
      setTotalItems(result.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load products.");
    } finally {
      setIsLoading(false);
    }
  }, [currentPage, searchQuery]);

  useEffect(() => {
    loadBackorders();
  }, [loadBackorders, dataVersion]);

  async function handleStatusChange(id: number, status: string) {
    await updateStatus(id, status);
    onStatusChanged();
  }

  return (
    <section className="page" aria-labelledby="productsHeading">
      <h1 id="productsHeading">Product Availability</h1>

      <input
        type="text"
        value={searchInput}
        placeholder="Search SKU..."
        className="search-bar"
        aria-label="Search SKU"
        onChange={(event) => setSearchInput(event.target.value)}
      />

      {error && <p className="status-message error-message">{error}</p>}
      {isLoading && <p className="status-message">Loading products...</p>}

      <ProductsTable
        backorders={backorders}
        onOpenNotes={onOpenNotes}
        onStatusChange={handleStatusChange}
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
