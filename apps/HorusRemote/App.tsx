import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, TextInput, ScrollView, Image, TouchableOpacity, SafeAreaView, Platform, ActivityIndicator, Modal } from 'react-native';
import React, { useState, useMemo, useEffect } from 'react';

// Imports de notre librairie locale @horus/core
import { AnimeSamaProvider, FrenchStreamProvider, AllAnimeProvider, SearchResult, Episode, Stream } from '@horus/core';

// Instanciation des providers de Scraping
const animeSama = new AnimeSamaProvider();
const allAnime = new AllAnimeProvider();
const frenchStream = new FrenchStreamProvider();

export default function App() {
  const [mediaType, setMediaType] = useState<'anime' | 'film_series'>('anime');
  const [search, setSearch] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);

  // Modal State pour voir les épisodes d'un média cliqué
  const [selectedMedia, setSelectedMedia] = useState<SearchResult | null>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [isLoadingEpisodes, setIsLoadingEpisodes] = useState(false);
  const [selectedSeason, setSelectedSeason] = useState<string>('');

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

  const extractStreamsAndCast = async (episode: Episode) => {
     try {
       const provider = getProviderForMedia(selectedMedia!.id);
       console.log(`📡 Extraction directe en cours via ${provider.name}...`);
       
       const streams = await provider.getStreams(episode.id);
       console.log("🚀 URLS NATIVES TROUVÉES :", streams);
       alert(`Trouvé ${streams.length} liens ! \nRegardez la console (Metro).`);
     } catch (e) {
       console.error(e);
       alert("Erreur lors de l'extraction de la vidéo");
     }
  };

  // Grouper les épisodes par saisons
  const seasonGroups = useMemo(() => {
    const groups: { [key: string]: Episode[] } = {};
    episodes.forEach((ep) => {
        let seasonName = 'Standard';
        if (ep.title.includes(' - ')) {
            seasonName = ep.title.split(' - ')[0].trim();
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

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />
      
      {/* HEADER / SEARCH */}
      <View style={styles.header}>
        <Text style={styles.appTitle}>Horus Remote</Text>
        
        {/* Pilules de Sélection de Type de Média */}
        <View style={styles.pillsContainer}>
          <TouchableOpacity 
            style={[styles.pill, mediaType === 'anime' && styles.pillActive]} 
            onPress={() => { setMediaType('anime'); setResults([]); }}
          >
            <Text style={[styles.pillText, mediaType === 'anime' && styles.pillTextActive]}>Anime</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.pill, mediaType === 'film_series' && styles.pillActive]} 
            onPress={() => { setMediaType('film_series'); setResults([]); }}
          >
            <Text style={[styles.pillText, mediaType === 'film_series' && styles.pillTextActive]}>Films & Séries</Text>
          </TouchableOpacity>
        </View>

        <TextInput 
          style={styles.searchInput}
          placeholder={mediaType === 'anime' ? "Rechercher un anime..." : "Rechercher un film ou une série..."}
          placeholderTextColor="#94A3B8"
          value={search}
          onChangeText={setSearch}
          onSubmitEditing={handleSearch}
          returnKeyType="search"
        />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {isSearching ? (
          <ActivityIndicator size="large" color="#8B5CF6" style={{ marginTop: 50 }} />
        ) : (
          <View style={styles.grid}>
            {results.map((item, idx) => (
              <TouchableOpacity key={item.id + idx} style={styles.card} onPress={() => openMedia(item)}>
                {item.coverUrl ? (
                   <Image source={{ uri: item.coverUrl }} style={styles.cardImage} />
                ) : (
                   <View style={[styles.cardImage, { backgroundColor: '#2A3143', justifyContent: 'center', alignItems: 'center' }]}>
                     <Text style={{color: '#94A3B8'}}>Pas de miniature</Text>
                   </View>
                )}
                <View style={styles.cardInfo}>
                  <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>
                  <Text style={styles.cardSubtitle}>{item.type}</Text>
                </View>
              </TouchableOpacity>
            ))}
            
            {results.length === 0 && search.length > 0 && !isSearching && (
               <Text style={styles.emptyText}>Aucun résultat trouvé pour votre recherche.</Text>
            )}
            {results.length === 0 && search.length === 0 && !isSearching && (
               <Text style={styles.emptyText}>
                 Recherchez {mediaType === 'anime' ? 'un anime' : 'un film ou une série'} pour commencer.
               </Text>
            )}
          </View>
        )}
      </ScrollView>

      {/* Modal Détails du média (Liste des épisodes) */}
      <Modal 
        visible={!!selectedMedia} 
        animationType="slide" 
        transparent={true}
        onRequestClose={() => { setSelectedMedia(null); setEpisodes([]); }}
      >
         <View style={{ flex: 1, backgroundColor: '#0B0F19' }}>
            {/* Background premium avec flou de la vignette */}
            {selectedMedia?.coverUrl && (
               <Image 
                   source={{ uri: selectedMedia.coverUrl }} 
                   style={[StyleSheet.absoluteFillObject, { opacity: 0.3 }]} 
                   blurRadius={20} 
               />
            )}
            <View style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(11, 15, 25, 0.75)' }]} />
            
            <SafeAreaView style={{ flex: 1 }}>
               <View style={styles.modalHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.modalTitle} numberOfLines={2}>{selectedMedia?.title}</Text>
                    <Text style={styles.modalSubtitle}>{selectedMedia?.type.toUpperCase()}</Text>
                  </View>
                  <TouchableOpacity onPress={() => { setSelectedMedia(null); setEpisodes([]); }} style={styles.closeBtn}>
                     <Text style={styles.closeBtnText}>✕</Text>
                  </TouchableOpacity>
               </View>

               {isLoadingEpisodes ? (
                  <ActivityIndicator size="large" color="#8B5CF6" style={{ marginTop: 100 }} />
               ) : (
                  <>
                    {/* Pilules de Sélections de Saisons */}
                    {seasonKeys.length > 1 && (
                       <View style={styles.seasonContainer}>
                          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20 }}>
                              {seasonKeys.map(season => {
                                   const isActive = season === selectedSeason;
                                   return (
                                     <TouchableOpacity 
                                        key={season} 
                                        style={[styles.seasonTab, isActive && styles.seasonTabActive]}
                                        onPress={() => setSelectedSeason(season)}
                                     >
                                        <Text style={[styles.seasonTabText, isActive && styles.seasonTabTextActive]}>{season}</Text>
                                     </TouchableOpacity>
                                   )
                              })}
                          </ScrollView>
                       </View>
                    )}

                    {/* Liste des Épisodes de la Saison active */}
                    <ScrollView style={styles.episodesList} contentContainerStyle={{ paddingBottom: 40, paddingHorizontal: 20 }}>
                       {(seasonGroups[selectedSeason] || []).map((ep, idx) => {
                          let displayTitle = ep.title;
                          if (displayTitle.includes(' - ')) {
                              displayTitle = displayTitle.split(' - ')[1] || displayTitle; // Affiche juste "Épisode X"
                          }

                          return (
                            <TouchableOpacity key={ep.id + idx} style={styles.episodeCard} onPress={() => extractStreamsAndCast(ep)}>
                               <View style={styles.episodeNumber}>
                                  <Text style={styles.episodeNumberText}>{idx + 1}</Text>
                               </View>
                               <View style={styles.episodeInfo}>
                                  <Text style={styles.episodeText}>{displayTitle}</Text>
                               </View>
                               <View style={styles.playIconBox}>
                                  <Text style={styles.playIconText}>▶</Text>
                               </View>
                            </TouchableOpacity>
                          )
                       })}
                       
                       {(seasonGroups[selectedSeason] || []).length === 0 && (
                          <Text style={styles.emptyText}>Aucun épisode pour cette saison.</Text>
                       )}
                    </ScrollView>
                  </>
               )}
            </SafeAreaView>
         </View>
      </Modal>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B0F19', paddingTop: Platform.OS === 'android' ? 40 : 0 },
  header: { paddingHorizontal: 20, marginTop: 20, marginBottom: 20 },
  appTitle: { color: '#F8FAFC', fontSize: 28, fontWeight: 'bold', marginBottom: 15, letterSpacing: -0.5 },
  
  pillsContainer: { flexDirection: 'row', marginBottom: 15 },
  pill: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 20, backgroundColor: '#1A1F2E', marginRight: 10, borderWidth: 1, borderColor: '#2A3143' },
  pillActive: { backgroundColor: '#8B5CF6', borderColor: '#8B5CF6' },
  pillText: { color: '#94A3B8', fontWeight: '600' },
  pillTextActive: { color: '#FFFFFF' },
  
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
  modalTitle: { color: '#FFF', fontSize: 24, fontWeight: 'bold', textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: {width: 0, height: 1}, textShadowRadius: 3 },
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
  playIconText: { color: '#A78BFA', fontSize: 12, marginLeft: 2 }
});
