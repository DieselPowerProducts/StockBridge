async function request(url, options = {}) {
  const response = await fetch(url, options);

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  return response.json();
}

export function getBackorders({ page, limit, search }) {
  const params = new URLSearchParams({
    page,
    limit,
    search
  });

  return request(`/backorders?${params.toString()}`);
}

export function importBackorders(formData) {
  return request("/import", {
    method: "POST",
    body: formData
  });
}

export function getNotes(sku) {
  return request(`/notes/${encodeURIComponent(sku)}`);
}

export function createNote({ sku, note }) {
  return request("/notes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ sku, note })
  });
}

export function deleteNote(id) {
  return request(`/notes/${id}`, {
    method: "DELETE"
  });
}

export function updateNote(id, note) {
  return request(`/notes/${id}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ note })
  });
}

export function updateStatus(id, status) {
  return request(`/status/${id}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ status })
  });
}

export function getVendors() {
  return request("/vendors");
}

export function getVendorBackorders(vendor) {
  return request(`/vendors/${encodeURIComponent(vendor)}/backorders`);
}
