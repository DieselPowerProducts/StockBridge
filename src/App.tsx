import { useCallback, useEffect, useState } from "react";
import { ImportPage } from "./components/import/ImportPage";
import { Sidebar } from "./components/layout/Sidebar";
import { NotesModal } from "./components/notes/NotesModal";
import { ProductsPage } from "./components/products/ProductsPage";
import { VendorsPage } from "./components/vendors/VendorsPage";
import type { AppRoute } from "./types";

function parseRoute(): AppRoute {
  const hash = window.location.hash.replace(/^#\/?/, "");
  const parts = hash.split("/").filter(Boolean);
  const page = parts[0] || "products";
  const vendor = parts.length > 1 ? decodeURIComponent(parts.slice(1).join("/")) : "";

  if (page === "import" || page === "vendors" || page === "products") {
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
  const [selectedSku, setSelectedSku] = useState("");
  const [dataVersion, setDataVersion] = useState(0);

  useEffect(() => {
    const handleHashChange = () => setRoute(parseRoute());

    window.addEventListener("hashchange", handleHashChange);

    if (!window.location.hash) {
      setHashRoute("products");
    }

    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  const markDataChanged = useCallback(() => {
    setDataVersion((version) => version + 1);
  }, []);

  return (
    <div className="container">
      <Sidebar currentPage={route.page} onNavigate={(page) => setHashRoute(page)} />

      <main className="main">
        {route.page === "products" && (
          <ProductsPage
            dataVersion={dataVersion}
            onOpenNotes={setSelectedSku}
            onStatusChanged={markDataChanged}
          />
        )}

        {route.page === "import" && (
          <ImportPage onImportComplete={markDataChanged} />
        )}

        {route.page === "vendors" && (
          <VendorsPage
            selectedVendor={route.vendor}
            dataVersion={dataVersion}
            onBackToVendors={() => setHashRoute("vendors")}
            onSelectVendor={(vendor) => setHashRoute("vendors", vendor)}
          />
        )}
      </main>

      {selectedSku && (
        <NotesModal sku={selectedSku} onClose={() => setSelectedSku("")} />
      )}
    </div>
  );
}
