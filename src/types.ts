export type PageName = "products" | "stock-check" | "vendors";

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

export type ProductAvailability = "Available" | "Backorder";

export type Product = {
  id: string;
  sku: string;
  name: string;
  qtyAvailable: number;
  availability: ProductAvailability;
  followUpDate: string;
};

export type ProductsResponse = {
  data: Product[];
  total: number;
  totalPages: number;
  isLastPage: boolean;
};

export type Note = {
  id: string;
  sku: string;
  note: string;
  created_at: string;
  updated_at?: string;
};

export type ProductVendor = {
  id: string;
  name: string;
};

export type ProductDetails = {
  id: string;
  sku: string;
  name: string;
  followUpDate: string;
  vendors: ProductVendor[];
};

export type VendorSummary = {
  id: string;
  vendor: string;
  productCount: number;
};

export type VendorsResponse = {
  data: VendorSummary[];
  total: number;
  totalPages: number;
  isLastPage: boolean;
};

export type VendorProduct = {
  id: string;
  vendorProductId: string;
  sku: string;
  name: string;
  qtyAvailable: number;
  availability: ProductAvailability;
};

export type VendorProductsResponse = {
  data: VendorProduct[];
  total: number;
  totalPages: number;
  isLastPage: boolean;
};
