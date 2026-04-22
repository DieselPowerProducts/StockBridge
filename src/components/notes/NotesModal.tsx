import { type MouseEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  createNote,
  deleteNote,
  getProductDetails,
  getUsers,
  getNotes,
  refreshProductDetails,
  updateProductFollowUp,
  updateProductVendorStock,
  updateNote
} from "../../services/api";
import { getMentionSeedUsers } from "../../data/mentionSeed";
import type {
  AuthUser,
  Note,
  ProductDetails,
  ProductKitChild,
  ProductStockUpdate,
  ProductVendor
} from "../../types";

type NotesModalProps = {
  closeLabel?: string;
  currentUser?: AuthUser | null;
  mode?: "modal" | "route";
  sku: string;
  onClose: () => void;
  onFollowUpSaved: () => void;
  onProductStockChanged?: (update: ProductStockUpdate) => void;
};

type ActiveMention = {
  start: number;
  end: number;
  query: string;
};

function formatFollowUpDate(value: string) {
  if (!value) {
    return "";
  }

  const [year, month, day] = value.split("-").map(Number);

  if (!year || !month || !day) {
    return value;
  }

  return new Date(year, month - 1, day).toLocaleDateString();
}

function getValidDate(value: string) {
  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

function isSameDate(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function formatNoteDate(value: string) {
  const date = getValidDate(value);

  if (!date) {
    return "";
  }

  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (isSameDate(date, today)) {
    return "Today";
  }

  if (isSameDate(date, yesterday)) {
    return "Yesterday";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

function formatNoteTime(value: string) {
  const date = getValidDate(value);

  if (!date) {
    return "";
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return "SB";
  }

  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function applyVendorQuantityUpdates(
  vendors: ProductVendor[],
  quantitiesByVendorProductId: Map<string, number>
) {
  return vendors.map((vendor) =>
    quantitiesByVendorProductId.has(vendor.vendorProductId)
      ? {
          ...vendor,
          quantity: quantitiesByVendorProductId.get(vendor.vendorProductId) || 0
        }
      : vendor
  );
}

function getUnavailableAvailability(vendors: ProductVendor[]) {
  return vendors.some((vendor) => vendor.builtToOrder)
    ? "Built to Order"
    : "Backorder";
}

function getProductStockUpdate(
  productDetails: ProductDetails,
  vendors: ProductVendor[]
): ProductStockUpdate {
  if (productDetails.isKit) {
    return {
      sku: productDetails.sku,
      qtyAvailable: productDetails.qtyAvailable,
      availability: productDetails.availability
    };
  }

  const qtyAvailable = vendors.reduce(
    (total, vendor) => total + Math.max(Number(vendor.quantity || 0), 0),
    0
  );

  return {
    sku: productDetails.sku,
    qtyAvailable,
    availability:
      qtyAvailable > 0 ? "Available" : getUnavailableAvailability(vendors)
  };
}

function formatKitQuantityLabel(childProduct: ProductKitChild) {
  return childProduct.qtyRequired === 1
    ? "1 required"
    : `${childProduct.qtyRequired} required`;
}

function getVendorDrivenAvailability(vendors: ProductVendor[]) {
  const qtyAvailable = vendors.reduce(
    (total, vendor) => total + Math.max(Number(vendor.quantity || 0), 0),
    0
  );

  return {
    qtyAvailable,
    availability:
      qtyAvailable > 0 ? "Available" : getUnavailableAvailability(vendors)
  } as const;
}

function normalizeMentionQuery(value: string) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function compactMentionValue(value: string) {
  return normalizeMentionQuery(value).replace(/[^a-z0-9]/g, "");
}

function getActiveMention(value: string, caretIndex: number): ActiveMention | null {
  if (caretIndex < 0) {
    return null;
  }

  const beforeCaret = value.slice(0, caretIndex);
  const atIndex = beforeCaret.lastIndexOf("@");

  if (atIndex === -1) {
    return null;
  }

  if (atIndex > 0 && !/\s/.test(beforeCaret[atIndex - 1])) {
    return null;
  }

  const query = beforeCaret.slice(atIndex + 1);

  if (
    query.startsWith(" ") ||
    query.endsWith(" ") ||
    query.includes("@") ||
    /[\n\r,:;!?()[\]{}<>]/.test(query) ||
    !/^[a-z0-9._ -]*$/i.test(query)
  ) {
    return null;
  }

  return {
    start: atIndex,
    end: caretIndex,
    query
  };
}

function getMentionSuggestions(
  users: AuthUser[],
  query: string,
  currentUserSub = "",
  currentUserEmail = ""
) {
  const safeQuery = normalizeMentionQuery(query);
  const compactQuery = compactMentionValue(query);
  const normalizedCurrentUserEmail = String(currentUserEmail || "")
    .trim()
    .toLowerCase();

  return users
    .filter(
      (user) =>
        user.sub &&
        user.sub !== currentUserSub &&
        String(user.email || "").trim().toLowerCase() !== normalizedCurrentUserEmail
    )
    .filter((user) => {
      if (!safeQuery && !compactQuery) {
        return true;
      }

      const emailLocal = String(user.email || "")
        .toLowerCase()
        .split("@")[0];
      const values = [
        normalizeMentionQuery(user.name),
        normalizeMentionQuery(user.email),
        normalizeMentionQuery(emailLocal),
        compactMentionValue(user.name),
        compactMentionValue(emailLocal)
      ].filter(Boolean);

      return values.some(
        (value) =>
          (safeQuery && value.includes(safeQuery)) ||
          (compactQuery && value.includes(compactQuery))
      );
    })
    .slice(0, 6);
}

export function NotesModal({
  closeLabel = "Close",
  currentUser = null,
  mode = "modal",
  sku,
  onClose,
  onFollowUpSaved,
  onProductStockChanged
}: NotesModalProps) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [productDetails, setProductDetails] = useState<ProductDetails | null>(
    null
  );
  const [newNote, setNewNote] = useState("");
  const [followUpDate, setFollowUpDate] = useState("");
  const [notesError, setNotesError] = useState("");
  const [detailsError, setDetailsError] = useState("");
  const [mentionUsers, setMentionUsers] = useState<AuthUser[]>([]);
  const [isMentionUsersLoading, setIsMentionUsersLoading] = useState(false);
  const [followUpMessage, setFollowUpMessage] = useState("");
  const [isFollowUpPickerOpen, setIsFollowUpPickerOpen] = useState(false);
  const [isFollowUpSaving, setIsFollowUpSaving] = useState(false);
  const [isProductDetailsLoading, setIsProductDetailsLoading] = useState(false);
  const [isProductRefreshing, setIsProductRefreshing] = useState(false);
  const [pendingVendorStock, setPendingVendorStock] = useState<
    Record<string, boolean>
  >({});
  const [isBulkVendorStockSaving, setIsBulkVendorStockSaving] = useState(false);
  const [isKitModalOpen, setIsKitModalOpen] = useState(false);
  const [selectedChildSku, setSelectedChildSku] = useState("");
  const [activeMention, setActiveMention] = useState<ActiveMention | null>(null);
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0);
  const followUpInputRef = useRef<HTMLInputElement | null>(null);
  const notesListRef = useRef<HTMLDivElement | null>(null);
  const noteInputRef = useRef<HTMLInputElement | null>(null);

  const loadNotes = useCallback(async () => {
    setNotesError("");

    try {
      const result = await getNotes(sku);
      setNotes(result);
    } catch (err) {
      setNotesError(err instanceof Error ? err.message : "Unable to load notes.");
    }
  }, [sku]);

  const loadProductDetails = useCallback(async () => {
    setDetailsError("");
    setIsProductDetailsLoading(true);

    try {
      const result = await getProductDetails(sku);
      setProductDetails(result);
      setFollowUpDate(result.followUpDate || "");
    } catch (err) {
      setDetailsError(
        err instanceof Error ? err.message : "Unable to load product vendors."
      );
      setProductDetails(null);
      setFollowUpDate("");
    } finally {
      setIsProductDetailsLoading(false);
    }
  }, [sku]);

  const loadMentionUsers = useCallback(async () => {
    setIsMentionUsersLoading(true);

    try {
      const result = await getUsers();
      setMentionUsers(result.length > 0 ? result : getMentionSeedUsers());
    } catch {
      setMentionUsers(getMentionSeedUsers());
    } finally {
      setIsMentionUsersLoading(false);
    }
  }, []);

  useEffect(() => {
    loadNotes();
  }, [loadNotes]);

  useEffect(() => {
    loadProductDetails();
  }, [loadProductDetails]);

  useEffect(() => {
    loadMentionUsers();
  }, [loadMentionUsers]);

  useEffect(() => {
    if (!activeMention || activeMention.query !== "") {
      return;
    }

    void loadMentionUsers();
  }, [activeMention?.start, activeMention?.query, loadMentionUsers]);

  useEffect(() => {
    setIsKitModalOpen(false);
    setSelectedChildSku("");
    setActiveMention(null);
    setSelectedMentionIndex(0);
  }, [sku]);

  useEffect(() => {
    if (!isFollowUpPickerOpen) {
      return;
    }

    followUpInputRef.current?.focus();
    try {
      followUpInputRef.current?.showPicker?.();
    } catch {
      // Some browsers only allow showPicker during the direct click event.
    }
  }, [isFollowUpPickerOpen]);

  useEffect(() => {
    if (notes.length === 0) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      if (notesListRef.current) {
        notesListRef.current.scrollTop = notesListRef.current.scrollHeight;
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [notes]);

  useEffect(() => {
    setSelectedMentionIndex(0);
  }, [activeMention?.query]);

  function updateMentionState(value: string, caretIndex: number) {
    setActiveMention(getActiveMention(value, caretIndex));
  }

  function handleNoteInputChange(value: string, caretIndex: number) {
    setNewNote(value);
    updateMentionState(value, caretIndex);
  }

  function insertMention(user: AuthUser) {
    if (!activeMention) {
      return;
    }

    const mentionLabel = `@${user.name}`;
    const nextValue = `${newNote.slice(0, activeMention.start)}${mentionLabel} ${newNote.slice(activeMention.end)}`;
    const nextCaretIndex = activeMention.start + mentionLabel.length + 1;

    setNewNote(nextValue);
    setActiveMention(null);
    setSelectedMentionIndex(0);

    window.requestAnimationFrame(() => {
      noteInputRef.current?.focus();
      noteInputRef.current?.setSelectionRange(nextCaretIndex, nextCaretIndex);
    });
  }

  async function handleAddNote() {
    const note = newNote.trim();

    if (!note) {
      return;
    }

    await createNote({ sku, note });
    setNewNote("");
    setActiveMention(null);
    setSelectedMentionIndex(0);
    loadNotes();
  }

  async function handleDeleteNote(id: string) {
    await deleteNote(id);
    loadNotes();
  }

  async function handleEditNote(note: Note) {
    const nextNote = window.prompt("Edit note:", note.note);

    if (nextNote === null) {
      return;
    }

    await updateNote(note.id, nextNote);
    loadNotes();
  }

  async function handleFollowUpDateChange(value: string) {
    setFollowUpDate(value);
    setFollowUpMessage("");
    setDetailsError("");
    setIsFollowUpSaving(true);

    try {
      const result = await updateProductFollowUp({
        sku,
        followUpDate: value
      });

      setFollowUpDate(result.followUpDate || "");
      setFollowUpMessage(
        result.followUpDate ? "Follow-up date saved." : "Follow-up date cleared."
      );
      setProductDetails((current) =>
        current
          ? {
              ...current,
              followUpDate: result.followUpDate || ""
            }
          : current
      );
      onFollowUpSaved();
    } catch (err) {
      setDetailsError(
        err instanceof Error ? err.message : "Unable to save follow-up date."
      );
    } finally {
      setIsFollowUpSaving(false);
    }
  }

  async function handleVendorStockChange(
    vendor: ProductVendor,
    enabled: boolean
  ) {
    if (!vendor.canUpdateStock) {
      return;
    }

    const isCurrentlyEnabled = vendor.quantity > 0;

    if (isCurrentlyEnabled === enabled || pendingVendorStock[vendor.vendorProductId]) {
      return;
    }

    setDetailsError("");
    setPendingVendorStock((current) => ({
      ...current,
      [vendor.vendorProductId]: true
    }));

    try {
      const result = await updateProductVendorStock({
        sku,
        vendorId: vendor.id,
        vendorProductId: vendor.vendorProductId,
        enabled
      });
      const quantitiesByVendorProductId = new Map([
        [result.vendorProductId, result.quantity]
      ]);
      const updatedVendors = applyVendorQuantityUpdates(
        vendors,
        quantitiesByVendorProductId
      );
      const nextStockUpdate = productDetails
        ? getProductStockUpdate(productDetails, updatedVendors)
        : null;

      setProductDetails((current) =>
        current
          ? {
              ...current,
              ...(!current.isKit
                ? getVendorDrivenAvailability(updatedVendors)
                : {}),
              vendors: applyVendorQuantityUpdates(current.vendors, quantitiesByVendorProductId)
            }
          : current
      );
      if (nextStockUpdate) {
        onProductStockChanged?.(nextStockUpdate);
      }
      onFollowUpSaved();
    } catch (err) {
      setDetailsError(
        err instanceof Error ? err.message : "Unable to update vendor stock."
      );
    } finally {
      setPendingVendorStock((current) => {
        const next = { ...current };

        delete next[vendor.vendorProductId];

        return next;
      });
    }
  }

  async function handleRefreshProduct() {
    setDetailsError("");
    setIsProductRefreshing(true);

    try {
      const result = await refreshProductDetails(sku);
      setProductDetails(result);
      setFollowUpDate(result.followUpDate || "");
      setFollowUpMessage("");
      onProductStockChanged?.(getProductStockUpdate(result, result.vendors));
      onFollowUpSaved();
    } catch (err) {
      setDetailsError(
        err instanceof Error ? err.message : "Unable to refresh this product."
      );
    } finally {
      setIsProductRefreshing(false);
    }
  }

  const title = productDetails?.name || "";
  const modalTitle = title && title !== sku ? `${sku} | ${title}` : sku;
  const vendors = productDetails?.vendors || [];
  const childProducts = productDetails?.childProducts || [];
  const editableVendors = vendors.filter((vendor) => vendor.canUpdateStock);
  const hasEditableVendors = editableVendors.length > 0;
  const areAllEditableVendorsOn =
    hasEditableVendors && editableVendors.every((vendor) => vendor.quantity > 0);
  const areAllEditableVendorsOff =
    hasEditableVendors && editableVendors.every((vendor) => vendor.quantity <= 0);
  const canShowKits = Boolean(productDetails?.isKit && childProducts.length > 0);
  const isRouteMode = mode === "route";
  const mentionSuggestions = activeMention
    ? getMentionSuggestions(
        mentionUsers,
        activeMention.query,
        currentUser?.sub || "",
        currentUser?.email || ""
      )
    : [];
  const isMentionMenuOpen = Boolean(activeMention);

  function handleCloseChildNotes() {
    setSelectedChildSku("");
    void loadProductDetails();
  }

  function handleBackdropClick(event: MouseEvent<HTMLDivElement>) {
    if (!isRouteMode && event.target === event.currentTarget) {
      onClose();
    }
  }

  function handleKitBackdropClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) {
      setIsKitModalOpen(false);
    }
  }

  async function handleAllVendorStockChange(enabled: boolean) {
    const vendorsToUpdate = editableVendors.filter(
      (vendor) =>
        (vendor.quantity > 0) !== enabled &&
        !pendingVendorStock[vendor.vendorProductId]
    );

    if (vendorsToUpdate.length === 0 || isBulkVendorStockSaving) {
      return;
    }

    setDetailsError("");
    setIsBulkVendorStockSaving(true);
    setPendingVendorStock((current) => ({
      ...current,
      ...Object.fromEntries(
        vendorsToUpdate.map((vendor) => [vendor.vendorProductId, true])
      )
    }));

    try {
      const results = await Promise.allSettled(
        vendorsToUpdate.map((vendor) =>
          updateProductVendorStock({
            sku,
            vendorId: vendor.id,
            vendorProductId: vendor.vendorProductId,
            enabled
          })
        )
      );
      const savedResults = results
        .filter((result) => result.status === "fulfilled")
        .map((result) => result.value);
      const quantitiesByVendorProductId = new Map(
        savedResults.map((result) => [result.vendorProductId, result.quantity])
      );

      if (savedResults.length > 0) {
        const updatedVendors = applyVendorQuantityUpdates(
          vendors,
          quantitiesByVendorProductId
        );
        const nextStockUpdate = productDetails
          ? getProductStockUpdate(productDetails, updatedVendors)
          : null;

        setProductDetails((current) =>
          current
            ? {
                ...current,
                ...(!current.isKit
                  ? getVendorDrivenAvailability(updatedVendors)
                  : {}),
                vendors: applyVendorQuantityUpdates(current.vendors, quantitiesByVendorProductId)
              }
            : current
        );
        if (nextStockUpdate) {
          onProductStockChanged?.(nextStockUpdate);
        }
        onFollowUpSaved();
      }

      if (savedResults.length !== results.length) {
        setDetailsError("Unable to update every assigned vendor stock value.");
      }
    } catch (err) {
      setDetailsError(
        err instanceof Error ? err.message : "Unable to update vendor stock."
      );
    } finally {
      setIsBulkVendorStockSaving(false);
      setPendingVendorStock((current) => {
        const next = { ...current };

        for (const vendor of vendorsToUpdate) {
          delete next[vendor.vendorProductId];
        }

        return next;
      });
    }
  }

  return (
    <div
      className={isRouteMode ? "notes-route-shell" : "modal"}
      role={isRouteMode ? "region" : "dialog"}
      aria-modal={isRouteMode ? undefined : true}
      aria-labelledby="modalTitle"
      onClick={handleBackdropClick}
    >
      <div className="modal-content notes-modal-content">
        <header className="notes-modal-header">
          <h2 id="modalTitle">{modalTitle}</h2>
          <button id="closeModalButton" type="button" onClick={onClose}>
            {closeLabel}
          </button>
        </header>

        {detailsError && (
          <p className="status-message error-message">{detailsError}</p>
        )}
        {notesError && <p className="status-message error-message">{notesError}</p>}

        <div className="notes-modal-grid">
          <aside className="assigned-vendors-panel" aria-labelledby="assignedVendorsHeading">
            <div className="assigned-vendors-heading">
              <h3 id="assignedVendorsHeading">Assigned vendors</h3>

              <div
                className="vendor-stock-switch"
                role="group"
                aria-label="All assigned vendor stock override"
                title="Update all assigned vendor stock values"
              >
                <button
                  type="button"
                  className={
                    areAllEditableVendorsOn
                      ? "vendor-stock-switch-option active"
                      : "vendor-stock-switch-option"
                  }
                  aria-label="Turn on stock for all assigned vendors"
                  aria-pressed={areAllEditableVendorsOn}
                  disabled={!hasEditableVendors || isBulkVendorStockSaving}
                  onClick={() => handleAllVendorStockChange(true)}
                >
                  I
                </button>
                <button
                  type="button"
                  className={
                    areAllEditableVendorsOff
                      ? "vendor-stock-switch-option active off"
                      : "vendor-stock-switch-option"
                  }
                  aria-label="Turn off stock for all assigned vendors"
                  aria-pressed={areAllEditableVendorsOff}
                  disabled={!hasEditableVendors || isBulkVendorStockSaving}
                  onClick={() => handleAllVendorStockChange(false)}
                >
                  O
                </button>
              </div>
            </div>

            {isProductDetailsLoading ? (
              <p className="status-message">Loading vendors...</p>
            ) : vendors.length === 0 ? (
              <p className="status-message">No vendors assigned.</p>
            ) : (
              <ul className="assigned-vendors-list">
                {vendors.map((vendor) => {
                  const stockEnabled = vendor.quantity > 0;
                  const isPending = Boolean(
                    pendingVendorStock[vendor.vendorProductId]
                  );

                  return (
                    <li className="assigned-vendor-item" key={vendor.vendorProductId}>
                      <span className="assigned-vendor-name">{vendor.name}</span>

                      {vendor.builtToOrder ? (
                        <div
                          className="vendor-build-time-display"
                          aria-label={`${vendor.name} build time`}
                          title={vendor.buildTime || "Build time not set"}
                        >
                          <span className="vendor-build-time-label">Build Time</span>
                          <span className="vendor-build-time-value">
                            {vendor.buildTime || "Not set"}
                          </span>
                        </div>
                      ) : (
                        <div
                          className={
                            vendor.canUpdateStock
                              ? "vendor-stock-switch"
                              : "vendor-stock-switch readonly"
                          }
                          role="group"
                          aria-label={`${vendor.name} stock ${
                            vendor.canUpdateStock ? "override" : "status"
                          }`}
                          title={`Current quantity: ${vendor.quantity}`}
                        >
                          <button
                            type="button"
                            className={
                              stockEnabled
                                ? "vendor-stock-switch-option active"
                                : "vendor-stock-switch-option"
                            }
                            aria-label={
                              vendor.canUpdateStock
                                ? `Turn on stock for ${vendor.name}`
                                : `${vendor.name} has warehouse stock`
                            }
                            aria-pressed={stockEnabled}
                            disabled={isPending || !vendor.canUpdateStock}
                            onClick={() => handleVendorStockChange(vendor, true)}
                          >
                            I
                          </button>
                          <button
                            type="button"
                            className={
                              stockEnabled
                                ? "vendor-stock-switch-option"
                                : "vendor-stock-switch-option active off"
                            }
                            aria-label={
                              vendor.canUpdateStock
                                ? `Turn off stock for ${vendor.name}`
                                : `${vendor.name} has no warehouse stock`
                            }
                            aria-pressed={!stockEnabled}
                            disabled={isPending || !vendor.canUpdateStock}
                            onClick={() => handleVendorStockChange(vendor, false)}
                          >
                            O
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </aside>

          <section className="notes-panel" aria-label="Notes">
            <div className="notes-panel-header">
              <div>
                <h3>Notes</h3>
                {followUpDate && (
                  <p className="follow-up-current">
                    Follow up: {formatFollowUpDate(followUpDate)}
                  </p>
                )}
              </div>

              <div className="notes-panel-actions">
                {canShowKits && (
                  <button
                    type="button"
                    className="follow-up-button"
                    onClick={() => setIsKitModalOpen(true)}
                  >
                    Kits
                  </button>
                )}
                <button
                  type="button"
                  className="follow-up-button"
                  disabled={isProductRefreshing}
                  onClick={handleRefreshProduct}
                >
                  {isProductRefreshing ? "Refreshing..." : "Refresh"}
                </button>
                <button
                  type="button"
                  className="follow-up-button"
                  onClick={() => setIsFollowUpPickerOpen((isOpen) => !isOpen)}
                >
                  Follow Up
                </button>
              </div>
            </div>

            {isFollowUpPickerOpen && (
              <div className="follow-up-picker">
                <input
                  ref={followUpInputRef}
                  type="date"
                  value={followUpDate}
                  aria-label="Follow-up date"
                  onChange={(event) => handleFollowUpDateChange(event.target.value)}
                />
                {isFollowUpSaving && (
                  <span className="follow-up-status">Saving...</span>
                )}
                {!isFollowUpSaving && followUpMessage && (
                  <span className="follow-up-status">{followUpMessage}</span>
                )}
              </div>
            )}

            <div id="notesList" className="notes-list" ref={notesListRef}>
              {notes.length === 0 ? (
                <p className="status-message">No notes yet.</p>
              ) : (
                notes.map((note, index) => {
                  const authorName = note.author?.name || "StockBridge";
                  const dateLabel = formatNoteDate(note.created_at);
                  const previousDateLabel =
                    index > 0 ? formatNoteDate(notes[index - 1].created_at) : "";
                  const showDateLabel = dateLabel && dateLabel !== previousDateLabel;
                  const noteTime = formatNoteTime(note.created_at);

                  return (
                    <div className="note-group" key={note.id}>
                      {showDateLabel && (
                        <div className="note-date-divider">
                          <span>{dateLabel}</span>
                        </div>
                      )}

                      <article className="note-item">
                        <div className="note-avatar" aria-hidden="true">
                          {note.author?.picture ? (
                            <img src={note.author.picture} alt="" />
                          ) : (
                            <span>{getInitials(authorName)}</span>
                          )}
                        </div>

                        <div className="note-card">
                          <header className="note-card-header">
                            <strong>{authorName}</strong>

                            <div className="note-card-meta">
                              {noteTime && (
                                <time dateTime={note.created_at}>{noteTime}</time>
                              )}

                              <div className="note-icon-actions">
                                <button
                                  type="button"
                                  aria-label="Edit note"
                                  title="Edit note"
                                  onClick={() => handleEditNote(note)}
                                >
                                  <svg
                                    aria-hidden="true"
                                    viewBox="0 0 24 24"
                                    focusable="false"
                                  >
                                    <path d="M4 16.7V20h3.3L17.1 10.2l-3.3-3.3L4 16.7Zm15.7-9.1c.4-.4.4-1 0-1.4l-1.9-1.9c-.4-.4-1-.4-1.4 0l-1.5 1.5 3.3 3.3 1.5-1.5Z" />
                                  </svg>
                                </button>
                                <button
                                  type="button"
                                  aria-label="Delete note"
                                  title="Delete note"
                                  onClick={() => handleDeleteNote(note.id)}
                                >
                                  <svg
                                    aria-hidden="true"
                                    viewBox="0 0 24 24"
                                    focusable="false"
                                  >
                                    <path d="M8 5V4c0-1.1.9-2 2-2h4c1.1 0 2 .9 2 2v1h4v2H4V5h4Zm2 0h4V4h-4v1Zm-3 4h10l-.7 11.1c-.1 1.1-1 1.9-2 1.9H9.7c-1.1 0-1.9-.8-2-1.9L7 9Zm3 2v8h2v-8h-2Zm4 0v8h2v-8h-2Z" />
                                  </svg>
                                </button>
                              </div>
                            </div>
                          </header>

                          <p className="note-text">{note.note}</p>
                        </div>
                      </article>
                    </div>
                  );
                })
              )}
            </div>

            <div className="note-input-container">
              {isMentionMenuOpen && (
                <div className="mention-suggestions" role="listbox" aria-label="Mention people">
                  {isMentionUsersLoading ? (
                    <p className="mention-status">Loading people...</p>
                  ) : mentionSuggestions.length === 0 ? (
                    <p className="mention-status">No matching people.</p>
                  ) : (
                    mentionSuggestions.map((user, index) => {
                      const isActive = index === selectedMentionIndex;
                      const emailLocal = user.email.split("@")[0] || user.email;

                      return (
                        <button
                          key={user.sub}
                          type="button"
                          className={`mention-suggestion-item${isActive ? " active" : ""}`}
                          role="option"
                          aria-selected={isActive}
                          onMouseDown={(event) => {
                            event.preventDefault();
                            insertMention(user);
                          }}
                        >
                          <span className="mention-suggestion-avatar" aria-hidden="true">
                            {user.picture ? (
                              <img src={user.picture} alt="" />
                            ) : (
                              <span>{getInitials(user.name)}</span>
                            )}
                          </span>
                          <span className="mention-suggestion-copy">
                            <strong>{user.name}</strong>
                            <small>@{emailLocal}</small>
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              )}

              <div className="note-input-row">
                <input
                  ref={noteInputRef}
                  type="text"
                  value={newNote}
                  placeholder="Add note or @mention someone..."
                  aria-label="Add note"
                  onChange={(event) =>
                    handleNoteInputChange(
                      event.target.value,
                      event.target.selectionStart ?? event.target.value.length
                    )
                  }
                  onClick={(event) =>
                    updateMentionState(
                      event.currentTarget.value,
                      event.currentTarget.selectionStart ?? event.currentTarget.value.length
                    )
                  }
                  onKeyUp={(event) =>
                    updateMentionState(
                      event.currentTarget.value,
                      event.currentTarget.selectionStart ?? event.currentTarget.value.length
                    )
                  }
                  onBlur={() => {
                    window.setTimeout(() => {
                      setActiveMention(null);
                    }, 0);
                  }}
                  onKeyDown={(event) => {
                    if (isMentionMenuOpen) {
                      if (event.key === "ArrowDown") {
                        event.preventDefault();
                        setSelectedMentionIndex((current) =>
                          mentionSuggestions.length === 0
                            ? 0
                            : (current + 1) % mentionSuggestions.length
                        );
                        return;
                      }

                      if (event.key === "ArrowUp") {
                        event.preventDefault();
                        setSelectedMentionIndex((current) =>
                          mentionSuggestions.length === 0
                            ? 0
                            : (current - 1 + mentionSuggestions.length) %
                              mentionSuggestions.length
                        );
                        return;
                      }

                      if (
                        (event.key === "Enter" || event.key === "Tab") &&
                        mentionSuggestions.length > 0
                      ) {
                        event.preventDefault();
                        insertMention(
                          mentionSuggestions[
                            Math.min(selectedMentionIndex, mentionSuggestions.length - 1)
                          ]
                        );
                        return;
                      }

                      if (event.key === "Escape") {
                        event.preventDefault();
                        setActiveMention(null);
                        return;
                      }
                    }

                    if (event.key === "Enter") {
                      event.preventDefault();
                      handleAddNote();
                    }
                  }}
                />
                <button className="send-btn" type="button" onClick={handleAddNote}>
                  Send
                </button>
              </div>
            </div>
          </section>
        </div>

        {isKitModalOpen && (
          <div
            className="notes-submodal-backdrop"
            role="dialog"
            aria-modal="true"
            aria-labelledby="kitModalTitle"
            onClick={handleKitBackdropClick}
          >
            <div className="kit-products-modal">
              <div className="kit-products-modal-header">
                <h3 id="kitModalTitle">Kits</h3>
                <button type="button" onClick={() => setIsKitModalOpen(false)}>
                  Close
                </button>
              </div>

              {childProducts.length === 0 ? (
                <p className="status-message">No child products found.</p>
              ) : (
                <ul className="kit-products-list">
                  {childProducts.map((childProduct) => (
                    <li className="kit-products-list-item" key={childProduct.sku}>
                      <button
                        type="button"
                        className="kit-products-copy kit-products-open"
                        onClick={() => setSelectedChildSku(childProduct.sku)}
                        aria-label={`Open notes for ${childProduct.sku}`}
                      >
                        <strong>{childProduct.sku}</strong>
                        <span>{childProduct.name}</span>
                      </button>

                      <div className="kit-products-meta">
                        <span className="kit-products-qty">
                          {formatKitQuantityLabel(childProduct)}
                        </span>
                        <span
                          className={`availability-badge ${
                            childProduct.availability === "Available"
                              ? "availability-available"
                              : "availability-backorder"
                          }`}
                          title={`Quantity available: ${childProduct.qtyAvailable}`}
                        >
                          {childProduct.availability}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {selectedChildSku && (
          <NotesModal
            currentUser={currentUser}
            sku={selectedChildSku}
            onClose={handleCloseChildNotes}
            onFollowUpSaved={onFollowUpSaved}
            onProductStockChanged={onProductStockChanged}
          />
        )}
      </div>
    </div>
  );
}
