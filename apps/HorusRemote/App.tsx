import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, TextInput, ScrollView, Image, TouchableOpacity, Platform, ActivityIndicator, Modal } from 'react-native';
import React, { useState, useMemo, useEffect } from 'react';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import * as NavigationBar from 'expo-navigation-bar';

// Imports de notre librairie locale @horus/core
import { AnimeSamaProvider, FrenchStreamProvider, AllAnimeProvider, SearchResult, Episode, Stream, groupStreamsByLanguage } from '@horus/core';

import VideoPlayer from './components/VideoPlayer';
import { HorusBootSequence } from './components/HorusBootSequence';
import { HorusHeader } from './components/HorusHeader';
import { HorusMediaCard } from './components/HorusMediaCard';
import { HorusMediaDetailsOverlay } from './components/HorusMediaDetailsOverlay';
import { HorusEpisodeList } from './components/HorusEpisodeList';
import { useUserStore } from './store/useUserStore';

// Instanciation des providers de Scraping
const animeSama = new AnimeSamaProvider();
const allAnime = new AllAnimeProvider();
const frenchStream = new FrenchStreamProvider();

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

  const getProviderForMedia = (mediaId: string) => {
    if (mediaType === 'film_series') return frenchStream;
    if (mediaId.includes('catalogue')) return animeSama;
    return allAnime;
  };

  const openMedia = async (media: SearchResult) => {
    setSelectedMedia(media);
    setIsEpisodeListVisible(false);
    setIsLoadingEpisodes(true);
    setEpisodes([]);
    setSelectedSeason('');
    try {
      const provider = getProviderForMedia(media.id);
      const eps = await provider.getEpisodes(media.id);
      setEpisodes(eps);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoadingEpisodes(false);
    }
  };

  const extractStreamsAndCast = async (episode: Episode, overrideMedia?: SearchResult) => {
    const targetMedia = overrideMedia || selectedMedia;
    if (targetMedia) {
      addToHistory({
        id: targetMedia.id,
        title: targetMedia.title,
        imageUrl: targetMedia.coverUrl || '',
        type: targetMedia.type === 'anime' ? 'series' : targetMedia.type as 'movie' | 'series'
      }, { lastEpisode: episode });
    }

    setIsExtracting(true);
    try {
      const provider = getProviderForMedia(targetMedia!.id);


      const streams = await provider.getStreams(episode.id);


      if (streams.length > 0) {
        const grouped = groupStreamsByLanguage(streams);
        const langs = Object.keys(grouped);

        if (langs.length === 1) {
          setAllStreams(grouped[langs[0]]);
          setCurrentStreamIndex(0);
        } else if (langs.length > 1) {
          setAvailableLanguages(grouped);
          setIsLangModalVisible(true);
        }
      } else {
        alert("Aucun lien de streaming trouvé pour cet épisode.");
      }
    } catch (e) {
      console.error(e);
      alert("Erreur lors de l'extraction de la vidéo");
    } finally {
      setIsExtracting(false);
    }
  };

  const handleLanguageSelect = (lang: string) => {
    setIsLangModalVisible(false);
    setAllStreams(availableLanguages[lang]);
    setCurrentStreamIndex(0);
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
                const dataToDisplay = (mediaType === 'wishlist') ? wishlist.map(item => ({ id: String(item.id), title: item.title, coverUrl: item.imageUrl, type: item.type === 'movie' ? 'movie' : 'series', sourceItem: item })) as any[]
                                      : (mediaType === 'history') ? history.map(item => ({ id: String(item.id), title: item.title, coverUrl: item.imageUrl, type: item.type === 'movie' ? 'movie' : 'series', sourceItem: item })) as any[]
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
                    highlightText={mediaType === 'history' && item.sourceItem?.lastEpisode?.number ? `ÉPISODE ${item.sourceItem.lastEpisode.number}` : undefined}
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
          // @ts-ignore : selectedMedia type from Core could be 'anime' instead of 'series'
          media={selectedMedia ? {
            id: selectedMedia.id,
            title: selectedMedia.title,
            imageUrl: selectedMedia.coverUrl || '',
            type: selectedMedia.type === 'anime' ? 'series' : selectedMedia.type
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

              {Object.keys(availableLanguages).map((lang) => (
                <TouchableOpacity
                  key={lang}
                  style={styles.langButton}
                  onPress={() => handleLanguageSelect(lang)}
                >
                  <Text style={styles.langButtonText}>{lang}</Text>
                  <Text style={styles.langButtonSubtext}>
                    {availableLanguages[lang].length} serveur(s)
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
  }
});
