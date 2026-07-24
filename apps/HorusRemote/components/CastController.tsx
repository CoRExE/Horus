import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useRemoteMediaClient } from 'react-native-google-cast';
import { Play, Pause, Square } from 'lucide-react-native';
import { MotiView } from 'moti';
import { DlnaDevice } from '../hooks/useDlnaDiscovery';
import { dlnaController } from '../services/dlnaController';

interface CastControllerProps {
  onClose: () => void;
  dlnaDevice?: DlnaDevice | null;
  dlnaTitle?: string;
}

export const CastController: React.FC<CastControllerProps> = ({ onClose, dlnaDevice, dlnaTitle }) => {
  const client = useRemoteMediaClient();
  const [isPlaying, setIsPlaying] = useState(true);
  const [mediaTitle, setMediaTitle] = useState('Chargement...');

  useEffect(() => {
    if (dlnaDevice) {
      setMediaTitle(dlnaTitle || 'Lecture DLNA en cours...');
      setIsPlaying(true);
      return;
    }

    if (!client) return;

    // Fonction pour mettre à jour l'état depuis le client
    const updateState = () => {
      client.getMediaStatus().then((status) => {
        if (status) {
          setIsPlaying(status.playerState === 'playing' || status.playerState === 'buffering');
          if (status.mediaInfo?.metadata?.title) {
            setMediaTitle(status.mediaInfo.metadata.title);
          }
        }
      });
    };

    updateState();

    const subscription = client.onMediaStatusUpdated(() => {
      updateState();
    });

    return () => {
      subscription.remove();
    };
  }, [client, dlnaDevice, dlnaTitle]);

  const handlePlayPause = () => {
    if (dlnaDevice) {
      if (isPlaying) {
        dlnaController.pause(dlnaDevice.controlUrl).catch(console.error);
      } else {
        dlnaController.play(dlnaDevice.controlUrl).catch(console.error);
      }
      setIsPlaying(!isPlaying);
      return;
    }

    if (!client) return;
    if (isPlaying) {
      client.pause();
    } else {
      client.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handleStop = () => {
    if (dlnaDevice) {
      dlnaController.stop(dlnaDevice.controlUrl).catch(console.error);
      onClose();
      return;
    }

    if (!client) return;
    client.stop();
    onClose();
  };

  return (
    <View style={styles.container}>
      {/* Glow Effect / Background animation */}
      <MotiView
        from={{ opacity: 0.3, scale: 0.95 }}
        animate={{ opacity: 0.7, scale: 1 }}
        transition={{ type: 'timing', duration: 2000, loop: true }}
        style={styles.glowBg}
      />

      <View style={styles.content}>
        <Text style={styles.statusLabel}>CASTING SYSTEM ONLINE</Text>
        <Text style={styles.title} numberOfLines={2}>{mediaTitle}</Text>

        <View style={styles.controls}>
          <TouchableOpacity style={styles.controlButton} onPress={handleStop}>
            <Square color="#F8FAFC" size={24} fill="#F8FAFC" />
          </TouchableOpacity>

          <TouchableOpacity style={[styles.controlButton, styles.playButton]} onPress={handlePlayPause}>
            {isPlaying ? (
              <Pause color="#0B0F19" size={32} fill="#0B0F19" />
            ) : (
              <Play color="#0B0F19" size={32} fill="#0B0F19" />
            )}
          </TouchableOpacity>
          
          {/* Placeholder pour équilibrer, ou bouton retour arrière */}
          <View style={{ width: 60 }} />
        </View>

        <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
          <Text style={styles.closeBtnText}>RÉDUIRE LA TÉLÉCOMMANDE</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B0F19',
    justifyContent: 'center',
    alignItems: 'center',
  },
  glowBg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(139, 92, 246, 0.1)', // Purple glow
  },
  content: {
    width: '85%',
    backgroundColor: '#1A1F2E',
    borderRadius: 24,
    padding: 30,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#8B5CF6',
    shadowColor: '#8B5CF6',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
  },
  statusLabel: {
    color: '#00FFFF',
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 3,
    marginBottom: 20,
  },
  title: {
    color: '#F8FAFC',
    fontSize: 22,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 40,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 30,
    marginBottom: 40,
  },
  controlButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  playButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#00FFFF',
    shadowColor: '#00FFFF',
    shadowOpacity: 0.8,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 0 },
  },
  closeBtn: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  closeBtnText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
});
