import { useEffect, useRef, useState } from "react";
import { invoke, errorMessage, isTauri } from "../services/native";

export function DownloadSettings({
  busy,
  autoFocus = false,
}: {
  busy: boolean;
  autoFocus?: boolean;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (autoFocus) {
      heading.current?.focus({ preventScroll: true });
      heading.current?.scrollIntoView?.({ block: "center" });
    }
  }, [autoFocus]);
  const [path, setPath] = useState("");
  const [saved, setSaved] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let alive = true;
    if (isTauri())
      void invoke<string>("get_download_directory")
        .then((value) => {
          if (alive) {
            setPath(value);
            setSaved(value);
          }
        })
        .catch((error) => {
          if (alive) setMessage(errorMessage(error));
        });
    return () => {
      alive = false;
    };
  }, []);
  const save = async (directory: string | null) => {
    setSaving(true);
    setMessage("");
    try {
      const result = await invoke<string>("set_download_directory", {
        directory,
      });
      setSaved(result);
      setPath(result);
      setMessage(
        "Dossier enregistré. Les fichiers existants conservent leur emplacement.",
      );
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };
  return (
    <section
      className="settings-card"
      aria-labelledby="download-settings-heading"
    >
      <h2 id="download-settings-heading" ref={heading} tabIndex={-1}>
        Téléchargements
      </h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save(path);
        }}
      >
        <label className="field">
          Dossier de destination
          <input
            value={path}
            onChange={(event) => setPath(event.target.value)}
            placeholder="Chemin absolu d’un dossier existant"
            disabled={busy || saving || !isTauri()}
          />
        </label>
        <div className="history-actions">
          <button
            className="secondary"
            disabled={
              busy || saving || !path.trim() || path === saved || !isTauri()
            }
          >
            Enregistrer le dossier
          </button>
          <button
            type="button"
            className="secondary"
            disabled={busy || saving || !isTauri()}
            onClick={() => void save(null)}
          >
            Dossier par défaut
          </button>
        </div>
        <p className="muted">
          Collez le chemin du dossier souhaité. Modifiable lorsque la file est
          vide. Les fichiers déjà téléchargés restent à leur emplacement.
        </p>
        {message && <p role="status">{message}</p>}
      </form>
    </section>
  );
}
