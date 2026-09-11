# Horus Desktop

Client de bureau Tauri 2 + React 19 + TypeScript + Vite, intégré au workspace pnpm.
Il réutilise les moteurs de `@horus/core` ; les modules Expo/React Native ne sont
pas chargés dans la WebView.

## Développement

Depuis la racine du monorepo :

```sh
pnpm install
cp apps/HorusDesktop/.env.example apps/HorusDesktop/.env
pnpm desktop
```

L’adresse du Worker peut aussi être saisie dans **Paramètres**. Cette préférence
locale prend le dessus sur `VITE_HORUS_API_URL`. Ne jamais mettre le jeton TMDB
dans une variable `VITE_*` : ces variables sont publiques dans le bundle.

Prérequis :

- Node **26.8.1** (`.nvmrc`, version validée pour les tests) et pnpm **12.3.4**.
- Rust/Cargo (la version 1.88 installée lors de l’implémentation compile le projet).
- macOS : Xcode Command Line Tools.
- Windows : outils C++ de Visual Studio et WebView2.
- Linux : dépendances système WebKitGTK et compilation indiquées dans les
  [prérequis officiels Tauri](https://v2.tauri.app/start/prerequisites/).
- **FFmpeg** dans le `PATH` pour télécharger ou convertir le HLS en transport
  MPEG-TS vers DLNA. Les installations Homebrew dans `/opt/homebrew/bin` et
  `/usr/local/bin` sont aussi détectées depuis Finder. Les DMG du workflow de
  release embarquent leur propre FFmpeg, utilisé en priorité ; les builds de
  développement conservent la recherche dans le système.
  La lecture locale et Chromecast des flux compatibles restent disponibles sans lui.

Si le lanceur pnpm global échoue avec `installed pnpm wrapper is missing`, utiliser
la version du projet sans modifier l’installation globale :

```sh
npx --yes pnpm@12.3.4 install
npx --yes pnpm@12.3.4 desktop
```

## Parcours disponibles

- Recherche de films/séries via HorusApi, résolution directe Vidzy et recherche AnimeSama.
- Épisodes, choix explicite de langue (VF prioritaire) et sélection du serveur.
- Lecture locale MP4/HLS, contrôles natifs du lecteur, plein écran, reprise de
  progression et épisode suivant. Un changement de langue n’est jamais automatique.
- Favoris et historique persistants, séparés de ceux du téléphone.
- Téléchargement annulable en MP4, progression en octets, lecture hors ligne,
  suppression et diffusion des fichiers conservés dans le dossier de l’application.
- Découverte IPv4 DLNA/SSDP et Chromecast/mDNS.
- Télécommande : lecture, pause, arrêt, progression et volume lorsque le récepteur
  les expose. Les commandes de sourdine sont aussi disponibles dans le service natif.
- Diffusion immédiate ou téléchargement complet avant diffusion. Ce dernier mode
  **conserve le fichier dans Téléchargements**, jusqu’à sa suppression explicite.

Les sous-titres intégrés et les codecs lisibles dépendent de la WebView et du
récepteur. FFmpeg effectue un **remuxage sans réencodage** : il ne convertit pas un
codec incompatible, ne change pas la résolution et ne garantit pas les pistes de
sous-titres séparées. Le relais MPEG-TS continu ne permet pas la recherche temporelle ;
préférer un fichier entièrement téléchargé pour avancer/reculer sur DLNA.

Les sources externes peuvent changer, refuser un flux ou ne pas disposer d’un
épisode. L’interface permet de choisir un autre serveur dans la même langue.
Les mises à jour OTA Expo, les services Android et la synchronisation avec la
bibliothèque du téléphone ne font pas partie du client desktop. Aucun serveur de
mise à jour Tauri ni certificat de signature n’est configuré.

## Architecture

```text
src/
  App.tsx                 Navigation et assemblage des écrans/hooks
  screens/                Catalogue, bibliothèque, téléchargements, paramètres
  components/             Fiche média, choix TV, collection et lecteurs
  hooks/usePlayback.ts    Démarrage, reprise, arrêt, serveur/épisode suivant
  hooks/useDownloads.ts   Téléchargements, progression, annulation, fichiers locaux
  hooks/useCasting.ts     Découverte et téléchargement avant diffusion
  hooks/                  Recherche, fiche média, paramètres et informations locales
  types/media.ts          Types des parcours Desktop
  utils/format.ts         Affichage des tailles de fichiers
  services/offline.ts     Conversion des fichiers locaux en sources de lecture
  services/native.ts      Transport Axios via IPC et contrats avec Rust
  services/providers.ts   Réutilisation d’AnimeSamaProvider et VidzyProvider
  services/devices.ts     Descriptions DLNA, commandes SOAP et télécommande
  store/library.ts        Favoris, historique et adresse API persistants
src-tauri/src/
  lib.rs                  Démarrage, commandes HTTP et fermeture propre
  relay.rs                Relais HTTP, réécriture HLS, Range et FFmpeg DLNA
  downloads.rs            Téléchargements, annulation et métadonnées atomiques
  discovery.rs            SSDP et mDNS
  cast.rs                 Connexion TLS et commandes Google Cast
```

Les pages des fournisseurs sont récupérées comme **texte** et analysées par les
moteurs partagés. Elles ne sont jamais ouvertes dans une iframe. Les requêtes
passent par Rust pour conserver les en-têtes nécessaires et éviter les restrictions
CORS de la WebView, sans modifier HorusApi.

Le relais utilise un port aléatoire et une URL opaque par session. Il sert seulement
les ressources enregistrées par les commandes locales ; aucun paramètre d’URL ne
permet à un client réseau de choisir une source ou un fichier arbitraire. Les URL
des playlists, clés et segments HLS sont réécrites avec les mêmes en-têtes. Les
capacités sont révoquées à l’arrêt de la lecture. Le CORS du relais autorise les
récepteurs Chromecast, qui utilisent leur propre origine.

Les téléchargements résident dans `app_data_dir()/downloads` :

- macOS : `~/Library/Application Support/io.github.corexe.horus.desktop/downloads`
- Windows : sous `%APPDATA%/io.github.corexe.horus.desktop/downloads`
- Linux : sous `$XDG_DATA_HOME/io.github.corexe.horus.desktop/downloads`
  (habituellement `~/.local/share`).

Les fichiers incomplets sont supprimés à l’annulation et au prochain démarrage.
À la fermeture normale, Horus annule les téléchargements et interrompt FFmpeg.

## Vérifications et builds

```sh
pnpm check
pnpm --filter horus-desktop build
pnpm --filter horus-desktop test:rust
pnpm --filter horus-desktop check:rust
pnpm --filter horus-desktop build:rust
pnpm desktop:build
```

`pnpm check` inclut TypeScript et les tests JavaScript de Desktop ; les tests Rust
restent une commande distincte pour que le développement mobile/API n’exige pas
la chaîne de compilation native. Ils couvrent notamment les manifestes HLS signés,
les clés relatives, les requêtes Range et la révocation des URL du relais. Les
tests JavaScript utilisent `.cts` pour le package partagé CommonJS `@horus/core`.

`pnpm check` exécute aussi les tests de parcours Vitest/jsdom dans `tests/*.test.tsx`.
Ils couvrent la reprise par épisode et fournisseur, la persistance du format de
bibliothèque existant, le changement de serveur dans la même langue, la sauvegarde
à la fermeture et la destruction d'une session HLS. Les 19 tests couvrent aussi
l'épisode suivant, les réponses tardives, les paramètres, les téléchargements,
la lecture hors ligne et la coordination TV. `pnpm --filter horus-desktop
test:ui` permet de les lancer seuls. Le DOM, les fournisseurs réseau et les appels
natifs sont simulés ; `App`, `Player` et le store Zustand sont les composants réels.
Voir les [versions et commandes de la CI](../../README.md#vérifications-automatiques)
pour reproduire les vérifications avec Node 26.8.1.

`pnpm --filter horus-desktop dev` ne lance que l’aperçu navigateur ; les opérations
natives nécessitent `pnpm desktop`.

### Validation média avec FFmpeg

```sh
pnpm --filter horus-desktop test:media
```

Cette commande génère une mire silencieuse de six secondes, puis vérifie les
téléchargements MP4 et HLS, le décodage des fichiers MP4 produits, le relais
MPEG-TS utilisé par DLNA, la progression, le refus d’un second téléchargement,
l’annulation de FFmpeg et le nettoyage après échec. Tous les serveurs du test
sont locaux ; aucun média externe n’est utilisé. Ce test est ignoré par défaut
dans `test:rust`, car il nécessite FFmpeg avec les encodeurs libx264 et AAC.
Les fichiers générés dans `tests/.media-fixtures` sont exclus de Git.

Pour vérifier le composant de lecture et les curseurs dans l’interface :

```sh
pnpm --filter horus-desktop test:fixtures
pnpm --filter horus-desktop dev
```

Ouvrir ensuite [la page de validation locale](http://127.0.0.1:1420/tests/player.html).
Elle permet de lire la mire MP4/HLS, de reprendre à une seconde et de tester le
curseur pendant des mises à jour simulées du récepteur. Cette page de test est
exclue du bundle de production. Elle ne remplace pas une validation sur une TV.

Pour un bundle macOS de test :

```sh
pnpm --filter horus-desktop tauri build --debug --bundles app
```

Les artefacts se trouvent dans `src-tauri/target/{debug,release}/bundle`. Construire
chaque cible sur son système, puis configurer les signatures avant distribution.
Le bundle macOS local ne constitue pas une validation Windows/Linux ni un test sur
une TV physique. Vérifier sur le réseau cible : découverte, démarrage réel du flux,
pause/reprise, volume, seek sur fichier et arrêt de la diffusion.

Configuration du frontend conforme au [guide Vite de Tauri](https://v2.tauri.app/start/frontend/vite/).
