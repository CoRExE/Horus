import React, { useCallback, useState } from 'react';
import { View, TouchableOpacity, Text, StyleSheet, StatusBar } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Stream } from '@horus/core';

interface VideoPlayerProps {
  stream: Stream;
  onClose: () => void;
  onError?: () => void;
}

export default function VideoPlayer({ stream, onClose, onError }: VideoPlayerProps) {
  const [hasError, setHasError] = useState(false);

  const videoSource = stream.headers
    ? { uri: stream.url, headers: stream.headers }
    : stream.url;

  const player = useVideoPlayer(videoSource, (p) => {
    p.play();
  });

  React.useEffect(() => {
    const subscription = player.addListener('statusChange', (newStatus: any) => {
      if (newStatus.status === 'error') {
        setHasError(true);
      }
    });
    return () => { try { subscription.remove(); } catch {} };
  }, [player]);

  const handleClose = useCallback(() => {
    player.pause();
    onClose();
  }, [player, onClose]);

  const handleTryNext = useCallback(() => {
    player.pause();
    if (onError) onError();
  }, [player, onError]);

  return (
    <View style={styles.container}>
      <StatusBar hidden />

      {/* Video */}
      <VideoView
        player={player}
        style={styles.video}
        fullscreenOptions={{ enable: true }}
        allowsPictureInPicture
        nativeControls
      />

      {/* Overlay Header */}
      <View style={styles.overlay}>
        <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
          <Text style={styles.closeBtnText}>✕</Text>
        </TouchableOpacity>
        <View style={styles.streamInfo}>
          <Text style={styles.serverText}>{stream.server}</Text>
          {stream.quality !== 'auto' && stream.quality !== 'unknown' && (
            <View style={styles.qualityBadge}>
              <Text style={styles.qualityText}>{stream.quality}</Text>
            </View>
          )}
        </View>
      </View>

      {/* Error Overlay */}
      {hasError && (
        <View style={styles.errorOverlay}>
          <Text style={styles.errorEmoji}>⚠️</Text>
          <Text style={styles.errorTitle}>Impossible de lire ce flux</Text>
          <Text style={styles.errorSubtitle}>Le serveur {stream.server} n'a pas répondu correctement.</Text>
          <View style={styles.errorButtons}>
            {onError && (
              <TouchableOpacity onPress={handleTryNext} style={styles.tryNextBtn}>
                <Text style={styles.tryNextBtnText}>Essayer un autre serveur</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={handleClose} style={styles.errorCloseBtn}>
              <Text style={styles.errorCloseBtnText}>Fermer</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
  },
  video: {
    width: '100%',
    height: '100%',
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingTop: 50,
    paddingHorizontal: 20,
    paddingBottom: 15,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeBtnText: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: 'bold',
  },
  streamInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  serverText: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 14,
    fontWeight: '600',
  },
  qualityBadge: {
    backgroundColor: '#8B5CF6',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  qualityText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '700',
  },
  // Error overlay
  errorOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  errorEmoji: {
    fontSize: 48,
    marginBottom: 16,
  },
  errorTitle: {
    color: '#FFF',
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 8,
  },
  errorSubtitle: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  errorButtons: {
    gap: 12,
    width: '100%',
  },
  tryNextBtn: {
    backgroundColor: '#8B5CF6',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  tryNextBtnText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
  },
  errorCloseBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  errorCloseBtnText: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 16,
    fontWeight: '600',
  },
});
