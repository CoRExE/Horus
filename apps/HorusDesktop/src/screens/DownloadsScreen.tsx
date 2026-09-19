import type { DownloadProgress } from "../types/media";
import { Download, Play, Cast, Trash2, Settings } from "lucide-react";
import type { OfflineMedia } from "../services/native";
import { bytesLabel } from "../utils/format";

interface Props {
  offline: OfflineMedia[];
  queue: DownloadProgress[];
  removeQueued: (id: string) => void;
  openDownloadSettings: () => void;
  starting: boolean;
  playingOfflineId?: string;
  playOffline: (item: OfflineMedia) => Promise<void>;
  castOffline: (item: OfflineMedia) => void;
  removeDownload: (id: string) => Promise<void>;
}

export function DownloadsScreen({
  offline,
  queue,
  removeQueued,
  openDownloadSettings,
  starting,
  playingOfflineId,
  playOffline,
  castOffline,
  removeDownload,
}: Props) {
  return (
    <>
      <p className="section-description">
        Vos fichiers restent disponibles sans connexion et peuvent être diffusés
        sur votre réseau local.
      </p>
      <button
        className="text-button download-settings-link"
        onClick={openDownloadSettings}
      >
        <Settings size={16} /> Dossier de téléchargement
      </button>
      {queue.length > 0 && (
        <section className="download-queue" aria-label="File d’attente">
          <h2>En attente ({queue.length})</h2>
          <ol>
            {queue.map((item) => (
              <li key={item.id}>
                <span>{item.title}</span>
                <button
                  className="secondary"
                  onClick={() => removeQueued(item.id)}
                  aria-label={`Retirer ${item.title} de la file`}
                >
                  Retirer
                </button>
              </li>
            ))}
          </ol>
          <p className="muted">
            Un fichier à la fois. La file est conservée tant que l’application
            reste ouverte.
          </p>
        </section>
      )}
      {!offline.length && (
        <div className="empty-state">
          <Download size={36} />
          <h2>À emporter avec vous</h2>
          <p>Ouvrez un titre, choisissez un épisode puis « Télécharger ».</p>
        </div>
      )}
      <div className="offline-list">
        {offline.map((item) => (
          <article key={item.id}>
            <div className="offline-icon">
              <Download />
            </div>
            <div className="offline-title">
              <h3>{item.metadata.title}</h3>
              <small>
                {item.available === false ? "Fichier introuvable · " : ""}
                {item.metadata.language} · {bytesLabel(item.sizeBytes)} ·{" "}
                {new Date(item.downloadedAt).toLocaleDateString("fr-FR")}
              </small>
              {item.filePath && (
                <small className="download-path">{item.filePath}</small>
              )}
            </div>
            <button
              className="secondary"
              disabled={starting || item.available === false}
              onClick={() => void playOffline(item)}
            >
              <Play size={16} /> Lire
            </button>
            <button
              className="icon-button"
              aria-label={`Diffuser ${item.metadata.title}`}
              disabled={starting || item.available === false}
              onClick={() => castOffline(item)}
            >
              <Cast size={19} />
            </button>
            <button
              className="icon-button danger"
              aria-label={`Supprimer ${item.metadata.title}`}
              disabled={playingOfflineId === item.id}
              onClick={() => void removeDownload(item.id)}
            >
              <Trash2 size={18} />
            </button>
          </article>
        ))}
      </div>
    </>
  );
}
