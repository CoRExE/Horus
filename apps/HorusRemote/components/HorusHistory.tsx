import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { formatPlaybackTime } from '@horus/core';
import type { HistoryItem } from '../store/useUserStore';
import { historyMediaKey, resumePosition } from '../services/history';
import { HorusMediaCard } from './HorusMediaCard';

export function HorusHistory({ history, remove, open }: {
  history: HistoryItem[];
  remove: (keys: string[]) => void;
  open: (item: HistoryItem) => void;
}) {
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState(new Set<string>());
  const keys = history.map(historyMediaKey);
  const selectedKeys = keys.filter(key => selected.has(key));
  const cancel = () => { setSelecting(false); setSelected(new Set()); };
  const button = (title: string, action: () => void, disabled = false) => (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={action} style={[styles.button, disabled && { opacity: 0.4 }]}>
      <Text style={styles.buttonText}>{title}</Text>
    </Pressable>
  );
  return (
    <View style={styles.container}>
      {history.length > 0 && <View style={styles.actions}>
        {selecting ? <>
          {button('Tout sélectionner', () => setSelected(new Set(keys)), selectedKeys.length === keys.length)}
          {button('Tout désélectionner', () => setSelected(new Set()), !selectedKeys.length)}
          {button(`Confirmer la suppression (${selectedKeys.length})`, () => { remove(selectedKeys); cancel(); }, !selectedKeys.length)}
          {button('Annuler', cancel)}
          <Text style={styles.hint}>{selectedKeys.length} sur {keys.length} sélectionnés. Les favoris et téléchargements sont conservés.</Text>
        </> : button('Supprimer', () => { setSelected(new Set()); setSelecting(true); })}
      </View>}
      {!history.length && <Text style={styles.hint}>Votre historique est vide.</Text>}
      <View style={styles.grid}>{history.map((item, index) => {
        const key = historyMediaKey(item);
        const position = resumePosition(item.position, item.duration);
        const progress = item.duration && item.duration > 0
          ? position > 0 ? `Reprendre à ${formatPlaybackTime(position)}`
            : (item.position ?? 0) > 0 ? 'Lecture terminée' : undefined
          : undefined;
        return <HorusMediaCard key={key} title={item.title} subtitle={item.type} imageUrl={item.imageUrl} index={index}
          highlightText={[item.type !== 'movie' && item.lastEpisode ? `ÉPISODE ${item.lastEpisode.number}` : undefined, progress].filter(Boolean).join(' · ')}
          selected={selecting ? selected.has(key) : undefined}
          onPress={() => {
            if (!selecting) { open(item); return; }
            setSelected(current => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
          }} />;
      })}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  button: { minHeight: 44, padding: 12, justifyContent: 'center', backgroundColor: '#1E293B', borderWidth: 1, borderColor: '#475569', borderRadius: 6 },
  buttonText: { color: '#E2E8F0', fontSize: 13 },
  hint: { width: '100%', color: '#94A3B8', fontSize: 13, lineHeight: 20, marginVertical: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
});
