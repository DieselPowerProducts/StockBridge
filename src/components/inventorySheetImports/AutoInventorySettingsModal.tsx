import { useEffect, useState } from "react";
import {
  getVendorAutoInventorySettings,
  getVendors,
  updateVendorAutoInventorySettings
} from "../../services/api";
import type {
  VendorAutoInventorySettings,
  VendorSummary
} from "../../types";

type AutoInventorySettingsModalProps = {
  vendorId?: string;
  vendorName?: string;
  onClose: () => void;
  onSaved: () => void;
};

function formatPhraseText(phrases: string[]) {
  return phrases.join(" : ");
}

function parsePhraseText(value: string) {
  return value
    .split(/[,:]/)
    .map((phrase) => phrase.trim())
    .filter(Boolean);
}

export function AutoInventorySettingsModal({
  vendorId = "",
  vendorName = "",
  onClose,
  onSaved
}: AutoInventorySettingsModalProps) {
  const [selectedVendorId, setSelectedVendorId] = useState(vendorId);
  const [selectedVendorName, setSelectedVendorName] = useState(vendorName);
  const [vendorSearch, setVendorSearch] = useState("");
  const [vendors, setVendors] = useState<VendorSummary[]>([]);
  const [settings, setSettings] = useState<VendorAutoInventorySettings | null>(null);
  const [inStockPhrases, setInStockPhrases] = useState("");
  const [outOfStockPhrases, setOutOfStockPhrases] = useState("");
  const [isLoading, setIsLoading] = useState(Boolean(vendorId));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (selectedVendorId) return;
    const timeout = window.setTimeout(() => {
      setIsLoading(true);
      void getVendors({ page: 1, limit: 20, search: vendorSearch.trim() })
        .then((result) => setVendors(result.data))
        .catch((loadError) =>
          setError(loadError instanceof Error ? loadError.message : "Unable to load vendors.")
        )
        .finally(() => setIsLoading(false));
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [selectedVendorId, vendorSearch]);

  useEffect(() => {
    if (!selectedVendorId) return;
    let ignore = false;
    setIsLoading(true);
    setError("");
    void getVendorAutoInventorySettings(selectedVendorId)
      .then((result) => {
        if (ignore) return;
        setSettings({ ...result, enabled: result.enabled || !vendorId });
        setInStockPhrases(formatPhraseText(result.inStockPhrases));
        setOutOfStockPhrases(formatPhraseText(result.outOfStockPhrases));
      })
      .catch((loadError) => {
        if (!ignore) {
          setError(loadError instanceof Error ? loadError.message : "Unable to load settings.");
        }
      })
      .finally(() => {
        if (!ignore) setIsLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [selectedVendorId, vendorId]);

  function updateSettings(patch: Partial<VendorAutoInventorySettings>) {
    setSettings((current) => (current ? { ...current, ...patch } : current));
  }

  async function handleSave() {
    if (!settings || !selectedVendorId || isSaving) return;
    setIsSaving(true);
    setError("");

    try {
      await updateVendorAutoInventorySettings({
        vendorId: selectedVendorId,
        settings: {
          enabled: settings.enabled,
          senderEmail: settings.senderEmail,
          skuHeader: settings.skuHeader,
          inventoryHeader: settings.inventoryHeader,
          subtractiveColumn: settings.subtractiveColumn,
          skuExceptions: settings.skuExceptions,
          inventoryMode: settings.inventoryMode,
          inStockPhrases: parsePhraseText(inStockPhrases),
          outOfStockPhrases: parsePhraseText(outOfStockPhrases)
        }
      });
      onSaved();
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save settings.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div
      className="modal auto-inventory-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="autoInventoryTitle"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSaving) onClose();
      }}
    >
      <section className="modal-content auto-inventory-modal">
        <header className="auto-inventory-modal-header">
          <div>
            <h2 id="autoInventoryTitle">Auto Inventory Settings</h2>
            {selectedVendorId ? <span>{selectedVendorName || selectedVendorId}</span> : null}
          </div>
          <button type="button" aria-label="Close auto inventory settings" onClick={onClose}>
            x
          </button>
        </header>

        {!selectedVendorId ? (
          <section className="auto-inventory-vendor-picker">
            <input
              type="search"
              className="search-bar"
              value={vendorSearch}
              placeholder="Search vendors..."
              aria-label="Search vendors for auto inventory"
              autoFocus
              onChange={(event) => setVendorSearch(event.target.value)}
            />
            {isLoading ? <p className="status-message">Loading vendors...</p> : null}
            <div className="auto-inventory-vendor-results">
              {vendors.map((vendor) => (
                <button
                  type="button"
                  key={vendor.id}
                  onClick={() => {
                    setSelectedVendorId(vendor.id);
                    setSelectedVendorName(vendor.vendor);
                  }}
                >
                  {vendor.vendor}
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {isLoading && selectedVendorId ? <p className="status-message">Loading settings...</p> : null}
        {error ? <p className="status-message error-message">{error}</p> : null}

        {settings && !isLoading ? (
          <>
            <label className="auto-inventory-enable">
              <input
                type="checkbox"
                checked={settings.enabled}
                disabled={isSaving}
                onChange={(event) => updateSettings({ enabled: event.target.checked })}
              />
              <span>Enable auto inventory for this vendor</span>
            </label>

            <div className="auto-inventory-form-grid">
              <label>
                <span>Sender Email</span>
                <input
                  type="email"
                  value={settings.senderEmail}
                  placeholder="inventory@vendor.com"
                  onChange={(event) => updateSettings({ senderEmail: event.target.value })}
                />
              </label>
              <label>
                <span>SKU Header</span>
                <input
                  type="text"
                  value={settings.skuHeader}
                  placeholder="SKU"
                  onChange={(event) => updateSettings({ skuHeader: event.target.value })}
                />
              </label>
              <label>
                <span>Inventory Header</span>
                <input
                  type="text"
                  value={settings.inventoryHeader}
                  placeholder="Inventory"
                  onChange={(event) => updateSettings({ inventoryHeader: event.target.value })}
                />
              </label>
              <label>
                <span>Subtractive Column</span>
                <input
                  type="text"
                  value={settings.subtractiveColumn || ""}
                  placeholder="Allocated"
                  onChange={(event) => updateSettings({ subtractiveColumn: event.target.value })}
                />
              </label>
            </div>

            <fieldset className="auto-inventory-mode">
              <legend>Inventory Value</legend>
              <label>
                <input
                  type="radio"
                  name="inventory-mode"
                  checked={settings.inventoryMode === "numerical"}
                  onChange={() => updateSettings({ inventoryMode: "numerical" })}
                />
                <span>Numerical</span>
              </label>
              <label>
                <input
                  type="radio"
                  name="inventory-mode"
                  checked={settings.inventoryMode === "alphabetical"}
                  onChange={() => updateSettings({ inventoryMode: "alphabetical" })}
                />
                <span>Alphabetical</span>
              </label>
            </fieldset>

            {settings.inventoryMode === "alphabetical" ? (
              <div className="auto-inventory-form-grid">
                <label>
                  <span>In Stock Message</span>
                  <input
                    type="text"
                    value={inStockPhrases}
                    placeholder="In Stock : Low Stock"
                    onChange={(event) => setInStockPhrases(event.target.value)}
                  />
                </label>
                <label>
                  <span>Out of Stock Message</span>
                  <input
                    type="text"
                    value={outOfStockPhrases}
                    placeholder="Out of Stock : Discontinued"
                    onChange={(event) => setOutOfStockPhrases(event.target.value)}
                  />
                </label>
              </div>
            ) : null}

            <footer className="auto-inventory-modal-actions">
              <button type="button" className="secondary-action" disabled={isSaving} onClick={onClose}>
                Cancel
              </button>
              <button type="button" className="send-btn" disabled={isSaving} onClick={handleSave}>
                {isSaving ? "Saving..." : "Save"}
              </button>
            </footer>
          </>
        ) : null}
      </section>
    </div>
  );
}
