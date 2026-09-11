import { LoaderCircle, RefreshCw, ArrowRight, Cast } from "lucide-react";
import { Modal } from "./Modal";
import { bytesLabel } from "../utils/format";
import type { Device } from "../services/native";
import type { CastTarget, DownloadProgress } from "../types/media";

interface Props {
  castTarget: CastTarget;
  closeCast: () => void;
  delivery: "direct" | "download";
  setDelivery: (delivery: "direct" | "download") => void;
  ffmpeg: boolean;
  download?: DownloadProgress;
  starting: boolean;
  scanning: boolean;
  scan: () => Promise<void>;
  deviceError: string;
  devices: Device[];
  castTo: (device: Device) => Promise<void>;
  cancelDownload: () => Promise<void>;
}

export function CastDialog({
  castTarget,
  closeCast,
  delivery,
  setDelivery,
  ffmpeg,
  download,
  starting,
  scanning,
  scan,
  deviceError,
  devices,
  castTo,
  cancelDownload,
}: Props) {
  return (
    <Modal title="Choisir un téléviseur" onClose={closeCast}>
      <div className="detail-content">
        <p className="muted">
          Votre ordinateur et votre téléviseur doivent être sur le même réseau.
        </p>
        {!castTarget.offlineId && (
          <label className="field">
            Mode de diffusion
            <select
              value={delivery}
              disabled={!!download || starting}
              onChange={(event) =>
                setDelivery(event.target.value as typeof delivery)
              }
            >
              <option value="direct">Diffuser pendant la lecture</option>
              <option value="download" disabled={!ffmpeg}>
                Télécharger puis diffuser (conserve le fichier)
              </option>
            </select>
          </label>
        )}
        <button
          className="secondary"
          disabled={scanning || starting || !!download}
          onClick={() => void scan()}
        >
          {scanning ? (
            <LoaderCircle className="spin" size={17} />
          ) : (
            <RefreshCw size={17} />
          )}{" "}
          {scanning ? "Recherche des appareils…" : "Actualiser"}
        </button>
        {deviceError && (
          <p className="notice error" role="alert">
            {deviceError}
          </p>
        )}
        {download && (
          <p role="status">
            Téléchargement avant diffusion : {bytesLabel(download.bytes)}{" "}
            <button
              className="text-button"
              onClick={() => void cancelDownload()}
            >
              Annuler
            </button>
          </p>
        )}
        {starting && (
          <p className="loading-line">
            <LoaderCircle className="spin" /> Démarrage sur le téléviseur…
          </p>
        )}
        <div className="device-list">
          {devices.map((device) => (
            <button
              key={device.id}
              disabled={starting || !!download}
              onClick={() => void castTo(device)}
            >
              <Cast />
              <span>
                <strong>{device.name}</strong>
                <small>
                  {device.kind === "cast" ? "Chromecast" : "DLNA"} · {device.ip}
                </small>
              </span>
              <ArrowRight size={18} />
            </button>
          ))}
        </div>
        {!scanning && !devices.length && (
          <p className="empty-state">
            Aucun appareil trouvé. Vérifiez le réseau local, le pare-feu et que
            le téléviseur est allumé.
          </p>
        )}
      </div>
    </Modal>
  );
}
