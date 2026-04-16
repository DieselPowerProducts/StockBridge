import * as api from "./api.js";

let vendorsLoaded = false;
let selectedVendor = "";
let onVendorSelected = openVendorProducts;
let onBackToVendors = showVendorList;

export function setupVendorsPage(options = {}) {
  onVendorSelected = options.onVendorSelected || openVendorProducts;
  onBackToVendors = options.onBackToVendors || showVendorList;

  document.getElementById("backToVendorsButton").addEventListener("click", onBackToVendors);
}

export async function loadVendors({ force = false, showList = true } = {}) {
  if (showList) {
    showVendorList();
  }

  if (vendorsLoaded && !force) {
    return;
  }

  const vendors = await api.getVendors();
  vendorsLoaded = true;
  renderVendors(vendors);
}

export function refreshVendors() {
  vendorsLoaded = false;
  return loadVendors({ force: true });
}

function renderVendors(vendors) {
  const tableBody = document.getElementById("vendorsTableBody");
  tableBody.innerHTML = "";

  if (vendors.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");

    cell.colSpan = 4;
    cell.textContent = "No vendors found yet.";
    row.appendChild(cell);
    tableBody.appendChild(row);
    return;
  }

  vendors.forEach((vendor) => {
    const row = document.createElement("tr");
    const vendorCell = document.createElement("td");
    const productsCell = document.createElement("td");
    const availableCell = document.createElement("td");
    const backorderedCell = document.createElement("td");
    const vendorButton = document.createElement("button");

    vendorButton.type = "button";
    vendorButton.className = "vendor-link";
    vendorButton.textContent = vendor.vendor;
    vendorButton.addEventListener("click", () => onVendorSelected(vendor.vendor));

    vendorCell.appendChild(vendorButton);
    productsCell.textContent = vendor.productCount;
    availableCell.textContent = vendor.availableCount || 0;
    backorderedCell.textContent = vendor.backorderedCount || 0;

    row.append(vendorCell, productsCell, availableCell, backorderedCell);
    tableBody.appendChild(row);
  });
}

export async function openVendorProducts(vendor) {
  selectedVendor = vendor;

  const products = await api.getVendorBackorders(vendor);
  showVendorProducts();
  renderVendorProducts(vendor, products);
}

function showVendorList() {
  document.getElementById("vendorListView").classList.remove("hidden");
  document.getElementById("vendorProductsView").classList.add("hidden");
}

function showVendorProducts() {
  document.getElementById("vendorListView").classList.add("hidden");
  document.getElementById("vendorProductsView").classList.remove("hidden");
}

function renderVendorProducts(vendor, products) {
  const title = document.getElementById("selectedVendorTitle");
  const count = document.getElementById("selectedVendorCount");
  const tableBody = document.getElementById("vendorProductsTableBody");

  title.textContent = vendor;
  count.textContent = `${products.length} product${products.length === 1 ? "" : "s"}`;
  tableBody.innerHTML = "";

  products.forEach((product) => {
    const row = document.createElement("tr");
    const skuCell = document.createElement("td");
    const statusCell = document.createElement("td");
    const updatedCell = document.createElement("td");

    skuCell.textContent = product.sku;
    statusCell.textContent = product.status || "";
    updatedCell.textContent = product.updated_at || "";

    row.append(skuCell, statusCell, updatedCell);
    tableBody.appendChild(row);
  });
}

export function getSelectedVendor() {
  return selectedVendor;
}
