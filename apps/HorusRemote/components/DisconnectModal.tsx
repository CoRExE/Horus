import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal } from 'react-native';
import { LogOut, X } from 'lucide-react-native';

interface DisconnectModalProps {
  visible: boolean;
  deviceName?: string;
  onClose: () => void;
  onConfirm: () => void;
}

export const DisconnectModal: React.FC<DisconnectModalProps> = ({ visible, deviceName, onClose, onConfirm }) => {
  return (
    <Modal visible={visible} animationType="fade" transparent={true} onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.modalContent}>
          
          <View style={styles.header}>
            <Text style={styles.title}>Déconnexion</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <X color="#F8FAFC" size={24} />
            </TouchableOpacity>
          </View>

          <View style={styles.body}>
            <LogOut color="#EF4444" size={48} style={styles.icon} />
            <Text style={styles.text}>
              Voulez-vous vous déconnecter de {deviceName ? `l'appareil "${deviceName}"` : 'cet appareil'} ?
            </Text>
            <Text style={styles.subtext}>La lecture sera arrêtée.</Text>
          </View>

          <View style={styles.footer}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelBtnText}>Annuler</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.confirmBtn} onPress={onConfirm}>
              <Text style={styles.confirmBtnText}>Déconnecter</Text>
            </TouchableOpacity>
          </View>

        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContent: {
    backgroundColor: '#1A1F2E',
    borderRadius: 24,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.2)', // Bordure légèrement rouge pour l'alerte
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    color: '#F8FAFC',
    fontSize: 20,
    fontWeight: 'bold',
  },
  closeBtn: {
    padding: 4,
  },
  body: {
    alignItems: 'center',
    marginBottom: 30,
  },
  icon: {
    marginBottom: 16,
  },
  text: {
    color: '#F8FAFC',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 8,
  },
  subtext: {
    color: '#94A3B8',
    fontSize: 14,
    textAlign: 'center',
  },
  footer: {
    flexDirection: 'row',
    gap: 12,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    alignItems: 'center',
  },
  cancelBtnText: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '600',
  },
  confirmBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    borderWidth: 1,
    borderColor: '#EF4444',
    alignItems: 'center',
  },
  confirmBtnText: {
    color: '#EF4444',
    fontSize: 16,
    fontWeight: 'bold',
  }
});
