function createStatusDropdown(item) {
  const select = document.createElement("select");
  select.className = "status-dropdown";
  select.dataset.id = item.id;

  ["Backordered", "Available"].forEach((status) => {
    const option = document.createElement("option");
    option.value = status;
    option.textContent = status;
    option.selected = item.status === status;
    select.appendChild(option);
  });

  return select;
}

export function renderTable(backorders, onOpenNotes) {
  const tableBody = document.getElementById("tableBody");
  tableBody.innerHTML = "";

  backorders.forEach((item) => {
    const row = document.createElement("tr");
    const skuCell = document.createElement("td");
    const vendorCell = document.createElement("td");
    const statusCell = document.createElement("td");
    const skuButton = document.createElement("button");

    skuButton.type = "button";
    skuButton.className = "sku-link";
    skuButton.textContent = item.sku;
    skuButton.addEventListener("click", () => onOpenNotes(item.sku));

    skuCell.appendChild(skuButton);
    vendorCell.textContent = item.vendor || "";
    statusCell.appendChild(createStatusDropdown(item));

    row.append(skuCell, vendorCell, statusCell);
    tableBody.appendChild(row);
  });
}
