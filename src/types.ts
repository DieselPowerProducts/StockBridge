export type PageName =
  | "products"
  | "stock-check"
  | "vendors"
  | "audit"
  | "sheet-imports"
  | "notifications";
export type RoutePageName = PageName | "notes" | "shopify-availability-sync";

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

export type AppVersionStatus = {
  version: string;
};

export type AppNotification = {
  id: string;
  sku: string;
  noteId: string;
  notePreview: string;
  sender: {
    sub: string;
    email: string;
    name: string;
    picture: string;
  };
  created_at: string;
  read_at: string;
};

export type NotificationsResponse = {
  items: AppNotification[];
  unreadCount: number;
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
export type ShopifyAvailabilityStatus =
  | "in_stock"
  | "out_of_stock"
  | "backordered"
  | "built_to_order"
  | "discontinued";
export type ShopifyAvailabilityModifier =
  | "out_of_stock"
  | "built_to_order"
  | "discontinued";
export type ShopifyAvailabilitySyncResponse = {
  availabilityCounts: Partial<Record<ShopifyAvailabilityStatus, number>>;
  hasNextPage: boolean;
  nextCursor: string;
  scannedVariantCount: number;
  skippedCount: number;
  skippedSamples: Array<{
    reason: string;
    sku?: string;
    value?: string;
    variantId?: string;
  }>;
  updatedCount: number;
};
export type StockCheckSort =
  | "yesterday"
  | "today"
  | "tomorrow"
  | "no-follow-up"
  | "all";

export type Product = {
  id: string;
  sku: string;
  name: string;
  qtyAvailable: number;
  availability: ProductAvailability;
  hasBuiltToOrderVendor?: boolean;
  followUpDate: string;
  isKit: boolean;
  vendorEmailSent?: boolean;
};

export type VendorEmailSentUpdate = {
  sku: string;
  token: number;
};

export type InventoryAuditResolvedUpdate = {
  sku: string;
  token: number;
};

export type ProductStockUpdate = {
  sku: string;
  qtyAvailable: number;
  availability: ProductAvailability;
  followUpDate?: string;
  followUpSaved?: boolean;
};

export type FollowUpOverrides = Record<string, string>;

export type ProductsResponse = {
  data: Product[];
  total: number;
  totalPages: number;
  isLastPage: boolean;
};

export type PriceAuditItem = {
  vendorProductId: string;
  sku: string;
  vendorSku: string;
  vendorId: string;
  vendorName: string;
  currentPrice: number | null;
  newProductCost: number;
  priceSourceUrl: string;
  updatedAt: string;
};

export type PriceAuditResponse = {
  data: PriceAuditItem[];
  total: number;
  totalAudits: number;
  totalPages: number;
  isLastPage: boolean;
};

export type PriceAuditConfirmation = {
  vendorProductId: string;
  sku: string;
  currentPrice: number;
};

export type PriceAuditDenial = {
  vendorProductId: string;
  sku: string;
};

export type InventoryAuditItem = {
  id: string;
  sku: string;
  vendorId: string;
  vendorName: string;
  senderEmail: string;
  senderName: string;
  subject: string;
  responseText: string;
  receivedAt: string;
};

export type InventoryAuditResponse = {
  data: InventoryAuditItem[];
  total: number;
  totalPages: number;
  isLastPage: boolean;
};

export type InventorySheetImportStatus =
  | "ready_for_review"
  | "needs_mapping"
  | "failed"
  | "retrying"
  | "approved"
  | "applying"
  | "applied"
  | "rejected";

export type InventorySheetMapping = {
  skuHeader?: string;
  inventoryHeader?: string;
  subtractiveColumn?: string;
  inventoryMode?: "numerical" | "alphabetical";
  inStockPhrases?: string[];
  outOfStockPhrases?: string[];
};

export type InventorySheetImport = {
  id: string;
  vendorId: string;
  vendorName: string;
  messageUid: string;
  messageId: string;
  senderEmail: string;
  subject: string;
  attachmentFilename: string;
  attachmentHash: string;
  status: InventorySheetImportStatus;
  mapping: InventorySheetMapping;
  availableHeaders: string[];
  totalRows: number;
  matchedRows: number;
  changedRows: number;
  selectedChangedRows: number;
  unmatchedRows: number;
  invalidRows: number;
  exceptionRows: number;
  appliedCount: number;
  skippedCount: number;
  errorCount: number;
  errorMessage: string;
  manualRetryCount: number;
  reviewedByEmail: string;
  reviewedByName: string;
  reviewedAt: string;
  createdAt: string;
  updatedAt: string;
  isLegacy: boolean;
};

export type InventorySheetImportRow = {
  rowNumber: number;
  vendorProductId: string;
  productId: string;
  productSku: string;
  vendorSku: string;
  sheetSku: string;
  inventoryValue: string;
  subtractiveValue: string;
  currentQuantity: number;
  proposedQuantity: number;
  sheetQuantity: number | null;
  changeRequired: boolean;
  selected: boolean;
  status: string;
  errorMessage: string;
};

export type InventorySheetImportsResponse = {
  data: InventorySheetImport[];
  total: number;
  totalPages: number;
  isLastPage: boolean;
};

export type InventorySheetImportDetails = InventorySheetImport & {
  rows: InventorySheetImportRow[];
  rowPage: number;
  rowTotal: number;
  rowTotalPages: number;
};

export type ShopifyAvailabilityResponse = {
  availability: ShopifyAvailabilityStatus;
  availabilityModifier: ShopifyAvailabilityModifier | "";
  availabilityText: string;
  duplicateSkuMatchCount: number;
  handle: string;
  matchedSku: string;
  matchedVariantId: string;
  productId: string;
  productStatus: string;
  productTitle: string;
  updatedMetafieldOwnerCount: number;
  updatedInventoryPolicyCount: number;
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
  vendorSku: string;
  productCost: number | null;
  newProductCost: number | null;
  priceSourceUrl: string;
  priceReceivedAt: string | null;
  name: string;
  quantity: number;
  stockSource: "vendor" | "warehouse";
  stockType: string;
  canUpdateStock: boolean;
  builtToOrder: boolean;
  buildTime: string;
  autoInventoryEnabled?: boolean;
  autoInventoryExcepted?: boolean;
  autoInventoryManaged?: boolean;
  autoInventoryQuantity?: number | null;
  autoInventoryUpdatedAt?: string;
  autoInventorySheetSku?: string;
  autoInventoryMode?: VendorAutoInventoryMode;
};

export type VendorContact = {
  id: string;
  vendorId: string;
  name: string;
  email: string;
  phone: string;
  label: string;
  isDefault?: boolean;
};

export type EmailTemplate = {
  id: string;
  name: string;
  subject: string;
  body: string;
};

export type ProductKitChild = {
  sku: string;
  name: string;
  qtyRequired: number;
  qtyAvailable: number;
  availability: ProductAvailability;
  builtToOrderLeadTime: string;
  followUpDate: string;
  followUpNoEta: boolean;
  isKit: boolean;
};

export type ProductParentKit = {
  sku: string;
  name: string;
  qtyRequired: number;
  qtyAvailable: number;
  availability: ProductAvailability;
  followUpDate: string;
};

export type ProductDetails = {
  id: string;
  sku: string;
  name: string;
  qtyAvailable: number;
  availability: ProductAvailability;
  isKit: boolean;
  followUpDate: string;
  followUpNoEta: boolean;
  shopifyAvailabilityStatus: ShopifyAvailabilityStatus | "";
  shopifyAvailabilityModifier: ShopifyAvailabilityModifier | "";
  builtToOrderLeadTime: string;
  childProducts: ProductKitChild[];
  parentKits: ProductParentKit[];
  vendors: ProductVendor[];
};

export type NotesBootstrapResponse = {
  notes: Note[];
  productDetails: ProductDetails;
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
  btoReconciliation?: {
    converted: number;
    shopifyFailed: number;
    shopifyMatched: number;
    shopifyUpdated: number;
    error?: string;
  };
};

export type VendorAutoInventoryMode = "numerical" | "alphabetical";

export type VendorAutoInventorySettings = {
  vendorId: string;
  enabled: boolean;
  senderEmail: string;
  skuHeader: string;
  inventoryHeader: string;
  subtractiveColumn: string;
  skuExceptions: string[];
  inventoryMode: VendorAutoInventoryMode;
  inStockPhrases: string[];
  outOfStockPhrases: string[];
  lastImportedAt: string;
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
