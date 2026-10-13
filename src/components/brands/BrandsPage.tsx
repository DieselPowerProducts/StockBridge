import { useEffect, useState } from "react";
import { getBrandProducts, getBrands } from "../../services/api";
import type { BrandProduct, BrandSummary } from "../../types";
import { Pagination } from "../products/Pagination";

type Props = {
  selectedBrand: string;
  onBackToBrands: () => void;
  onSelectBrand: (brandKey: string) => void;
  onOpenNotes: (sku: string) => void;
};

const pageSize = 30;

function formatSyncTime(value: string) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
}

export function BrandsPage({ selectedBrand, onBackToBrands, onSelectBrand, onOpenNotes }: Props) {
  const [brands, setBrands] = useState<BrandSummary[]>([]);
  const [products, setProducts] = useState<BrandProduct[]>([]);
  const [brandName, setBrandName] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalProducts, setTotalProducts] = useState(0);
  const [syncedAt, setSyncedAt] = useState("");
  const [ready, setReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setPage(1);
    setSearchInput("");
    setSearch("");
    setBrandName("");
  }, [selectedBrand]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    const request = selectedBrand
      ? getBrandProducts({ brand: selectedBrand, page, limit: pageSize, search })
      : getBrands({ page, limit: pageSize, search });
    void request.then((result) => {
      if (cancelled) return;
      setSyncedAt(result.syncedAt);
      setTotal(result.total);
      if ("ready" in result) {
        setBrands(result.data);
        setTotalProducts(result.totalProducts);
        setReady(result.ready);
      } else {
        setProducts(result.data);
        setBrandName(result.brandName);
      }
    }).catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : "Unable to load brands.");
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [selectedBrand, page, search]);

  return (
    <section className="page brands-page" aria-labelledby="brandsHeading">
      <header className="brands-page-header">
        <div>
          {selectedBrand && (
            <button type="button" className="brands-back" onClick={onBackToBrands}>
              <span aria-hidden="true">&larr;</span> Brands
            </button>
          )}
          <h1 id="brandsHeading">{selectedBrand ? brandName || "Brand" : "Brands"}</h1>
        </div>
        {syncedAt && <span className="brands-synced">Shopify synced {formatSyncTime(syncedAt)}</span>}
      </header>

      <div className="brands-toolbar">
        <input
          type="search"
          className="search-bar"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder={selectedBrand ? "Search SKU or name..." : "Search brands..."}
          aria-label={selectedBrand ? "Search brand products" : "Search brands"}
        />
        {!selectedBrand && ready && <span>{totalProducts.toLocaleString()} SKUs</span>}
        {selectedBrand && !loading && <span>{total.toLocaleString()} SKUs</span>}
      </div>

      {error && <p className="status-message error-message">{error}</p>}
      {loading && <p className="status-message" role="status">Loading brands...</p>}
      {!loading && !selectedBrand && !ready && (
        <p className="status-message">Waiting for the first Shopify brand sync.</p>
      )}
      {!loading && ready && !selectedBrand && (
        <div className="products-table-scroll brands-table-scroll">
          <table>
            <thead><tr><th>Shopify vendor</th><th>SKUs</th></tr></thead>
            <tbody>
              {brands.length === 0 ? (
                <tr><td colSpan={2}>No brands found.</td></tr>
              ) : brands.map((brand) => (
                <tr key={brand.key}>
                  <td>
                    <button type="button" className="sku-link" onClick={() => onSelectBrand(brand.key)}>
                      {brand.name}
                    </button>
                    {brand.key === "conflict" && <small className="brands-review-label">Review</small>}
                  </td>
                  <td>{brand.productCount.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!loading && selectedBrand && (
        <div className="products-table-scroll brands-table-scroll">
          <table>
            <thead><tr><th>SKU</th><th>Product</th><th>Type</th></tr></thead>
            <tbody>
              {products.length === 0 ? (
                <tr><td colSpan={3}>No matching products.</td></tr>
              ) : products.map((product) => (
                <tr key={product.id}>
                  <td><button type="button" className="sku-link" onClick={() => onOpenNotes(product.sku)}>{product.sku}</button></td>
                  <td>{product.name}</td>
                  <td>{product.isKit ? "Kit" : "Part"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!loading && ready && total > pageSize && (
        <Pagination currentPage={page} limit={pageSize} totalItems={total} onPageChange={setPage} />
      )}
    </section>
  );
}
