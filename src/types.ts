export type PageName = "products" | "import" | "vendors";

export type AppRoute = {
  page: PageName;
  vendor: string;
};

export type Backorder = {
  id: number;
  sku: string;
  vendor: string | null;
  notes?: string;
  status: string;
  updated_at: string;
};

export type BackordersResponse = {
  data: Backorder[];
  total: number;
};

export type Note = {
  id: number;
  sku: string;
  note: string;
  created_at: string;
};

export type VendorSummary = {
  vendor: string;
  productCount: number;
  availableCount: number;
  backorderedCount: number;
};

export type VendorBackorder = {
  id: number;
  sku: string;
  vendor: string | null;
  status: string;
  updated_at: string;
};
