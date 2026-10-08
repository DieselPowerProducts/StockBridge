import { useEffect, useMemo, useRef, useState } from "react";
import {
  getStockCheckBrandGroups,
  getVendorContacts,
  sendBulkVendorStockCheckEmail
} from "../../services/api";
import type {
  FollowUpOverrides,
  Product,
  ProductStockUpdate,
  StockCheckBrandGroup,
  VendorContact,
  VendorEmailSentUpdate
} from "../../types";
import { ProductsTable } from "./ProductsTable";
import { applyProductStockUpdate } from "./productStockUpdates";

type DateFilter = {
  fromDate: string;
  toDate: string;
  includeUndated: boolean;
};

type Composer = {
  group: StockCheckBrandGroup;
  filter: DateFilter;
  skus: string[];
  contacts: VendorContact[];
  to: string;
  subject: string;
  message: string;
};

type Props = {
  productStockUpdate: ProductStockUpdate | null;
  followUpOverrides: FollowUpOverrides;
  vendorEmailSentUpdate: VendorEmailSentUpdate | null;
  onOpenNotes: (sku: string) => void;
  onBulkEmailSent: (skus: string[]) => void;
};

const defaultFilter: DateFilter = {
  fromDate: "",
  toDate: "",
  includeUndated: true
};

function getVisibleProducts(products: Product[], filter: DateFilter) {
  return products.filter((product) => {
    const date = product.followUpDate || "";
    if (!date) return filter.includeUndated;
    return (!filter.fromDate || date >= filter.fromDate) &&
      (!filter.toDate || date <= filter.toDate);
  });
}

function formatContact(contact: VendorContact) {
  return contact.name && contact.name !== contact.email
    ? `${contact.name} - ${contact.email}`
    : contact.email;
}

export function StockCheckBrandView({
  productStockUpdate,
  followUpOverrides,
  vendorEmailSentUpdate,
  onOpenNotes,
  onBulkEmailSent
}: Props) {
  const [groups, setGroups] = useState<StockCheckBrandGroup[]>([]);
  const [filters, setFilters] = useState<Record<string, DateFilter>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [composer, setComposer] = useState<Composer | null>(null);
  const [composerError, setComposerError] = useState("");
  const [contactsLoading, setContactsLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [emailedSkus, setEmailedSkus] = useState<Set<string>>(new Set());
  const [refreshToken, setRefreshToken] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const initialStockUpdate = useRef(productStockUpdate);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError("");
    void getStockCheckBrandGroups(true)
      .then((result) => {
        if (!cancelled) setGroups(result.groups);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Unable to load brands.");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => { cancelled = true; };
  }, [refreshToken]);

  useEffect(() => {
    if (!productStockUpdate || productStockUpdate === initialStockUpdate.current) return;
    setRefreshToken((token) => token + 1);
  }, [productStockUpdate]);

  useEffect(() => {
    if (!vendorEmailSentUpdate?.sku) return;
    setEmailedSkus((current) => new Set(current).add(vendorEmailSentUpdate.sku.toUpperCase()));
  }, [vendorEmailSentUpdate]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (composer && !dialog.open) dialog.showModal();
    if (!composer && dialog.open) dialog.close();
  }, [composer]);

  const visibleGroups = useMemo(() => groups
    .filter((group) => group.vendorName.toLowerCase().includes(search.trim().toLowerCase()))
    .map((group) => ({
      ...group,
      products: applyProductStockUpdate(group.products, productStockUpdate)
        .map((product) => ({
          ...product,
          followUpDate: Object.prototype.hasOwnProperty.call(
            followUpOverrides,
            product.sku.toUpperCase()
          ) ? followUpOverrides[product.sku.toUpperCase()] || "" : product.followUpDate,
          vendorEmailSent: product.vendorEmailSent || emailedSkus.has(product.sku.toUpperCase())
        }))
        .filter((product) => product.availability !== "Available" || Boolean(product.followUpDate))
    })), [groups, search, productStockUpdate, followUpOverrides, emailedSkus]);

  function updateFilter(vendorId: string, patch: Partial<DateFilter>) {
    setFilters((current) => ({
      ...current,
      [vendorId]: { ...(current[vendorId] || defaultFilter), ...patch }
    }));
  }

  async function openComposer(group: StockCheckBrandGroup, filter: DateFilter, products: Product[]) {
    setComposerError("");
    setComposer({
      group,
      filter: { ...filter },
      skus: products.map((product) => product.sku),
      contacts: [],
      to: "",
      subject: `Stock check request - ${group.vendorName}`,
      message: "Could you please provide availability and estimated ship dates for these parts?"
    });
    setContactsLoading(true);
    try {
      const contacts = await getVendorContacts(group.vendorId);
      setComposer((current) => current?.group.vendorId === group.vendorId
        ? {
            ...current,
            contacts,
            to: contacts.find((contact) => contact.isDefault)?.email || contacts[0]?.email || ""
          }
        : current);
    } catch (err) {
      setComposerError(err instanceof Error ? err.message : "Unable to load vendor contacts.");
    } finally {
      setContactsLoading(false);
    }
  }

  async function sendEmail() {
    if (!composer || sending || !composer.to) return;
    setSending(true);
    setComposerError("");
    try {
      const result = await sendBulkVendorStockCheckEmail({
        vendorId: composer.group.vendorId,
        skus: composer.skus,
        ...composer.filter,
        to: composer.to,
        subject: composer.subject,
        message: composer.message
      });
      setEmailedSkus((current) => {
        const next = new Set(current);
        result.skus.forEach((sku) => next.add(sku.toUpperCase()));
        return next;
      });
      onBulkEmailSent(result.skus);
      setComposer(null);
      setRefreshToken((token) => token + 1);
    } catch (err) {
      setComposerError(err instanceof Error ? err.message : "Unable to send stock check email.");
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <div className="stock-check-brand-search">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Find brand..."
          aria-label="Find brand"
        />
        <span>{visibleGroups.length} brands</span>
      </div>
      {error && <p className="status-message error-message">{error}</p>}
      {isLoading && <p className="status-message" role="status">Loading brands...</p>}
      {!isLoading && visibleGroups.length === 0 && (
        <p className="status-message">No matching brands.</p>
      )}
      <div className="stock-check-brand-list">
        {visibleGroups.map((group) => {
          const key = group.vendorId || "unassigned";
          const filter = filters[key] || defaultFilter;
          const products = getVisibleProducts(group.products, filter);
          const isOpen = expanded.has(key);
          return (
            <section className="stock-check-brand-group" key={key}>
              <button
                type="button"
                className="stock-check-brand-heading"
                aria-expanded={isOpen}
                onClick={() => setExpanded((current) => {
                  const next = new Set(current);
                  if (next.has(key)) next.delete(key);
                  else next.add(key);
                  return next;
                })}
              >
                <strong>{group.vendorName}</strong>
                <span className="stock-check-brand-count">{products.length}</span>
                <span className="stock-check-brand-chevron" aria-hidden="true" />
              </button>
              {isOpen && (
                <div className="stock-check-brand-content">
                  <div className="stock-check-brand-controls">
                    <label><span>From</span><input type="date" value={filter.fromDate}
                      max={filter.toDate || undefined}
                      onChange={(event) => updateFilter(key, {
                        fromDate: event.target.value,
                        includeUndated: false
                      })} /></label>
                    <label><span>Through</span><input type="date" value={filter.toDate}
                      min={filter.fromDate || undefined}
                      onChange={(event) => updateFilter(key, {
                        toDate: event.target.value,
                        includeUndated: false
                      })} /></label>
                    <label className="stock-check-undated"><input type="checkbox"
                      checked={filter.includeUndated}
                      onChange={(event) => updateFilter(key, {
                        includeUndated: event.target.checked
                      })} /> No follow-up date</label>
                    {group.vendorId && (
                      <button type="button" className="stock-check-bulk-button"
                        disabled={products.length === 0}
                        onClick={() => void openComposer(group, filter, products)}>
                        Email {products.length} {products.length === 1 ? "SKU" : "SKUs"}
                      </button>
                    )}
                  </div>
                  <ProductsTable
                    products={products}
                    emptyMessage="No stock checks in this date range."
                    onOpenNotes={onOpenNotes}
                    showVendorEmailStatus
                  />
                </div>
              )}
            </section>
          );
        })}
      </div>
      <dialog ref={dialogRef} className="stock-check-bulk-dialog"
        onClose={() => setComposer(null)}>
        {composer && (
          <>
            <div className="stock-check-bulk-dialog-head">
              <h2>{composer.group.vendorName} stock check</h2>
              <button type="button" onClick={() => setComposer(null)}
                aria-label="Close" title="Close">&times;</button>
            </div>
            <div className="stock-check-bulk-dialog-body">
              <p>{composer.skus.length} {composer.skus.length === 1 ? "SKU" : "SKUs"}</p>
              <label><span>To</span><select value={composer.to}
                disabled={contactsLoading || sending}
                onChange={(event) => setComposer({ ...composer, to: event.target.value })}>
                {contactsLoading && <option value="">Loading contacts...</option>}
                {!contactsLoading && composer.contacts.length === 0 &&
                  <option value="">No available contacts</option>}
                {composer.contacts.map((contact) => (
                  <option key={contact.id} value={contact.email}>{formatContact(contact)}</option>
                ))}
              </select></label>
              <label><span>Subject</span><input type="text" value={composer.subject}
                disabled={sending}
                onChange={(event) => setComposer({ ...composer, subject: event.target.value })} /></label>
              <label><span>Message</span><textarea value={composer.message} rows={3}
                disabled={sending}
                onChange={(event) => setComposer({ ...composer, message: event.target.value })} /></label>
              <div className="stock-check-bulk-skus">
                {composer.skus.map((sku) => <div key={sku}>{sku}</div>)}
              </div>
              {composerError && <p className="status-message error-message">{composerError}</p>}
              <div className="stock-check-bulk-actions">
                <button type="button" onClick={() => setComposer(null)} disabled={sending}>Cancel</button>
                <button type="button" className="stock-check-bulk-button" onClick={() => void sendEmail()}
                  disabled={sending || contactsLoading || !composer.to || !composer.subject.trim()}>
                  {sending ? "Sending..." : `Send ${composer.skus.length} SKUs`}
                </button>
              </div>
            </div>
          </>
        )}
      </dialog>
    </>
  );
}
