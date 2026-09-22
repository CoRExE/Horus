import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useUserStore } from '../store/useUserStore';
import { HorusKeyboard } from './HorusKeyboard';

export function CatalogSettings({ visible }: { visible: boolean }) {
  const apiUrl = useUserStore(state => state.apiUrl);
  const setApiUrl = useUserStore(state => state.setApiUrl);
  const [draft, setDraft] = useState(apiUrl);
  const [keyboard, setKeyboard] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  useEffect(() => { if (visible) setDraft(apiUrl); }, [visible, apiUrl]);
  useEffect(() => { setKeyboard(false); setMessage(''); }, [visible]);
  const save = () => {
    try {
      setApiUrl(draft);
      setError(false);
      setMessage('Adresse du catalogue enregistrée.');
    } catch (error) {
      setError(true);
      setMessage(error instanceof Error ? error.message : 'Adresse invalide.');
    }
  };
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.title}>Catalogue HorusApi</Text>
    <Text style={styles.hint}>L’adresse de ton Worker Cloudflare. Le jeton TMDB reste dans l’API.</Text>
    <Text style={styles.label}>Adresse du catalogue</Text>
    {Platform.OS === 'android' ? (
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Modifier l’adresse du catalogue"
        onPress={() => setKeyboard(true)} style={styles.input}>
        <Text selectable={false} style={draft ? styles.value : styles.hint}>{draft || 'https://horus-api.votre-compte.workers.dev'}</Text>
      </TouchableOpacity>
    ) : <TextInput accessibilityLabel="Adresse du catalogue" style={[styles.input, styles.value]}
      value={draft} onChangeText={setDraft} autoCapitalize="none" autoCorrect={false}
      placeholder="https://horus-api.votre-compte.workers.dev" placeholderTextColor="#94A3B8"
      keyboardType="url" onSubmitEditing={save} />}
    <TouchableOpacity accessibilityRole="button" onPress={save} style={styles.button}>
      <Text style={styles.value}>Enregistrer l’adresse</Text>
    </TouchableOpacity>
    {!!message && <Text accessibilityLiveRegion="polite" style={[styles.hint, error && styles.error]}>{message}</Text>}
    <HorusKeyboard visible={visible && keyboard} value={draft} onChange={setDraft}
      title="Adresse du catalogue" submitLabel="Enregistrer" kind="url"
      onClose={() => setKeyboard(false)} onSubmit={save} />
  </View>;
}
const styles = StyleSheet.create({
  section: { borderBottomWidth: 1, borderBottomColor: '#334155', paddingBottom: 20, marginBottom: 12, gap: 10 },
  title: { color: '#F8FAFC', fontSize: 20, fontWeight: '700' },
  label: { color: '#E2E8F0', fontSize: 15 },
  hint: { color: '#94A3B8', fontSize: 14, lineHeight: 20 },
  value: { color: '#F8FAFC', fontSize: 15 },
  input: { backgroundColor: '#101827', borderWidth: 1, borderColor: '#475569', borderRadius: 8, padding: 12, minHeight: 48 },
  button: { backgroundColor: '#202338', padding: 12, borderRadius: 10 },
  error: { color: '#FB7185' },
});
