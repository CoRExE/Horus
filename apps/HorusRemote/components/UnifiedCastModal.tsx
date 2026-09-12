import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView, ActivityIndicator } from 'react-native';
import { useDevices, CastContext } from 'react-native-google-cast';
import { useDlnaDiscovery, DlnaDevice } from '../hooks/useDlnaDiscovery';
import { Download, Monitor, Radio, Tv, X, RefreshCw, Terminal } from 'lucide-react-native';

export type RemoteDeliveryMode = 'direct' | 'cache';
export type RemoteCacheQuality = 720 | 1080;

interface UnifiedCastModalProps {
  visible: boolean;
  onClose: () => void;
  onSelectCast: (mode: RemoteDeliveryMode, quality: RemoteCacheQuality) => void;
  onSelectDlna: (
    device: DlnaDevice,
    mode: RemoteDeliveryMode,
    quality: RemoteCacheQuality
  ) => void;
}

export const UnifiedCastModal: React.FC<UnifiedCastModalProps> = ({
  visible,
  onClose,
  onSelectCast,
  onSelectDlna,
}) => {
  // Découverte Chromecast
  const castDevices = useDevices();

  // Découverte DLNA
  const { devices: dlnaDevices, isSearching, startDiscovery, logs } = useDlnaDiscovery();
  const [showDebug, setShowDebug] = useState(false);
  const [deliveryMode, setDeliveryMode] = useState<RemoteDeliveryMode>('direct');
  const [cacheQuality, setCacheQuality] = useState<RemoteCacheQuality>(720);

  useEffect(() => {
    if (visible) {
      startDiscovery();
    }
  }, [visible, startDiscovery]);

  const handleCastSelect = (deviceId: string) => {
    onSelectCast(deliveryMode, cacheQuality);
    CastContext.getSessionManager().startSession(deviceId).catch(console.error);
    onClose();
  };

  const handleDlnaSelect = (device: DlnaDevice) => {
    onSelectDlna(device, deliveryMode, cacheQuality);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={true} onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.modalContent}>

          <View style={styles.header}>
            <Text style={styles.title}>Cast & DLNA</Text>
            <View style={styles.headerActions}>
              <TouchableOpacity
                onPress={() => setShowDebug(!showDebug)}
                style={[styles.refreshBtn, showDebug && { backgroundColor: 'rgba(0, 255, 255, 0.2)' }]}
              >
                <Terminal color="#00FFFF" size={20} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={startDiscovery}
                style={[styles.refreshBtn, isSearching && styles.refreshBtnDisabled]}
                disabled={isSearching}
              >
                <RefreshCw color={isSearching ? '#475569' : '#00FFFF'} size={20} />
              </TouchableOpacity>
              <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                <X color="#F8FAFC" size={24} />
              </TouchableOpacity>
            </View>
          </View>

          {isSearching && (
            <View style={styles.searchingContainer}>
              <ActivityIndicator color="#00FFFF" />
              <Text style={styles.searchingText}>Recherche d'appareils sur le réseau local...</Text>
            </View>
          )}

          {!showDebug && (
            <View style={styles.modeSection}>
              <Text style={styles.sectionTitle}>Mode de diffusion</Text>
              <View style={styles.modeRow}>
                <TouchableOpacity
                  style={[
                    styles.modeButton,
                    deliveryMode === 'direct' && styles.modeButtonActive,
                  ]}
                  onPress={() => setDeliveryMode('direct')}
                >
                  <Radio
                    color={deliveryMode === 'direct' ? '#00FFFF' : '#64748B'}
                    size={22}
                  />
                  <Text style={styles.modeButtonTitle}>Immédiat</Text>
                  <Text style={styles.modeButtonText}>Démarre sans attendre</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.modeButton,
                    deliveryMode === 'cache' && styles.modeButtonActive,
                  ]}
                  onPress={() => setDeliveryMode('cache')}
                >
                  <Download
                    color={deliveryMode === 'cache' ? '#00FFFF' : '#64748B'}
                    size={22}
                  />
                  <Text style={styles.modeButtonTitle}>Téléchargement complet</Text>
                  <Text style={styles.modeButtonText}>Lecture TV stabilisée</Text>
                </TouchableOpacity>
              </View>
              {deliveryMode === 'cache' && (
                <View style={styles.qualitySection}>
                  <Text style={styles.sectionTitle}>Qualité du téléchargement</Text>
                  <View style={styles.modeRow}>
                    <TouchableOpacity
                      style={[
                        styles.qualityButton,
                        cacheQuality === 720 && styles.modeButtonActive,
                      ]}
                      onPress={() => setCacheQuality(720)}
                    >
                      <Text style={styles.modeButtonTitle}>720p rapide</Text>
                      <Text style={styles.modeButtonText}>Moins lourd et plus rapide</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.qualityButton,
                        cacheQuality === 1080 && styles.modeButtonActive,
                      ]}
                      onPress={() => setCacheQuality(1080)}
                    >
                      <Text style={styles.modeButtonTitle}>1080p maximale</Text>
                      <Text style={styles.modeButtonText}>Plus net, téléchargement plus long</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
          )}

          {showDebug ? (
            <View style={styles.debugContainer}>
              <View style={styles.debugHeader}>
                <Text style={styles.debugTitle}>Logs de Découverte (Debug)</Text>
                <TouchableOpacity onPress={() => setShowDebug(false)}>
                  <Text style={styles.debugCloseText}>Fermer</Text>
                </TouchableOpacity>
              </View>
              <ScrollView style={styles.debugScroll} nestedScrollEnabled={true}>
                {logs.length === 0 ? (
                  <Text style={styles.debugLogLine}>Aucun log disponible pour le moment.</Text>
                ) : (
                  logs.map((log, index) => (
                    <Text
                      key={index}
                      style={[
                        styles.debugLogLine,
                        log.includes('Error') || log.includes('Failed') ? styles.debugLogLineError : null,
                        log.includes('successful') || log.includes('Discovered') ? styles.debugLogLineSuccess : null
                      ]}
                    >
                      {log}
                    </Text>
                  ))
                )}
              </ScrollView>
            </View>
          ) : (
            <ScrollView style={styles.listContainer}>
              {/* Google Cast Devices */}
              {castDevices.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Google Cast</Text>
                  {castDevices.map((device) => (
                    <TouchableOpacity
                      key={device.deviceId}
                      style={styles.deviceItem}
                      onPress={() => handleCastSelect(device.deviceId)}
                    >
                      <View style={styles.iconContainer}>
                        <Monitor color="#8B5CF6" size={24} />
                      </View>
                      <View style={styles.deviceInfo}>
                        <Text style={styles.deviceName}>{device.friendlyName}</Text>
                        <Text style={styles.deviceType}>Chromecast</Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {/* DLNA / UPnP Devices */}
              {dlnaDevices.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Appareils DLNA / Box TV</Text>
                  {dlnaDevices.map((device) => (
                    <TouchableOpacity
                      key={device.id}
                      style={styles.deviceItem}
                      onPress={() => handleDlnaSelect(device)}
                    >
                      <View style={styles.iconContainer}>
                        <Tv color="#00FFFF" size={24} />
                      </View>
                      <View style={styles.deviceInfo}>
                        <Text style={styles.deviceName}>{device.name}</Text>
                        <Text style={styles.deviceType}>DLNA • {device.ip}</Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {!isSearching && castDevices.length === 0 && dlnaDevices.length === 0 && (
                <View style={styles.emptyContainer}>
                  <Text style={styles.emptyText}>Aucun appareil détecté.</Text>
                  <Text style={styles.emptySubtext}>Assurez-vous d'être sur le même réseau WiFi que votre TV ou Box.</Text>
                  <TouchableOpacity onPress={startDiscovery} style={styles.retryBtn}>
                    <RefreshCw color="#00FFFF" size={18} />
                    <Text style={styles.retryText}>Réessayer</Text>
                  </TouchableOpacity>
                </View>
              )}
            </ScrollView>
          )}

        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#1A1F2E',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    maxHeight: '80%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  title: {
    color: '#F8FAFC',
    fontSize: 20,
    fontWeight: 'bold',
  },
  refreshBtn: {
    padding: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(0, 255, 255, 0.08)',
  },
  refreshBtnDisabled: {
    opacity: 0.4,
  },
  closeBtn: {
    padding: 4,
  },
  searchingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 255, 255, 0.1)',
    padding: 12,
    borderRadius: 12,
    marginBottom: 20,
  },
  searchingText: {
    color: '#00FFFF',
    marginLeft: 10,
    fontSize: 14,
  },
  modeSection: {
    marginBottom: 20,
  },
  modeRow: {
    flexDirection: 'row',
    gap: 10,
  },
  modeButton: {
    flex: 1,
    minHeight: 112,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#253044',
    backgroundColor: '#0B0F19',
  },
  qualitySection: {
    marginTop: 18,
  },
  qualityButton: {
    flex: 1,
    minHeight: 78,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#253044',
    backgroundColor: '#0B0F19',
  },
  modeButtonActive: {
    borderColor: '#00FFFF',
    backgroundColor: 'rgba(0, 255, 255, 0.08)',
  },
  modeButtonTitle: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 8,
  },
  modeButtonText: {
    color: '#64748B',
    fontSize: 11,
    marginTop: 4,
  },
  listContainer: {
    marginBottom: 10,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    color: '#94A3B8',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  deviceItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0B0F19',
    padding: 16,
    borderRadius: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  deviceInfo: {
    flex: 1,
  },
  deviceName: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  deviceType: {
    color: '#475569',
    fontSize: 13,
  },
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
  },
  emptyText: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  emptySubtext: {
    color: '#475569',
    textAlign: 'center',
    fontSize: 14,
    marginBottom: 20,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(0, 255, 255, 0.1)',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0, 255, 255, 0.2)',
  },
  retryText: {
    color: '#00FFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  debugContainer: {
    backgroundColor: '#0B0F19',
    borderRadius: 16,
    padding: 16,
    maxHeight: 350,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  debugHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
    paddingBottom: 8,
    marginBottom: 8,
  },
  debugTitle: {
    color: '#94A3B8',
    fontSize: 14,
    fontWeight: 'bold',
    fontFamily: 'monospace',
  },
  debugCloseText: {
    color: '#E2E8F0',
    fontSize: 12,
  },
  debugScroll: {
    maxHeight: 300,
  },
  debugLogLine: {
    color: '#CBD5E1',
    fontSize: 11,
    fontFamily: 'monospace',
    marginBottom: 4,
  },
  debugLogLineError: {
    color: '#EF4444',
  },
  debugLogLineSuccess: {
    color: '#10B981',
  },
});
