import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, TextInput, ScrollView, Image, TouchableOpacity, Platform, ActivityIndicator, Modal } from 'react-native';
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import * as NavigationBar from 'expo-navigation-bar';

// Imports de notre librairie locale @horus/core
import { AnimeSamaProvider, FrenchStreamProvider, AllAnimeProvider, SearchResult, Episode, Stream, ProviderId, formatRemoteMediaTitle, groupStreamsByLanguage, inferStreamFormat, normalizeStreamLanguage, sortStreamLanguages, sortStreamsForRemotePlayback } from '@horus/core';

import VideoPlayer from './components/VideoPlayer';
import { HorusBootSequence } from './components/HorusBootSequence';
import { HorusHeader } from './components/HorusHeader';
import { HorusMediaCard } from './components/HorusMediaCard';
import { HorusMediaDetailsOverlay } from './components/HorusMediaDetailsOverlay';
import { HorusEpisodeList } from './components/HorusEpisodeList';
import { HistoryItem, MediaItem, useUserStore } from './store/useUserStore';
import { useCastSession, CastContext } from 'react-native-google-cast';
import { CastController } from './components/CastController';
import { RemoteDeliveryMode, UnifiedCastModal } from './components/UnifiedCastModal';
import { DisconnectModal } from './components/DisconnectModal';
import { DlnaDevice } from './hooks/useDlnaDiscovery';
import { dlnaController } from './services/dlnaController';
import LocalVideoProxy from './modules/local-video-proxy/src/LocalVideoProxyModule';
import { CacheProgressEvent } from './modules/local-video-proxy/src/LocalVideoProxy.types';

// Instanciation des providers de Scraping
const animeSama = new AnimeSamaProvider();
const allAnime = new AllAnimeProvider();
const frenchStream = new FrenchStreamProvider();
const REMOTE_CACHE_CANCELLED = 'REMOTE_CACHE_CANCELLED';

const formatByteCount = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 Mo';
  const megabytes = bytes / (1024 * 1024);
  if (megabytes < 1024) return `${megabytes.toFixed(megabytes < 10 ? 1 : 0)} Mo`;
  return `${(megabytes / 1024).toFixed(1)} Go`;
};

const isRemoteCacheCancellation = (error: unknown) =>
  error instanceof Error && error.message === REMOTE_CACHE_CANCELLED;

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
}

interface RemotePlaybackSession extends PlaybackContext {
  language: string;
  canSeek: boolean;
}

export default function App() {
  const [isBooting, setIsBooting] = useState(true);
  const [mediaType, setMediaType] = useState<'anime' | 'film_series' | 'wishlist' | 'history'>('anime');
  const [search, setSearch] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);

  const wishlist = useUserStore(state => state.wishlist);
  const history = useUserStore(state => state.history);
  const addToHistory = useUserStore(state => state.addToHistory);

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
  const [remoteDeliveryMode, setRemoteDeliveryMode] = useState<RemoteDeliveryMode>('direct');
  const [isCachingMedia, setIsCachingMedia] = useState(false);
  const [cacheProgress, setCacheProgress] = useState<CacheProgressEvent>({
    bytesDownloaded: 0,
  });
  const cacheCancelledRef = useRef(false);
  const lastCacheProgressAtRef = useRef(0);

  const stopProxyAndClearCache = () => {
    LocalVideoProxy.stopServer()
      .catch(console.error)
      .finally(() => LocalVideoProxy.clearCache().catch(console.error));
  };

  const loadOnChromecast = async (stream: Stream, title: string, imageUrl: string) => {
    if (!castSession) return;

    const preparedStream = await dlnaController.prepareRemoteStream(stream, { bridgeHls: false });
    await castSession.client.loadMedia({
      mediaInfo: {
        contentUrl: preparedStream.url,
        contentType: preparedStream.contentType,
        metadata: {
          type: 'generic',
          title,
          images: [{ url: imageUrl }]
        }
      }
    });
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
    let lastError: unknown;

    if (!castSession && !activeDlnaDevice) {
      return false;
    }

    const shouldCache = remoteDeliveryMode === 'cache';
    cacheCancelledRef.current = false;
    if (shouldCache) {
      setCacheProgress({ bytesDownloaded: 0 });
      setIsCachingMedia(true);
    }

    try {
      for (const stream of orderedStreams) {
        let candidate = stream;
        let cacheId: string | undefined;
        try {
          if (shouldCache) {
            const cached = await dlnaController.cacheStream(stream);
            candidate = cached.stream;
            cacheId = cached.cacheId;
          }

          if (castSession) {
            await loadOnChromecast(candidate, context.title, context.imageUrl);
          } else if (activeDlnaDevice) {
            console.log(`[DLNA] Trying server ${stream.server} (${language})`);
            await dlnaController.castVideo(
              activeDlnaDevice.controlUrl,
              candidate,
              context.title
            );
          }
          selectedStream = candidate;
          break;
        } catch (error) {
          lastError = error;
          if (cacheId) {
            await dlnaController.removeCachedMedia(cacheId).catch(console.error);
          }
          if (cacheCancelledRef.current) {
            throw new Error(REMOTE_CACHE_CANCELLED);
          }
          const protocol = castSession ? 'Cast' : 'DLNA';
          console.warn(`[${protocol}] Server ${stream.server} failed, trying the next one.`);
        }
      }
    } finally {
      if (shouldCache) {
        setIsCachingMedia(false);
      }
    }

    if (!selectedStream) {
      throw lastError instanceof Error
        ? lastError
        : new Error('No remote stream could be started');
    }

    setPendingCastInfo({ title: context.title, imageUrl: context.imageUrl });
    setRemotePlayback({
      ...context,
      language,
      canSeek: Boolean(castSession) || inferStreamFormat(selectedStream) === 'file',
    });
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
    if (!search.trim()) return;
    setIsSearching(true);
    setResults([]);
    try {
      if (mediaType === 'anime') {
        const [res1, res2] = await Promise.allSettled([
          animeSama.search(search),
          allAnime.search(search)
        ]);
        const combined: SearchResult[] = [];
        if (res1.status === 'fulfilled') combined.push(...res1.value);
        if (res2.status === 'fulfilled') combined.push(...res2.value);
        setResults(combined);
      } else {
        const res = await frenchStream.search(search);
        setResults(res);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsSearching(false);
    }
  };

  const getProviderForMedia = (media: SearchResult) => {
    switch (inferProviderId(media)) {
      case 'french-stream':
        return frenchStream;
      case 'anime-sama':
        return animeSama;
      case 'all-anime':
        return allAnime;
    }
  };

  const openMedia = async (media: SearchResult) => {
    setSelectedMedia(media);
    setIsEpisodeListVisible(false);
    setIsLoadingEpisodes(true);
    setEpisodes([]);
    setSelectedSeason('');
    try {
      const provider = getProviderForMedia(media);
      const eps = await provider.getEpisodes(media.id);
      setEpisodes(eps);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoadingEpisodes(false);
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

    const historyEpisode = targetMedia.type === 'movie'
      ? undefined
      : { lastEpisode: episode };
    addToHistory({
      id: targetMedia.id,
      title: targetMedia.title,
      imageUrl: targetMedia.coverUrl || '',
      type: targetMedia.type,
      providerId: targetMedia.providerId,
    }, historyEpisode);

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
            setAvailableLanguages(grouped);
            setIsLangModalVisible(true);
            return;
          }
          const didPlayRemotely = await playOnSelectedRemote(
            preferredStreams,
            preferredLanguage,
            context
          );
          if (!didPlayRemotely) {
            setAllStreams(preferredStreams);
            setCurrentStreamIndex(0);
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
            setAllStreams(streamList);
            setCurrentStreamIndex(0);
          }
        } else if (langs.length >= 1) {
          setAvailableLanguages(grouped);
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

  const handleLanguageSelect = async (lang: string) => {
    setIsLangModalVisible(false);
    const selectedStreams = availableLanguages[lang];
    try {
      if (!selectedStreams || selectedStreams.length === 0) return;
      const didPlayRemotely = pendingPlayback
        ? await playOnSelectedRemote(selectedStreams, lang, pendingPlayback)
        : false;
      if (!didPlayRemotely) {
        setAllStreams(selectedStreams);
        setCurrentStreamIndex(0);
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

  const tryNextStream = () => {
    if (currentStreamIndex + 1 < allStreams.length) {
      setCurrentStreamIndex(currentStreamIndex + 1);
    } else {
      setAllStreams([]);
      setCurrentStreamIndex(0);
      alert("Aucun autre serveur disponible.");
    }
  };

  const closePlayer = () => {
    setAllStreams([]);
    setCurrentStreamIndex(0);
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
    LocalVideoProxy.clearCache().catch(error => {
      console.warn('[Cache] Initial cleanup failed', error);
    });
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
      }
    );
    return () => subscription.remove();
  }, []);

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
          hideSearch={mediaType === 'wishlist' || mediaType === 'history'}
          onPressCast={() => {
            if (castSession || (activeDlnaDevice && remotePlayback)) {
              setIsCastRemoteVisible(true);
            } else if (activeDlnaDevice) {
              setIsDisconnectModalVisible(true);
            } else {
              setIsUnifiedCastModalVisible(true);
            }
          }}
          isCasting={!!castSession || !!activeDlnaDevice}
        />

        {/* Pilules de Sélection de Type de Média */}
        <View style={[styles.pillsContainer, { paddingHorizontal: 20, marginBottom: 15, marginTop: (mediaType === 'wishlist' || mediaType === 'history') ? 20 : 0 }]}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: 'center' }}>
            <TouchableOpacity
              style={[styles.pill, mediaType === 'anime' && styles.pillActive]}
              onPress={() => { setMediaType('anime'); }}
            >
              <Text style={[styles.pillText, mediaType === 'anime' && styles.pillTextActive]}>Anime</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.pill, mediaType === 'film_series' && styles.pillActive]}
              onPress={() => { setMediaType('film_series'); }}
            >
              <Text style={[styles.pillText, mediaType === 'film_series' && styles.pillTextActive]}>Films & Séries</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.pill, mediaType === 'wishlist' && styles.pillActive]}
              onPress={() => { setMediaType('wishlist'); }}
            >
              <Text style={[styles.pillText, mediaType === 'wishlist' && styles.pillTextActive]}>Wishlist</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.pill, mediaType === 'history' && styles.pillActive]}
              onPress={() => { setMediaType('history'); }}
            >
              <Text style={[styles.pillText, mediaType === 'history' && styles.pillTextActive]}>Historique</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>

        <ScrollView contentContainerStyle={styles.scrollContent}>
          {isSearching && (mediaType === 'anime' || mediaType === 'film_series') ? (
            <ActivityIndicator size="large" color="#8B5CF6" style={{ marginTop: 50 }} />
          ) : (
            <View style={styles.grid}>
              {(() => {
                const dataToDisplay: Array<SearchResult & { sourceItem?: HistoryItem }> =
                  (mediaType === 'wishlist') ? wishlist.map(toSearchResult)
                  : (mediaType === 'history') ? history.map(item => ({ ...toSearchResult(item), sourceItem: item }))
                  : results;

                if (dataToDisplay.length === 0) {
                  if (mediaType === 'wishlist') {
                     return <Text style={styles.emptyText}>Votre Wishlist est vide. Ajoutez des médias pour les retrouver ici.</Text>;
                  }
                  if (mediaType === 'history') {
                     return <Text style={styles.emptyText}>Votre Historique est vide.</Text>;
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
                    key={item.id + idx}
                    title={item.title}
                    subtitle={item.type}
                    highlightText={
                      mediaType === 'history' &&
                      item.type !== 'movie' &&
                      item.sourceItem?.lastEpisode?.number
                        ? `ÉPISODE ${item.sourceItem.lastEpisode.number}`
                        : undefined
                    }
                    imageUrl={item.coverUrl}
                    index={idx}
                    onPress={() => {
                      if (mediaType === 'history' && item.sourceItem?.lastEpisode) {
                        // Reprise directe de l'épisode sans passer par l'overlay de détails
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
          onClose={() => { setSelectedMedia(null); setEpisodes([]); }}
          media={selectedMedia ? {
            id: selectedMedia.id,
            title: selectedMedia.title,
            imageUrl: selectedMedia.coverUrl || '',
            type: selectedMedia.type,
            providerId: selectedMedia.providerId,
          } : null}
          onInitStream={() => {
            if (seasonKeys.length === 1 && seasonGroups[seasonKeys[0]].length === 1) {
              extractStreamsAndCast(seasonGroups[seasonKeys[0]][0]);
            } else {
              setIsEpisodeListVisible(true);
            }
          }}
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
              key={currentStreamIndex}
              stream={allStreams[currentStreamIndex]}
              onClose={closePlayer}
              onError={allStreams.length > 1 ? tryNextStream : undefined}
            />
          </Modal>
        )}

        {/* Modale de Sélection Cast / DLNA */}
        <UnifiedCastModal
          visible={isUnifiedCastModalVisible}
          onClose={() => setIsUnifiedCastModalVisible(false)}
          onSelectCast={setRemoteDeliveryMode}
          onSelectDlna={(device, mode) => {
            setActiveDlnaDevice(device);
            setRemoteDeliveryMode(mode);
          }}
        />

        <Modal
          visible={isCachingMedia}
          transparent={true}
          animationType="fade"
          onRequestClose={() => {
            cacheCancelledRef.current = true;
            LocalVideoProxy.cancelCache().catch(console.error);
          }}
        >
          <View style={styles.cacheModalOverlay}>
            <View style={styles.cacheModalContent}>
              <ActivityIndicator size="large" color="#00FFFF" />
              <Text style={styles.cacheModalTitle}>Préparation pour la TV</Text>
              <Text style={styles.cacheModalText}>
                Téléchargement complet du média
              </Text>
              <Text style={styles.cacheModalProgress}>
                {formatByteCount(cacheProgress.bytesDownloaded)}
                {cacheProgress.totalBytes
                  ? ` / ${formatByteCount(cacheProgress.totalBytes)}`
                  : ' téléchargés'}
              </Text>
              {cacheProgress.totalBytes ? (
                <View style={styles.cacheProgressTrack}>
                  <View
                    style={[
                      styles.cacheProgressFill,
                      {
                        width: `${Math.min(
                          100,
                          (cacheProgress.bytesDownloaded / cacheProgress.totalBytes) * 100
                        )}%`,
                      },
                    ]}
                  />
                </View>
              ) : (
                <Text style={styles.cacheModalHint}>
                  La taille totale du flux HLS sera connue à la fin.
                </Text>
              )}
              <TouchableOpacity
                style={styles.cacheCancelButton}
                onPress={() => {
                  cacheCancelledRef.current = true;
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
              hasPreviousEpisode={hasPreviousRemoteEpisode}
              hasNextEpisode={hasNextRemoteEpisode}
              isChangingEpisode={isChangingRemoteEpisode}
              onPreviousEpisode={() => changeRemoteEpisode(-1)}
              onNextEpisode={() => changeRemoteEpisode(1)}
              onStopped={() => {
                setRemotePlayback(null);
                stopProxyAndClearCache();
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
            stopProxyAndClearCache();
            setRemotePlayback(null);
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
    paddingBottom: Platform.OS === 'ios' ? 40 : 25
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
