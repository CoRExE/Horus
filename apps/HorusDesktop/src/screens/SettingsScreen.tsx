import { DownloadSettings } from "../components/DownloadSettings";
import type { FormEvent } from "react";
import type { RuntimeInfo } from "../types/media";
import type { useUpdates } from "../hooks/useUpdates";

interface Props {
  downloadsBusy: boolean;
  focusDownloadSettings?: boolean;
  apiInput: string;
  setApiInput: (url: string) => void;
  saveApiUrl: (event: FormEvent) => void;
  version: string;
  runtime?: RuntimeInfo;
  updates: ReturnType<typeof useUpdates>;
}

export function SettingsScreen({
  downloadsBusy,
  focusDownloadSettings,
  apiInput,
  setApiInput,
  saveApiUrl,
  version,
  runtime,
  updates,
}: Props) {
  return (
    <div className="settings-grid">
      <section className="settings-card">
        <h2>Catalogue HorusApi</h2>
        <p>
          L’adresse de votre Worker Cloudflare. Le jeton TMDB reste dans l’API.
        </p>
        <form onSubmit={saveApiUrl}>
          <label>
            Adresse du catalogue
            <input
              type="url"
              required
              value={apiInput}
              onChange={(event) => setApiInput(event.target.value)}
              placeholder="https://horus-api.votre-compte.workers.dev"
            />
          </label>
          <button className="primary">Enregistrer</button>
        </form>
      </section>
      <DownloadSettings
        busy={downloadsBusy}
        autoFocus={focusDownloadSettings}
      />
      <section className="settings-card">
        <h2>Cette installation</h2>
        <dl>
          <div>
            <dt>Version</dt>
            <dd>{version}</dd>
          </div>
          <div>
            <dt>Système</dt>
            <dd>{runtime?.platform ?? "Navigateur"}</dd>
          </div>
          <div>
            <dt>FFmpeg</dt>
            <dd>{runtime?.ffmpeg ? "Disponible" : "Non détecté"}</dd>
          </div>
        </dl>
        <button
          disabled={!updates.enabled || updates.result.kind === "checking"}
          onClick={() => void updates.check()}
        >
          {updates.result.kind === "checking"
            ? "Vérification…"
            : "Vérifier les mises à jour"}
        </button>
        <p role="status">
          {!updates.enabled
            ? "Vérification disponible dans une installation prise en charge."
            : updates.result.kind === "current"
              ? "Cette version est à jour."
              : updates.result.kind === "unavailable"
                ? "Vérification impossible pour le moment. Réessayez plus tard."
                : updates.result.kind === "available"
                  ? `Version ${updates.result.manifest.version} disponible.`
                  : ""}
        </p>
        <p>
          FFmpeg permet les téléchargements MP4 et le relais HLS vers DLNA. Il
          doit être installé sur chaque ordinateur.
        </p>
        <p>
          Les favoris et l’historique sont propres à cette application. Le
          dossier de téléchargement peut être choisi dans les paramètres
          ci-dessus.
        </p>
      </section>
    </div>
  );
}
