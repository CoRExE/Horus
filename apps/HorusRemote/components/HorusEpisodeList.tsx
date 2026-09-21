import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Modal, Pressable, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { MotiView } from 'moti';
import { Episode } from '@horus/core';
import { Check, Download } from 'lucide-react-native';

export interface HorusEpisodeListProps {
  visible: boolean;
  onClose: () => void;
  seasonKeys: string[];
  selectedSeason: string;
  onSelectSeason: (season: string) => void;
  episodes: Episode[];
  allEpisodes?: Episode[];
  onDownloadEpisodes?: (episodes: Episode[], language: string) => void;
  isExtracting: boolean;
  onPlayEpisode: (episode: Episode) => void;
  onDownloadEpisode?: (episode: Episode) => void;
  downloadedEpisodeIds?: string[];
  downloadingEpisodeId?: string | null;
  isLoading?: boolean;
}

const COLOR_OVERLAY = 'rgba(11, 15, 25, 0.75)';
const COLOR_PANEL = '#131A2A';
const COLOR_ACCENT_CYAN = '#00FFFF';
const COLOR_ACCENT_PURPLE = '#8B5CF6';
const COLOR_TEXT = '#F8FAFC';

export const HorusEpisodeList: React.FC<HorusEpisodeListProps> = ({
  visible,
  onClose,
  seasonKeys,
  selectedSeason,
  onSelectSeason,
  episodes,
  allEpisodes = episodes,
  onDownloadEpisodes,
  isExtracting,
  onPlayEpisode,
  onDownloadEpisode,
  downloadedEpisodeIds = [],
  downloadingEpisodeId,
  isLoading = false,
}) => {
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [language, setLanguage] = useState('VF');
  useEffect(() => {
    if (!visible) { setSelecting(false); setSelected([]); }
  }, [visible]);
  const toggleEpisode = (episode: Episode) => setSelected(current => current.includes(episode.id)
    ? current.filter(id => id !== episode.id) : [...current, episode.id]);
  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        {/* Arrière-plan touchable pour fermer */}
        <Pressable style={styles.overlay} onPress={onClose} />

        {/* Conteneur principal façon BottomSheet cyber */}
        <View style={styles.bottomSheet}>
          {/* Encoches Supérieures */}
          <View style={styles.notchTopLeft} pointerEvents="none" />
          <View style={styles.notchTopRight} pointerEvents="none" />

          {/* Wrapper du contenu principal */}
          <View style={styles.content}>
            <View style={styles.header}>
              <View style={styles.titleWrapper}>
                  <View style={styles.statusDot} />
                  <Text style={styles.title}>DATABANKS / EPISODES</Text>
              </View>
              <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                <Text style={styles.closeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Sélecteur de Saisons */}
            {seasonKeys.length > 1 && (
              <View style={styles.seasonsContainer}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingRight: 20 }}>
                  {seasonKeys.map((season) => {
                    const isActive = season === selectedSeason;
                    return (
                      <TouchableOpacity
                        key={season}
                        style={[styles.seasonTab, isActive && styles.seasonTabActive]}
                        onPress={() => onSelectSeason(season)}
                      >
                        <Text style={[styles.seasonTabText, isActive && styles.seasonTabTextActive]}>
                          {season}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            )}

            {onDownloadEpisodes && <View style={styles.batchControls}>
              {!selecting ? <TouchableOpacity accessibilityRole="button" disabled={isLoading || isExtracting || !!downloadingEpisodeId}
                onPress={() => setSelecting(true)} style={styles.batchButton}>
                <Text style={styles.batchText}>Télécharger plusieurs épisodes</Text>
              </TouchableOpacity> : <>
                <Text style={styles.batchText}>Langue des téléchargements</Text>
                <View style={styles.batchRow}>{['VF', 'VOSTFR', 'VO'].map(value => <TouchableOpacity key={value}
                  accessibilityRole="radio" accessibilityState={{ selected: language === value }}
                  onPress={() => setLanguage(value)} style={[styles.batchButton, language === value && styles.seasonTabActive]}>
                  <Text style={styles.batchText}>{value}</Text>
                </TouchableOpacity>)}</View>
                <View style={styles.batchRow}>
                  <TouchableOpacity accessibilityRole="button" style={styles.batchButton}
                    onPress={() => setSelected(current => [...new Set([...current, ...episodes.map(episode => episode.id)])])}>
                    <Text style={styles.batchText}>Toute la saison</Text>
                  </TouchableOpacity>
                  <TouchableOpacity accessibilityRole="button" style={styles.batchButton} onPress={() => setSelected([])}>
                    <Text style={styles.batchText}>Tout désélectionner</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.batchRow}>
                  <TouchableOpacity accessibilityRole="button" style={[styles.batchButton, !selected.length && { opacity: 0.4 }]}
                    disabled={!selected.length || !!downloadingEpisodeId || isExtracting}
                    onPress={() => { onDownloadEpisodes(allEpisodes.filter(episode => selected.includes(episode.id)), language); setSelected([]); setSelecting(false); }}>
                    <Text style={styles.batchText}>Télécharger ({selected.length})</Text>
                  </TouchableOpacity>
                  <TouchableOpacity accessibilityRole="button" style={styles.batchButton} onPress={() => { setSelecting(false); setSelected([]); }}>
                    <Text style={styles.batchText}>Annuler</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.batchHint}>Dans l’ordre des épisodes. Les épisodes déjà présents dans cette langue sont ignorés ; une langue absente est signalée.</Text>
              </>}
            </View>}

            {/* Liste des Épisodes avec Staggered Animation */}
            <ScrollView style={styles.episodesList} contentContainerStyle={{ paddingBottom: 40, paddingTop: 10 }}>
              {episodes.map((ep, idx) => {
                let displayTitle = ep.title || `Épisode ${ep.number}`;
                if (displayTitle.includes(' - ')) {
                  displayTitle = displayTitle.split(' - ')[1] || displayTitle;
                }

                return (
                  <MotiView
                    key={ep.id + idx}
                    from={{ opacity: 0, translateX: -20 }}
                    animate={{ opacity: 1, translateX: 0 }}
                    transition={{
                      type: 'spring',
                      damping: 15,
                      stiffness: 100,
                      delay: Math.min(idx * 50, 1000) // Effet d'apparition en cascade rapide
                    }}
                  >
                    <View style={styles.episodeCard}>
                      <TouchableOpacity
                        style={styles.episodePlayArea}
                        onPress={() => selecting ? toggleEpisode(ep) : onPlayEpisode(ep)}
                        accessibilityRole={selecting ? "checkbox" : "button"}
                        accessibilityState={selecting ? { checked: selected.includes(ep.id) } : undefined}
                        accessibilityLabel={displayTitle}
                        disabled={isExtracting}
                        activeOpacity={0.7}
                      >
                        <View style={styles.episodeIndexBox}>
                          <Text style={styles.episodeIndexText}>
                            EP.{String(idx + 1).padStart(2, '0')}
                          </Text>
                        </View>
                        <View style={styles.episodeInfo}>
                          <Text style={styles.episodeTitle} numberOfLines={2}>
                            {displayTitle}
                          </Text>
                        </View>
                        <View style={styles.playAction}>
                          {selecting ? (
                            <Text style={styles.playIconText}>{selected.includes(ep.id) ? '☑' : '☐'}</Text>
                          ) : isExtracting ? (
                            <ActivityIndicator size="small" color={COLOR_ACCENT_PURPLE} />
                          ) : (
                            <Text style={styles.playIconText}>▶</Text>
                          )}
                        </View>
                      </TouchableOpacity>
                      {onDownloadEpisode && !selecting && (
                        <TouchableOpacity
                          style={styles.downloadAction}
                          onPress={() => onDownloadEpisode(ep)}
                          disabled={Boolean(downloadingEpisodeId) || downloadedEpisodeIds.includes(ep.id)}
                        >
                          {downloadingEpisodeId === ep.id ? (
                            <ActivityIndicator size="small" color={COLOR_ACCENT_CYAN} />
                          ) : downloadedEpisodeIds.includes(ep.id) ? (
                            <Check color="#10B981" size={20} />
                          ) : (
                            <Download color={COLOR_ACCENT_CYAN} size={20} />
                          )}
                        </TouchableOpacity>
                      )}
                    </View>
                  </MotiView>
                );
              })}

              {isLoading && (
                <View style={styles.emptyContainer}>
                  <ActivityIndicator size="large" color={COLOR_ACCENT_CYAN} />
                  <Text style={styles.emptyText}>LOADING DATABANK…</Text>
                </View>
              )}

              {!isLoading && episodes.length === 0 && (
                <View style={styles.emptyContainer}>
                  <Text style={styles.emptyText}>NO DATA FOUND IN THIS BANK</Text>
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  batchControls: { gap: 6, marginBottom: 8 },
  batchRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  batchButton: { borderWidth: 1, borderColor: '#475569', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 6 },
  batchText: { color: '#F8FAFC', fontSize: 13 },
  batchHint: { color: '#94A3B8', fontSize: 11 },
  container: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: COLOR_OVERLAY,
  },
  bottomSheet: {
    height: '75%',
    backgroundColor: COLOR_PANEL,
    borderTopWidth: 2,
    borderColor: COLOR_ACCENT_CYAN,
    position: 'relative',
    shadowColor: COLOR_ACCENT_CYAN,
    shadowOffset: { width: 0, height: -5 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  // --- Encoches Graphiques Supérieures ---
  notchTopLeft: {
     position: 'absolute',
     top: -2,
     left: -2,
     width: 15,
     height: 15,
     borderTopWidth: 3,
     borderLeftWidth: 3,
     borderColor: COLOR_ACCENT_PURPLE,
     zIndex: 20,
  },
  notchTopRight: {
     position: 'absolute',
     top: -2,
     right: -2,
     width: 15,
     height: 15,
     borderTopWidth: 3,
     borderRightWidth: 3,
     borderColor: COLOR_ACCENT_PURPLE,
     zIndex: 20,
  },
  // --- Header ---
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  titleWrapper: {
      flexDirection: 'row',
      alignItems: 'center',
  },
  statusDot: {
      width: 8,
      height: 8,
      backgroundColor: COLOR_ACCENT_CYAN,
      marginRight: 10,
      shadowColor: COLOR_ACCENT_CYAN,
      shadowOpacity: 0.8,
      shadowRadius: 4,
      shadowOffset: { width: 0, height: 0 },
  },
  title: {
    color: COLOR_TEXT,
    fontSize: 18,
    fontWeight: 'bold',
    letterSpacing: 2,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderWidth: 1,
    borderColor: '#1E293B',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0B0F19',
  },
  closeBtnText: {
    color: '#94A3B8',
    fontSize: 16,
    fontWeight: 'bold',
  },
  // --- Saisons ---
  seasonsContainer: {
    marginBottom: 15,
  },
  seasonTab: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: '#0B0F19',
    borderWidth: 1,
    borderColor: '#1E293B',
    marginRight: 12,
  },
  seasonTabActive: {
    borderColor: COLOR_ACCENT_CYAN,
    backgroundColor: 'rgba(0, 255, 255, 0.05)',
  },
  seasonTabText: {
    color: '#475569',
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  seasonTabTextActive: {
    color: COLOR_ACCENT_CYAN,
  },
  // --- Episodes ---
  episodesList: {
    flex: 1,
  },
  episodeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0B0F19',
    borderLeftWidth: 2,
    borderColor: COLOR_ACCENT_PURPLE,
    marginBottom: 12,
    padding: 8,
  },
  episodePlayArea: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 4,
  },
  episodeIndexBox: {
    backgroundColor: 'rgba(139, 92, 246, 0.1)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginRight: 12,
  },
  episodeIndexText: {
    color: COLOR_ACCENT_PURPLE,
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  episodeInfo: {
    flex: 1,
    paddingRight: 10,
  },
  episodeTitle: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '600',
  },
  playAction: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playIconText: {
    color: COLOR_ACCENT_CYAN,
    fontSize: 14,
  },
  downloadAction: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderLeftWidth: 1,
    borderLeftColor: '#1E293B',
  },
  emptyContainer: {
    marginTop: 40,
    alignItems: 'center',
  },
  emptyText: {
    color: '#475569',
    letterSpacing: 2,
    fontWeight: 'bold',
  }
});
