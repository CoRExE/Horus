import React from 'react';
import { View, Text, Image, StyleSheet, Pressable } from 'react-native';
import { MotiView } from 'moti';

export interface HorusMediaCardProps {
  title: string;
  subtitle?: string; // Type de média (ex: 'anime', 'movie')
  highlightText?: string; // Text to highlight, ex: episode name
  imageUrl?: string;
  index: number;
  onPress: () => void;
  onLongPress?: () => void;
}

const CARD_IMAGE_HEIGHT = 220; // Utilisé pour définir l'amplitude du balayage

export const HorusMediaCard: React.FC<HorusMediaCardProps> = ({ 
  title, 
  subtitle, 
  highlightText,
  imageUrl, 
  index, 
  onPress,
  onLongPress,
}) => {
  return (
    <MotiView
      style={styles.container}
      from={{ opacity: 0, translateY: 30 }}
      animate={{ opacity: 1, translateY: 0 }}
      transition={{ 
        type: 'spring', 
        damping: 18, 
        stiffness: 90, 
        // L'index crée un effet cascade (stagger). On limite le délai à 1200ms pour l'UX.
        delay: Math.min(index * 80, 1200) 
      }}
    >
      <Pressable 
        onPress={onPress} 
        onLongPress={onLongPress}
        style={({ pressed }) => [
          styles.pressableBlock, 
          pressed && styles.pressedStyle
        ]}
      >
        
        {/* -- Conteneur Visuel (Image + Scanner) -- */}
        <View style={styles.imageContainer}>
          {imageUrl ? (
            <Image source={{ uri: imageUrl }} style={styles.image} />
          ) : (
            <View style={styles.placeholder}>
               <Text style={styles.placeholderText}>NO DATA</Text>
            </View>
          )}

          {/* Calque Overlay pour accentuer le côté Interface Virtuelle */}
          <View style={styles.screenOverlay} pointerEvents="none" />

          {/* Data Scanner (Aller-retour unique sans boucle) */}
          <MotiView
            style={styles.scannerLine}
            from={{ translateY: -10, opacity: 0 }}
            animate={{ 
              translateY: [-10, CARD_IMAGE_HEIGHT + 10, -10],
              opacity: [1, 1, 0] // S'estompe à la fin pour disparaître
            }} 
            transition={{
              type: 'timing',
              duration: 2500, // Vitesse du scan
              delay: (index % 5) * 300, 
            }}
            pointerEvents="none"
          />
        </View>

        {/* -- Méta-données textuelles -- */}
        <View style={styles.infoContainer}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <View style={styles.subtitleRow}>
            {subtitle && (
               <Text style={styles.subtitle} numberOfLines={1}>
                 {subtitle.toUpperCase()}
               </Text>
            )}
            {highlightText && (
               <Text style={[styles.subtitle, styles.highlightText]} numberOfLines={1}>
                 {highlightText.toUpperCase()}
               </Text>
            )}
          </View>
        </View>

        {/* -- Encoches asymétriques Cyberpunk -- */}
        <View style={styles.notchTopRight} pointerEvents="none" />
        <View style={styles.notchBottomLeft} pointerEvents="none" />

      </Pressable>
    </MotiView>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '48%', // Assure l'affichage en 2 colonnes dans la Grid
    marginBottom: 15,
  },
  pressableBlock: {
    backgroundColor: '#131A2A', // Fond un poil plus clair que le fond global (#0B0F19)
    borderColor: '#1E293B',
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
    // Aucun border-radius classique !
  },
  pressedStyle: {
    opacity: 0.6,
    borderColor: '#8B5CF6', // Highlight violet (focus action utilisateur) au tap
  },
  imageContainer: {
    height: CARD_IMAGE_HEIGHT,
    width: '100%',
    position: 'relative',
    backgroundColor: '#1E293B', 
  },
  image: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
    opacity: 0.8, // Lisse l'image et la fond mieux dans le thème sombre
  },
  placeholder: {
    width: '100%',
    height: '100%',
    backgroundColor: '#1E293B',
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderText: {
    color: '#475569',
    fontSize: 12,
    letterSpacing: 2,
    fontWeight: 'bold',
  },
  screenOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 255, 255, 0.03)', // Teinte bleutée très subtile omniprésente
  },
  scannerLine: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: '#00FFFF',
    shadowColor: '#00FFFF',
    shadowOffset: { width: 0, height: 2 }, // Donne une impression d'éclairage
    shadowOpacity: 1,
    shadowRadius: 5,
    zIndex: 10,
  },
  infoContainer: {
    padding: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0, 255, 255, 0.15)', // Ligne de séparation interne
    backgroundColor: '#131A2A',
  },
  title: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: 'bold',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  subtitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  subtitle: {
    color: '#00FFFF',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    flex: 1,
  },
  highlightText: {
    color: '#8B5CF6',
    textAlign: 'right',
  },
  // --- Encoches Graphiques Accent / Scan ---
  notchTopRight: {
     position: 'absolute',
     top: -1,
     right: -1,
     width: 15,
     height: 15,
     borderTopWidth: 2,
     borderRightWidth: 2,
     borderColor: '#00FFFF',
     zIndex: 20,
  },
  notchBottomLeft: {
     position: 'absolute',
     bottom: -1,
     left: -1,
     width: 15,
     height: 15,
     borderBottomWidth: 2,
     borderLeftWidth: 2,
     borderColor: '#00FFFF',
     zIndex: 20,
  }
});
