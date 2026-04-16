import * as api from "./api.js";
import { setupImportForm } from "./importForm.js";
import { openModal, setupNotesModal } from "./notesModal.js";
import { renderPagination } from "./pagination.js";
import { setupPages, setupSidebar, showPage } from "./pages.js";
import { state } from "./state.js";
import { renderTable } from "./table.js";
import { loadVendors, openVendorProducts, refreshVendors, setupVendorsPage } from "./vendors.js";

async function loadBackorders() {
  const result = await api.getBackorders({
    page: state.currentPage,
    limit: state.limit,
    search: state.searchQuery
  });

  state.backorders = result.data;
  state.totalItems = result.total;

  renderTable(state.backorders, openModal);
  renderPagination(state, (page) => {
    state.currentPage = page;
    loadBackorders();
  });
}

function setupSearch() {
  let timeout;

  document.getElementById("searchInput").addEventListener("input", (event) => {
    clearTimeout(timeout);

    timeout = setTimeout(() => {
      state.searchQuery = event.target.value;
      state.currentPage = 1;
      loadBackorders();
    }, 300);
  });
}

function setupStatusUpdates() {
  document.addEventListener("change", async (event) => {
    if (!event.target.classList.contains("status-dropdown")) {
      return;
    }

    await api.updateStatus(event.target.dataset.id, event.target.value);
    loadBackorders();
    refreshVendors();
  });
}

function setRoute(page, vendor = "") {
  const nextHash = vendor
    ? `#/${page}/${encodeURIComponent(vendor)}`
    : `#/${page}`;

  if (window.location.hash === nextHash) {
    renderRoute();
    return;
  }

  window.location.hash = nextHash;
}

function getRoute() {
  const hash = window.location.hash.replace(/^#\/?/, "");
  const parts = hash.split("/").filter(Boolean);
  const page = parts[0] || "products";
  const vendor = parts.length > 1 ? decodeURIComponent(parts.slice(1).join("/")) : "";

  return {
    page,
    vendor
  };
}

async function renderRoute() {
  const route = getRoute();

  if (route.page === "import") {
    showPage("import", {
      onProductsShown: loadBackorders,
      onVendorsShown: loadVendors
    });
    return;
  }

  if (route.page === "vendors") {
    showPage("vendors", {
      onProductsShown: loadBackorders,
      onVendorsShown: () => loadVendors({ showList: !route.vendor })
    });

    if (route.vendor) {
      await loadVendors({ showList: false });
      await openVendorProducts(route.vendor);
    }

    return;
  }

  showPage("products", {
    onProductsShown: loadBackorders,
    onVendorsShown: loadVendors
  });
}

function setupApp() {
  setupSidebar();
  setupPages({
    onNavigate: setRoute
  });
  setupSearch();
  setupImportForm(() => {
    loadBackorders();
    refreshVendors();
  });
  setupNotesModal();
  setupStatusUpdates();
  setupVendorsPage({
    onVendorSelected: (vendor) => setRoute("vendors", vendor),
    onBackToVendors: () => setRoute("vendors")
  });

  window.addEventListener("hashchange", renderRoute);

  if (!window.location.hash) {
    setRoute("products");
    return;
  }

  renderRoute();
}

document.addEventListener("DOMContentLoaded", setupApp);
