import { useEffect, useState } from "react";
import { Sidebar } from "./components/layout/Sidebar";
import { ProductsPage } from "./components/products/ProductsPage";
import { VendorsPage } from "./components/vendors/VendorsPage";
import type { AppRoute } from "./types";

function parseRoute(): AppRoute {
  const hash = window.location.hash.replace(/^#\/?/, "");
  const parts = hash.split("/").filter(Boolean);
  const page = parts[0] || "products";
  const vendor = parts.length > 1 ? decodeURIComponent(parts.slice(1).join("/")) : "";

  if (page === "vendors" || page === "products") {
    return { page, vendor };
  }

  return { page: "products", vendor: "" };
}

function setHashRoute(page: AppRoute["page"], vendor = "") {
  const nextHash = vendor
    ? `#/${page}/${encodeURIComponent(vendor)}`
    : `#/${page}`;

  if (window.location.hash === nextHash) {
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    return;
  }

  window.location.hash = nextHash;
}

export function App() {
  const [route, setRoute] = useState<AppRoute>(() => parseRoute());

  useEffect(() => {
    const handleHashChange = () => setRoute(parseRoute());

    window.addEventListener("hashchange", handleHashChange);

    if (!window.location.hash) {
      setHashRoute("products");
    }

    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  return (
    <div className="container">
      <Sidebar currentPage={route.page} onNavigate={(page) => setHashRoute(page)} />

      <main className="main">
        {route.page === "products" && (
          <ProductsPage />
        )}

        {route.page === "vendors" && (
          <VendorsPage
            selectedVendor={route.vendor}
            dataVersion={0}
            onBackToVendors={() => setHashRoute("vendors")}
            onSelectVendor={(vendor) => setHashRoute("vendors", vendor)}
          />
        )}
      </main>
    </div>
  );
}
