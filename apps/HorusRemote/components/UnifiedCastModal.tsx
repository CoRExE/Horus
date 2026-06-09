import React, { useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView, ActivityIndicator } from 'react-native';
import { useDevices, CastContext } from 'react-native-google-cast';
import { useDlnaDiscovery, DlnaDevice } from '../hooks/useDlnaDiscovery';
import { Monitor, Tv, X, RefreshCw } from 'lucide-react-native';

interface UnifiedCastModalProps {
  visible: boolean;
  onClose: () => void;
  onSelectDlna: (device: DlnaDevice) => void;
}

export const UnifiedCastModal: React.FC<UnifiedCastModalProps> = ({ visible, onClose, onSelectDlna }) => {
  // Découverte Chromecast
  const castDevices = useDevices();
  
  // Découverte DLNA
  const { devices: dlnaDevices, isSearching, startDiscovery } = useDlnaDiscovery();

  useEffect(() => {
    if (visible) {
      startDiscovery();
    }
  }, [visible, startDiscovery]);

  const handleCastSelect = (deviceId: string) => {
    CastContext.getInstance().getSessionManager().startSession(deviceId);
    onClose();
  };

  const handleDlnaSelect = (device: DlnaDevice) => {
    onSelectDlna(device);
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
});
