export function setupPages({ onNavigate }) {
  document.querySelectorAll("[data-page]").forEach((button) => {
    button.addEventListener("click", () => onNavigate(button.dataset.page));
  });
}

export function setupSidebar() {
  const sidebar = document.getElementById("sidebar");
  const toggle = document.getElementById("sidebarToggle");

  toggle.addEventListener("click", () => {
    sidebar.classList.toggle("collapsed");
  });
}

export function showPage(page, { onProductsShown, onVendorsShown }) {
  document.getElementById("productsPage").classList.add("hidden");
  document.getElementById("importPage").classList.add("hidden");
  document.getElementById("vendorsPage").classList.add("hidden");

  if (page === "products") {
    document.getElementById("productsPage").classList.remove("hidden");
    onProductsShown();
  }

  if (page === "import") {
    document.getElementById("importPage").classList.remove("hidden");
  }

  if (page === "vendors") {
    document.getElementById("vendorsPage").classList.remove("hidden");
    onVendorsShown();
  }
}
