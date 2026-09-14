import React, { useState } from 'react';
import { View, StyleSheet, TextInput, TextInputProps, TouchableOpacity } from 'react-native';
import { MotiText, MotiView } from 'moti';
import { Search, Cast, Power, Settings } from 'lucide-react-native';

interface HorusHeaderProps extends TextInputProps {
  title?: string;
  hideSearch?: boolean;
  onPressCast?: () => void;
  onPressExit?: () => void;
  onPressSettings?: () => void;
  isCasting?: boolean;
}

export const HorusHeader: React.FC<HorusHeaderProps> = ({
  title = "HORUS",
  hideSearch = false,
  onPressCast,
  onPressExit,
  onPressSettings,
  isCasting = false,
  ...inputProps
}) => {
  const [isFocused, setIsFocused] = useState(false);

  // --- Palette de Couleurs Strictes ---
  const COLOR_BG = '#0B0F19';
  const COLOR_ACCENT = '#00FFFF'; // Bordures cyber et focus
  const COLOR_FOCUS = '#8B5CF6';  // Surlignage (utilisé pour la couleur du curseur / selection)
  const COLOR_TEXT_MAIN = '#F8FAFC';
  const COLOR_TEXT_DIM = '#475569'; // Placeholder

  // La couleur active change en fonction du state
  const currentBorderColor = isFocused ? COLOR_ACCENT : COLOR_TEXT_DIM;

  return (
    <View style={styles.container}>
      
      {/* 1. Titre Glitch et Statut Système */}
      <View style={styles.titleContainer}>
        
        {/* Calque de Glitch Cyberspatial (Aberration) */}
        <MotiText
          style={[styles.title, styles.titleGlitch]}
          animate={{
            translateX: [0, -3, 5, -2, 0, 0, 0, 0, 0, 0, 0],
            opacity: [0, 0.6, 0, 0.4, 0, 0, 0, 0, 0, 0, 0],
          }}
          transition={{ loop: true, type: 'timing', duration: 4000 }} // De longues pauses entre les glitchs
        >
          {title}
        </MotiText>
        
        {/* Titre Principal Instable */}
        <MotiText
          style={styles.title}
          animate={{
             translateX: [0, 2, -1, 0, 0, 0, -2, 0, 0, 0, 0],
             skewX: ['0deg', '0deg', '-5deg', '0deg', '0deg', '0deg', '3deg', '0deg', '0deg', '0deg', '0deg'],
             opacity: [1, 1, 0.8, 1, 1, 1, 0.6, 1, 1, 1, 1],
          }}
          transition={{ loop: true, type: 'timing', duration: 3500 }}
        >
          {title}
        </MotiText>

        {/* Actions à droite (Cast + Statut Système) */}
        <View style={styles.rightActions}>
          <View style={styles.actionRow}>
            {onPressSettings && <TouchableOpacity style={styles.iconButton} onPress={onPressSettings} accessibilityRole="button" accessibilityLabel="Paramètres">
              <Settings color={COLOR_ACCENT} size={23} />
            </TouchableOpacity>}
            <TouchableOpacity
              style={styles.iconButton}
              onPress={onPressCast}
              accessibilityRole="button"
              accessibilityLabel="Diffuser sur une télévision"
            >
              <Cast color={COLOR_ACCENT} size={24} fill={isCasting ? COLOR_ACCENT : 'transparent'} />
            </TouchableOpacity>
            {onPressExit && (
              <TouchableOpacity
                style={styles.iconButton}
                onPress={onPressExit}
                accessibilityRole="button"
                accessibilityLabel="Quitter Horus proprement"
              >
                <Power color="#FB7185" size={23} />
              </TouchableOpacity>
            )}
          </View>
          {/* Indicateur d'état système animé (Pulsation lente) */}
          <MotiView 
            style={styles.systemStatus}
            animate={{ opacity: [0.4, 1, 0.4] }}
            transition={{ loop: true, type: 'timing', duration: 2000 }}
          >
            <View style={styles.statusDot} />
            <MotiText style={styles.statusText}>SYS.ONLINE</MotiText>
          </MotiView>
        </View>
      </View>

      {/* 2. Barre de Recherche "Cyber" */}
      {!hideSearch && (
        <View 
          style={[
            styles.searchContainer, 
            { 
              borderBottomColor: currentBorderColor,
              borderLeftColor: currentBorderColor,
              // Applique un très léger fond tinté si actif
              backgroundColor: isFocused ? 'rgba(0, 255, 255, 0.03)' : 'rgba(71, 85, 105, 0.05)'
            }
          ]}
        >
          <Search color={currentBorderColor} size={20} style={styles.searchIcon} />
          
          <TextInput
            style={styles.input}
            placeholder="Trace Media Stream..."
            placeholderTextColor={COLOR_TEXT_DIM}
            selectionColor={COLOR_FOCUS} // Couleur de surlignage/curseur native
            onFocus={(e) => {
               setIsFocused(true);
               if (inputProps.onFocus) inputProps.onFocus(e);
            }}
            onBlur={(e) => {
               setIsFocused(false);
               if (inputProps.onBlur) inputProps.onBlur(e);
            }}
            {...inputProps}
          />

          {/* Détails fragmentés : Les encoches Cyber aux extrémités non-bordées */}
          <View style={[styles.notchTopRight, { backgroundColor: currentBorderColor }]} />
          <View style={[styles.notchBottomRight, { backgroundColor: currentBorderColor }]} />
          <View style={[styles.notchTopLeft, { backgroundColor: currentBorderColor }]} />
        </View>
      )}

    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 25,
    backgroundColor: '#0B0F19',
  },
  // --- TITRE ---
  titleContainer: {
    marginBottom: 20,
    position: 'relative',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end', // Aligner le texte SYS.ONLINE avec le bas du titre
  },
  title: {
    color: '#F8FAFC',
    fontSize: 44,
    fontWeight: '900',
    letterSpacing: 10, // Rendu imposant
    textShadowColor: 'rgba(0, 255, 255, 0.4)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 15,
  },
  titleGlitch: {
    position: 'absolute',
    color: '#00FFFF', // Aberration cyan
    opacity: 0,
    zIndex: -1, // Derrière le texte principal
    textShadowRadius: 0,
  },
  rightActions: {
    alignItems: 'flex-end',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 14,
    marginBottom: 8,
  },
  iconButton: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  systemStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8, 
  },
  statusDot: {
    width: 6,
    height: 6,
    backgroundColor: '#00FFFF',
    marginRight: 6,
    shadowColor: '#00FFFF',
    shadowOpacity: 1,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 0 },
  },
  statusText: {
    color: '#00FFFF',
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 2,
    opacity: 0.8,
  },
  // --- RECHERCHE ---
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 2,
    borderLeftWidth: 2,
    height: 55,
    paddingHorizontal: 15,
    position: 'relative',
    // Aucun border radius classique, pour l'aspect angulaire "Tech"
  },
  searchIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '500',
    height: '100%',
    letterSpacing: 0.5,
  },
  // --- ENCOCHES (Détails Asymétriques) ---
  notchTopRight: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 20,
    height: 2,
  },
  notchBottomRight: {
     position: 'absolute',
     bottom: -2, // Recouvre la ligne du bas pour simuler un bord de cadre terminal
     right: 0,
     width: 2,
     height: 12,
  },
  notchTopLeft: {
     position: 'absolute',
     top: 0,
     left: -2, 
     width: 2,
     height: 12,
  }
});
