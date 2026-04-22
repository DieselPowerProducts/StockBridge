export type PageName = "products" | "stock-check" | "vendors";
export type RoutePageName = PageName | "notes";

export type AppRoute = {
  page: RoutePageName;
  sku: string;
  vendor: string;
};

export type AuthUser = {
  sub: string;
  email: string;
  name: string;
  picture: string;
  hd: string;
};

export type AuthSession = {
  user: AuthUser | null;
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

export type ProductAvailability = "Available" | "Backorder" | "Built to Order";
export type StockCheckSort = "yesterday" | "today" | "tomorrow" | "all";

export type Product = {
  id: string;
  sku: string;
  name: string;
  qtyAvailable: number;
  availability: ProductAvailability;
  followUpDate: string;
  isKit: boolean;
};

export type ProductStockUpdate = {
  sku: string;
  qtyAvailable: number;
  availability: ProductAvailability;
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
  author: {
    sub: string;
    email: string;
    name: string;
    picture: string;
  };
  created_at: string;
  updated_at?: string;
};

export type ProductVendor = {
  id: string;
  vendorProductId: string;
  name: string;
  quantity: number;
  stockSource: "vendor" | "warehouse";
  stockType: string;
  canUpdateStock: boolean;
  builtToOrder: boolean;
  buildTime: string;
};

export type ProductKitChild = {
  sku: string;
  name: string;
  qtyRequired: number;
  qtyAvailable: number;
  availability: ProductAvailability;
  isKit: boolean;
};

export type ProductDetails = {
  id: string;
  sku: string;
  name: string;
  qtyAvailable: number;
  availability: ProductAvailability;
  isKit: boolean;
  followUpDate: string;
  childProducts: ProductKitChild[];
  vendors: ProductVendor[];
};

export type VendorSummary = {
  id: string;
  vendor: string;
};

export type VendorDetails = {
  id: string;
  vendor: string;
  builtToOrder: boolean;
  buildTime: string;
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
  vendor: VendorDetails;
  data: VendorProduct[];
  total: number;
  totalPages: number;
  isLastPage: boolean;
};
