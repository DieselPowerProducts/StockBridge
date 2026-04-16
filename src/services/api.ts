import type {
  BackordersResponse,
  Note,
  ProductsResponse,
  VendorBackorder,
  VendorSummary
} from "../types";

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, options);

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export function getBackorders({
  page,
  limit,
  search
}: {
  page: number;
  limit: number;
  search: string;
}) {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
    search
  });

  return request<BackordersResponse>(`/backorders?${params.toString()}`);
}

export function getProducts({
  page,
  limit,
  search
}: {
  page: number;
  limit: number;
  search: string;
}) {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
    search
  });

  return request<ProductsResponse>(`/products?${params.toString()}`);
}

export function importBackorders(formData: FormData) {
  return request<{ message: string; imported: number }>("/import", {
    method: "POST",
    body: formData
  });
}

export function getNotes(sku: string) {
  return request<Note[]>(`/notes/${encodeURIComponent(sku)}`);
}

export function createNote({ sku, note }: { sku: string; note: string }) {
  return request<{ id: string }>("/notes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ sku, note })
  });
}

export function deleteNote(id: string) {
  return request<{ deleted: number }>(`/notes/${id}`, {
    method: "DELETE"
  });
}

export function updateNote(id: string, note: string) {
  return request<{ updated: number }>(`/notes/${id}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ note })
  });
}

export function updateStatus(id: number, status: string) {
  return request<{ updated: number }>(`/status/${id}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ status })
  });
}

export function getVendors() {
  return request<VendorSummary[]>("/vendors");
}

export function getVendorBackorders(vendor: string) {
  return request<VendorBackorder[]>(
    `/vendors/${encodeURIComponent(vendor)}/backorders`
  );
}
