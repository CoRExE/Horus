# Project: Movie-TV-Link (Standalone Android TV Ecosystem)

Nom de l'App : **Horus

## 📡 Architecture "No-Server"
* **TV App (Host):** Agit comme serveur local (HTTP Bridge) et lecteur vidéo.
* **Mobile App (Remote):** Agit comme client de recherche et contrôleur D-Pad.
* **Communication:** Liaison via Wi-Fi local (UDP/ZeroConf) pour l'auto-détection.

## 🛠 Stack Technique (Full React Native)
* **Framework TV:** `react-native-tvos` (gestion native du focus/télécommande).
* **Framework Mobile:** `React Native (Expo)` (UI de recherche et télécommande tactile).
* **Scraping Logic:** JS/TS (Axios + Cheerio) — Portage de `movie-cli` vers du JS pur.
* **Local Server:** `react-native-http-bridge` (pour recevoir les ordres du téléphone).
* **Video Player:** `react-native-video` (basé sur ExoPlayer pour les flux .m3u8).
* **Package Manager** : `pnpm` pour la partie TV, `bun` pour expo.

## 🧩 Structure du Monorepo
/project-root
  ├── /packages/core         # Logique partagée (scraping, parsers ani-cli/movie-cli)
  ├── /apps/android-tv       # App TV (UI "10-foot", Serveur HTTP, Player)
  └── /apps/mobile-remote    # App Mobile (Recherche, Historique, Remote Control)

## 🚀 Flux de Fonctionnement
1.  **Discovery:** Le téléphone scanne le réseau via ZeroConf et trouve l'IP de la TV.
2.  **Search:** L'utilisateur cherche un film sur son téléphone (scraping effectué en local sur le tel).
3.  **Command:** Le téléphone envoie une requête POST `host_ip:port/play?url=...` à la TV.
4.  **Playback:** La TV reçoit l'URL, l'app passe au premier plan et lance le flux vidéo.