import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  GestureResponderEvent,
  LayoutChangeEvent,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRemoteMediaClient } from 'react-native-google-cast';
import {
  FastForward,
  Minus,
  Pause,
  Play,
  Plus,
  Rewind,
  SkipBack,
  SkipForward,
  Square,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react-native';
import { MotiView } from 'moti';
import { formatPlaybackTime, selectPlaybackDuration } from '@horus/core';
import { DlnaDevice } from '../hooks/useDlnaDiscovery';
import { dlnaController, DlnaTransportState } from '../services/dlnaController';

interface CastControllerProps {
  onClose: () => void;
  onStopped?: () => void;
  onRequestDisconnect?: () => void;
  dlnaDevice?: DlnaDevice | null;
  dlnaTitle?: string;
  canSeek?: boolean;
  expectedDurationSeconds?: number;
  playbackNotice?: string;
  hasPreviousEpisode?: boolean;
  hasNextEpisode?: boolean;
  isChangingEpisode?: boolean;
  onPreviousEpisode?: () => void;
  onNextEpisode?: () => void;
}

const isPlayingState = (state: DlnaTransportState) =>
  state === 'PLAYING' || state === 'TRANSITIONING';

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

export const CastController: React.FC<CastControllerProps> = ({
  onClose,
  onStopped,
  onRequestDisconnect,
  dlnaDevice,
  dlnaTitle,
  canSeek = true,
  expectedDurationSeconds,
  playbackNotice,
  hasPreviousEpisode = false,
  hasNextEpisode = false,
  isChangingEpisode = false,
  onPreviousEpisode,
  onNextEpisode,
}) => {
  const client = useRemoteMediaClient();
  const [isPlaying, setIsPlaying] = useState(true);
  const [mediaTitle, setMediaTitle] = useState('Chargement...');
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(50);
  const [isMuted, setIsMuted] = useState(false);
  const [progressWidth, setProgressWidth] = useState(1);
  const [seekPreview, setSeekPreview] = useState<number | null>(null);
  const [isCommandPending, setIsCommandPending] = useState(false);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [transportState, setTransportState] = useState<DlnaTransportState>('UNKNOWN');

  useEffect(() => {
    setMediaTitle(dlnaDevice ? (dlnaTitle || 'Lecture DLNA en cours...') : 'Chargement...');
  }, [dlnaDevice, dlnaTitle]);

  useEffect(() => {
    if (!dlnaDevice) return;

    let cancelled = false;
    let refreshInProgress = false;

    const refreshDlnaStatus = async () => {
      if (refreshInProgress) return;
      refreshInProgress = true;
      try {
        const status = await dlnaController.getPlaybackStatus(
          dlnaDevice.controlUrl,
          dlnaDevice.renderingControlUrl
        );
        if (cancelled) return;
        setTransportState(status.transportState);
        setIsPlaying(isPlayingState(status.transportState));
        setPosition(status.positionSeconds);
        setDuration(selectPlaybackDuration(
          expectedDurationSeconds,
          status.durationSeconds,
          canSeek
        ));
        if (status.volume !== undefined) setVolume(status.volume);
        if (status.muted !== undefined) setIsMuted(status.muted);
        setCommandError(null);
      } catch {
        if (!cancelled) setCommandError('Téléviseur momentanément injoignable');
      } finally {
        refreshInProgress = false;
      }
    };

    void refreshDlnaStatus();
    const interval = setInterval(() => void refreshDlnaStatus(), 2_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [canSeek, dlnaDevice, expectedDurationSeconds]);

  useEffect(() => {
    if (dlnaDevice || !client) return;

    const applyCastStatus = (
      status: Awaited<ReturnType<typeof client.getMediaStatus>>
    ) => {
      if (!status) return;
      setIsPlaying(status.playerState === 'playing' || status.playerState === 'buffering');
      setPosition(status.streamPosition || 0);
      setVolume(Math.round((status.volume ?? 0.5) * 100));
      setIsMuted(status.isMuted);
      if (status.mediaInfo?.metadata?.title) {
        setMediaTitle(status.mediaInfo.metadata.title);
      }
    };

    void client.getMediaStatus().then(applyCastStatus);
    const statusSubscription = client.onMediaStatusUpdated(applyCastStatus);
    const progressSubscription = client.onMediaProgressUpdated((progress, total) => {
      setPosition(progress);
      setDuration(total);
    }, 1_000);

    return () => {
      statusSubscription.remove();
      progressSubscription.remove();
    };
  }, [client, dlnaDevice]);

  const runCommand = async (command: () => Promise<void>, errorMessage: string) => {
    if (isCommandPending) return;
    setIsCommandPending(true);
    setCommandError(null);
    try {
      await command();
    } catch (error) {
      console.error(error);
      setCommandError(errorMessage);
    } finally {
      setIsCommandPending(false);
    }
  };

  const handlePlayPause = () => {
    void runCommand(async () => {
      if (dlnaDevice) {
        if (isPlaying) {
          await dlnaController.pause(dlnaDevice.controlUrl);
        } else {
          await dlnaController.play(dlnaDevice.controlUrl);
        }
      } else if (client) {
        if (isPlaying) {
          await client.pause();
        } else {
          await client.play();
        }
      }
      setIsPlaying(!isPlaying);
    }, 'Impossible de modifier la lecture');
  };

  const handleStop = () => {
    void runCommand(async () => {
      if (dlnaDevice) {
        await dlnaController.stop(dlnaDevice.controlUrl);
      } else if (client) {
        await client.stop();
      }
      onStopped?.();
      onClose();
    }, 'Impossible d’arrêter la lecture');
  };

  const seekTo = (targetPosition: number) => {
    if (!canSeek) {
      setCommandError('Déplacement indisponible pour ce flux HLS en DLNA');
      return;
    }
    const maximum = duration > 0 ? duration : Number.MAX_SAFE_INTEGER;
    const nextPosition = clamp(targetPosition, 0, maximum);
    void runCommand(async () => {
      if (dlnaDevice) {
        await dlnaController.seek(dlnaDevice.controlUrl, nextPosition);
      } else if (client) {
        await client.seek({ position: nextPosition });
      }
      setPosition(nextPosition);
    }, 'Ce téléviseur ne permet pas le déplacement dans la vidéo');
  };

  const previewProgress = (event: GestureResponderEvent) => {
    if (!canSeek || duration <= 0) return;
    const ratio = clamp(event.nativeEvent.locationX / progressWidth, 0, 1);
    setSeekPreview(duration * ratio);
  };

  const commitProgress = (event: GestureResponderEvent) => {
    if (!canSeek || duration <= 0) return;
    const ratio = clamp(event.nativeEvent.locationX / progressWidth, 0, 1);
    const target = duration * ratio;
    setSeekPreview(null);
    seekTo(target);
  };

  const handleProgressLayout = (event: LayoutChangeEvent) => {
    setProgressWidth(Math.max(1, event.nativeEvent.layout.width));
  };

  const changeVolume = (nextVolume: number) => {
    const normalizedVolume = clamp(nextVolume, 0, 100);
    void runCommand(async () => {
      if (dlnaDevice?.renderingControlUrl) {
        await dlnaController.setVolume(dlnaDevice.renderingControlUrl, normalizedVolume);
      } else if (!dlnaDevice && client) {
        await client.setStreamVolume(normalizedVolume / 100);
      } else {
        throw new Error('Volume control unavailable');
      }
      setVolume(normalizedVolume);
      if (normalizedVolume > 0) setIsMuted(false);
    }, 'Contrôle du volume indisponible sur cet appareil');
  };

  const toggleMute = () => {
    const nextMuted = !isMuted;
    void runCommand(async () => {
      if (dlnaDevice?.renderingControlUrl) {
        await dlnaController.setMuted(dlnaDevice.renderingControlUrl, nextMuted);
      } else if (!dlnaDevice && client) {
        await client.setStreamMuted(nextMuted);
      } else {
        throw new Error('Mute control unavailable');
      }
      setIsMuted(nextMuted);
    }, 'Contrôle de la sourdine indisponible');
  };

  const canControlVolume = Boolean(!dlnaDevice || dlnaDevice.renderingControlUrl);
  const displayedPosition = seekPreview ?? position;
  const progress = duration > 0 ? clamp(displayedPosition / duration, 0, 1) : 0;
  const sourceLabel = dlnaDevice
    ? `DLNA • ${dlnaDevice.name}`
    : 'GOOGLE CAST';
  const stateLabel = dlnaDevice && transportState === 'STOPPED'
    ? 'ARRÊTÉ'
    : dlnaDevice && transportState === 'NO_MEDIA_PRESENT'
      ? 'AUCUN MÉDIA'
      : transportState === 'TRANSITIONING'
        ? 'CHARGEMENT'
        : isPlaying
          ? 'EN LECTURE'
          : 'EN PAUSE';

  return (
    <View style={styles.container}>
      <MotiView
        from={{ opacity: 0.25, scale: 0.98 }}
        animate={{ opacity: 0.65, scale: 1 }}
        transition={{ type: 'timing', duration: 2_000, loop: true }}
        style={styles.glowBg}
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.content}>
          <View style={styles.topBar}>
            <View>
              <Text style={styles.statusLabel}>{sourceLabel}</Text>
              <Text style={styles.stateLabel}>{stateLabel}</Text>
            </View>
            <TouchableOpacity style={styles.iconButtonSmall} onPress={onClose}>
              <X color="#94A3B8" size={20} />
            </TouchableOpacity>
          </View>

          <Text style={styles.title} numberOfLines={3}>{mediaTitle}</Text>

          <View style={styles.timeline}>
            <View
              style={styles.progressTrack}
              onLayout={handleProgressLayout}
              onStartShouldSetResponder={() => canSeek && duration > 0}
              onMoveShouldSetResponder={() => canSeek && duration > 0}
              onResponderGrant={previewProgress}
              onResponderMove={previewProgress}
              onResponderRelease={commitProgress}
              onResponderTerminate={() => setSeekPreview(null)}
            >
              <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
              <View style={[styles.progressThumb, { left: `${progress * 100}%` }]} />
            </View>
            <View style={styles.timeRow}>
              <Text style={styles.timeText}>{formatPlaybackTime(displayedPosition)}</Text>
              <Text style={styles.timeText}>
                {duration > 0 ? formatPlaybackTime(duration) : '--:--'}
              </Text>
            </View>
          </View>

          <View style={styles.seekControls}>
            <TouchableOpacity
              style={[styles.secondaryControl, !canSeek && styles.disabled]}
              onPress={() => seekTo(position - 10)}
              disabled={isCommandPending || !canSeek}
            >
              <Rewind color="#F8FAFC" size={24} />
              <Text style={styles.seekLabel}>10s</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.playButton, isCommandPending && styles.disabled]}
              onPress={handlePlayPause}
              disabled={isCommandPending}
            >
              {isCommandPending ? (
                <ActivityIndicator color="#0B0F19" />
              ) : isPlaying ? (
                <Pause color="#0B0F19" size={34} fill="#0B0F19" />
              ) : (
                <Play color="#0B0F19" size={34} fill="#0B0F19" />
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.secondaryControl, !canSeek && styles.disabled]}
              onPress={() => seekTo(position + 10)}
              disabled={isCommandPending || !canSeek}
            >
              <FastForward color="#F8FAFC" size={24} />
              <Text style={styles.seekLabel}>10s</Text>
            </TouchableOpacity>
          </View>

          {(hasPreviousEpisode || hasNextEpisode) && (
            <View style={styles.episodeControls}>
              <TouchableOpacity
                style={[
                  styles.episodeButton,
                  (!hasPreviousEpisode || isChangingEpisode) && styles.disabled,
                ]}
                onPress={onPreviousEpisode}
                disabled={!hasPreviousEpisode || isChangingEpisode}
              >
                <SkipBack color="#00FFFF" size={20} />
                <Text style={styles.episodeButtonText}>PRÉCÉDENT</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.episodeButton,
                  (!hasNextEpisode || isChangingEpisode) && styles.disabled,
                ]}
                onPress={onNextEpisode}
                disabled={!hasNextEpisode || isChangingEpisode}
              >
                {isChangingEpisode ? (
                  <ActivityIndicator size="small" color="#00FFFF" />
                ) : (
                  <SkipForward color="#00FFFF" size={20} />
                )}
                <Text style={styles.episodeButtonText}>SUIVANT</Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={[styles.volumeCard, !canControlVolume && styles.disabled]}>
            <TouchableOpacity
              style={styles.volumeIcon}
              onPress={toggleMute}
              disabled={!canControlVolume || isCommandPending}
            >
              {isMuted || volume === 0 ? (
                <VolumeX color="#F8FAFC" size={23} />
              ) : (
                <Volume2 color="#F8FAFC" size={23} />
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.volumeStep}
              onPress={() => changeVolume(volume - 5)}
              disabled={!canControlVolume || isCommandPending}
            >
              <Minus color="#94A3B8" size={18} />
            </TouchableOpacity>
            <View style={styles.volumeTrack}>
              <View style={[styles.volumeFill, { width: `${isMuted ? 0 : volume}%` }]} />
            </View>
            <Text style={styles.volumeText}>{isMuted ? 0 : volume}%</Text>
            <TouchableOpacity
              style={styles.volumeStep}
              onPress={() => changeVolume(volume + 5)}
              disabled={!canControlVolume || isCommandPending}
            >
              <Plus color="#94A3B8" size={18} />
            </TouchableOpacity>
          </View>

          {!canControlVolume && (
            <Text style={styles.hintText}>
              Le téléviseur n’expose pas de contrôle de volume DLNA.
            </Text>
          )}
          {!canSeek && (
            <Text style={styles.hintText}>
              {playbackNotice || 'Le déplacement temporel n’est pas disponible pour ce média.'}
            </Text>
          )}
          {commandError && <Text style={styles.errorText}>{commandError}</Text>}

          <TouchableOpacity
            style={[styles.stopButton, isCommandPending && styles.disabled]}
            onPress={handleStop}
            disabled={isCommandPending}
          >
            <Square color="#F87171" size={18} fill="#F87171" />
            <Text style={styles.stopButtonText}>ARRÊTER LA DIFFUSION</Text>
          </TouchableOpacity>

          {onRequestDisconnect && (
            <TouchableOpacity
              style={styles.disconnectButton}
              onPress={onRequestDisconnect}
              disabled={isCommandPending}
            >
              <Text style={styles.disconnectButtonText}>DÉCONNECTER L’APPAREIL</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B0F19',
  },
  glowBg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(139, 92, 246, 0.1)',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 32,
  },
  content: {
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    backgroundColor: '#131A2A',
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: '#8B5CF6',
    shadowColor: '#8B5CF6',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 18,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  statusLabel: {
    color: '#00FFFF',
    fontSize: 11,
    fontWeight: 'bold',
    letterSpacing: 2,
  },
  stateLabel: {
    color: '#64748B',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginTop: 5,
  },
  iconButtonSmall: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  title: {
    color: '#F8FAFC',
    fontSize: 23,
    fontWeight: 'bold',
    lineHeight: 30,
    marginTop: 28,
    marginBottom: 30,
  },
  timeline: {
    marginBottom: 28,
  },
  progressTrack: {
    height: 18,
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  progressFill: {
    position: 'absolute',
    left: 0,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#00FFFF',
  },
  progressThumb: {
    position: 'absolute',
    width: 14,
    height: 14,
    marginLeft: -7,
    borderRadius: 7,
    backgroundColor: '#F8FAFC',
    borderWidth: 3,
    borderColor: '#00FFFF',
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  timeText: {
    color: '#94A3B8',
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  seekControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 28,
    marginBottom: 28,
  },
  secondaryControl: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: 'rgba(255,255,255,0.07)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  seekLabel: {
    color: '#94A3B8',
    fontSize: 9,
    fontWeight: '700',
    marginTop: -2,
  },
  playButton: {
    width: 78,
    height: 78,
    borderRadius: 39,
    backgroundColor: '#00FFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#00FFFF',
    shadowOpacity: 0.6,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
  },
  episodeControls: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 20,
  },
  episodeButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,255,255,0.3)',
    backgroundColor: 'rgba(0,255,255,0.06)',
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  episodeButtonText: {
    color: '#00FFFF',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  volumeCard: {
    minHeight: 58,
    borderRadius: 14,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255,255,255,0.05)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  volumeIcon: {
    width: 32,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  volumeStep: {
    width: 30,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  volumeTrack: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#334155',
    overflow: 'hidden',
  },
  volumeFill: {
    height: '100%',
    backgroundColor: '#8B5CF6',
  },
  volumeText: {
    width: 38,
    color: '#CBD5E1',
    fontSize: 11,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  hintText: {
    color: '#64748B',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 8,
    textAlign: 'center',
  },
  errorText: {
    color: '#FCA5A5',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 12,
    textAlign: 'center',
  },
  stopButton: {
    minHeight: 48,
    marginTop: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.35)',
    backgroundColor: 'rgba(248,113,113,0.06)',
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopButtonText: {
    color: '#F87171',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
  },
  disconnectButton: {
    minHeight: 40,
    marginTop: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disconnectButtonText: {
    color: '#64748B',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.9,
  },
  disabled: {
    opacity: 0.35,
  },
});
