import React, { useCallback, useState, useEffect, useRef } from 'react';
import { View, TouchableOpacity, Text, StyleSheet, StatusBar, Platform, ScrollView } from 'react-native';
import { useVideoPlayer, VideoView, type VideoSource } from 'expo-video';
import * as NavigationBar from 'expo-navigation-bar';
import { Stream } from '@horus/core';
import LocalVideoProxy from '../modules/local-video-proxy/src/LocalVideoProxyModule';

interface VideoPlayerProps {
  stream: Stream;
  onClose: () => void;
  onError?: () => void;
  errorActionLabel?: string;
  onPlaybackStarted?: () => void;
}

export default function VideoPlayer({
  stream,
  onClose,
  onError,
  errorActionLabel = 'Essayer un autre serveur',
  onPlaybackStarted,
}: VideoPlayerProps) {
  const [hasError, setHasError] = useState(false);
  const [errorDetails, setErrorDetails] = useState('');
  const [areErrorDetailsVisible, setAreErrorDetailsVisible] = useState(false);
  const didNotifyPlaybackRef = useRef(false);
  const onPlaybackStartedRef = useRef(onPlaybackStarted);

  useEffect(() => {
    onPlaybackStartedRef.current = onPlaybackStarted;
  }, [onPlaybackStarted]);

  // Configuration de l'immersion
  useEffect(() => {
    async function enterFullScreen() {
      if (Platform.OS === 'android') {
        // Masquer la barre de navigation (Immersive Mode)
        await NavigationBar.setVisibilityAsync('hidden');
        await NavigationBar.setBehaviorAsync('inset-touch');
      }
    }

    async function exitFullScreen() {
      if (Platform.OS === 'android') {
        // Restaurer la barre de navigation
        await NavigationBar.setVisibilityAsync('visible');
      }
    }

    enterFullScreen();
    return () => {
      exitFullScreen();
    };
  }, []);

  const videoSource: VideoSource = {
    uri: stream.url,
    headers: stream.headers,
    contentType: stream.format === 'hls' ? 'hls' : 'progressive',
  };

  const player = useVideoPlayer(videoSource, (p) => {
    p.play();
  });

  useEffect(() => {
    const statusSubscription = player.addListener('statusChange', (newStatus) => {
      if (newStatus.status === 'error') {
        void (async () => {
          const message = newStatus.error?.message?.trim() ||
            'Le lecteur natif n’a fourni aucun détail supplémentaire.';
          const proxyError = stream.server.startsWith('Proxy local')
            ? await LocalVideoProxy.getLastError().catch(() => null)
            : null;
          let sourceHost = 'inconnu';
          try {
            sourceHost = new URL(stream.url).hostname;
          } catch {
            // The native error remains useful even if the source URI is malformed.
          }
          const details = [
            `Erreur native : ${message}`,
            proxyError ? `Erreur du proxy : ${proxyError}` : null,
            `Serveur : ${stream.server}`,
            `Langue : ${stream.language}`,
            `Format : ${stream.format || 'détection automatique'}`,
            `Hôte : ${sourceHost}`,
          ].filter((detail): detail is string => Boolean(detail)).join('\n');
          console.error('[VideoPlayer] Playback error', {
            server: stream.server,
            language: stream.language,
            format: stream.format,
            sourceHost,
            message,
            proxyError,
          });
          setErrorDetails(details);
          setHasError(true);
        })();
      }
    });
    const playingSubscription = player.addListener('playingChange', ({ isPlaying }) => {
      if (isPlaying && !didNotifyPlaybackRef.current) {
        didNotifyPlaybackRef.current = true;
        onPlaybackStartedRef.current?.();
      }
    });
    return () => {
      statusSubscription.remove();
      playingSubscription.remove();
    };
  }, [player, stream.format, stream.language, stream.server]);

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

      {/* Overlay Header - Uniquement visible si pas d'erreur */}
      {!hasError && (
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
      )}

      {/* Error Overlay */}
      {hasError && (
        <View style={styles.errorOverlay}>
          <Text style={styles.errorEmoji}>⚠️</Text>
          <Text style={styles.errorTitle}>Impossible de lire ce flux</Text>
          <Text style={styles.errorSubtitle}>Le serveur {stream.server} n'a pas répondu correctement.</Text>
          <TouchableOpacity
            onPress={() => setAreErrorDetailsVisible(visible => !visible)}
            style={styles.errorDetailsButton}
          >
            <Text style={styles.errorDetailsButtonText}>
              {areErrorDetailsVisible ? 'Masquer le détail' : 'Voir le détail de l’erreur'}
            </Text>
          </TouchableOpacity>
          {areErrorDetailsVisible && (
            <ScrollView
              style={styles.errorDetailsPanel}
              contentContainerStyle={styles.errorDetailsContent}
            >
              <Text selectable style={styles.errorDetailsText}>
                {errorDetails}
              </Text>
            </ScrollView>
          )}
          <View style={styles.errorButtons}>
            {onError && (
              <TouchableOpacity onPress={handleTryNext} style={styles.tryNextBtn}>
                <Text style={styles.tryNextBtnText}>{errorActionLabel}</Text>
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
    marginBottom: 16,
    lineHeight: 20,
  },
  errorDetailsButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  errorDetailsButtonText: {
    color: '#A78BFA',
    fontSize: 14,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  errorDetailsPanel: {
    width: '100%',
    maxHeight: 160,
    padding: 12,
    marginBottom: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(167, 139, 250, 0.35)',
    backgroundColor: 'rgba(15, 23, 42, 0.95)',
  },
  errorDetailsContent: {
    flexGrow: 1,
  },
  errorDetailsText: {
    color: '#CBD5E1',
    fontSize: 12,
    lineHeight: 17,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
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
