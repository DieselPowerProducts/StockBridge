import { useState } from "react";
import type { InventoryAuditResolvedUpdate } from "../../types";
import { PriceAuditPage } from "../priceAudit/PriceAuditPage";
import { InventoryAuditPanel } from "./InventoryAuditPanel";

type AuditPageProps = {
  inventoryAuditResolvedUpdate: InventoryAuditResolvedUpdate | null;
  onOpenNotes: (sku: string) => void;
};

type AuditType = "price" | "inventory";

export function AuditPage({
  inventoryAuditResolvedUpdate,
  onOpenNotes
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
          inventoryAuditResolvedUpdate={inventoryAuditResolvedUpdate}
          onOpenNotes={onOpenNotes}
        />
      )}
    </section>
  );
}
