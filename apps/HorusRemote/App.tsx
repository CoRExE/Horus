import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, TextInput, ScrollView, Image, TouchableOpacity, SafeAreaView, Platform } from 'react-native';
import React, { useState } from 'react';

// FAKE DATA
const CONTINUE_WATCHING = [
  { id: '1', title: 'Cyberpunk: Edgerunners', episode: 'Ep 4 - Lucky You', cover: 'https://cdn.myanimelist.net/images/anime/1173/127351.jpg' },
  { id: '2', title: 'Arcane', episode: 'Ep 9 - The Monster You Created', cover: 'https://cdn.myanimelist.net/images/anime/1805/119934.jpg' },
  { id: '3', title: 'Jujutsu Kaisen', episode: 'S2 Ep 1 - Hidden Inventory', cover: 'https://cdn.myanimelist.net/images/anime/1792/138022.jpg' },
];

export default function App() {
  const [search, setSearch] = useState('');

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />
      
      {/* HEADER / SEARCH */}
      <View style={styles.header}>
        <Text style={styles.appTitle}>Horus</Text>
        <TextInput 
          style={styles.searchInput}
          placeholder="Rechercher un film ou un anime..."
          placeholderTextColor="#94A3B8"
          value={search}
          onChangeText={setSearch}
        />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* CONTINUE WATCHING */}
        <Text style={styles.sectionTitle}>Continue Watching</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.carousel}>
          {CONTINUE_WATCHING.map((item) => (
            <TouchableOpacity key={item.id} style={styles.card} activeOpacity={0.8}>
              <Image source={{ uri: item.cover }} style={styles.cardImage} />
              <View style={styles.cardInfo}>
                <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
                <Text style={styles.cardSubtitle} numberOfLines={1}>{item.episode}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B0F19', // Fond premium sombre
    paddingTop: Platform.OS === 'android' ? 40 : 0,
  },
  header: {
    paddingHorizontal: 20,
    marginTop: 20,
    marginBottom: 30,
  },
  appTitle: {
    color: '#F8FAFC',
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 20,
  },
  searchInput: {
    backgroundColor: '#1A1F2E',
    color: '#F8FAFC',
    paddingHorizontal: 20,
    paddingVertical: 15,
    borderRadius: 12,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#2A3143',
  },
  scrollContent: {
    paddingBottom: 40,
  },
  sectionTitle: {
    color: '#F8FAFC',
    fontSize: 20,
    fontWeight: 'bold',
    marginLeft: 20,
    marginBottom: 15,
  },
  carousel: {
    paddingLeft: 20,
  },
  card: {
    marginRight: 15,
    width: 260,
    borderRadius: 12,
    backgroundColor: '#1A1F2E',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  cardImage: {
    width: '100%',
    height: 140,
    resizeMode: 'cover',
  },
  cardInfo: {
    padding: 12,
  },
  cardTitle: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  cardSubtitle: {
    color: '#8B5CF6', // Accent Violet
    fontSize: 14,
    fontWeight: '500',
  },
});
