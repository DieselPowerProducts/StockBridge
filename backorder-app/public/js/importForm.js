import * as api from "./api.js";

export function setupImportForm(onImportComplete) {
  document.getElementById("importForm").addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(event.target);
    await api.importBackorders(formData);

    alert("Import complete");
    event.target.reset();
    onImportComplete();
  });
}
