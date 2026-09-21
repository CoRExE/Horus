import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { editKeyboardText } from '../services/keyboardEditing';
import { hideAndroidNavigation } from '../services/immersiveNavigation';

export function HorusKeyboard({ visible, value, onChange, onClose, onSubmit, title = "Recherche", submitLabel = "Rechercher", kind = "text" }: {
  visible: boolean; value: string; onChange: (value: string) => void;
  onClose: () => void; onSubmit: () => void;
  title?: string; submitLabel?: string; kind?: "text" | "url";
}) {
  const [cursor, setCursor] = useState(0);
  const [upper, setUpper] = useState(false);
  const [symbols, setSymbols] = useState(false);
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  useEffect(() => { if (visible) setCursor(Array.from(value).length); }, [visible]);
  const edit = (key: string) => {
    const result = editKeyboardText(value, cursor, key);
    setCursor(result.cursor); onChange(result.value);
  };
  const close = () => { onClose(); hideAndroidNavigation(); };
  const key = (label: string, action: () => void, accessibilityLabel = label, active = false) => (
    <TouchableOpacity key={label} accessibilityRole="button" accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: active }} onPress={action} style={[styles.key, active && styles.active]}>
      <Text style={styles.keyText}>{label}</Text>
    </TouchableOpacity>
  );
  const rows = symbols ? ['1234567890', "-_:;!?.,'/", '@#&+()[]%='] : ['azertyuiop', 'qsdfghjklm', 'wxcvbn'];
  const characters = Array.from(value);
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={close}
    onShow={hideAndroidNavigation} onDismiss={hideAndroidNavigation} statusBarTranslucent navigationBarTranslucent>
    <View style={styles.overlay}>
      <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Fermer le clavier" accessibilityRole="button" />
      <View style={[styles.sheet, { maxHeight: height * 0.9, paddingBottom: Math.max(12, insets.bottom) }]}>
        <ScrollView bounces={false}>
          <View style={styles.heading}>
            <Text style={styles.title}>{title}</Text>
            <TouchableOpacity accessibilityRole="button" onPress={close} accessibilityLabel="Fermer le clavier"><Text style={styles.keyText}>Fermer</Text></TouchableOpacity>
          </View>
          <Text style={styles.value} accessibilityLabel={`${title} : ${value || 'vide'}`}>
            {characters.slice(0, cursor).join('')}<Text style={styles.caret}>│</Text>{characters.slice(cursor).join('')}
          </Text>
          <View style={styles.row}>
            {key('←', () => edit('left'), 'Déplacer le curseur à gauche')}
            {key('→', () => edit('right'), 'Déplacer le curseur à droite')}
            {key('Effacer tout', () => edit('clear'))}
            {key('⌫', () => edit('backspace'), 'Effacer le caractère précédent')}
          </View>
          {kind === 'url' && <View style={styles.row}>
            {['https://', '.', '/', '-', '.workers.dev'].map(part => key(part, () => edit(part)))}
          </View>}
          {rows.map(row => <View key={row} style={styles.row}>{Array.from(row).map(character => {
            const label = upper ? character.toUpperCase() : character;
            return key(label, () => edit(label));
          })}</View>)}
          {!symbols && <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.accents}>
            {Array.from('éèêëàâäùûüîïôöçœ').map(character => {
              const label = upper ? character.toUpperCase() : character;
              return <TouchableOpacity key={label} accessibilityRole="button" accessibilityLabel={label} style={styles.accent} onPress={() => edit(label)}><Text style={styles.keyText}>{label}</Text></TouchableOpacity>;
            })}
          </ScrollView>}
          <View style={styles.row}>
            {key(symbols ? 'ABC' : '123', () => setSymbols(!symbols), 'Changer lettres et symboles')}
            {key('⇧', () => setUpper(!upper), 'Majuscules', upper)}
            {key('Espace', () => edit(' '))}
            {key(submitLabel, () => { close(); onSubmit(); })}
          </View>
        </ScrollView>
      </View>
    </View>
  </Modal>;
}
const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: { backgroundColor: '#101827', borderTopWidth: 1, borderColor: '#00FFFF', padding: 8 },
  heading: { flexDirection: 'row', justifyContent: 'space-between', padding: 8 },
  title: { color: '#00FFFF', fontSize: 17, fontWeight: '700' },
  value: { color: '#F8FAFC', fontSize: 19, padding: 12, backgroundColor: '#0B0F19', minHeight: 50 },
  caret: { color: '#00FFFF' },
  row: { flexDirection: 'row', gap: 3, marginTop: 6 },
  key: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: '#253047', borderRadius: 6, paddingHorizontal: 2 },
  active: { backgroundColor: '#6440a4' },
  keyText: { color: '#F8FAFC', fontSize: 14, textAlign: 'center' },
  accents: { gap: 5, paddingVertical: 6 },
  accent: { minWidth: 40, minHeight: 44, backgroundColor: '#253047', borderRadius: 6, justifyContent: 'center', alignItems: 'center' },
});
