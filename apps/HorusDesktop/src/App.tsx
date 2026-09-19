import { groupStreamsByLanguage } from "@horus/core";
import { useState } from "react";
import {
  Film,
  Sparkles,
  Heart,
  History,
  Download,
  Settings,
  Monitor,
  Check,
  X,
} from "lucide-react";
import { CatalogueScreen } from "./screens/CatalogueScreen";
import { LibraryScreen } from "./screens/LibraryScreen";
import { DownloadsScreen } from "./screens/DownloadsScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { MediaDetailsDialog } from "./components/MediaDetailsDialog";
import { CastDialog } from "./components/CastDialog";
import { DownloadActivity } from "./components/DownloadActivity";
import { Player } from "./components/Player";
import { useLibrary } from "./store/library";
import { errorMessage, isTauri } from "./services/native";
import { offlineDetails, offlineSource } from "./services/offline";
import { useMediaDetails } from "./hooks/useMediaDetails";
import { useCatalogue } from "./hooks/useCatalogue";
import { useCasting } from "./hooks/useCasting";
import { useDownloads } from "./hooks/useDownloads";
import { usePlayback } from "./hooks/usePlayback";
import { useRuntimeInfo } from "./hooks/useRuntimeInfo";
import { useUpdates } from "./hooks/useUpdates";
import { UpdateNotice } from "./components/UpdateNotice";
import { useSettings } from "./hooks/useSettings";
import type { Section } from "./types/media";
const sections = [
  { id: "catalogue", label: "Films & séries", icon: Film },
  { id: "anime", label: "Animés", icon: Sparkles },
  { id: "wishlist", label: "Ma liste", icon: Heart },
  { id: "history", label: "Historique", icon: History },
  { id: "downloads", label: "Téléchargements", icon: Download },
  { id: "settings", label: "Paramètres", icon: Settings },
] as const;
export default function App() {
  const library = useLibrary();
  const [focusDownloadSettings, setFocusDownloadSettings] = useState(false);
  const [section, setSection] = useState<Section>("catalogue");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const { runtime, version, versionReady } = useRuntimeInfo(setError);
  const updates = useUpdates(runtime, version, versionReady);
  const {
    details,
    detailsBusy,
    detailError,
    language,
    selectedStream,
    setLanguage,
    setSelectedStream,
    setDetailError,
    closeDetails,
    chooseEpisode,
    openMedia,
    showEpisode,
  } = useMediaDetails();
  const {
    devices,
    scanning,
    deviceError,
    setDeviceError,
    castTarget,
    delivery,
    setDelivery,
    scan,
    openCast,
    closeCast,
    castTo,
  } = useCasting();
  const {
    offline,
    download,
    queue,
    removeQueued,
    isDownloading,
    refreshOffline,
    downloadMedia,
    cancelDownload,
    removeDownload,
  } = useDownloads({ setError, setNotice, setDetailError, setDeviceError });
  const {
    playing,
    playerRef,
    starting,
    startPlayback,
    stopPlayback,
    playNext,
    retryPlayback,
    progress,
    nextEpisode,
  } = usePlayback({
    setError,
    setNotice,
    setDetailError,
    setDeviceError,
    closeDetails,
    closeCast,
    showEpisode,
  });
  const { query, setQuery, results, searched, searching, search, resetSearch } =
    useCatalogue(section, setError);
  const { apiInput, setApiInput, saveApiUrl } = useSettings(
    setError,
    setNotice,
  );
  const navigate = (next: Section) => {
    setFocusDownloadSettings(false);
    resetSearch();
    setSection(next);
    setError("");
    setNotice("");
    if (next === "downloads")
      void refreshOffline().catch((error) => setError(errorMessage(error)));
  };
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            navigate("catalogue");
          }}
        >
          <span className="brand-mark">H</span>
          <span>
            HORUS<small>DESKTOP</small>
          </span>
        </a>
        <span className="nav-caption">VOTRE ESPACE CINÉMA</span>
        <nav aria-label="Navigation principale">
          {sections.map((item) => (
            <button
              key={item.id}
              className={section === item.id ? "nav-item active" : "nav-item"}
              aria-current={section === item.id ? "page" : undefined}
              onClick={() => navigate(item.id)}
            >
              <item.icon size={19} />
              <span>{item.label}</span>
              {item.id === "wishlist" && library.wishlist.length > 0 && (
                <small>{library.wishlist.length}</small>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="status-dot" />{" "}
          {isTauri() ? "Application de bureau" : "Aperçu navigateur"}
          <small>Horus · v{version}</small>
        </div>
      </aside>
      <main>
        <header className="page-header">
          <div>
            <span className="eyebrow">HORUS / VOTRE BIBLIOTHÈQUE</span>
            <h1>{sections.find((item) => item.id === section)?.label}</h1>
          </div>
          <span className="desktop-badge">
            <Monitor size={16} /> Desktop
          </span>
        </header>
        {!isTauri() && (
          <p className="notice">
            Aperçu de l’interface. La recherche, la lecture et la diffusion
            nécessitent la fenêtre Tauri : <code>pnpm desktop</code>.
          </p>
        )}
        {error && (
          <div className="notice error" role="alert">
            {error}
            <button
              className="icon-button"
              aria-label="Masquer l’erreur"
              onClick={() => setError("")}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {notice && (
          <div className="notice success" role="status">
            <Check size={18} />
            {notice}
            <button
              className="icon-button"
              aria-label="Masquer le message"
              onClick={() => setNotice("")}
            >
              <X size={16} />
            </button>
          </div>
        )}
        <UpdateNotice updates={updates} />
        {download && (
          <DownloadActivity
            download={download}
            cancelDownload={() =>
              cancelDownload().catch((error) => setError(errorMessage(error)))
            }
          />
        )}
        {playing && (
          <Player
            ref={playerRef}
            playback={playing}
            onStop={() =>
              void stopPlayback().catch((error) =>
                setError(errorMessage(error)),
              )
            }
            onProgress={progress}
            onNext={
              nextEpisode && !starting ? () => void playNext() : undefined
            }
            onRetry={
              !playing.offlineId ? () => void retryPlayback() : undefined
            }
          />
        )}
        {(section === "catalogue" || section === "anime") && (
          <CatalogueScreen
            {...{
              section,
              library,
              query,
              setQuery,
              searched,
              searching,
              error,
              results,
              search,
              openMedia,
            }}
            openSettings={() => navigate("settings")}
            isDesktop={isTauri()}
          />
        )}
        {(section === "wishlist" || section === "history") && (
          <LibraryScreen {...{ section, library, openMedia }} />
        )}
        {section === "downloads" && (
          <DownloadsScreen
            {...{ offline, starting, queue, removeQueued }}
            openDownloadSettings={() => {
              navigate("settings");
              setFocusDownloadSettings(true);
            }}
            playingOfflineId={playing?.offlineId}
            playOffline={(item) =>
              startPlayback(
                offlineDetails(item),
                offlineSource(item),
                undefined,
                item.id,
              )
            }
            castOffline={(item) =>
              openCast(offlineDetails(item), offlineSource(item), item.id)
            }
            removeDownload={removeDownload}
          />
        )}
        {section === "settings" && (
          <SettingsScreen
            downloadsBusy={!!download || queue.length > 0}
            focusDownloadSettings={focusDownloadSettings}
            {...{ apiInput, setApiInput, version, runtime }}
            saveApiUrl={saveApiUrl}
            updates={updates}
          />
        )}
      </main>
      {details && !castTarget && (
        <MediaDetailsDialog
          {...{
            details,
            library,
            closeDetails,
            detailError,
            detailsBusy,
            starting,
            language,
            setLanguage,
            selectedStream,
            setSelectedStream,
            chooseEpisode,
            startPlayback,
            openCast,
            downloadMedia,
          }}
          downloading={
            !!details &&
            isDownloading(
              details,
              (groupStreamsByLanguage(details.streams)[language] ?? [])[
                selectedStream
              ],
            )
          }
          ffmpeg={!!runtime?.ffmpeg}
        />
      )}
      {castTarget && (
        <CastDialog
          {...{
            castTarget,
            delivery,
            setDelivery,
            download,
            starting,
            scanning,
            scan,
            deviceError,
            devices,
          }}
          castTo={(device) => castTo(device, startPlayback, downloadMedia)}
          ffmpeg={!!runtime?.ffmpeg}
          cancelDownload={cancelDownload}
          closeCast={() => {
            if (!starting && !download) closeCast();
          }}
        />
      )}
    </div>
  );
}
