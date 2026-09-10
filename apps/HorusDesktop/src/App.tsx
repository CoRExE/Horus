import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Film,
  Sparkles,
  Heart,
  History,
  Download,
  Settings,
  Search,
  Cast,
  Play,
  Monitor,
  ArrowRight,
  Trash2,
  LoaderCircle,
  RefreshCw,
  Check,
  X,
} from "lucide-react";
import {
  formatRemoteMediaTitle,
  groupStreamsByLanguage,
  inferStreamFormat,
  normalizeStreamLanguage,
  sortStreamLanguages,
  type Episode,
  type SearchResult,
  type Stream,
} from "@horus/core";
import { listen } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { Modal } from "./components/Modal";
import { Player, type Playback } from "./components/Player";
import { useLibrary, mediaKey } from "./store/library";
import { searchMedia, providerFor } from "./services/providers";
import { controlDevice, discoverDevices, loadDevice } from "./services/devices";
import {
  errorMessage,
  invoke,
  isTauri,
  releaseStream,
  sourcePayload,
  type Device,
  type OfflineMedia,
  type PreparedStream,
} from "./services/native";

type Section =
  | "catalogue"
  | "anime"
  | "wishlist"
  | "history"
  | "downloads"
  | "settings";
interface Details {
  media: SearchResult;
  episodes: Episode[];
  episode?: Episode;
  streams: Stream[];
}
interface Playing extends Playback {
  media: SearchResult;
  episode: Episode;
  stream: Stream;
  episodes: Episode[];
  alternatives: Stream[];
  offlineId?: string;
}
const sections = [
  { id: "catalogue", label: "Films & séries", icon: Film },
  { id: "anime", label: "Animés", icon: Sparkles },
  { id: "wishlist", label: "Ma liste", icon: Heart },
  { id: "history", label: "Historique", icon: History },
  { id: "downloads", label: "Téléchargements", icon: Download },
  { id: "settings", label: "Paramètres", icon: Settings },
] as const;
const bytesLabel = (bytes: number) =>
  bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(1)} Go`
    : `${Math.round(bytes / 1024 ** 2)} Mo`;

export default function App() {
  const library = useLibrary();
  const [section, setSection] = useState<Section>("catalogue");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [details, setDetails] = useState<Details>();
  const [detailsBusy, setDetailsBusy] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [language, setLanguage] = useState("VF");
  const [selectedStream, setSelectedStream] = useState(0);
  const [playing, setPlaying] = useState<Playing>();
  const playingRef = useRef<Playing | undefined>(undefined);
  const [starting, setStarting] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [scanning, setScanning] = useState(false);
  const [deviceError, setDeviceError] = useState("");
  const [castTarget, setCastTarget] = useState<{
    details: Details;
    stream: Stream;
    offlineId?: string;
  }>();
  const [delivery, setDelivery] = useState<"direct" | "download">("direct");
  const [offline, setOffline] = useState<OfflineMedia[]>([]);
  const [download, setDownload] = useState<{
    id: string;
    title: string;
    bytes: number;
  }>();
  const downloadRef = useRef<string | undefined>(undefined);
  const [runtime, setRuntime] = useState<{
    platform: string;
    ffmpeg: boolean;
  }>();
  const [version, setVersion] = useState("0.1.0");
  const [apiInput, setApiInput] = useState(library.apiUrl);
  const searchGeneration = useRef(0);
  const detailsGeneration = useRef(0);
  const playbackGeneration = useRef(0);
  const lastProgressSave = useRef(0);

  async function refreshOffline() {
    if (isTauri()) setOffline(await invoke<OfflineMedia[]>("list_downloads"));
  }
  useEffect(() => {
    if (!isTauri()) return;
    void invoke<{ platform: string; ffmpeg: boolean }>("runtime_info")
      .then(setRuntime)
      .catch((error) => setError(errorMessage(error)));
    void getVersion()
      .then(setVersion)
      .catch(() => {});
    void refreshOffline().catch((error) => setError(errorMessage(error)));
    const listener = listen<{ id: string; bytes: number }>(
      "download-progress",
      (event) =>
        setDownload((current) =>
          current?.id === event.payload.id
            ? { ...current, bytes: event.payload.bytes }
            : current,
        ),
    );
    return () => {
      void listener.then((unlisten) => unlisten());
    };
  }, []);

  const navigate = (next: Section) => {
    searchGeneration.current++;
    setSection(next);
    setResults([]);
    setSearched(false);
    setSearching(false);
    setQuery("");
    setError("");
    setNotice("");
    if (next === "downloads")
      void refreshOffline().catch((error) => setError(errorMessage(error)));
  };

  const search = async (event: FormEvent) => {
    event.preventDefault();
    if (section !== "catalogue" && section !== "anime") return;
    const generation = ++searchGeneration.current;
    setSearching(true);
    setError("");
    setSearched(true);
    setResults([]);
    try {
      const media = await searchMedia(section, query.trim());
      if (generation === searchGeneration.current) setResults(media);
    } catch (error) {
      if (generation === searchGeneration.current)
        setError(errorMessage(error));
    } finally {
      if (generation === searchGeneration.current) setSearching(false);
    }
  };

  const closeDetails = () => {
    detailsGeneration.current++;
    setDetails(undefined);
    setDetailsBusy(false);
    setDetailError("");
  };
  const chooseEpisode = async (current: Details, episode: Episode) => {
    const generation = ++detailsGeneration.current;
    setDetails({ ...current, episode, streams: [] });
    setDetailsBusy(true);
    setDetailError("");
    setLanguage("VF");
    setSelectedStream(0);
    try {
      const streams = await providerFor(current.media).getStreams(episode.id);
      if (generation !== detailsGeneration.current) return;
      setDetails({ ...current, episode, streams });
      if (!streams.length)
        setDetailError("Aucun serveur disponible pour cet épisode.");
    } catch (error) {
      if (generation === detailsGeneration.current)
        setDetailError(errorMessage(error));
    } finally {
      if (generation === detailsGeneration.current) setDetailsBusy(false);
    }
  };

  const openMedia = async (media: SearchResult, resume?: Episode) => {
    const generation = ++detailsGeneration.current;
    setDetails({ media, episodes: [], streams: [] });
    setDetailsBusy(true);
    setDetailError("");
    try {
      const episodes = await providerFor(media).getEpisodes(media.id);
      if (generation !== detailsGeneration.current) return;
      const current = { media, episodes, streams: [] };
      setDetails(current);
      if (!episodes.length)
        setDetailError("Aucun épisode disponible pour ce média.");
      const initial = resume
        ? episodes.find((item) => item.id === resume.id)
        : episodes.length === 1
          ? episodes[0]
          : undefined;
      if (initial) {
        await chooseEpisode(current, initial);
        return;
      }
    } catch (error) {
      if (generation === detailsGeneration.current)
        setDetailError(errorMessage(error));
    } finally {
      if (generation === detailsGeneration.current) setDetailsBusy(false);
    }
  };

  const stopPlayback = async () => {
    ++playbackGeneration.current;
    const current = playingRef.current;
    playingRef.current = undefined;
    setPlaying(undefined);
    if (current) {
      try {
        if (current.device) await controlDevice(current.device, "stop");
      } catch (error) {
        setError(`Arrêt TV non confirmé : ${errorMessage(error)}`);
      } finally {
        await releaseStream(current.prepared.id);
      }
    }
  };

  const startPlayback = async (
    current: Details,
    stream: Stream,
    device?: Device,
    offlineId?: string,
  ) => {
    if (!current.episode) return;
    setStarting(true);
    setError("");
    setDetailError("");
    setDeviceError("");
    let prepared: PreparedStream | undefined;
    try {
      await stopPlayback();
      const generation = ++playbackGeneration.current;
      const format = offlineId ? "file" : inferStreamFormat(stream);
      prepared = offlineId
        ? await invoke<PreparedStream>("offline_stream", {
            id: offlineId,
            receiver: device?.ip ?? null,
          })
        : await invoke<PreparedStream>("prepare_stream", {
            source: sourcePayload(stream),
            format,
            receiver: device?.ip ?? null,
            bridge: device?.kind === "dlna" && format === "hls",
          });
      if (generation !== playbackGeneration.current) {
        await releaseStream(prepared.id);
        return;
      }
      const title = formatRemoteMediaTitle(current.media, current.episode);
      if (device) await loadDevice(device, prepared, title);
      if (generation !== playbackGeneration.current) {
        if (device) await controlDevice(device, "stop");
        await releaseStream(prepared.id);
        return;
      }
      const previous = useLibrary
        .getState()
        .history.find(
          (item) =>
            mediaKey(item.media) === mediaKey(current.media) &&
            item.episode.id === current.episode!.id,
        );
      if (
        device &&
        previous &&
        previous.position > 0 &&
        prepared.contentType !== "video/mp2t"
      ) {
        await controlDevice(device, "seek", previous.position).catch(() =>
          setNotice(
            "La reprise à la position précédente n’est pas disponible sur ce téléviseur.",
          ),
        );
      }
      const playback: Playing = {
        prepared,
        title,
        language: normalizeStreamLanguage(stream.language),
        format,
        device,
        resumeAt: previous?.position ?? 0,
        media: current.media,
        episode: current.episode,
        stream,
        episodes: current.episodes,
        alternatives: current.streams,
        offlineId,
      };
      playingRef.current = playback;
      setPlaying(playback);
      lastProgressSave.current = 0;
      library.remember({
        media: current.media,
        episode: current.episode,
        position: previous?.position ?? 0,
        duration: previous?.duration ?? 0,
      });
      closeDetails();
      setCastTarget(undefined);
    } catch (error) {
      if (prepared) await releaseStream(prepared.id).catch(() => {});
      const message = errorMessage(error);
      setError(message);
      setDetailError(message);
      setDeviceError(message);
    } finally {
      setStarting(false);
    }
  };

  const downloadMedia = async (
    current: Details,
    stream: Stream,
  ): Promise<OfflineMedia | undefined> => {
    if (!current.episode || downloadRef.current) return;
    const id = crypto.randomUUID();
    const metadata = {
      media: current.media,
      episode: current.episode,
      title: formatRemoteMediaTitle(current.media, current.episode),
      language: normalizeStreamLanguage(stream.language),
    };
    downloadRef.current = id;
    setDownload({ id, title: metadata.title, bytes: 0 });
    setError("");
    setDetailError("");
    try {
      const result = await invoke<OfflineMedia>("download_media", {
        id,
        source: sourcePayload(stream),
        metadata,
      });
      await refreshOffline();
      setNotice("Téléchargement terminé. Le média est disponible hors ligne.");
      return result;
    } catch (error) {
      const message = errorMessage(error);
      setError(message);
      setDetailError(message);
      setDeviceError(message);
    } finally {
      downloadRef.current = undefined;
      setDownload(undefined);
    }
  };

  const scan = async () => {
    setScanning(true);
    setDeviceError("");
    setDevices([]);
    try {
      const result = await discoverDevices();
      setDevices(result.devices);
      setDeviceError(result.warnings.join(" · "));
    } catch (error) {
      setDeviceError(errorMessage(error));
    } finally {
      setScanning(false);
    }
  };
  const openCast = (current: Details, stream: Stream, offlineId?: string) => {
    setCastTarget({ details: current, stream, offlineId });
    setDelivery("direct");
    void scan();
  };
  const castTo = async (device: Device) => {
    if (!castTarget) return;
    if (delivery === "download" && !castTarget.offlineId) {
      const cached = await downloadMedia(castTarget.details, castTarget.stream);
      if (cached)
        await startPlayback(
          castTarget.details,
          castTarget.stream,
          device,
          cached.id,
        );
    } else
      await startPlayback(
        castTarget.details,
        castTarget.stream,
        device,
        castTarget.offlineId,
      );
  };

  const playNext = async () => {
    const current = playingRef.current;
    if (!current || starting) return;
    const next =
      current.episodes[
        current.episodes.findIndex((item) => item.id === current.episode.id) + 1
      ];
    if (!next) return;
    setStarting(true);
    try {
      const streams = await providerFor(current.media).getStreams(next.id);
      if (playingRef.current !== current) return;
      const stream = streams.find(
        (item) => normalizeStreamLanguage(item.language) === current.language,
      );
      if (!stream) {
        await stopPlayback();
        setDetails({
          media: current.media,
          episodes: current.episodes,
          episode: next,
          streams,
        });
        setLanguage(current.language);
        setSelectedStream(0);
        setDetailError(
          `La piste ${current.language} est indisponible. Choisissez une autre langue pour continuer.`,
        );
        return;
      }
      await startPlayback(
        {
          media: current.media,
          episodes: current.episodes,
          episode: next,
          streams,
        },
        stream,
        current.device,
      );
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setStarting(false);
    }
  };

  const progress = (position: number, duration: number, flush = false) => {
    if (
      !playing ||
      playingRef.current !== playing ||
      (!flush && Date.now() - lastProgressSave.current < 5000)
    )
      return;
    lastProgressSave.current = Date.now();
    library.remember({
      media: playing.media,
      episode: playing.episode,
      position,
      duration,
    });
  };
  const offlineDetails = (item: OfflineMedia): Details => ({
    media: item.metadata.media,
    episodes: [item.metadata.episode],
    episode: item.metadata.episode,
    streams: [],
  });
  const offlineSource = (item: OfflineMedia): Stream => ({
    url: "",
    language: item.metadata.language,
    server: "Hors ligne",
    format: "file",
  });
  const groups = groupStreamsByLanguage(details?.streams ?? []);
  const streams = groups[language] ?? [];
  const stream = streams[selectedStream];
  const visibleMedia =
    section === "wishlist"
      ? library.wishlist
      : section === "history"
        ? library.history.map((item) => item.media)
        : results;
  const searchingSection = section === "catalogue" || section === "anime";
  const nextEpisode =
    playing &&
    !playing.offlineId &&
    playing.episodes[
      playing.episodes.findIndex((item) => item.id === playing.episode.id) + 1
    ];

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
        {download && (
          <div className="download-progress" role="status">
            <LoaderCircle className="spin" size={20} />
            <div>
              <strong>{download.title}</strong>
              <small>
                {bytesLabel(download.bytes)} téléchargés · préparation du
                fichier MP4
              </small>
            </div>
            <button
              className="secondary"
              onClick={() =>
                void invoke("cancel_download", { id: download.id }).catch(
                  (error) => setError(errorMessage(error)),
                )
              }
            >
              Annuler
            </button>
          </div>
        )}
        {playing && (
          <Player
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
              !playing.offlineId
                ? () => {
                    const alternatives = playing.alternatives.filter(
                      (item) =>
                        normalizeStreamLanguage(item.language) ===
                        playing.language,
                    );
                    const next =
                      alternatives[alternatives.indexOf(playing.stream) + 1];
                    if (next)
                      void startPlayback(
                        {
                          media: playing.media,
                          episodes: playing.episodes,
                          episode: playing.episode,
                          streams: playing.alternatives,
                        },
                        next,
                        playing.device,
                      );
                    else
                      setError(
                        "Aucun autre serveur disponible dans cette langue.",
                      );
                  }
                : undefined
            }
          />
        )}
        {searchingSection && (
          <>
            <form className="search-form" onSubmit={search}>
              <Search size={21} />
              <input
                aria-label="Rechercher un titre"
                placeholder={
                  section === "anime"
                    ? "Rechercher un animé sur AnimeSama…"
                    : "Un film, une série, un univers à découvrir…"
                }
                value={query}
                minLength={2}
                maxLength={120}
                required
                onChange={(event) => setQuery(event.target.value)}
              />
              <button
                className="primary"
                disabled={searching || query.trim().length < 2 || !isTauri()}
              >
                {searching ? (
                  <LoaderCircle size={18} className="spin" />
                ) : (
                  <ArrowRight size={18} />
                )}{" "}
                Rechercher
              </button>
            </form>
            {section === "catalogue" && !library.apiUrl && (
              <p className="notice">
                Configurez l’adresse de HorusApi dans les{" "}
                <button
                  className="text-button"
                  onClick={() => navigate("settings")}
                >
                  paramètres
                </button>{" "}
                pour rechercher un titre. La recherche par identifiant TMDB
                reste disponible.
              </p>
            )}
            {!searched && (
              <section className="welcome">
                <div className="eyebrow">
                  {section === "anime" ? "ANIMESAMA" : "FILMS & SÉRIES"}
                </div>
                <h2>
                  Vos histoires.
                  <br />
                  <em>Sur grand écran.</em>
                </h2>
                <p>
                  Retrouvez un titre, choisissez votre épisode et
                  installez-vous. Sur votre ordinateur ou votre téléviseur.
                </p>
                <div className="welcome-line">
                  <span />
                  <span>UNE AUTRE FAÇON DE REGARDER</span>
                </div>
                <div className="orbit" aria-hidden="true">
                  <div />
                  <span>H</span>
                </div>
              </section>
            )}
            {searching && (
              <div className="empty-state">
                <LoaderCircle className="spin" />
                <p>Recherche en cours…</p>
              </div>
            )}
          </>
        )}
        {section === "history" && library.history.length > 0 && (
          <button
            className="secondary section-action"
            onClick={() => library.clearHistory()}
          >
            <Trash2 size={16} /> Vider l’historique
          </button>
        )}
        {section !== "settings" &&
          section !== "downloads" &&
          visibleMedia.length > 0 && (
            <>
              <div className="list-heading">
                <h2>
                  {searchingSection
                    ? "Résultats"
                    : section === "wishlist"
                      ? "À regarder plus tard"
                      : "Reprendre une histoire"}
                </h2>
                <span>{visibleMedia.length} titres</span>
              </div>
              <div className="media-grid">
                {visibleMedia.map((media) => {
                  const saved = library.wishlist.some(
                    (item) => mediaKey(item) === mediaKey(media),
                  );
                  const history = library.history.find(
                    (item) => mediaKey(item.media) === mediaKey(media),
                  );
                  return (
                    <article className="media-card" key={mediaKey(media)}>
                      <button
                        className="media-open"
                        onClick={() =>
                          void openMedia(
                            media,
                            section === "history"
                              ? history?.episode
                              : undefined,
                          )
                        }
                      >
                        <div className="poster">
                          {media.coverUrl ? (
                            <img
                              src={media.coverUrl}
                              alt=""
                              loading="lazy"
                              onError={(event) => {
                                event.currentTarget.style.display = "none";
                              }}
                            />
                          ) : null}
                          <Film className="poster-placeholder" size={35} />
                          <span className="play-overlay">
                            <Play fill="currentColor" />
                          </span>
                          <span className="media-type">
                            {media.type === "movie"
                              ? "FILM"
                              : media.type === "anime"
                                ? "ANIMÉ"
                                : "SÉRIE"}
                          </span>
                        </div>
                        <h3>{media.title}</h3>
                        <small>
                          {section === "history" && history
                            ? (history.episode.title ??
                              `Épisode ${history.episode.number}`)
                            : media.providerId === "anime-sama"
                              ? "AnimeSama"
                              : "Catalogue TMDB"}
                        </small>
                      </button>
                      <button
                        className={saved ? "favorite saved" : "favorite"}
                        aria-label={
                          saved
                            ? `Retirer ${media.title} de ma liste`
                            : `Ajouter ${media.title} à ma liste`
                        }
                        aria-pressed={saved}
                        onClick={() => library.toggleWishlist(media)}
                      >
                        <Heart
                          size={17}
                          fill={saved ? "currentColor" : "none"}
                        />
                      </button>
                    </article>
                  );
                })}
              </div>
            </>
          )}
        {((searchingSection && searched && !searching && !error) ||
          section === "wishlist" ||
          section === "history") &&
          !visibleMedia.length && (
            <div className="empty-state">
              <Film size={35} />
              <h2>
                {searched
                  ? "Aucun résultat"
                  : "Votre bibliothèque commence ici"}
              </h2>
              <p>
                {searched
                  ? "Essayez un autre titre ou vérifiez son orthographe."
                  : section === "wishlist"
                    ? "Ajoutez des titres avec le cœur pour les retrouver ici."
                    : "Vos dernières lectures apparaîtront ici."}
              </p>
            </div>
          )}
        {section === "downloads" && (
          <>
            <p className="section-description">
              Vos fichiers restent disponibles sans connexion et peuvent être
              diffusés sur votre réseau local.
            </p>
            {!offline.length && (
              <div className="empty-state">
                <Download size={36} />
                <h2>À emporter avec vous</h2>
                <p>
                  Ouvrez un titre, choisissez un épisode puis « Télécharger ».
                </p>
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
                      {item.metadata.language} · {bytesLabel(item.sizeBytes)} ·{" "}
                      {new Date(item.downloadedAt).toLocaleDateString("fr-FR")}
                    </small>
                  </div>
                  <button
                    className="secondary"
                    disabled={starting}
                    onClick={() =>
                      void startPlayback(
                        offlineDetails(item),
                        offlineSource(item),
                        undefined,
                        item.id,
                      )
                    }
                  >
                    <Play size={16} /> Lire
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`Diffuser ${item.metadata.title}`}
                    disabled={starting}
                    onClick={() =>
                      openCast(
                        offlineDetails(item),
                        offlineSource(item),
                        item.id,
                      )
                    }
                  >
                    <Cast size={19} />
                  </button>
                  <button
                    className="icon-button danger"
                    aria-label={`Supprimer ${item.metadata.title}`}
                    disabled={playing?.offlineId === item.id}
                    onClick={() =>
                      void invoke("remove_download", { id: item.id })
                        .then(refreshOffline)
                        .catch((error) => setError(errorMessage(error)))
                    }
                  >
                    <Trash2 size={18} />
                  </button>
                </article>
              ))}
            </div>
          </>
        )}
        {section === "settings" && (
          <div className="settings-grid">
            <section className="settings-card">
              <h2>Catalogue HorusApi</h2>
              <p>
                L’adresse de votre Worker Cloudflare. Le jeton TMDB reste dans
                l’API.
              </p>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  try {
                    const url = new URL(apiInput);
                    if (!["http:", "https:"].includes(url.protocol))
                      throw new Error();
                    library.setApiUrl(url.href.replace(/\/$/, ""));
                    setNotice("Adresse du catalogue enregistrée.");
                    setError("");
                  } catch {
                    setError("Saisissez une URL HTTP ou HTTPS valide.");
                  }
                }}
              >
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
                FFmpeg permet les téléchargements MP4 et le relais HLS vers
                DLNA. Il doit être installé sur chaque ordinateur.
              </p>
              <p>
                Les favoris et l’historique sont propres à cette application.
                Les téléchargements sont conservés dans son dossier de données.
              </p>
            </section>
          </div>
        )}
      </main>
      {details && !castTarget && (
        <Modal title={details.media.title} onClose={closeDetails} wide>
          <div className="detail-content">
            <div className="detail-heading">
              <span className="eyebrow">
                {details.media.type === "anime" ? "ANIMESAMA" : "VIDZY"}
              </span>
              <button
                className="secondary"
                onClick={() => library.toggleWishlist(details.media)}
              >
                <Heart size={16} />
                {library.wishlist.some(
                  (item) => mediaKey(item) === mediaKey(details.media),
                )
                  ? "Retirer de ma liste"
                  : "Ajouter à ma liste"}
              </button>
            </div>
            {detailError && (
              <p className="notice error" role="alert">
                {detailError}
              </p>
            )}
            {detailsBusy && (
              <p className="loading-line">
                <LoaderCircle className="spin" size={20} />{" "}
                {details.episode
                  ? "Résolution des serveurs…"
                  : "Chargement des épisodes…"}
              </p>
            )}
            {details.episodes.length > 0 && (
              <label className="field">
                Épisode
                <select
                  disabled={detailsBusy || starting}
                  value={details.episode?.id ?? ""}
                  onChange={(event) => {
                    const episode = details.episodes.find(
                      (item) => item.id === event.target.value,
                    );
                    if (episode) void chooseEpisode(details, episode);
                  }}
                >
                  <option value="" disabled>
                    Choisir un épisode
                  </option>
                  {details.episodes.map((episode) => (
                    <option key={episode.id} value={episode.id}>
                      {episode.title ?? `Épisode ${episode.number}`}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {details.streams.length > 0 && (
              <>
                <div className="language-picker" aria-label="Langue">
                  {sortStreamLanguages(Object.keys(groups)).map((item) => (
                    <button
                      key={item}
                      className={item === language ? "chip selected" : "chip"}
                      aria-pressed={item === language}
                      onClick={() => {
                        setLanguage(item);
                        setSelectedStream(0);
                      }}
                    >
                      {item}
                    </button>
                  ))}
                </div>
                {!streams.length && (
                  <p className="notice">
                    La VF n’est pas disponible. Choisissez explicitement une
                    autre langue ci-dessus.
                  </p>
                )}
                {streams.length > 0 && (
                  <label className="field">
                    Serveur
                    <select
                      value={selectedStream}
                      disabled={starting}
                      onChange={(event) =>
                        setSelectedStream(Number(event.target.value))
                      }
                    >
                      {streams.map((item, index) => (
                        <option key={`${item.server}-${index}`} value={index}>
                          {item.server} · {item.quality ?? "auto"} ·{" "}
                          {inferStreamFormat(item).toUpperCase()}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <div className="detail-actions">
                  <button
                    className="primary"
                    disabled={!stream || starting}
                    onClick={() =>
                      stream && void startPlayback(details, stream)
                    }
                  >
                    {starting ? (
                      <LoaderCircle className="spin" size={18} />
                    ) : (
                      <Play size={18} />
                    )}{" "}
                    Lire ici
                  </button>
                  <button
                    className="secondary"
                    disabled={!stream || starting}
                    onClick={() => stream && openCast(details, stream)}
                  >
                    <Cast size={18} /> Diffuser
                  </button>
                  <button
                    className="secondary"
                    disabled={
                      !stream || !!download || starting || !runtime?.ffmpeg
                    }
                    onClick={() =>
                      stream && void downloadMedia(details, stream)
                    }
                  >
                    <Download size={18} /> Télécharger
                  </button>
                </div>
                {!runtime?.ffmpeg && (
                  <small className="muted">
                    Installez FFmpeg pour télécharger les vidéos.
                  </small>
                )}
              </>
            )}
          </div>
        </Modal>
      )}
      {castTarget && (
        <Modal
          title="Choisir un téléviseur"
          onClose={() => {
            if (!starting && !download) setCastTarget(undefined);
          }}
        >
          <div className="detail-content">
            <p className="muted">
              Votre ordinateur et votre téléviseur doivent être sur le même
              réseau.
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
                  <option value="download" disabled={!runtime?.ffmpeg}>
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
                  onClick={() =>
                    void invoke("cancel_download", { id: download.id })
                  }
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
                      {device.kind === "cast" ? "Chromecast" : "DLNA"} ·{" "}
                      {device.ip}
                    </small>
                  </span>
                  <ArrowRight size={18} />
                </button>
              ))}
            </div>
            {!scanning && !devices.length && (
              <p className="empty-state">
                Aucun appareil trouvé. Vérifiez le réseau local, le pare-feu et
                que le téléviseur est allumé.
              </p>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
