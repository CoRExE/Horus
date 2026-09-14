import React from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { useReleaseUpdates } from '../hooks/useReleaseUpdates';

type Updates = ReturnType<typeof useReleaseUpdates>;
export function ReleaseUpdateBanner({ updates, onOpen }: { updates: Updates; onOpen: () => void }) {
  if (!updates.showOffer || updates.result.kind !== 'available') return null;
  return <View style={styles.banner}>
    <TouchableOpacity accessibilityRole="button" onPress={onOpen} style={{ flex: 1 }}>
      <Text style={styles.text}>Horus {updates.result.manifest.version} est disponible</Text>
      <Text style={styles.link}>Voir la mise à jour</Text>
    </TouchableOpacity>
    <TouchableOpacity accessibilityRole="button" onPress={updates.dismiss}><Text style={styles.link}>Plus tard</Text></TouchableOpacity>
  </View>;
}

export function ReleaseSettings({ visible, onClose, updates }: { visible: boolean; onClose: () => void; updates: Updates }) {
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
    <View style={styles.overlay}><View style={styles.card}>
      <ScrollView>
        <Text accessibilityRole="header" style={styles.title}>Paramètres</Text>
        <Text style={styles.text}>HorusRemote · {updates.version}</Text>
        <TouchableOpacity accessibilityRole="button" disabled={!updates.enabled || updates.result.kind === 'checking'} onPress={() => void updates.check()} style={styles.button}>
          <Text style={styles.text}>{updates.result.kind === 'checking' ? 'Vérification…' : 'Vérifier les mises à jour'}</Text>
        </TouchableOpacity>
        {updates.result.kind === 'current' && <Text style={styles.text}>Cette version est à jour.</Text>}
        {updates.result.kind === 'unavailable' && <Text style={styles.text}>Vérification impossible pour le moment. Réessayez plus tard.</Text>}
        {updates.result.kind === 'available' && <>
          <Text style={styles.title}>Version {updates.result.manifest.version}</Text>
          <Text style={styles.text}>{updates.result.manifest.notes || 'Nouvelle version disponible.'}</Text>
          <Text style={styles.text}>L’installation se fait manuellement après téléchargement.</Text>
          <TouchableOpacity accessibilityRole="button" disabled={updates.opening} onPress={() => void updates.download()} style={styles.button}>
            <Text style={styles.text}>{updates.opening ? 'Ouverture…' : 'Télécharger'}</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" onPress={() => { updates.dismiss(); onClose(); }} style={styles.button}>
            <Text style={styles.text}>Plus tard</Text>
          </TouchableOpacity>
        </>}
        {!!updates.message && <Text style={styles.text}>{updates.message}</Text>}
      </ScrollView>
      <TouchableOpacity accessibilityRole="button" onPress={onClose} style={styles.button}><Text style={styles.link}>Fermer</Text></TouchableOpacity>
    </View></View>
  </Modal>;
}
const styles = StyleSheet.create({
  banner: { backgroundColor: '#1e1838', marginHorizontal: 20, marginBottom: 12, padding: 12, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { backgroundColor: '#0b0f19', padding: 20, borderRadius: 18, width: '100%', maxWidth: 560, maxHeight: '85%' },
  title: { color: '#f8fafc', fontSize: 22, fontWeight: '700', marginVertical: 12 },
  text: { color: '#e2e8f0', fontSize: 15, lineHeight: 22, marginVertical: 4 },
  link: { color: '#a78bfa', fontSize: 15, paddingVertical: 8 },
  button: { backgroundColor: '#202338', borderRadius: 10, padding: 12, marginVertical: 8 },
});
