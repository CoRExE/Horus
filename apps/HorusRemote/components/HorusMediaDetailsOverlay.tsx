import React from 'react';
import { View, Text, Image, StyleSheet, Modal, Pressable, TouchableOpacity } from 'react-native';
import { MotiView } from 'moti';
import { Bookmark } from 'lucide-react-native';
import { useUserStore, MediaItem } from '../store/useUserStore';

export interface HorusMediaDetailsOverlayProps {
  visible: boolean;
  onClose: () => void;
  media: MediaItem;
  onInitStream: () => void;
}

const COLOR_OVERLAY = 'rgba(11, 15, 25, 0.85)';
const COLOR_PANEL = '#131A2A';
const COLOR_BORDER = '#1E293B';
const COLOR_ACCENT_CYAN = '#00FFFF';
const COLOR_ACCENT_PURPLE = '#8B5CF6';
const COLOR_TEXT = '#F8FAFC';

export const HorusMediaDetailsOverlay: React.FC<HorusMediaDetailsOverlayProps> = ({
  visible,
  onClose,
  media,
  onInitStream,
}) => {
  const toggleWishlist = useUserStore((state) => state.toggleWishlist);
  const addToHistory = useUserStore((state) => state.addToHistory);
  const wishlist = useUserStore((state) => state.wishlist);

  // Sécurité si media est indéfini
  if (!media) return null;

  const isInWishlist = wishlist.some((item) => item.id === media.id);

  const handleInitStream = () => {
    addToHistory(media);
    onInitStream();
  };

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="none" // On court-circuite l'animation native
      onRequestClose={onClose}
    >
      {/* 1. L'arrière-plan "Defocus" */}
      <MotiView
        style={styles.overlay}
        from={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ type: 'timing', duration: 150 }} 
      >
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />
      </MotiView>

      {/* 2. Le Panel de Détails (Focus) */}
      <View style={styles.centerContainer} pointerEvents="box-none">
        
        {/* 3. Le "Flicker Transition" sur le Panel */}
        <MotiView
          style={styles.panel}
          from={{ opacity: 0, scale: 0.95 }}
          animate={{
            opacity: [0, 0.8, 0.2, 1, 0.5, 1],
            scale: [0.95, 1.03, 0.98, 1.01, 1],
          }}
          transition={{ 
            type: 'timing', 
            duration: 180,   
          }}
        >
          <View style={styles.notchTopLeft} pointerEvents="none" />
          <View style={styles.notchBottomRight} pointerEvents="none" />

          <View style={styles.content}>
            {media.imageUrl ? (
              <Image source={{ uri: media.imageUrl }} style={styles.image} />
            ) : (
              <View style={styles.imagePlaceholder}>
                <Text style={{ color: '#475569', letterSpacing: 2 }}>NO SIGNAL</Text>
              </View>
            )}

            <Text style={styles.title} numberOfLines={2}>
              {media.title}
            </Text>

            <View style={styles.actionsContainer}>
              <TouchableOpacity 
                style={styles.actionButton} 
                activeOpacity={0.7} 
                onPress={handleInitStream}
              >
                <Text style={styles.actionButtonText}>INITIALIZE STREAM</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[
                  styles.wishlistButton,
                  isInWishlist && styles.wishlistButtonActive
                ]}
                activeOpacity={0.7}
                onPress={() => toggleWishlist(media)}
              >
                <Bookmark 
                  color={isInWishlist ? COLOR_ACCENT_PURPLE : COLOR_ACCENT_CYAN} 
                  fill={isInWishlist ? COLOR_ACCENT_PURPLE : 'transparent'}
                  size={24}
                />
              </TouchableOpacity>
            </View>
          </View>
        </MotiView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: COLOR_OVERLAY,
  },
  centerContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    zIndex: 10,
  },
  panel: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: COLOR_PANEL,
    borderWidth: 1,
    borderColor: COLOR_BORDER,
    position: 'relative',
  },
  content: {
    padding: 25,
    alignItems: 'center',
  },
  notchTopLeft: {
    position: 'absolute',
    top: -1,
    left: -1,
    width: 25,
    height: 25,
    borderTopWidth: 2,
    borderLeftWidth: 2,
    borderColor: COLOR_ACCENT_CYAN,
    zIndex: 20,
  },
  notchBottomRight: {
    position: 'absolute',
    bottom: -1,
    right: -1,
    width: 25,
    height: 25,
    borderBottomWidth: 2,
    borderRightWidth: 2,
    borderColor: COLOR_ACCENT_CYAN,
    zIndex: 20,
  },
  image: {
    width: 220,
    height: 330,
    resizeMode: 'cover',
    marginBottom: 20,
    borderColor: COLOR_BORDER,
    borderWidth: 1,
  },
  imagePlaceholder: {
    width: 220,
    height: 330,
    backgroundColor: '#1E293B',
    marginBottom: 20,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLOR_BORDER,
  },
  title: {
    color: COLOR_TEXT,
    fontSize: 22,
    fontWeight: 'bold',
    textAlign: 'center',
    letterSpacing: 0.5,
    marginBottom: 30,
  },
  actionsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    gap: 12,
  },
  actionButton: {
    flex: 1,
    backgroundColor: 'rgba(139, 92, 246, 0.1)', 
    borderWidth: 1,
    borderColor: COLOR_ACCENT_PURPLE,
    paddingVertical: 16,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButtonText: {
    color: COLOR_ACCENT_PURPLE,
    fontSize: 14,
    fontWeight: 'bold',
    letterSpacing: 2,
  },
  wishlistButton: {
    width: 52,
    height: 52,
    borderWidth: 1,
    borderColor: COLOR_ACCENT_CYAN,
    backgroundColor: 'rgba(0, 255, 255, 0.05)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  wishlistButtonActive: {
    borderColor: COLOR_ACCENT_PURPLE,
    backgroundColor: 'rgba(139, 92, 246, 0.1)',
  },
});
