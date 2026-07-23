import { useState } from "react";
import type { ProductStockUpdate } from "../../types";
import { PriceAuditPage } from "../priceAudit/PriceAuditPage";
import { InventoryAuditPanel } from "./InventoryAuditPanel";

type AuditPageProps = {
  onOpenNotes: (sku: string) => void;
  productStockUpdate: ProductStockUpdate | null;
};

type AuditType = "price" | "inventory";

export function AuditPage({
  onOpenNotes,
  productStockUpdate
}: AuditPageProps) {
  const [auditType, setAuditType] = useState<AuditType>("price");

  return (
    <section className="page audit-page" aria-labelledby="auditHeading">
      <header className="audit-page-header">
        <h1 id="auditHeading">Audit</h1>

        <label className="audit-type-control">
          <span>Audit type</span>
          <select
            value={auditType}
            onChange={(event) =>
              setAuditType(event.target.value as AuditType)
            }
          >
            <option value="price">Price Audit</option>
            <option value="inventory">Inventory Audit</option>
          </select>
        </label>
      </header>

      {auditType === "price" ? (
        <PriceAuditPage embedded onOpenNotes={onOpenNotes} />
      ) : (
        <InventoryAuditPanel
          onOpenNotes={onOpenNotes}
          productStockUpdate={productStockUpdate}
        />
      )}
    </section>
  );
}
