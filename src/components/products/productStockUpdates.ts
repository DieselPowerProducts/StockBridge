import type { Product, ProductStockUpdate } from "../../types";

export function applyProductStockUpdate(
  products: Product[],
  productStockUpdate: ProductStockUpdate | null
) {
  if (!productStockUpdate) {
    return products;
  }

  return products.map((product) =>
    product.sku === productStockUpdate.sku
      ? {
          ...product,
          qtyAvailable: productStockUpdate.qtyAvailable,
          availability: productStockUpdate.availability,
          followUpDate: product.followUpDate
        }
      : product
  );
}
