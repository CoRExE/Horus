import React, { useState } from 'react';
import { StyleSheet, Text, View, TextInput, ScrollView, Image, Pressable, SafeAreaView } from 'react-native';

const CONTINUE_WATCHING = [
  { id: '1', title: 'Cyberpunk: Edgerunners', episode: 'Ep 4 - Lucky You', cover: 'https://cdn.myanimelist.net/images/anime/1173/127351.jpg' },
  { id: '2', title: 'Arcane', episode: 'Ep 9 - The Monster You Created', cover: 'https://cdn.myanimelist.net/images/anime/1805/119934.jpg' },
  { id: '3', title: 'Jujutsu Kaisen', episode: 'S2 Ep 1 - Hidden Inventory', cover: 'https://cdn.myanimelist.net/images/anime/1792/138022.jpg' },
];

export default function App() {
  const [background, setBackground] = useState(CONTINUE_WATCHING[0].cover);

  return (
    <View style={styles.container}>
      {/* DYNAMIC BACKGROUND */}
      <Image source={{ uri: background }} style={styles.backgroundImage} blurRadius={40} />
      <View style={styles.overlay} />

      <SafeAreaView style={styles.content}>
        <View style={styles.header}>
          <Text style={styles.appTitle}>Horus</Text>
          <View style={styles.searchContainer}>
             <TextInput 
              style={styles.searchInput}
              placeholder="Rechercher..."
              placeholderTextColor="#94A3B8"
            />
          </View>
        </View>

        <Text style={styles.sectionTitle}>Continue Watching</Text>
        
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.carousel}>
          {CONTINUE_WATCHING.map((item) => (
            <Pressable 
              key={item.id} 
              onFocus={() => setBackground(item.cover)}
              style={({ focused }) => [
                styles.card,
                focused && styles.cardFocused
              ]}
            >
              {({ focused }) => (
                <>
                  <Image source={{ uri: item.cover }} style={styles.cardImage} />
                  <View style={styles.cardInfo}>
                    <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
                    <Text style={[styles.cardSubtitle, focused && styles.cardSubtitleFocused]} numberOfLines={1}>
                      {item.episode}
                    </Text>
                  </View>
                </>
              )}
            </Pressable>
          ))}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B0F19',
  },
  backgroundImage: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
    opacity: 0.3,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(11, 15, 25, 0.8)',
  },
  content: {
    flex: 1,
    padding: 40,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 60,
  },
  appTitle: {
    color: '#F8FAFC',
    fontSize: 48,
    fontWeight: 'bold',
  },
  searchContainer: {
    width: 300,
  },
  searchInput: {
    backgroundColor: 'rgba(26, 31, 46, 0.8)',
    color: '#F8FAFC',
    paddingHorizontal: 20,
    paddingVertical: 15,
    borderRadius: 8,
    fontSize: 18,
    borderWidth: 1,
    borderColor: '#2A3143',
  },
  sectionTitle: {
    color: '#F8FAFC',
    fontSize: 32,
    fontWeight: 'bold',
    marginBottom: 30,
  },
  carousel: {
    paddingBottom: 40,
    alignItems: 'center',
  },
  card: {
    marginRight: 40,
    width: 340,
    borderRadius: 16,
    backgroundColor: '#1A1F2E',
    overflow: 'hidden',
    borderWidth: 3,
    borderColor: 'transparent',
    transform: [{ scale: 1 }],
  },
  cardFocused: {
    borderColor: '#8B5CF6',
    transform: [{ scale: 1.05 }],
    shadowColor: '#8B5CF6',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.8,
    shadowRadius: 20,
    elevation: 10,
  },
  cardImage: {
    width: '100%',
    height: 190,
    resizeMode: 'cover',
  },
  cardInfo: {
    padding: 16,
  },
  cardTitle: {
    color: '#F8FAFC',
    fontSize: 22,
    fontWeight: '600',
    marginBottom: 6,
  },
  cardSubtitle: {
    color: '#94A3B8',
    fontSize: 18,
    fontWeight: '500',
  },
  cardSubtitleFocused: {
    color: '#8B5CF6', // Accent Violet
  }
});
