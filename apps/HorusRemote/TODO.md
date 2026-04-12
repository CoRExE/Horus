# 👁️ Horus Remote - Cyber UI/UX (Data Stream & Pulse Interface)

Ce document trace la feuille de route pour transformer l'application HorusRemote en combinant les concepts de flux de données et d'interface pulsante.

## 🚀 Phase 1 : Infrastructure & Dépendances
- [ ] Installer : `react-native-reanimated`, `moti`, `react-native-svg`, `lucide-react-native`.
- [ ] Configurer `babel.config.js` avec le plugin Reanimated.

## ⚡ Phase 2 : Identité & Startup (Data Stream + Pulse)
*Objectif : Une séquence de boot-up visuelle intense.*

- [ ] **Icone "Horus Core"** :
    - Un triangle (pyramide) déconstruit en blocs de données (Data Stream).
    - Au centre, une pupille qui pulse doucement (Pulse Interface).
    - Entourage par un anneau de chargement fragmenté.
- [ ] **Animation de Startup** :
    - **Step 1** : Les blocs du triangle s'assemblent depuis les bords vers le centre.
    - **Step 2** : L'anneau fragmenté tourne de plus en plus vite (effet d'accélération).
    - **Step 3** : "Boot up flicker" (clignotement style écran cathodique/cyber) lors de la finalisation.

## 🖥️ Phase 3 : Interface "Data Grid"
*Objectif : Une UI qui semble être projetée ou scannée.*

- [ ] **Header System** :
    - Titre "HORUS" avec effets de glitch subtils au survol/chargement.
    - Barre de recherche "Trace Media Stream...".
- [ ] **Grille de Résultats** :
    - Cartes avec bordures de données fragmentées.
    - Apparition des vignettes avec un effet de "Data Load" (balayage horizontal).

## 🎭 Phase 4 : Transitions Cybernétiques
*Objectif : Remplacer les animations standards par des effets numériques.*

- [ ] **Horizontal Motion Blur** :
    - Lors du changement de source (Anime <-> Film), simuler un flou de mouvement rapide.
- [ ] **Focus / Defocus** :
    - Ouverture des détails du média : l'interface arrière-plan devient floue (defocus) pendant que le contenu "pop" de manière nette (focus).
- [ ] **Flicker Transitions** :
    - Micro-clignotements lors du passage d'un état à un autre.

## 🛠️ Palette Technique
- **Couleurs** : `#0B0F19` (Fond), `#8B5CF6` (Pulse), `#00FFFF` (Data Stream).
- **Style** : Géométrique, fragmenté, haute vélocité.
