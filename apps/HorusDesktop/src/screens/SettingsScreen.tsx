import type { FormEvent } from "react";
import type { RuntimeInfo } from "../types/media";

interface Props {
  apiInput: string;
  setApiInput: (url: string) => void;
  saveApiUrl: (event: FormEvent) => void;
  version: string;
  runtime?: RuntimeInfo;
}

export function SettingsScreen({
  apiInput,
  setApiInput,
  saveApiUrl,
  version,
  runtime,
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
        <p>
          FFmpeg permet les téléchargements MP4 et le relais HLS vers DLNA. Il
          doit être installé sur chaque ordinateur.
        </p>
        <p>
          Les favoris et l’historique sont propres à cette application. Les
          téléchargements sont conservés dans son dossier de données.
        </p>
      </section>
    </div>
  );
}
