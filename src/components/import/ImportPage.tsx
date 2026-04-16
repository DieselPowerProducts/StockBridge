import type { FormEvent } from "react";
import { useRef, useState } from "react";
import { importBackorders } from "../../services/api";

type ImportPageProps = {
  onImportComplete: () => void;
};

export function ImportPage({ onImportComplete }: ImportPageProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setMessage("");
    setIsSubmitting(true);

    try {
      const formData = new FormData(event.currentTarget);
      const result = await importBackorders(formData);

      formRef.current?.reset();
      setMessage(`${result.imported} products imported.`);
      onImportComplete();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="page" aria-labelledby="importHeading">
      <h1 id="importHeading">Import Parts</h1>

      <form id="importForm" ref={formRef} onSubmit={handleSubmit}>
        <input type="file" name="file" accept=".csv,text/csv" required />
        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Uploading..." : "Upload CSV"}
        </button>
      </form>

      {message && <p className="status-message">{message}</p>}
    </section>
  );
}
