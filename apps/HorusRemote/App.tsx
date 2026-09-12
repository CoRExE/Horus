import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, TextInput, ScrollView, Image, TouchableOpacity, Platform, PermissionsAndroid, ActivityIndicator, Modal, Linking, Alert } from 'react-native';
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import * as NavigationBar from 'expo-navigation-bar';

// Imports de notre librairie locale @horus/core
import { AnimeSamaProvider, VidzyProvider, SearchResult, Episode, Stream, ProviderId, formatRemoteMediaTitle, groupStreamsByLanguage, inferStreamFormat, normalizeStreamLanguage, selectPlaybackDuration, sortStreamLanguages, sortStreamsForRemotePlayback } from '@horus/core';

import VideoPlayer from './components/VideoPlayer';
import { HorusBootSequence } from './components/HorusBootSequence';
import { HorusHeader } from './components/HorusHeader';
import { HorusMediaCard } from './components/HorusMediaCard';
import { HorusMediaDetailsOverlay } from './components/HorusMediaDetailsOverlay';
import { HorusEpisodeList } from './components/HorusEpisodeList';
import { HistoryItem, MediaItem, OfflineMediaItem, useUserStore } from './store/useUserStore';
import {
  CastContext,
  MediaPlayerIdleReason,
  MediaPlayerState,
  RemoteMediaClient,
  useCastSession,
} from 'react-native-google-cast';
import { CastController } from './components/CastController';
import { RemoteCacheQuality, RemoteDeliveryMode, UnifiedCastModal } from './components/UnifiedCastModal';
import { DisconnectModal } from './components/DisconnectModal';
import { DlnaDevice } from './hooks/useDlnaDiscovery';
import { dlnaController } from './services/dlnaController';
import LocalVideoProxy from './modules/local-video-proxy/src/LocalVideoProxyModule';
import { CacheProgressEvent } from './modules/local-video-proxy/src/LocalVideoProxy.types';

// Instanciation des providers de Scraping
const animeSama = new AnimeSamaProvider();
const vidzy = new VidzyProvider({
  catalogApiUrl: process.env.EXPO_PUBLIC_HORUS_API_URL,
});
const REMOTE_CACHE_CANCELLED = 'REMOTE_CACHE_CANCELLED';
const CAST_START_TIMEOUT_MS = 20_000;

type MediaSection = 'anime' | 'film_series' | 'wishlist' | 'history' | 'downloads';

const waitForChromecastPlayback = (
  client: RemoteMediaClient,
  contentUrl: string,
  loadMedia: () => Promise<void>
) => new Promise<void>((resolve, reject) => {
  let settled = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let subscription: { remove: () => void } | undefined;

  const finish = (error?: Error) => {
    if (settled) return;
    settled = true;
    if (timeout) clearTimeout(timeout);
    subscription?.remove();
    if (error) reject(error);
    else resolve();
  };

  subscription = client.onMediaStatusUpdated(status => {
    if (status?.mediaInfo?.contentUrl !== contentUrl) return;
    if (status.playerState === MediaPlayerState.PLAYING) {
      finish();
    } else if (
      status.playerState === MediaPlayerState.IDLE &&
      status.idleReason === MediaPlayerIdleReason.ERROR
    ) {
      finish(new Error('Chromecast could not start this stream'));
    }
  });

  timeout = setTimeout(
    () => finish(new Error('Chromecast playback start timed out')),
    CAST_START_TIMEOUT_MS
  );

  void loadMedia()
    .then(() => client.requestStatus())
    .catch(error => finish(error instanceof Error ? error : new Error(String(error))));
});

const formatByteCount = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 Mo';
  const megabytes = bytes / (1024 * 1024);
  if (megabytes < 1024) return `${megabytes.toFixed(megabytes < 10 ? 1 : 0)} Mo`;
  return `${(megabytes / 1024).toFixed(1)} Go`;
};

const isRemoteCacheCancellation = (error: unknown) =>
  error instanceof Error && error.message === REMOTE_CACHE_CANCELLED;

const verifyOfflineTvStream = async (url: string) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(url, {
      headers: { Range: 'bytes=0-4095' },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Le serveur hors ligne a répondu HTTP ${response.status}`);
    }
    const firstBytes = await response.arrayBuffer();
    if (firstBytes.byteLength === 0) {
      throw new Error('Le serveur hors ligne a renvoyé un fichier vide');
    }
  } finally {
    clearTimeout(timeout);
  }
};

const requestTvStreamingNotificationPermission = async () => {
  if (Platform.OS !== 'android' || Number(Platform.Version) < 33) return;

  const permission = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
  if (await PermissionsAndroid.check(permission)) return;

  await PermissionsAndroid.request(permission, {
    title: 'Notification de diffusion TV',
    message:
      'Horus affiche une notification pendant la diffusion afin qu’Android maintienne le serveur vidéo actif lorsque le téléphone est verrouillé.',
    buttonPositive: 'Autoriser',
    buttonNegative: 'Pas maintenant',
  });
};

const inferProviderId = (media: {
  id: string | number;
  type: SearchResult['type'];
  providerId?: ProviderId;
}): ProviderId => {
  if (media.providerId) return media.providerId;

  const id = String(media.id);
  if (id.includes('catalogue')) return 'anime-sama';
  if (media.type !== 'anime' && /^\d+$/.test(id)) return 'french-stream';
  return 'all-anime';
};

const toSearchResult = (media: MediaItem): SearchResult => ({
  id: String(media.id),
  title: media.title,
  coverUrl: media.imageUrl,
  type: media.type,
  providerId: inferProviderId(media),
});

interface PlaybackContext {
  media: SearchResult;
  episode: Episode;
  episodeQueue: Episode[];
  title: string;
  imageUrl: string;
  offlineMediaId?: string;
}

interface RemotePlaybackSession extends PlaybackContext {
  language: string;
  canSeek: boolean;
  usesCachedMedia: boolean;
  durationSeconds?: number;
  playbackNotice?: string;
}

export default function App() {
  const [isBooting, setIsBooting] = useState(true);
  const [mediaType, setMediaType] = useState<MediaSection>('anime');
  const [search, setSearch] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);

  const wishlist = useUserStore(state => state.wishlist);
  const history = useUserStore(state => state.history);
  const offlineMedia = useUserStore(state => state.offlineMedia);
  const addToHistory = useUserStore(state => state.addToHistory);
  const addOfflineMedia = useUserStore(state => state.addOfflineMedia);
  const removeOfflineMediaFromStore = useUserStore(state => state.removeOfflineMedia);
  const setPendingOfflineDownload = useUserStore(state => state.setPendingOfflineDownload);

  // Modal State pour voir les épisodes d'un média cliqué
  const [selectedMedia, setSelectedMedia] = useState<SearchResult | null>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [isLoadingEpisodes, setIsLoadingEpisodes] = useState(false);
  const [selectedSeason, setSelectedSeason] = useState<string>('');
  const [isEpisodeListVisible, setIsEpisodeListVisible] = useState(false);

  // Video Player State
  const [allStreams, setAllStreams] = useState<Stream[]>([]);
  const [currentStreamIndex, setCurrentStreamIndex] = useState(0);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isLangModalVisible, setIsLangModalVisible] = useState(false);
  const [availableLanguages, setAvailableLanguages] = useState<Record<string, Stream[]>>({});

  // Cast State
  const castSession = useCastSession();
  const [isCastRemoteVisible, setIsCastRemoteVisible] = useState(false);
  const [pendingCastInfo, setPendingCastInfo] = useState<{title: string, imageUrl: string} | null>(null);
  const [pendingPlayback, setPendingPlayback] = useState<PlaybackContext | null>(null);
  const [remotePlayback, setRemotePlayback] = useState<RemotePlaybackSession | null>(null);
  const [isChangingRemoteEpisode, setIsChangingRemoteEpisode] = useState(false);

  // Unified Cast Modal State
  const [isUnifiedCastModalVisible, setIsUnifiedCastModalVisible] = useState(false);
  const [isDisconnectModalVisible, setIsDisconnectModalVisible] = useState(false);
  const [activeDlnaDevice, setActiveDlnaDevice] = useState<DlnaDevice | null>(null);
  const [isTvModeEnabled, setIsTvModeEnabled] = useState(false);
  const [remoteDeliveryMode, setRemoteDeliveryMode] = useState<RemoteDeliveryMode>('direct');
  const [remoteCacheQuality, setRemoteCacheQuality] = useState<RemoteCacheQuality>(720);
  const [isCachingMedia, setIsCachingMedia] = useState(false);
  const [downloadingEpisodeId, setDownloadingEpisodeId] = useState<string | null>(null);
  const [cacheProgress, setCacheProgress] = useState<CacheProgressEvent>({
    bytesDownloaded: 0,
  });
  const cacheCancelledRef = useRef(false);
  const lastCacheProgressAtRef = useRef(0);
  const notificationCommandInFlightRef = useRef(false);
  const searchRequestIdRef = useRef(0);
  const mediaRequestIdRef = useRef(0);
  const localPlaybackUsesProxyRef = useRef(false);
  const cacheOperationRef = useRef<string | null>(null);
  const remoteCleanupInFlightRef = useRef(false);
  const isExitingRef = useRef(false);

  const recordPlaybackInHistory = (context: PlaybackContext) => {
    const historyEpisode = context.media.type === 'movie'
      ? undefined
      : { lastEpisode: context.episode };
    addToHistory({
      id: context.media.id,
      title: context.media.title,
      imageUrl: context.media.coverUrl || '',
      type: context.media.type,
      providerId: context.media.providerId,
    }, historyEpisode);
  };

  const stopProxyAndClearCache = async (cancelActiveCache = false) => {
    if (cancelActiveCache) {
      await LocalVideoProxy.cancelCache().catch(console.error);
    }
    await LocalVideoProxy.stopServer().catch(console.error);
    await LocalVideoProxy.clearCache().catch(console.error);
  };

  const claimCacheOperation = (kind: 'tv' | 'offline') => {
    if (cacheOperationRef.current) return null;
    const id = `${kind}:${Date.now()}:${Math.random()}`;
    cacheOperationRef.current = id;
    return id;
  };

  const prepareStreamsForLocalPlayback = async (streams: Stream[]) => {
    const preparedStreams: Stream[] = [];
    let usesProxy = false;

    try {
      for (const stream of streams) {
        if (inferStreamFormat(stream) !== 'hls' || !stream.headers) {
          preparedStreams.push(stream);
          continue;
        }

        const prepared = await dlnaController.prepareRemoteStream(stream, {
          preserveHls: Platform.OS === 'android',
          keepAlive: false,
        });
        usesProxy = true;
        preparedStreams.push({
          ...stream,
          url: prepared.url,
          format: prepared.contentType === 'application/vnd.apple.mpegurl'
            ? 'hls'
            : 'file',
          contentType: prepared.contentType,
          headers: undefined,
          server: `Proxy local • ${stream.server}`,
        });
      }
    } catch (error) {
      if (usesProxy) {
        await LocalVideoProxy.stopServer().catch(console.error);
      }
      throw error;
    }

    if (localPlaybackUsesProxyRef.current && !usesProxy) {
      await stopProxyAndClearCache();
    }
    localPlaybackUsesProxyRef.current = usesProxy;
    return preparedStreams;
  };

  const startLocalPlayback = async (streams: Stream[]) => {
    const preparedStreams = await prepareStreamsForLocalPlayback(streams);
    setAllStreams(preparedStreams);
    setCurrentStreamIndex(0);
  };

  const loadOnChromecast = async (stream: Stream, title: string, imageUrl: string) => {
    if (!castSession) return;

    const preparedStream = await dlnaController.prepareRemoteStream(stream, { bridgeHls: false });
    const client = castSession.client;
    await waitForChromecastPlayback(
      client,
      preparedStream.url,
      () => client.loadMedia({
        autoplay: true,
        mediaInfo: {
          contentUrl: preparedStream.url,
          contentType: preparedStream.contentType,
          metadata: {
            type: 'generic',
            title,
            images: [{ url: imageUrl }]
          }
        }
      })
    );
  };

  const playOnSelectedRemote = async (
    streams: Stream[],
    language: string,
    context: PlaybackContext
  ) => {
    if (streams.length === 0) {
      throw new Error('No stream candidate available');
    }

    const orderedStreams = sortStreamsForRemotePlayback(streams);
    let selectedStream: Stream | null = null;
    let selectedFallbackReason: string | undefined;
    let lastError: unknown;

    if (!isTvModeEnabled || (!castSession && !activeDlnaDevice)) {
      return false;
    }

    await requestTvStreamingNotificationPermission();

    const shouldCache = remoteDeliveryMode === 'cache';
    const operationId = shouldCache ? claimCacheOperation('tv') : null;
    if (shouldCache && !operationId) {
      throw new Error('Un autre téléchargement est déjà en cours');
    }
    cacheCancelledRef.current = false;
    if (shouldCache) {
      setCacheProgress({ bytesDownloaded: 0, phase: 'downloading' });
      setIsCachingMedia(true);
    }

    try {
      for (const stream of orderedStreams) {
        let candidate = stream;
        let cacheId: string | undefined;
        let startedRemotely = false;
        let fallbackReason: string | undefined;
        try {
          if (shouldCache) {
            const cached = await dlnaController.cacheStream(stream, remoteCacheQuality, {
              title: context.title,
              imageUrl: context.imageUrl,
            }, !castSession ? activeDlnaDevice?.controlUrl : undefined);
            candidate = cached.stream;
            cacheId = cached.cacheId;
            startedRemotely = cached.startedRemotely;
            fallbackReason = cached.fallbackReason;
            if (cached.remoteStartError) {
              console.warn('[DLNA] Native start failed; retrying from JavaScript:', cached.remoteStartError);
            }
          }

          if (castSession) {
            await loadOnChromecast(candidate, context.title, context.imageUrl);
          } else if (activeDlnaDevice && !startedRemotely) {
            console.log(`[DLNA] Trying server ${stream.server} (${language})`);
            await dlnaController.castVideo(
              activeDlnaDevice.controlUrl,
              candidate,
              context.title
            );
          }
          selectedStream = candidate;
          selectedFallbackReason = fallbackReason;
          break;
        } catch (error) {
          lastError = error;
          if (cacheId) {
            await dlnaController.removeCachedMedia(cacheId).catch(console.error);
          }
          if (cacheCancelledRef.current) {
            await stopProxyAndClearCache(true);
            throw new Error(REMOTE_CACHE_CANCELLED);
          }
          const protocol = castSession ? 'Cast' : 'DLNA';
          console.warn(`[${protocol}] Server ${stream.server} failed, trying the next one.`);
        }
      }
    } finally {
      if (shouldCache) {
        setIsCachingMedia(false);
        if (cacheOperationRef.current === operationId) {
          cacheOperationRef.current = null;
        }
      }
    }

    if (!selectedStream) {
      if (shouldCache && Platform.OS === 'android') {
        LocalVideoProxy.setTvNotificationMode(
          'direct',
          undefined,
          undefined,
          false
        ).catch(console.error);
      }
      await stopProxyAndClearCache();
      throw lastError instanceof Error
        ? lastError
        : new Error('No remote stream could be started');
    }

    setPendingCastInfo({ title: context.title, imageUrl: context.imageUrl });
    const selectedContentType = selectedStream.contentType?.toLowerCase() || '';
    const isMpegTsFallback = selectedContentType.includes('mp2t');
    const canSeekSelectedStream = selectedStream.seekable ?? (
      !isMpegTsFallback && (
        Boolean(castSession) || inferStreamFormat(selectedStream) === 'file'
      )
    );
    setRemotePlayback({
      ...context,
      language,
      canSeek: canSeekSelectedStream,
      usesCachedMedia: shouldCache,
      durationSeconds: selectedStream.durationSeconds,
      playbackNotice: isMpegTsFallback
        ? selectedFallbackReason || 'La conversion MP4 a échoué. Lecture MPEG-TS sans déplacement temporel.'
        : undefined,
    });
    recordPlaybackInHistory(context);
    setIsCastRemoteVisible(true);
    return true;
  };

  // Configuration de l'immersion Android au démarrage
  useEffect(() => {
    if (Platform.OS === 'android') {
      NavigationBar.setBackgroundColorAsync('transparent');
      NavigationBar.setVisibilityAsync('hidden');
      NavigationBar.setBehaviorAsync('inset-touch');
    }
  }, []);

  const handleSearch = async () => {
    const query = search.trim();
    if (!query) return;
    const requestId = ++searchRequestIdRef.current;
    const requestedMediaType = mediaType;
    setIsSearching(true);
    setResults([]);
    try {
      if (requestedMediaType === 'anime') {
        // AllAnime's public API currently requires a Cloudflare browser
        // challenge, so only the working AnimeSama provider is queried.
        const providerResults = await Promise.allSettled([animeSama.search(query)]);
        if (requestId !== searchRequestIdRef.current) return;
        setResults(providerResults.flatMap(result =>
          result.status === 'fulfilled' ? result.value : []
        ));
      } else {
        const res = await vidzy.search(query);
        if (requestId !== searchRequestIdRef.current) return;
        setResults(res);
      }
    } catch (e) {
      if (requestId === searchRequestIdRef.current) console.error(e);
    } finally {
      if (requestId === searchRequestIdRef.current) setIsSearching(false);
    }
  };

  const selectMediaType = (nextMediaType: MediaSection) => {
    if (nextMediaType === mediaType) return;
    searchRequestIdRef.current += 1;
    mediaRequestIdRef.current += 1;
    setMediaType(nextMediaType);
    setIsSearching(false);
    setResults([]);
    setSelectedMedia(null);
    setEpisodes([]);
    setIsEpisodeListVisible(false);
  };

  const getProviderForMedia = (media: SearchResult) => {
    switch (inferProviderId(media)) {
      case 'french-stream':
        throw new Error('Cette entrée utilise une source legacy indisponible');
      case 'vidzy':
        return vidzy;
      case 'anime-sama':
        return animeSama;
      case 'all-anime':
        throw new Error('AllAnime est temporairement indisponible');
    }
  };

  const openMedia = async (media: SearchResult) => {
    const requestId = ++mediaRequestIdRef.current;
    setSelectedMedia(media);
    setIsEpisodeListVisible(false);
    setIsLoadingEpisodes(true);
    setEpisodes([]);
    setSelectedSeason('');
    try {
      const provider = getProviderForMedia(media);
      const eps = await provider.getEpisodes(media.id);
      if (requestId === mediaRequestIdRef.current) setEpisodes(eps);
    } catch (e) {
      if (requestId === mediaRequestIdRef.current) {
        console.error(e);
        alert(e instanceof Error ? e.message : "Impossible de charger ce média");
      }
    } finally {
      if (requestId === mediaRequestIdRef.current) setIsLoadingEpisodes(false);
    }
  };

  const extractStreamsAndCast = async (
    episode: Episode,
    overrideMedia?: SearchResult,
    options: {
      preferredLanguage?: string;
      episodeQueue?: Episode[];
    } = {}
  ) => {
    const targetMedia = overrideMedia || selectedMedia;
    if (!targetMedia) return;

    setIsExtracting(true);
    try {
      const provider = getProviderForMedia(targetMedia);
      const currentEpisodeQueue =
        selectedMedia?.id === targetMedia.id ? episodes : [];
      const shouldLoadQueue =
        !options.episodeQueue &&
        currentEpisodeQueue.length === 0 &&
        targetMedia.type !== 'movie';
      const [streams, loadedQueue] = await Promise.all([
        provider.getStreams(episode.id),
        shouldLoadQueue
          ? provider.getEpisodes(targetMedia.id).catch(() => [episode])
          : Promise.resolve(options.episodeQueue || currentEpisodeQueue),
      ]);

      if (streams.length > 0) {
        const grouped = groupStreamsByLanguage(streams);
        const langs = sortStreamLanguages(Object.keys(grouped));
        setAvailableLanguages(grouped);

        const castTitle = formatRemoteMediaTitle(targetMedia, episode);
        const castImage = targetMedia.coverUrl || '';
        const context: PlaybackContext = {
          media: targetMedia,
          episode,
          episodeQueue: loadedQueue.length > 0 ? loadedQueue : [episode],
          title: castTitle,
          imageUrl: castImage,
        };
        setPendingCastInfo({ title: castTitle, imageUrl: castImage });
        setPendingPlayback(context);

        if (options.preferredLanguage) {
          const preferredLanguage = normalizeStreamLanguage(options.preferredLanguage);
          const preferredStreams = grouped[preferredLanguage];
          if (!preferredStreams) {
            setIsLangModalVisible(true);
            return;
          }
          const didPlayRemotely = await playOnSelectedRemote(
            preferredStreams,
            preferredLanguage,
            context
          );
          if (!didPlayRemotely) {
            await startLocalPlayback(preferredStreams);
          }
          return;
        }

        if (langs.length === 1 && langs[0] === 'VF') {
          const streamList = grouped[langs[0]];
          const didPlayRemotely = await playOnSelectedRemote(
            streamList,
            langs[0],
            context
          );
          if (!didPlayRemotely) {
            await startLocalPlayback(streamList);
          }
        } else if (langs.length >= 1) {
          setIsLangModalVisible(true);
        }
      } else {
        alert("Aucun lien de streaming trouvé pour cet épisode.");
      }
    } catch (e) {
      if (isRemoteCacheCancellation(e)) return;
      console.error(e);
      alert("Erreur lors de l'extraction de la vidéo");
    } finally {
      setIsExtracting(false);
    }
  };

  const downloadEpisodeForOffline = async (
    episode: Episode,
    overrideMedia?: SearchResult,
    isRecovery = false,
    cacheQuality: RemoteCacheQuality = remoteCacheQuality
  ) => {
    const targetMedia = overrideMedia || selectedMedia;
    if (!targetMedia) return;

    if (Platform.OS !== 'android') {
      Alert.alert(
        'Téléchargement indisponible',
        'La bibliothèque hors ligne est pour le moment disponible uniquement sur Android.'
      );
      return;
    }
    if (cacheOperationRef.current || allStreams.length > 0 || remotePlayback) {
      Alert.alert(
        'Lecture en cours',
        'Arrête la lecture ou la diffusion actuelle avant de télécharger un autre média.'
      );
      return;
    }
    if (useUserStore.getState().offlineMedia.some(item =>
      item.media.id === targetMedia.id && item.episode.id === episode.id
    )) {
      Alert.alert('Déjà téléchargé', 'Ce média est déjà présent dans la bibliothèque hors ligne.');
      return;
    }

    const operationId = claimCacheOperation('offline');
    if (!operationId) return;

    cacheCancelledRef.current = false;
    setDownloadingEpisodeId(episode.id);
    setCacheProgress({ bytesDownloaded: 0, phase: 'downloading' });
    setIsCachingMedia(true);
    let persistedId: string | undefined;

    if (!isRecovery) {
      setPendingOfflineDownload({
        media: {
          id: targetMedia.id,
          title: targetMedia.title,
          imageUrl: targetMedia.coverUrl || '',
          type: targetMedia.type,
          providerId: targetMedia.providerId,
        },
        episode,
        quality: cacheQuality,
        requestedAt: Date.now(),
      });
    }

    try {
      await requestTvStreamingNotificationPermission();
      const provider = getProviderForMedia(targetMedia);
      const streams = await provider.getStreams(episode.id);
      if (cacheCancelledRef.current) {
        throw new Error(REMOTE_CACHE_CANCELLED);
      }
      const grouped = groupStreamsByLanguage(streams);
      const languages = sortStreamLanguages(Object.keys(grouped));
      const language = grouped.VF ? 'VF' : languages[0];
      const candidates = language
        ? sortStreamsForRemotePlayback(grouped[language] || [])
        : [];
      if (candidates.length === 0) {
        throw new Error('Aucun flux téléchargeable trouvé pour ce média.');
      }

      let downloadedItem: OfflineMediaItem | undefined;
      let lastError: unknown;
      for (const stream of candidates) {
        let cacheId: string | undefined;
        try {
          const cached = await dlnaController.cacheStream(
            stream,
            cacheQuality,
            {
              title: `Téléchargement • ${formatRemoteMediaTitle(targetMedia, episode)}`,
              imageUrl: targetMedia.coverUrl || '',
            }
          );
          cacheId = cached.cacheId;
          await LocalVideoProxy.persistCachedMedia(cacheId);
          persistedId = cacheId;
          downloadedItem = {
            id: cacheId,
            media: {
              id: targetMedia.id,
              title: targetMedia.title,
              imageUrl: targetMedia.coverUrl || '',
              type: targetMedia.type,
              providerId: targetMedia.providerId,
            },
            episode,
            title: formatRemoteMediaTitle(targetMedia, episode),
            language,
            contentType: cached.stream.contentType || 'video/mp4',
            sizeBytes: cached.stream.sizeBytes || 0,
            durationSeconds: cached.stream.durationSeconds,
            seekable: cached.stream.seekable ?? false,
            downloadedAt: Date.now(),
          };
          break;
        } catch (error) {
          lastError = error;
          if (cacheId && cacheId !== persistedId) {
            await dlnaController.removeCachedMedia(cacheId).catch(console.error);
          }
          if (cacheCancelledRef.current) {
            throw new Error(REMOTE_CACHE_CANCELLED);
          }
          console.warn(`[Offline] Server ${stream.server} failed, trying the next one.`);
        }
      }

      if (!downloadedItem) {
        throw lastError instanceof Error
          ? lastError
          : new Error('Aucun serveur n’a permis de télécharger ce média.');
      }

      addOfflineMedia(downloadedItem);
      setPendingOfflineDownload(null);
      Alert.alert(
        'Téléchargement terminé',
        `${downloadedItem.title} est disponible hors ligne (${formatByteCount(downloadedItem.sizeBytes)}).`
      );
    } catch (error) {
      setPendingOfflineDownload(null);
      if (persistedId) {
        await LocalVideoProxy.removeOfflineMedia(persistedId).catch(console.error);
      }
      if (!isRemoteCacheCancellation(error)) {
        console.error('[Offline] Download failed', error);
        Alert.alert(
          'Échec du téléchargement',
          error instanceof Error ? error.message : 'Impossible de télécharger ce média.'
        );
      }
    } finally {
      if (cacheOperationRef.current === operationId) {
        await stopProxyAndClearCache();
        cacheOperationRef.current = null;
        setIsCachingMedia(false);
        setDownloadingEpisodeId(null);
      }
    }
  };

  const playOfflineMedia = async (item: OfflineMediaItem) => {
    if (Platform.OS !== 'android') return;

    let startedOfflineServer = false;
    try {
      const context: PlaybackContext = {
        media: toSearchResult(item.media),
        episode: item.episode,
        episodeQueue: [item.episode],
        title: item.title,
        imageUrl: item.media.imageUrl,
        offlineMediaId: item.id,
      };
      const shouldPlayOnTv = isTvModeEnabled && Boolean(castSession || activeDlnaDevice);
      let streamUrl: string;

      if (shouldPlayOnTv) {
        const { ip, port, token } = await LocalVideoProxy.startServer(8080, true);
        startedOfflineServer = true;
        const query = new URLSearchParams({
          token,
          id: item.id,
          contentType: item.contentType,
        });
        streamUrl = `http://${ip}:${port}/offline?${query.toString()}`;
        await verifyOfflineTvStream(streamUrl);
      } else {
        streamUrl = await LocalVideoProxy.getOfflineMediaUri(item.id);
      }

      const stream: Stream = {
        url: streamUrl,
        language: item.language,
        quality: 'offline',
        server: 'Bibliothèque hors ligne',
        format: 'file',
        contentType: item.contentType,
        durationSeconds: item.durationSeconds,
        sizeBytes: item.sizeBytes,
        seekable: item.seekable,
      };

      setPendingPlayback(context);
      setPendingCastInfo({ title: context.title, imageUrl: context.imageUrl });
      setAvailableLanguages({ [item.language]: [stream] });

      if (shouldPlayOnTv) {
        await requestTvStreamingNotificationPermission();
        if (castSession) {
          await loadOnChromecast(stream, context.title, context.imageUrl);
        } else if (activeDlnaDevice) {
          await dlnaController.castVideo(activeDlnaDevice.controlUrl, stream, context.title);
        }
        setRemotePlayback({
          ...context,
          language: item.language,
          canSeek: item.seekable,
          usesCachedMedia: true,
          durationSeconds: item.durationSeconds,
          playbackNotice: item.seekable
            ? undefined
            : 'Ce téléchargement utilise un format de compatibilité sans déplacement temporel.',
        });
        recordPlaybackInHistory(context);
        setIsCastRemoteVisible(true);
      } else {
        localPlaybackUsesProxyRef.current = false;
        setAllStreams([stream]);
        setCurrentStreamIndex(0);
      }
    } catch (error) {
      if (startedOfflineServer) {
        await LocalVideoProxy.stopServer().catch(console.error);
      }
      console.error('[Offline] Playback failed', error);
      Alert.alert(
        'Lecture impossible',
        error instanceof Error
          ? error.message
          : 'Le fichier hors ligne est absent ou ne peut plus être lu.'
      );
    }
  };

  const deleteOfflineMedia = (item: OfflineMediaItem) => {
    if (
      pendingPlayback?.offlineMediaId === item.id &&
      (allStreams.length > 0 || remotePlayback)
    ) {
      Alert.alert('Média en cours de lecture', 'Arrête la lecture avant de supprimer ce média.');
      return;
    }

    Alert.alert(
      'Supprimer le téléchargement',
      `Supprimer « ${item.title} » du téléphone ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: () => {
            void LocalVideoProxy.removeOfflineMedia(item.id)
              .then(() => removeOfflineMediaFromStore(item.id))
              .catch(error => {
                console.error('[Offline] Delete failed', error);
                Alert.alert('Suppression impossible', 'Le téléchargement n’a pas pu être supprimé.');
              });
          },
        },
      ]
    );
  };

  const handleLanguageSelect = async (lang: string) => {
    setIsLangModalVisible(false);
    const selectedStreams = availableLanguages[lang];
    try {
      if (!selectedStreams || selectedStreams.length === 0) return;
      const didPlayRemotely = pendingPlayback
        ? await playOnSelectedRemote(selectedStreams, lang, pendingPlayback)
        : false;
      if (!didPlayRemotely) {
        await startLocalPlayback(selectedStreams);
      }
    } catch (error) {
      if (isRemoteCacheCancellation(error)) return;
      console.error(error);
      alert("Impossible d'envoyer ce flux vers l'appareil sélectionné.");
    }
  };

  const remoteEpisodeIndex = remotePlayback
    ? remotePlayback.episodeQueue.findIndex(item => item.id === remotePlayback.episode.id)
    : -1;
  const hasPreviousRemoteEpisode = remoteEpisodeIndex > 0;
  const hasNextRemoteEpisode = Boolean(
    remotePlayback &&
    remoteEpisodeIndex >= 0 &&
    remoteEpisodeIndex < remotePlayback.episodeQueue.length - 1
  );

  const changeRemoteEpisode = async (offset: -1 | 1) => {
    if (!remotePlayback || isChangingRemoteEpisode) return;
    const targetEpisode = remotePlayback.episodeQueue[remoteEpisodeIndex + offset];
    if (!targetEpisode) return;

    setIsChangingRemoteEpisode(true);
    try {
      await extractStreamsAndCast(targetEpisode, remotePlayback.media, {
        preferredLanguage: remotePlayback.language,
        episodeQueue: remotePlayback.episodeQueue,
      });
    } finally {
      setIsChangingRemoteEpisode(false);
    }
  };

  const alternateLocalLanguage = useMemo(() => {
    const currentLanguage = allStreams[currentStreamIndex]?.language;
    return sortStreamLanguages(Object.keys(availableLanguages))
      .find(language =>
        language !== currentLanguage &&
        (availableLanguages[language]?.length || 0) > 0
      );
  }, [allStreams, availableLanguages, currentStreamIndex]);

  const tryNextStream = async () => {
    if (currentStreamIndex + 1 < allStreams.length) {
      setCurrentStreamIndex(currentStreamIndex + 1);
    } else if (alternateLocalLanguage) {
      const alternateStreams = availableLanguages[alternateLocalLanguage];
      try {
        await startLocalPlayback(alternateStreams);
      } catch (error) {
        console.error(error);
        alert(`Impossible de préparer le flux ${alternateLocalLanguage}.`);
      }
    } else {
      setAllStreams([]);
      setCurrentStreamIndex(0);
      if (localPlaybackUsesProxyRef.current) {
        localPlaybackUsesProxyRef.current = false;
        LocalVideoProxy.stopServer().catch(console.error);
      }
      alert("Aucun autre serveur disponible.");
    }
  };

  const closePlayer = () => {
    if (localPlaybackUsesProxyRef.current) {
      localPlaybackUsesProxyRef.current = false;
      LocalVideoProxy.stopServer().catch(console.error);
    }
    setAllStreams([]);
    setCurrentStreamIndex(0);
    setPendingPlayback(null);
  };

  const finishRemotePlayback = async () => {
    if (remoteCleanupInFlightRef.current) return;
    remoteCleanupInFlightRef.current = true;
    setIsCastRemoteVisible(false);
    setRemotePlayback(null);
    setPendingPlayback(null);
    try {
      await stopProxyAndClearCache();
    } finally {
      remoteCleanupInFlightRef.current = false;
    }
  };

  const confirmExitApp = () => {
    if (Platform.OS !== 'android' || isExitingRef.current) return;
    Alert.alert(
      'Quitter Horus',
      'La lecture et les tâches en cours seront arrêtées. Les médias téléchargés resteront disponibles.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Quitter',
          style: 'destructive',
          onPress: () => {
            isExitingRef.current = true;
            cacheCancelledRef.current = true;
            setPendingOfflineDownload(null);
            void (async () => {
              await Promise.allSettled([
                LocalVideoProxy.cancelCache(),
                activeDlnaDevice
                  ? dlnaController.stop(activeDlnaDevice.controlUrl)
                  : Promise.resolve(),
                castSession
                  ? CastContext.getSessionManager().endCurrentSession(true)
                  : Promise.resolve(),
              ]);
              setAllStreams([]);
              setRemotePlayback(null);
              setActiveDlnaDevice(null);
              setIsTvModeEnabled(false);
              setIsCastRemoteVisible(false);
              await LocalVideoProxy.exitApp();
            })().catch(error => {
              isExitingRef.current = false;
              console.error('[Exit] Clean shutdown failed', error);
              Alert.alert('Fermeture impossible', 'Horus n’a pas pu terminer toutes ses tâches proprement.');
            });
          },
        },
      ]
    );
  };

  // Grouper les épisodes par saisons
  const seasonGroups = useMemo(() => {
    const groups: { [key: string]: Episode[] } = {};
    episodes.forEach((ep) => {
      let seasonName = 'Standard';
      const title = ep.title || '';
      if (title.includes(' - ')) {
        seasonName = title.split(' - ')[0].trim();
      }
      if (!groups[seasonName]) groups[seasonName] = [];
      groups[seasonName].push(ep);
    });
    return groups;
  }, [episodes]);

  const seasonKeys = Object.keys(seasonGroups);

  useEffect(() => {
    if (seasonKeys.length > 0 && !seasonKeys.includes(selectedSeason)) {
      setSelectedSeason(seasonKeys[0]);
    }
  }, [seasonKeys, selectedSeason]);

  useEffect(() => {
    const subscription = LocalVideoProxy.addListener(
      'onCacheProgress',
      (progress) => {
        const now = Date.now();
        const isComplete =
          progress.totalBytes !== undefined &&
          progress.bytesDownloaded >= progress.totalBytes;
        if (!isComplete && now - lastCacheProgressAtRef.current < 200) return;
        lastCacheProgressAtRef.current = now;
        setCacheProgress(progress);
        if (Platform.OS === 'android') {
          const phase = progress.phase === 'optimizing' ? 'optimizing' : 'downloading';
          const notificationProgress = phase === 'optimizing'
            ? progress.phaseProgress ?? -1
            : progress.totalBytes && progress.totalBytes > 0
              ? progress.bytesDownloaded / progress.totalBytes
              : -1;
          LocalVideoProxy.updateTvCacheProgress(
            Math.min(1, Math.max(-1, notificationProgress)),
            phase
          ).catch(error => {
            console.warn('[Notification] Unable to update cache progress', error);
          });
        }
      }
    );
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    let disposed = false;

    const reconcileAndRecover = async () => {
      await LocalVideoProxy.clearCache().catch(error => {
        console.warn('[Cache] Initial cleanup failed', error);
      });
      const storedIds = new Set(await LocalVideoProxy.listOfflineMediaIds());
      const state = useUserStore.getState();
      const metadataIds = new Set(state.offlineMedia.map(item => item.id));

      state.offlineMedia
        .filter(item => !storedIds.has(item.id))
        .forEach(item => state.removeOfflineMedia(item.id));
      await Promise.all(
        [...storedIds]
          .filter(id => !metadataIds.has(id))
          .map(id => LocalVideoProxy.removeOfflineMedia(id))
      );

      if (disposed) return;
      const pending = useUserStore.getState().pendingOfflineDownload;
      if (!pending) return;
      const alreadyDownloaded = useUserStore.getState().offlineMedia.some(item =>
        item.media.id === pending.media.id && item.episode.id === pending.episode.id
      );
      if (alreadyDownloaded) {
        useUserStore.getState().setPendingOfflineDownload(null);
        return;
      }
      void downloadEpisodeForOffline(
        pending.episode,
        toSearchResult(pending.media),
        true,
        pending.quality
      );
    };

    const run = () => void reconcileAndRecover().catch(error => {
      console.warn('[Offline] Unable to reconcile the local library', error);
    });
    if (useUserStore.persist.hasHydrated()) run();
    const unsubscribe = useUserStore.persist.onFinishHydration(run);
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!remotePlayback) return;

    let cancelled = false;
    let refreshInProgress = false;
    let dlnaPlaybackStarted = false;
    const shouldSyncNotification =
      Platform.OS === 'android' && remotePlayback.usesCachedMedia;
    const updateNotification = (
      isPlaying: boolean,
      positionSeconds: number,
      durationSeconds: number
    ) => {
      if (cancelled || !shouldSyncNotification) return;
      LocalVideoProxy.updateTvPlaybackState(
        isPlaying,
        positionSeconds,
        durationSeconds
      ).catch(error => {
        console.warn('[Notification] Unable to synchronize TV playback', error);
      });
    };

    if (shouldSyncNotification) {
      void LocalVideoProxy.setTvNotificationMode(
        'player',
        remotePlayback.title,
        remotePlayback.imageUrl,
        remotePlayback.canSeek
      ).then(() => updateNotification(true, 0, 0)).catch(error => {
        console.warn('[Notification] Unable to show TV player', error);
      });
    }

    if (castSession) {
      const client = castSession.client;
      let castIsPlaying = true;
      let castPosition = 0;
      let castDuration = 0;
      const applyCastStatus = (
        status: Awaited<ReturnType<typeof client.getMediaStatus>>
      ) => {
        if (!status || cancelled) return;
        if (
          status.playerState === MediaPlayerState.IDLE &&
          status.idleReason !== MediaPlayerIdleReason.INTERRUPTED
        ) {
          cancelled = true;
          void finishRemotePlayback();
          return;
        }
        castIsPlaying = status.playerState === 'playing' || status.playerState === 'buffering';
        castPosition = status.streamPosition ?? castPosition;
        castDuration = status.mediaInfo?.streamDuration ?? castDuration;
        updateNotification(castIsPlaying, castPosition, castDuration);
      };

      void client.getMediaStatus().then(applyCastStatus);
      const statusSubscription = client.onMediaStatusUpdated(applyCastStatus);
      const progressSubscription = client.onMediaProgressUpdated((progress, total) => {
        castPosition = progress;
        castDuration = total;
        updateNotification(castIsPlaying, castPosition, castDuration);
      }, 1_000);
      return () => {
        cancelled = true;
        statusSubscription.remove();
        progressSubscription.remove();
      };
    }

    if (activeDlnaDevice) {
      const refreshDlnaStatus = async () => {
        if (refreshInProgress) return;
        refreshInProgress = true;
        try {
          const status = await dlnaController.getPlaybackStatus(
            activeDlnaDevice.controlUrl,
            activeDlnaDevice.renderingControlUrl
          );
          if (
            status.transportState === 'PLAYING' ||
            status.transportState === 'PAUSED_PLAYBACK' ||
            status.transportState === 'TRANSITIONING'
          ) {
            dlnaPlaybackStarted = true;
          } else if (
            dlnaPlaybackStarted &&
            (status.transportState === 'STOPPED' || status.transportState === 'NO_MEDIA_PRESENT')
          ) {
            cancelled = true;
            void finishRemotePlayback();
            return;
          }
          updateNotification(
            status.transportState === 'PLAYING' || status.transportState === 'TRANSITIONING',
            status.positionSeconds,
            selectPlaybackDuration(
              remotePlayback.durationSeconds,
              status.durationSeconds,
              remotePlayback.canSeek
            )
          );
        } catch (error) {
          if (!cancelled) {
            console.warn('[Notification] TV status temporarily unavailable', error);
          }
        } finally {
          refreshInProgress = false;
        }
      };
      void refreshDlnaStatus();
      const interval = setInterval(() => void refreshDlnaStatus(), 2_000);
      return () => {
        cancelled = true;
        clearInterval(interval);
      };
    }

    void finishRemotePlayback();

    return () => {
      cancelled = true;
    };
  }, [activeDlnaDevice, castSession, remotePlayback]);

  useEffect(() => {
    if (Platform.OS !== 'android' || !remotePlayback?.usesCachedMedia) return;

    const subscription = LocalVideoProxy.addListener('onMediaControl', event => {
      if (notificationCommandInFlightRef.current && event.action !== 'stop') return;
      notificationCommandInFlightRef.current = true;
      void (async () => {
        const castClient = castSession?.client;
        if (event.action === 'play') {
          if (castClient) await castClient.play();
          else if (activeDlnaDevice) await dlnaController.play(activeDlnaDevice.controlUrl);
        } else if (event.action === 'pause') {
          if (castClient) await castClient.pause();
          else if (activeDlnaDevice) await dlnaController.pause(activeDlnaDevice.controlUrl);
        } else if (
          event.action === 'seek' &&
          remotePlayback.canSeek &&
          event.positionSeconds !== undefined
        ) {
          if (castClient) await castClient.seek({ position: event.positionSeconds });
          else if (activeDlnaDevice) {
            await dlnaController.seek(activeDlnaDevice.controlUrl, event.positionSeconds);
          }
        } else if (event.action === 'stop') {
          try {
            if (castClient) await castClient.stop();
            else if (activeDlnaDevice) await dlnaController.stop(activeDlnaDevice.controlUrl);
          } finally {
            await finishRemotePlayback();
          }
        }
      })().catch(error => {
        console.warn('[Notification] TV command failed', error);
      }).finally(() => {
        notificationCommandInFlightRef.current = false;
      });
    });

    return () => subscription.remove();
  }, [activeDlnaDevice, castSession, remotePlayback]);

  useEffect(() => {
    const openTvRemote = ({ url }: { url: string }) => {
      if (url === 'horusremote://tv-remote' && remotePlayback) {
        setIsCastRemoteVisible(true);
      }
    };
    void Linking.getInitialURL().then(url => {
      if (url) openTvRemote({ url });
    }).catch(error => {
      console.warn('[Notification] Unable to read notification link', error);
    });
    const subscription = Linking.addEventListener('url', openTvRemote);
    return () => subscription.remove();
  }, [remotePlayback]);

  if (isBooting) {
    return <HorusBootSequence onBootComplete={() => setIsBooting(false)} />;
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container}>
        <StatusBar style="light" />

        {/* HEADER / SEARCH */}
        <HorusHeader
          value={search}
          onChangeText={setSearch}
          onSubmitEditing={handleSearch}
          returnKeyType="search"
          hideSearch={mediaType === 'wishlist' || mediaType === 'history' || mediaType === 'downloads'}
          onPressCast={() => {
            if (isTvModeEnabled && (castSession || (activeDlnaDevice && remotePlayback))) {
              setIsCastRemoteVisible(true);
            } else if (isTvModeEnabled && activeDlnaDevice) {
              setIsDisconnectModalVisible(true);
            } else {
              setIsUnifiedCastModalVisible(true);
            }
          }}
          isCasting={isTvModeEnabled && (!!castSession || !!activeDlnaDevice)}
          onPressExit={Platform.OS === 'android' ? confirmExitApp : undefined}
        />

        {/* Pilules de Sélection de Type de Média */}
        <View style={[styles.pillsContainer, { paddingHorizontal: 20, marginBottom: 15, marginTop: (mediaType === 'wishlist' || mediaType === 'history' || mediaType === 'downloads') ? 20 : 0 }]}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: 'center' }}>
            <TouchableOpacity
              style={[styles.pill, mediaType === 'anime' && styles.pillActive]}
              onPress={() => selectMediaType('anime')}
            >
              <Text style={[styles.pillText, mediaType === 'anime' && styles.pillTextActive]}>Anime</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.pill, mediaType === 'film_series' && styles.pillActive]}
              onPress={() => selectMediaType('film_series')}
            >
              <Text style={[styles.pillText, mediaType === 'film_series' && styles.pillTextActive]}>Films & Séries</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.pill, mediaType === 'wishlist' && styles.pillActive]}
              onPress={() => selectMediaType('wishlist')}
            >
              <Text style={[styles.pillText, mediaType === 'wishlist' && styles.pillTextActive]}>Wishlist</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.pill, mediaType === 'history' && styles.pillActive]}
              onPress={() => selectMediaType('history')}
            >
              <Text style={[styles.pillText, mediaType === 'history' && styles.pillTextActive]}>Historique</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.pill, mediaType === 'downloads' && styles.pillActive]}
              onPress={() => selectMediaType('downloads')}
            >
              <Text style={[styles.pillText, mediaType === 'downloads' && styles.pillTextActive]}>Hors ligne</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>

        <ScrollView contentContainerStyle={styles.scrollContent}>
          {isSearching && (mediaType === 'anime' || mediaType === 'film_series') ? (
            <ActivityIndicator size="large" color="#8B5CF6" style={{ marginTop: 50 }} />
          ) : (
            <View style={styles.grid}>
              {mediaType === 'downloads' && offlineMedia.length > 0 && (
                <Text style={styles.offlineHint}>
                  Touchez un média pour le lire ou le diffuser. Maintenez sa carte pour le supprimer.
                </Text>
              )}
              {(() => {
                const dataToDisplay: Array<SearchResult & {
                  sourceItem?: HistoryItem;
                  sourceOffline?: OfflineMediaItem;
                }> =
                  (mediaType === 'wishlist') ? wishlist.map(toSearchResult)
                  : (mediaType === 'history') ? history.map(item => ({ ...toSearchResult(item), sourceItem: item }))
                  : (mediaType === 'downloads') ? offlineMedia.map(item => ({
                      ...toSearchResult(item.media),
                      id: item.id,
                      title: item.title,
                      sourceOffline: item,
                    }))
                  : results;

                if (dataToDisplay.length === 0) {
                  if (mediaType === 'wishlist') {
                     return <Text style={styles.emptyText}>Votre Wishlist est vide. Ajoutez des médias pour les retrouver ici.</Text>;
                  }
                  if (mediaType === 'history') {
                     return <Text style={styles.emptyText}>Votre Historique est vide.</Text>;
                  }
                  if (mediaType === 'downloads') {
                     return <Text style={styles.emptyText}>Aucun média téléchargé. Utilisez l’icône de téléchargement depuis un film ou un épisode.</Text>;
                  }
                  if (search.length > 0) {
                     return <Text style={styles.emptyText}>Aucun résultat trouvé pour votre recherche.</Text>;
                  }
                  return (
                     <Text style={styles.emptyText}>
                       Recherchez {mediaType === 'anime' ? 'un anime' : 'un film ou une série'} pour commencer.
                     </Text>
                  );
                }

                return dataToDisplay.map((item, idx) => (
                  <HorusMediaCard
                    key={`${item.id}-${idx}`}
                    title={item.title}
                    subtitle={mediaType === 'downloads' ? 'hors ligne' : item.type}
                    highlightText={
                      mediaType === 'downloads' && item.sourceOffline
                        ? formatByteCount(item.sourceOffline.sizeBytes)
                        : mediaType === 'history' &&
                          item.type !== 'movie' &&
                          item.sourceItem?.lastEpisode?.number
                          ? `ÉPISODE ${item.sourceItem.lastEpisode.number}`
                          : undefined
                    }
                    imageUrl={item.coverUrl}
                    index={idx}
                    onLongPress={item.sourceOffline
                      ? () => deleteOfflineMedia(item.sourceOffline!)
                      : undefined}
                    onPress={() => {
                      if (mediaType === 'downloads' && item.sourceOffline) {
                        void playOfflineMedia(item.sourceOffline);
                      } else if (mediaType === 'history' && item.sourceItem?.lastEpisode) {
                        // Reprise directe de l'épisode sans passer par l'overlay de détails
                        mediaRequestIdRef.current += 1;
                        setSelectedMedia(item as SearchResult);
                        extractStreamsAndCast(item.sourceItem.lastEpisode, item as SearchResult);
                      } else {
                        // Comportement normal pour la recherche ou la wishlist
                        openMedia(item as SearchResult);
                      }
                    }}
                  />
                ));
              })()}
            </View>
          )}
        </ScrollView>

        {/* Overlay Détails du média (Phase 4 Cyber UI) */}
        <HorusMediaDetailsOverlay
          visible={!!selectedMedia && !isEpisodeListVisible}
          onClose={() => {
            mediaRequestIdRef.current += 1;
            setSelectedMedia(null);
            setEpisodes([]);
            setIsLoadingEpisodes(false);
          }}
          media={selectedMedia ? {
            id: selectedMedia.id,
            title: selectedMedia.title,
            imageUrl: selectedMedia.coverUrl || '',
            type: selectedMedia.type,
            providerId: selectedMedia.providerId,
          } : null}
          isLoading={isLoadingEpisodes}
          onInitStream={() => {
            if (seasonKeys.length === 1 && seasonGroups[seasonKeys[0]].length === 1) {
              extractStreamsAndCast(seasonGroups[seasonKeys[0]][0]);
            } else {
              setIsEpisodeListVisible(true);
            }
          }}
          onDownload={
            Platform.OS === 'android' &&
            seasonKeys.length === 1 &&
            seasonGroups[seasonKeys[0]].length === 1
              ? () => downloadEpisodeForOffline(seasonGroups[seasonKeys[0]][0])
              : undefined
          }
          isDownloading={Boolean(downloadingEpisodeId)}
          isDownloaded={Boolean(
            selectedMedia &&
            seasonKeys.length === 1 &&
            seasonGroups[seasonKeys[0]].length === 1 &&
            offlineMedia.some(item =>
              item.media.id === selectedMedia.id &&
              item.episode.id === seasonGroups[seasonKeys[0]][0].id
            )
          )}
        />

        {/* Phase 5 : Liste des épisodes Cyber UI */}
        <HorusEpisodeList 
          visible={isEpisodeListVisible}
          onClose={() => setIsEpisodeListVisible(false)}
          seasonKeys={seasonKeys}
          selectedSeason={selectedSeason}
          onSelectSeason={setSelectedSeason}
          episodes={seasonGroups[selectedSeason] || []}
          isExtracting={isExtracting}
          onPlayEpisode={(ep) => extractStreamsAndCast(ep)}
          onDownloadEpisode={Platform.OS === 'android'
            ? (episode) => downloadEpisodeForOffline(episode)
            : undefined}
          downloadedEpisodeIds={selectedMedia
            ? offlineMedia
                .filter(item => item.media.id === selectedMedia.id)
                .map(item => item.episode.id)
            : []}
          downloadingEpisodeId={downloadingEpisodeId}
          isLoading={isLoadingEpisodes}
        />

        {/* --- Modal de sélection de la langue (façon Bottom Sheet) --- */}
        <Modal
          visible={isLangModalVisible}
          animationType="slide"
          transparent={true}
          onRequestClose={() => setIsLangModalVisible(false)}
        >
          <View style={styles.langModalOverlay}>
            <View style={styles.langModalContent}>
              <Text style={styles.langModalTitle}>Choisir la version</Text>

              {sortStreamLanguages(Object.keys(availableLanguages)).map((lang) => (
                <TouchableOpacity
                  key={lang}
                  style={styles.langButton}
                  onPress={() => handleLanguageSelect(lang)}
                >
                  <Text style={styles.langButtonText}>{lang}</Text>
                  <Text style={styles.langButtonSubtext}>
                    {lang === 'VOSTFR'
                      ? 'Audio original • sous-titres DLNA non garantis'
                      : lang === 'VO'
                        ? 'Audio original'
                        : `${availableLanguages[lang].length} serveur(s)`}
                  </Text>
                </TouchableOpacity>
              ))}

              <TouchableOpacity
                style={styles.langCancelButton}
                onPress={() => setIsLangModalVisible(false)}
              >
                <Text style={styles.langCancelText}>Annuler</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* Lecteur Vidéo en plein écran */}
        {allStreams.length > 0 && (
          <Modal
            visible={true}
            animationType="fade"
            onRequestClose={closePlayer}
          >
            <VideoPlayer
              key={`${currentStreamIndex}:${allStreams[currentStreamIndex].url}`}
              stream={allStreams[currentStreamIndex]}
              onClose={closePlayer}
              onError={
                currentStreamIndex + 1 < allStreams.length || alternateLocalLanguage
                  ? () => { void tryNextStream(); }
                  : undefined
              }
              errorActionLabel={
                currentStreamIndex + 1 < allStreams.length
                  ? 'Essayer un autre serveur'
                  : alternateLocalLanguage
                    ? `Essayer en ${alternateLocalLanguage}`
                    : undefined
              }
              onPlaybackStarted={() => {
                if (pendingPlayback) recordPlaybackInHistory(pendingPlayback);
              }}
            />
          </Modal>
        )}

        {/* Modale de Sélection Cast / DLNA */}
        <UnifiedCastModal
          visible={isUnifiedCastModalVisible}
          onClose={() => setIsUnifiedCastModalVisible(false)}
          onSelectCast={(mode, quality) => {
            setIsTvModeEnabled(true);
            setRemoteDeliveryMode(mode);
            setRemoteCacheQuality(quality);
          }}
          onSelectDlna={(device, mode, quality) => {
            setActiveDlnaDevice(device);
            setIsTvModeEnabled(true);
            setRemoteDeliveryMode(mode);
            setRemoteCacheQuality(quality);
          }}
        />

        <Modal
          visible={isCachingMedia}
          transparent={true}
          animationType="fade"
          onRequestClose={() => {
            cacheCancelledRef.current = true;
            if (downloadingEpisodeId) setPendingOfflineDownload(null);
            LocalVideoProxy.cancelCache().catch(console.error);
          }}
        >
          <View style={styles.cacheModalOverlay}>
            <View style={styles.cacheModalContent}>
              <ActivityIndicator size="large" color="#00FFFF" />
              <Text style={styles.cacheModalTitle}>
                {downloadingEpisodeId ? 'Téléchargement hors ligne' : 'Préparation pour la TV'}
              </Text>
              <Text style={styles.cacheModalText}>
                {cacheProgress.phase === 'optimizing'
                  ? 'Optimisation du fichier MP4'
                  : `Téléchargement complet du média en ${remoteCacheQuality}p`}
              </Text>
              {cacheProgress.phase === 'optimizing' ? (
                <Text style={styles.cacheModalProgress}>
                  {Math.round((cacheProgress.phaseProgress || 0) * 100)} %
                </Text>
              ) : (
                <Text style={styles.cacheModalProgress}>
                  {formatByteCount(cacheProgress.bytesDownloaded)}
                  {cacheProgress.totalBytes
                    ? ` / ${cacheProgress.totalBytesEstimated ? '~' : ''}${formatByteCount(cacheProgress.totalBytes)}`
                    : ' téléchargés'}
                </Text>
              )}
              {cacheProgress.phase === 'optimizing' || cacheProgress.totalBytes ? (
                <View style={styles.cacheProgressTrack}>
                  <View
                    style={[
                      styles.cacheProgressFill,
                      {
                        width: `${Math.min(
                          100,
                          cacheProgress.phase === 'optimizing'
                            ? (cacheProgress.phaseProgress || 0) * 100
                            : (cacheProgress.bytesDownloaded / (cacheProgress.totalBytes || 1)) * 100
                        )}%`,
                      },
                    ]}
                  />
                </View>
              ) : (
                <Text style={styles.cacheModalHint}>
                  Calcul de la taille estimée du flux HLS…
                </Text>
              )}
              <TouchableOpacity
                style={styles.cacheCancelButton}
                onPress={() => {
                  cacheCancelledRef.current = true;
                  if (downloadingEpisodeId) setPendingOfflineDownload(null);
                  LocalVideoProxy.cancelCache().catch(console.error);
                }}
              >
                <Text style={styles.cacheCancelText}>Annuler</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* Télécommande Cast */}
        {isCastRemoteVisible && (
          <Modal visible={true} animationType="slide" transparent={false} onRequestClose={() => setIsCastRemoteVisible(false)}>
            <CastController 
              onClose={() => {
                setIsCastRemoteVisible(false);
              }}
              dlnaDevice={activeDlnaDevice}
              dlnaTitle={pendingCastInfo?.title}
              canSeek={remotePlayback?.canSeek ?? true}
              expectedDurationSeconds={remotePlayback?.durationSeconds}
              playbackNotice={remotePlayback?.playbackNotice}
              hasPreviousEpisode={hasPreviousRemoteEpisode}
              hasNextEpisode={hasNextRemoteEpisode}
              isChangingEpisode={isChangingRemoteEpisode}
              onPreviousEpisode={() => changeRemoteEpisode(-1)}
              onNextEpisode={() => changeRemoteEpisode(1)}
              onStopped={() => {
                void finishRemotePlayback();
              }}
              onRequestDisconnect={() => {
                setIsCastRemoteVisible(false);
                setIsDisconnectModalVisible(true);
              }}
            />
          </Modal>
        )}

        {/* Modale de déconnexion */}
        <DisconnectModal
          visible={isDisconnectModalVisible}
          deviceName={activeDlnaDevice ? activeDlnaDevice.name : 'Chromecast'}
          onClose={() => setIsDisconnectModalVisible(false)}
          onConfirm={() => {
            if (activeDlnaDevice) {
              dlnaController.stop(activeDlnaDevice.controlUrl).catch(() => {});
              setActiveDlnaDevice(null);
            }
            if (castSession) {
              CastContext.getSessionManager().endCurrentSession(true).catch(console.error);
            }
            setIsTvModeEnabled(false);
            void finishRemotePlayback();
            setIsCastRemoteVisible(false);
            setIsDisconnectModalVisible(false);
          }}
        />

      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B0F19' },

  header: { paddingHorizontal: 20, marginTop: 20, marginBottom: 20 },
  appTitle: { color: '#F8FAFC', fontSize: 28, fontWeight: 'bold', marginBottom: 15, letterSpacing: -0.5 },

  pillsContainer: { flexDirection: 'row', marginBottom: 15 },
  pill: { 
    paddingVertical: 10, 
    paddingHorizontal: 20, 
    backgroundColor: '#0B0F19', 
    marginRight: 12, 
    borderWidth: 1, 
    borderColor: '#1E293B',
    borderLeftWidth: 3 // Cyber edge
  },
  pillActive: { 
    backgroundColor: 'rgba(0, 255, 255, 0.05)', 
    borderColor: '#00FFFF',
    borderLeftColor: '#8B5CF6',
  },
  pillText: { color: '#475569', fontWeight: 'bold', letterSpacing: 1, fontSize: 12, textTransform: 'uppercase' },
  pillTextActive: { color: '#00FFFF' },

  searchInput: { backgroundColor: '#1A1F2E', color: '#F8FAFC', paddingHorizontal: 20, paddingVertical: 15, borderRadius: 12, fontSize: 16, borderWidth: 1, borderColor: '#2A3143' },

  scrollContent: { paddingBottom: 40 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 15, justifyContent: 'space-between' },
  card: { width: '48%', marginBottom: 15, borderRadius: 12, backgroundColor: '#1A1F2E', overflow: 'hidden', borderWidth: 1, borderColor: 'transparent' },
  cardImage: { width: '100%', height: 220, resizeMode: 'cover' },
  cardInfo: { padding: 12 },
  cardTitle: { color: '#F8FAFC', fontSize: 14, fontWeight: '600', marginBottom: 4 },
  cardSubtitle: { color: '#8B5CF6', fontSize: 12, fontWeight: '500', textTransform: 'capitalize' },

  emptyText: { color: '#94A3B8', textAlign: 'center', width: '100%', marginTop: 20, paddingHorizontal: 20, lineHeight: 22 },
  offlineHint: { color: '#64748B', width: '100%', marginBottom: 14, paddingHorizontal: 5, fontSize: 12, lineHeight: 18 },

  // Modal Custom Styling
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20 },
  modalTitle: { color: '#FFF', fontSize: 24, fontWeight: 'bold', textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
  modalSubtitle: { color: '#A78BFA', fontSize: 14, fontWeight: '600', marginTop: 4, letterSpacing: 1 },
  closeBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.1)', justifyContent: 'center', alignItems: 'center', marginLeft: 15 },
  closeBtnText: { color: '#FFF', fontSize: 16, fontWeight: 'bold' },

  // Season Tabs
  seasonContainer: { marginBottom: 15 },
  seasonTab: { paddingVertical: 10, paddingHorizontal: 18, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.05)', marginRight: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  seasonTabActive: { backgroundColor: '#8B5CF6', borderColor: '#8B5CF6' },
  seasonTabText: { color: '#94A3B8', fontWeight: '600', fontSize: 14 },
  seasonTabTextActive: { color: '#FFF' },

  // Episodes List
  episodesList: { flex: 1 },
  episodeCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.05)', padding: 12, borderRadius: 12, marginBottom: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
  episodeNumber: { width: 40, justifyContent: 'center', alignItems: 'center' },
  episodeNumberText: { color: '#94A3B8', fontSize: 16, fontWeight: 'bold' },
  episodeInfo: { flex: 1, paddingHorizontal: 10 },
  episodeText: { color: '#FFF', fontSize: 15, fontWeight: '500' },
  playIconBox: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(139, 92, 246, 0.2)', justifyContent: 'center', alignItems: 'center' },
  playIconText: { color: '#A78BFA', fontSize: 12, marginLeft: 2 },

  // --- Modale Langues (Bottom Sheet) ---
  langModalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.6)'
  },
  langModalContent: {
    backgroundColor: '#1A1F2E',
    padding: 25,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: 25
  },
  langModalTitle: {
    color: '#FFF',
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center'
  },
  langButton: {
    backgroundColor: '#2A3143',
    padding: 16,
    borderRadius: 14,
    marginBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)'
  },
  langButtonText: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.5
  },
  langButtonSubtext: {
    color: '#8B5CF6',
    fontSize: 12,
    fontWeight: '500'
  },
  langCancelButton: {
    marginTop: 10,
    padding: 16,
    borderRadius: 14,
    alignItems: 'center'
  },
  langCancelText: {
    color: '#94A3B8',
    fontSize: 16,
    fontWeight: '600'
  },
  cacheModalOverlay: {
    flex: 1,
    justifyContent: 'center',
    padding: 28,
    backgroundColor: 'rgba(0, 0, 0, 0.82)',
  },
  cacheModalContent: {
    padding: 24,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(0, 255, 255, 0.28)',
    backgroundColor: '#111827',
    alignItems: 'center',
  },
  cacheModalTitle: {
    color: '#F8FAFC',
    fontSize: 20,
    fontWeight: '700',
    marginTop: 18,
  },
  cacheModalText: {
    color: '#94A3B8',
    fontSize: 14,
    marginTop: 8,
  },
  cacheModalProgress: {
    color: '#00FFFF',
    fontSize: 15,
    fontWeight: '700',
    marginTop: 18,
  },
  cacheProgressTrack: {
    width: '100%',
    height: 7,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: '#253044',
    marginTop: 14,
  },
  cacheProgressFill: {
    height: '100%',
    borderRadius: 4,
    backgroundColor: '#00FFFF',
  },
  cacheModalHint: {
    color: '#64748B',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 14,
  },
  cacheCancelButton: {
    marginTop: 22,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#253044',
  },
  cacheCancelText: {
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: '600',
  }
});
