# TODO — Prochaines évolutions de Horus

Dernière mise à jour : 19 septembre 2026.

Cette feuille de route reprend les prochaines évolutions discutées. Les cases
non cochées correspondent à du travail à réaliser, pas à des fonctionnalités
déjà livrées. L'ordre ci-dessous est un ordre de réalisation proposé.

## Périmètre

| Zone | Modifications prévues |
| --- | --- |
| `apps/HorusDesktop` | Réorganisation du code, lecteur, téléchargements, diffusion TV, builds macOS, Windows et Linux pour usage personnel et vérification des versions. |
| `apps/HorusRemote` | Builds Android sans EAS, gestion des versions et vérification des versions publiées. |
| `.github/workflows` et configuration du dépôt | Tests, compilation, releases et publication des informations de mise à jour. |
| `packages/core` | Uniquement les fonctions réellement communes aux deux clients, si leur extraction est utile ; vérifier les deux applications après modification. |
| `apps/HorusApi` | Aucun changement fonctionnel prévu pour ces chantiers. |

La réorganisation de l'interface et les améliorations du lecteur décrites ici
visent Desktop. Le travail sur les releases et la vérification des mises à jour
concerne aussi Mobile. La TODO graphique existante de
[HorusRemote](apps/HorusRemote/TODO.md) reste un document distinct.

## Décisions retenues

- Depuis le 12 septembre 2026, Mobile cible Android uniquement : aucune version iOS n'est prévue, ni via EAS, ni via GitHub Actions, ni en build local à maintenir.
- Conserver Expo et React Native pour Mobile ; remplacer EAS Build par des builds natifs dans GitHub Actions.
- L'application est destinée à un usage personnel, sans objectif de distribution au public ni de publication sur les stores officiels.
- Commencer la génération automatisée des installateurs par macOS et Android, puis l'étendre à Windows et Linux dans le chantier 3 après validation de cette première étape.
- Séparer les versions avec des tags `desktop-vX.Y.Z` et `mobile-vX.Y.Z`.
- Automatiser la détection d'une nouvelle version ; proposer son téléchargement et laisser l'utilisateur réaliser l'installation.
- Publier un manifeste JSON public par plateforme, mis à jour après la publication réussie de la release et de ses fichiers.
- Ne pas utiliser le lien GitHub `releases/latest` global pour sélectionner indépendamment une version mobile ou desktop.
- Les releases GitHub servent à récupérer les binaires pour les installations et mises à jour personnelles ; elles ne remplacent pas directement le protocole EAS Update.

## 1. Automatiser les vérifications — dépôt

- [x] Ajouter un workflow de vérification des propositions de modification : TypeScript et tests existants du monorepo.
- [x] Vérifier la compilation de l'interface Desktop et du code Rust sur macOS.
- [x] Exécuter les tests média avec FFmpeg : MP4/HLS, relais, annulation et nettoyage après échec.
- [x] Ajouter des tests ciblés des parcours sensibles : reprise du bon épisode, persistance de la bibliothèque, changement de serveur dans la même langue et fermeture propre du lecteur.
- [x] Configurer les versions des outils, l'installation verrouillée et les caches pnpm/Cargo ; conserver les journaux utiles en cas d'échec.
- [x] Configurer les dépendances et le cache Gradle lors de l'ajout du build Android au chantier 3 : Java 17, SDK/build-tools 36, NDK/CMake et `setup-gradle` sont configurés dans le workflow Android.
- [x] Faire dépendre les jobs de release de la réussite des vérifications : les workflows Desktop et Android appellent `checks.yml` via `workflow_call` et attendent son succès avec `needs`, sur le même commit du tag.
- [ ] Valider un premier lancement du workflow sur GitHub, y compris la restauration des caches et la récupération des journaux d'un échec provoqué.

Travail terminé le 10 septembre 2026 :

- Ajout de [`.github/workflows/checks.yml`](.github/workflows/checks.yml) : pull requests, pushes sur `main`/`master`, lancement manuel et appel depuis un autre workflow. Deux jobs vérifient le monorepo sur Ubuntu et Desktop/Rust/FFmpeg sur macOS, sans secret de publication.
- Node 26.8.1 fixé dans `.nvmrc`, pnpm 12.3.4 lu dans `package.json`, Rust 1.88.0 fixé dans le workflow ; installations `--frozen-lockfile` et commandes Cargo `--locked`. Les dépendances précédemment verrouillées sont conservées, avec ajout des dépendances de test uniquement. Les caches pnpm/Cargo utilisent les fichiers de verrouillage ; les journaux d'échec sont conservés sept jours.
- Huit tests Vitest/jsdom ajoutés et intégrés à `pnpm check` : reprise du bon épisode, absence de reprise sur un autre épisode ou fournisseur, restauration de la bibliothèque et compatibilité du stockage version 1, repli sur un serveur de même langue jusqu'à épuisement, sauvegarde immédiate et libération à la fermeture, destruction de la session HLS au démontage. Les composants et le store réels sont utilisés avec les entrées réseau/natives et médias du navigateur simulés.
- Aucun changement du code applicatif, du format des données, de l'API, du mobile ou des fonctionnalités Rust ; les chantiers suivants ne sont pas commencés.

Validations locales effectuées sur macOS :

- Validation initiale : installation `pnpm install --frozen-lockfile --offline` réussie avec pnpm 10.24.0 et le cache existant (avant alignement sur pnpm 12.3.4).
- `pnpm check` réussi sous Node 26.8.1 : TypeScript des quatre packages, suite core, 3 tests API, 4 tests Desktop existants et 8 nouveaux tests de parcours.
- `pnpm --filter horus-desktop build` réussi ; l'avertissement Vite sur les chunks de plus de 500 ko reste présent.
- `cargo check`, `cargo build` et `cargo test --locked` réussis avec Rust 1.88.0 : 4 tests Rust ordinaires réussis. Le test média, ignoré dans cette commande, a ensuite été exécuté explicitement avec `media_integration -- --ignored` après génération des fixtures : 1 test réussi avec FFmpeg 9.0.1, couvrant MP4/HLS, relais, annulation et nettoyage.
- Cinq régressions injectées uniquement dans une copie temporaire ont été détectées par des assertions : reprise d'un autre épisode, repli dans une autre langue, perte de progression à la fermeture, changement de clé de stockage et oubli de destruction HLS.
- Workflow validé par actionlint 1.7.7 ; `git diff --check` réussi.

Alignement ultérieur sur pnpm 12.3.4, installé sur la machine : `packageManager`,
documentation, profil EAS preview et action CI (`pnpm/action-setup@v6`) mis à jour.
Le lockfile inclut désormais le verrou du gestionnaire ; les dépendances
applicatives sont inchangées (comparaison des données du lockfile avec le commit
précédent). Les scripts d'installation d'`esbuild` et de `workerd` sont autorisés
explicitement dans `pnpm-workspace.yaml`, comme l'exige pnpm 12.
`pnpm install --frozen-lockfile`, `pnpm check` et la compilation de l'interface
Desktop ont été relancés avec succès sous pnpm 12.3.4. Le YAML du workflow a été
relu et parsé ; son exécution sur GitHub et les builds EAS restent non vérifiés.

Limites constatées : Node 20.19.4 échoue dans le chargement CommonJS/ESM des tests
Desktop existants avec le `tsx` verrouillé, d'où l'alignement sur Node 26.8.1.
Les tests Rust réseau et le lanceur `tsx` nécessitent l'autorisation d'ouvrir des
sockets locales hors du bac à sable de l'agent. Aucun lancement GitHub Actions,
build Android, publication, essai WebView Tauri ou test sur TV physique n'a été
effectué. L'image macOS et FFmpeg Homebrew peuvent évoluer : les dépendances
verrouillées ne garantissent pas des binaires identiques octet par octet.

Validation : une modification cassant un parcours couvert ou la compilation
doit être détectée avant publication. Les tests réseau locaux ne remplacent pas
les essais sur une TV physique.

## 2. Réorganiser le code — HorusDesktop

- [x] Alléger `src/App.tsx` en séparant les écrans catalogue, bibliothèque, téléchargements et paramètres.
- [x] Extraire la fiche média : saisons/épisodes, langues et serveurs.
- [x] Centraliser le cycle de lecture dans un hook ou service dédié : démarrage, reprise, arrêt, changement de serveur et épisode suivant.
- [x] Isoler la coordination des téléchargements et celle de la diffusion TV de leur affichage.
- [x] Garantir une séquence de fermeture cohérente : sauvegarde de progression, arrêt et libération des ressources.
- [x] Procéder par extractions successives, à comportement identique, avec vérification des parcours après chaque étape.

Travail terminé le 10 septembre 2026 :

- `App.tsx` passe de 1 223 à 311 lignes et conserve la navigation, les messages et l'assemblage des écrans/hooks.
- Les quatre écrans sont isolés dans `src/screens/`. `MediaCollection` partage l'affichage des résultats, favoris et historiques ; `MediaDetailsDialog` conserve les choix d'épisode, de langue et de serveur existants, sans ajouter de nouvelle navigation par saison.
- `usePlayback` regroupe préparation, reprise par épisode/fournisseur, arrêt, serveur suivant, épisode suivant et sauvegarde de progression. Les contrôles média, HLS et plein écran restent dans `Player` et son hook existant.
- `useDownloads` regroupe chargement des fichiers locaux, téléchargement, événements de progression, annulation et suppression. `useCasting` regroupe découverte, choix du récepteur et coordination du téléchargement avant diffusion ; leurs affichages sont dans `DownloadActivity`, `DownloadsScreen` et `CastDialog`.
- `useCatalogue`, `useMediaDetails`, `useSettings` et `useRuntimeInfo` isolent les autres états et requêtes. Les garde-fous sur les réponses tardives, le brouillon des paramètres, les libellés, les classes CSS et les règles de disponibilité des commandes sont conservés.
- L'arrêt commun demande la position courante à `Player` avant d'invalider la session, puis arrête le récepteur et libère le relais même si la TV refuse l'arrêt. Cette sauvegarde protège aussi le remplacement d'une lecture depuis la bibliothèque, qui ne passe pas par le bouton de fermeture. Le démontage conserve le nettoyage vidéo/HLS existant.
- Le store et son format de persistance version 1, les services natifs, le code Rust, Mobile, HorusApi, `packages/core`, les dépendances et les workflows sont inchangés. L'ajout préexistant `desktop:clean` dans `package.json` est préservé à l'identique. Aucun chantier de release ou de mise à jour n'a été commencé.

Validations effectuées :

- TypeScript Desktop et les 8 tests de parcours du chantier 1 passent avant modification, après extraction des écrans/dialogues, puis après extraction des hooks.
- Ajout de 11 tests de parcours, soit 19 tests Vitest/jsdom : épisode suivant et choix explicite de langue, fermeture pendant une résolution, brouillon des paramètres, actions de bibliothèque, remplacement d'une lecture, téléchargement/lecture hors ligne/suppression, progression filtrée et annulation, téléchargement avant diffusion, arrêt TV en erreur et recherche devenue obsolète.
- Comparaison ponctuelle avec une copie de l'ancien `App.tsx` : DOM strictement identique sur 9 états (catalogue, animés, favoris, historique, téléchargements, paramètres, fiche média, changement de langue et choix de TV). Le composant de référence et le test de comparaison temporaires ont été retirés du dépôt après validation.
- `pnpm check` réussi : TypeScript des quatre packages, suite core, 3 tests API, 4 tests Desktop existants et 19 tests de parcours. `pnpm --filter horus-desktop build` réussi ; l'avertissement Vite sur les chunks de plus de 500 ko reste présent.
- `git diff --check` réussi et comparaison octet par octet du `package.json` avec son état au début du chantier.
- Essai manuel sur une box Orange concluant, confirmé par l'utilisateur après les validations automatisées.

Limites : les interactions média du navigateur, fournisseurs et appels natifs
sont simulés dans les tests UI. L'essai sur box Orange est confirmé par
l'utilisateur ; aucun essai manuel dans la WebView Tauri ou sur mobile réel
n'a été effectué par l'agent pendant ce chantier. Les tests Rust/FFmpeg
n'ont pas été relancés puisque leur code et leurs contrats n'ont pas changé.
La fermeture de la fenêtre native reste gérée par le code Rust existant ; la
séquence vérifiée ici concerne l'arrêt et le remplacement du lecteur.

Validation : les parcours actuels restent disponibles sans modification des
préférences, favoris ou historiques existants. Éviter une réécriture globale.

## 3. Automatiser les releases — Desktop, Mobile et dépôt

### Socle commun

- [x] Ajouter des workflows déclenchés par les tags propres à chaque application, avec possibilité de lancement manuel.
- [x] Définir la source de vérité des versions et vérifier la cohérence des fichiers de configuration avec le tag.
- [x] Prévoir les secrets de signature dans GitHub, sans les ajouter au dépôt ni aux journaux.
- [x] Construire les installateurs et préparer les notes de version : brouillons Android et Desktop multiplateforme créés sur GitHub.
- [x] Définir le passage brouillon → publication : workflow manuel vérifiant les installateurs et leurs sommes avant publication. Le branchement des manifestes publics reste au chantier 4, après cette étape.
- [x] Étendre le workflow Desktop et les contrôles de publication aux fichiers Windows et Linux, réunis avec macOS sous le même tag `desktop-vX.Y.Z` ; refuser la publication si un fichier attendu pour les plateformes retenues manque. Le workflow Desktop 0.1.1 est entièrement réussi.

### macOS — HorusDesktop

- [x] Construire et vérifier le binaire Apple Silicon.
- [x] Construire et vérifier le binaire Intel via le workflow prévu.
- [x] Intégrer FFmpeg pour rendre les téléchargements autonomes, avec ses sources et licences ; les binaires arm64 et Intel passent les vérifications du workflow.
- [x] Vérifier la signature ad hoc des bundles macOS dans le workflow.
- [ ] Vérifier l'installation des builds macOS pour l'usage personnel prévu.
- [x] Publier des fichiers identifiables par version et architecture dans GitHub Releases : `desktop-v0.1.1` publiée le 12 septembre 2026.
- [ ] Tester l'installation depuis Finder sur un environnement sans les outils de développement du projet.

### Android — HorusRemote

- [x] Récupérer et sauvegarder la clé de signature des APK existants si elle est gérée par EAS ; conserver la continuité des mises à jour.
- [x] Générer le projet Android via `expo prebuild` et compiler un APK release signé avec Gradle.
- [x] Vérifier l'intégration des modules natifs à la compilation et dans l'APK, notamment le proxy vidéo et Google Cast ; les essais sur appareil restent à effectuer.
- [x] Remplacer les scripts de build EAS de production/preview Android et reporter les variables nécessaires dans le nouveau workflow ; le build de développement Android utilise désormais le SDK local. Les commandes iOS sont retirées à la suite de l'abandon de cette cible.
- [x] Reprendre la gestion du `versionCode` depuis la dernière valeur réellement distribuée, y compris les incréments gérés à distance par EAS.
- [x] Tester l'installation de l'APK par-dessus la version existante sans désinstallation : mise à jour confirmée par l'utilisateur.
- [x] Publier l'APK dans GitHub Releases : `mobile-v1.4.1` publiée le 12 septembre 2026.
- [x] Confirmer la conservation des données après mise à jour Android : essai concluant rapporté par l'utilisateur le 14 septembre 2026.
- [x] Désactiver EAS Update dans le nouveau binaire et adapter les éventuels appels associés ; la migration exige l'installation de ce binaire.
- [x] Retirer la configuration EAS devenue inutile une fois la migration validée : profils EAS, identifiant de projet, URL OTA, runtime OTA, hook inutilisé et dépendance `expo-updates` supprimés.

### Windows — HorusDesktop

- [x] Retenir une cible initiale : Windows 11 x64, installateur NSIS `.exe` pour l'utilisateur courant ; adéquation aux machines personnelles à confirmer par l'utilisateur.
- [x] Configurer le build Windows dans GitHub Actions avec MSVC, MSYS2 UCRT64, dépendances, caches et commandes de tests Desktop/média.
- [x] Compiler Windows et exécuter les tests Desktop/média sur GitHub ; installateur NSIS généré et installation silencieuse terminée sans erreur.
- [x] Valider jusqu'au bout les contrôles des fichiers installés Windows et le workflow complet.
- [x] Embarquer FFmpeg pour Windows avec ses sources et licences, et vérifier son exécution sans installation système de FFmpeg.
- [x] Produire l'installateur et documenter les dépendances d'exécution ainsi que les éventuelles étapes de confiance nécessaires à l'installation pour un usage personnel.
- [x] Valider l'installation Windows sur la machine de l'utilisateur : installateur confirmé fonctionnel.
- [ ] Tester sur une machine Windows sans outils de développement l'installation, le lancement, la lecture, les téléchargements et l'accès au réseau local ; vérifier qu'une mise à jour conserve les préférences, favoris et historiques.
- [x] Publier l'installateur dans la release Desktop avec un nom indiquant version, plateforme et architecture : `desktop-v0.1.1` publiée.
- [ ] Vérifier la somme de contrôle de l'installateur Windows après téléchargement depuis la release publiée.

### Linux — HorusDesktop

- [x] Retenir une cible initiale : Ubuntu 24.04 x64, paquet `.deb` ; adéquation aux machines personnelles à confirmer par l'utilisateur.
- [x] Configurer le build Linux dans GitHub Actions avec les dépendances système Tauri, caches et commandes de tests Desktop/média.
- [x] Compiler Linux et exécuter les tests Desktop/média sur GitHub ; paquet `.deb` généré, version/architecture du paquet vérifiées et extraction réussie.
- [x] Valider jusqu'au bout les contrôles des fichiers extraits Linux et le workflow complet.
- [x] Embarquer FFmpeg pour Linux avec ses sources et licences, et vérifier son exécution sans installation système de FFmpeg.
- [ ] Produire les paquets retenus et documenter leurs dépendances d'exécution ; vérifier leur compatibilité sur les distributions ciblées.
- [x] Valider l'essai Linux pour l'usage personnel : essai concluant confirmé par l'utilisateur le 14 septembre 2026.
- [ ] Tester sur une machine Linux sans outils de développement l'installation, le lancement, la lecture, les téléchargements et l'accès au réseau local ; vérifier qu'une mise à jour conserve les préférences, favoris et historiques.
- [x] Publier les paquets dans la release Desktop avec des noms indiquant version, plateforme et architecture : `desktop-v0.1.1` publiée.
- [ ] Vérifier la somme de contrôle du paquet Linux après téléchargement depuis la release publiée.

Windows et Linux ont été intégrés au périmètre le 11 septembre 2026 ; leur
pipeline 0.1.1 est entièrement réussi. L'installation Windows et l'essai Linux
sont confirmés concluants par l'utilisateur.
La détection des mises à jour pour ces plateformes sera traitée au chantier 4, à partir des fichiers
publiés ici. Les essais approfondis de diffusion TV restent au chantier 7.

Validation : les releases suivantes doivent pouvoir être produites sans EAS.
La récupération initiale des clés ou numéros de build peut nécessiter un accès
au projet EAS existant.

Travail réalisé les 10 et 11 septembre 2026 (première publication encore à valider) :

- Ajout de `release-desktop.yml`, `release-mobile.yml` et `publish-release.yml`. Les tags stables `desktop-vX.Y.Z` / `mobile-vX.Y.Z` sont contrôlés avant les checks et les builds ; les jobs utilisent le commit exact du tag. Les builds produisent un brouillon, avec noms de fichiers distincts par version/architecture, notes de version, `SHA256SUMS` et métadonnées de provenance `release-info.json`.
- La publication manuelle refuse un brouillon incomplet, des fichiers altérés, des métadonnées différentes du tag ou un numéro Android déjà publié. Aucun écrasement d'une release existante et aucun recours au `latest` global. Les manifestes publics et les vérifications de mises à jour dans les applications n'ont pas été commencés.
- FFmpeg 8.0.1 est compilé depuis ses sources officielles avec SHA-256 fixé, sans bibliothèques Homebrew, options GPL ou nonfree. Le sidecar, ses sources exactes, licences et recette sont inclus par `tauri.release.conf.json`. Le runtime préfère ce binaire voisin de l'application, puis conserve les recherches système existantes. Les DMG utilisent une signature ad hoc pour l'usage personnel ; aucune signature Developer ID ou notarisation n'est configurée.
- L'APK public attaché à `v1.4.1` a été inspecté : il contient en réalité la version `1.4.0`, code 24, identifiant `com.horus.remote`. EAS production utilise aussi le code 24. La prochaine version Android est préparée en `1.4.1` / code 25 ; le certificat public et les références sont enregistrés dans `scripts/release/android-baseline.json`.
- La clé de production EAS a été exportée et sauvegardée localement dans `apps/HorusRemote/credentials.json` et `credentials/android/keystore.jks`, ignorés par Git et avec accès local restreint. Son certificat correspond à l'APK historique. Les quatre secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` et `ANDROID_KEY_PASSWORD` ont été configurés dans GitHub via le script dédié, sans affichage de leurs valeurs.
- Le prebuild Android conserve les scripts de démarrage existants. Un plugin configure la signature de release et refuse des identifiants absents au lieu d'utiliser la clé de debug. Les nouveaux builds Android de release désactivent EAS Update via leur configuration native ; les parcours de développement/iOS gardent leur configuration. Metro parcourt directement les fichiers pour ces builds, sans dépendre du daemon Watchman local.
- Guide d'exploitation ajouté dans `docs/RELEASES.md` : versions, clés, builds locaux, installation et publication. La modification préexistante de `package.json` à la racine est conservée à l'identique. Aucun changement des données persistées, des parcours de lecture, de HorusApi ou de `packages/core`.

Validations effectuées :

- `pnpm install --frozen-lockfile` réussi ; lockfile inchangé. Le cache hors ligne incomplet a nécessité l'installation depuis le registre. La machine utilise désormais Node 22 par défaut ; Node 26.8.1, fixé par le projet, a été téléchargé dans un répertoire temporaire et son SHA-256 officiel vérifié pour reproduire la CI sans changer l'installation de l'utilisateur.
- `pnpm check` réussi avec Node 26.8.1 : TypeScript des quatre packages, suite core, 3 tests API, 4 tests Desktop existants et 19 tests UI. Les 10 tests Node des garde-fous de release passent, avec les échanges GitHub simulés ; ils sont intégrés au workflow de vérifications.
- Compilation locale du FFmpeg arm64, des sources Rust de release et du DMG Apple Silicon réussie. L'image a été montée en lecture seule : signature du bundle et du sidecar vérifiée, architectures arm64 vérifiées, dépendances dynamiques limitées aux bibliothèques système, sources/licence présentes et FFmpeg exécutable avec `PATH=/usr/bin:/bin`. L'image a été démontée après contrôle.
- Les 4 tests Rust ordinaires et le test média intégré passent avec le FFmpeg compilé pour la release : MP4/HLS, relais, téléchargement, annulation et nettoyage. Les fixtures H.264 sont générées avec le FFmpeg système ; le moteur testé utilise le nouveau binaire.
- Génération Android et export Metro/Hermes réussis (3 237 modules). Le premier essai avait échoué avec l'index Metro/Watchman local ; réinstallation verrouillée et lecture directe des fichiers en mode release ont permis l'export.
- Build Gradle `:app:assembleRelease` réussi sous Node 26.8.1 et Java 17. L'APK contient `com.horus.remote`, version `1.4.1`, code 25, signé avec le certificat historique vérifié par `apksigner`. Son manifeste désactive EAS Update et conserve la configuration Google Cast ; le bundle JavaScript et les bibliothèques Hermes/React Native sont présents pour les quatre ABI. `apkanalyzer` confirme les classes du proxy vidéo local, Google Cast, Expo Video et UDP.
- Le DMG arm64 et l'APK signé sont regroupés dans `build/installers/`, avec `SHA256SUMS`, pour les essais manuels. `git diff --check` et la comparaison octet par octet du `package.json` préexistant réussissent ; aucun secret, installateur ou projet Android généré n'est ajouté aux fichiers suivis.
- Les workflows passent actionlint 1.7.12 ; les scripts shell passent `bash -n`. Les checks GitHub précédents du chantier 1 ont été observés réussis sur une pull request de `dev` et un push de `main` ; la restauration des caches et les journaux d'un échec provoqué restent non vérifiés.

Corrections après les premiers lancements GitHub, le 11 septembre 2026 :

- Logs Desktop consultés : les deux architectures échouaient au contrôle FFmpeg, car `lipo -verify_arch` interprétait le nom du fichier comme une architecture. Le fichier passe désormais avant `-verify_arch` dans `build-ffmpeg.sh` et `verify-macos.sh`.
- Logs Android consultés : le run est marqué annulé, avec saturation du Metaspace Gradle (512 Mio) et erreurs KSP/D8 avant l'arrêt. Le script de release fixe désormais le Metaspace Gradle à 2 Gio et celui de Kotlin à 1 Gio, conserve un heap de 2 Gio par daemon et limite Gradle à deux workers. Ces arguments sont appliqués après chaque prebuild sans modifier les commandes de développement.
- Les quatre workflows définissent un `run-name` : application et tag pour les releases, tag pour la publication, branche ou numéro de PR et branches pour les vérifications. Ces titres s'appliqueront aux nouvelles exécutions utilisant les workflows corrigés.
- Le guide de release explique les réglages mémoire et la relance depuis un nouveau tag incluant les correctifs ; les anciens tags pointent toujours sur l'ancien code. L'ajout Windows/Linux dans cette TODO et la modification préexistante de `package.json` sont conservés.

Validations de ces corrections :

- Les quatre workflows passent actionlint 1.7.12 ; les trois scripts shell de build/vérification macOS passent `bash -n` ; les 10 tests Node de release passent sous Node 26.8.1.
- La commande `lipo` corrigée accepte des objets Mach-O arm64 et x86_64 compilés localement, y compris avec des espaces dans le chemin, et refuse une architecture absente. Cela ne remplace pas le build complet Intel sur GitHub/Xcode 16.4.
- Le DMG Apple Silicon existant passe `verify-dmg.sh` : intégrité, signature, architectures, dépendances système, FFmpeg exécutable et sources/licences présents. Montage en lecture seule puis démontage réussis ; aucun nouveau DMG n'a été construit pour ce correctif.
- Le build Android signé via le script corrigé réussit avec Java 17 et Node 26.8.1 : 918 tâches, dont 39 exécutées et 879 à jour. L'APK passe `verify-apk.mjs` (identifiant, version 1.4.1/code 25, certificat historique, contenu natif et EAS Update désactivé). Le cache local a été réutilisé : l'absence de saturation mémoire sur un runner GitHub reste à confirmer.
- `git diff --check` réussi ; les `package.json` racine et Mobile sont identiques octet par octet à leur état avant ces corrections. Aucun commit, push, déplacement/création de tag ou lancement distant n'a été effectué pour ces corrections.

Builds GitHub confirmés le 11 septembre 2026 :

- [Release Desktop · desktop-v0.1.0](https://github.com/CoRExE/Horus/actions/runs/34562753304) et [Release Android · mobile-v1.4.1](https://github.com/CoRExE/Horus/actions/runs/34562753395) réussies sur `6067717`, avec les titres corrigés. Les vérifications, builds, contrôles des installateurs et créations de brouillons sont réussis.
- Le brouillon Desktop contient les DMG arm64 et x64, le brouillon Android contient l'APK 1.4.1/code 25 ; chacun contient `SHA256SUMS` et `release-info.json`. Présence et état des fichiers contrôlés via GitHub. Les deux releases sont encore en brouillon ; aucun essai sur appareil ni publication n'est déduit de la réussite des builds.

Extension Windows/Linux préparée le 11 septembre 2026 :

- Desktop passe en 0.1.1 dans ses quatre sources de version, pour préparer une nouvelle release distincte du brouillon 0.1.0. Android reste inchangé. Aucun tag n'est créé ou déplacé.
- Deux jobs natifs sont ajoutés au workflow Desktop (`windows-2022` / `ubuntu-24.04`). Le brouillon attend désormais les deux DMG, le NSIS Windows et le `.deb` Linux. Les contrôles de publication et notes de version couvrent ces quatre fichiers.
- Le script FFmpeg conserve les options macOS et ajoute Linux/GCC et Windows/MSYS2 UCRT64 avec contrôle des dépendances ELF/DLL. Les configurations de packaging incluent sources/licences et un sidecar nommé `horus-ffmpeg` sur Windows/Linux, prioritaire sur le nom système. Linux ne remplace pas `/usr/bin/ffmpeg` ; les chemins et priorités macOS restent inchangés.
- Les jobs génèrent les fixtures avec FFmpeg système, puis exécutent les tests Rust/média avec le sidecar Horus voisin du binaire de test. Les vérifications des paquets contrôlent architecture x64, égalité avec les binaires du build, archive source et notices, ainsi que le lancement FFmpeg avec un PATH limité aux dossiers système.
- Windows prévoit installation silencieuse NSIS dans un dossier temporaire puis désinstallation ; WebView2 est téléchargé si nécessaire. Linux prévoit extraction du `.deb`, contrôle des dépendances dynamiques et simulation APT ; les dépendances GStreamer de lecture sont déclarées. Les guides décrivent les cibles, prérequis et essais manuels restants.

Validations de l'extension :

- 17 tests Node de release passent : les nouveaux contrôles refusent les installateurs Windows/Linux absents ou altérés ainsi que les architectures PE/ELF incorrectes. Les échanges GitHub de ces tests sont simulés.
- Les workflows passent actionlint 1.7.12 et les scripts shell passent `bash -n`. Les deux configurations Tauri passent la validation du schéma de la CLI installée ; les scripts Node ajoutés passent leur contrôle de syntaxe.
- Le script FFmpeg étendu réussit sur macOS arm64 avec les sources en cache : archive SHA-256, compilation, architecture, dépendances système et exécution vérifiées.
- Les 6 tests Rust passent sur macOS, test média inclus, avec FFmpeg compilé depuis les sources. Le nouveau test de repli vers le sidecar historique passe ; le test de priorité `horus-ffmpeg` est réservé aux cibles Windows/Linux et sera exécuté sur leurs runners. Les tests HTTP ont nécessité l'autorisation d'ouvrir des sockets locales hors du bac à sable.
- `git diff --check` passe et le `package.json` racine est identique octet par octet à son état initial. Les scripts shell sont fixés en LF pour MSYS2/Git Bash. Aucun secret ni fichier généré n'est ajouté aux fichiers suivis.
- Les premiers builds et contrôles Windows/Linux n'ont pas été exécutés localement : hôte macOS et aucun daemon Docker disponible. Le script PowerShell reste à valider sur le runner Windows. Aucun lancement distant ni publication n'a été effectué pour cette extension.

Diagnostic et correction des contrôles Windows/Linux le 12 septembre 2026 :

- Le [run Desktop 0.1.1](https://github.com/CoRExE/Horus/actions/runs/34610698430), sur `7f2f6d0`, réussit les deux jobs macOS. Windows et Linux compilent FFmpeg, passent les tests Desktop (dont 19 tests UI) et les 7 tests Rust/média, puis produisent respectivement le NSIS et le `.deb`. Les deux jobs échouent ensuite dans `verify-desktop-files.mjs` sur la comparaison du binaire principal installé avec celui du build. Le job de brouillon est donc ignoré.
- Les logs montrent le patch du type de bundle par Tauri. Le [code de Tauri 2.11.4](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.11.4/crates/tauri-bundler/src/bundle.rs) remplace la première occurrence du marqueur `__TAURI_BUNDLE_TYPE_VAR_UNK` par `__TAURI_BUNDLE_TYPE_VAR_NSS` ou `__TAURI_BUNDLE_TYPE_VAR_DEB`, puis restaure le binaire original dans le dossier de build. La comparaison précédente produisait donc un faux échec sur les deux plateformes.
- Le contrôle reproduit désormais uniquement cette transformation dans une copie mémoire du binaire de référence. Toute autre différence, taille différente, marqueur absent ou mauvais type de paquet est refusé ; FFmpeg reste comparé strictement octet par octet. Aucun binaire applicatif, format de données ou réglage de packaging n'est modifié.
- Les 21 tests Node de release passent sous Node 26.8.1, dont quatre nouveaux tests du marqueur Tauri : NSIS/DEB acceptés, marqueur absent ou incorrect, fichier tronqué/allongé, modification hors marqueur, remplacement supplémentaire et altération de FFmpeg refusés. Les workflows passent actionlint 1.7.12 ; les scripts shell passent `bash -n` et le script Node modifié passe le contrôle de syntaxe.
- `git diff --check` et la comparaison du `package.json` racine avec son état initial passent. Aucun commit, push, déplacement de tag, lancement distant ou publication effectué. La vérification native complète après ce correctif reste à relancer sur GitHub ; les étapes situées après la comparaison du binaire ne sont pas encore validées.

Abandon de la cible iOS le 12 septembre 2026 :

- Décision utilisateur : aucune version iOS ne sera distribuée. Retrait de cette évolution de la feuille de route, des commandes `ios`, `build:prod:ios` et `build:prod:all`, et mise à jour des guides. Aucune validation iOS n'est requise pour clôturer le chantier 3.
- Premier retrait : les métadonnées iOS historiques d'`app.json` avaient été conservées pour le plugin release-it existant. Le nettoyage complémentaire décrit ci-dessous retire cette dépendance.
- Validation : les 21 tests Node de release passent sous Node 22.23.2 disponible localement ; `git diff --check` passe. La modification préexistante du `package.json` racine est préservée. Aucun nouveau build natif ni essai sur appareil effectué pour ce retrait.

Validations GitHub et retours utilisateur complémentaires :

- Le [workflow Desktop 0.1.1](https://github.com/CoRExE/Horus/actions/runs/34659803136), sur `aeed428`, a réussi tous les jobs : vérifications, macOS arm64/x64, Windows, Linux et création du brouillon. Les contrôles natifs après la correction du marqueur Tauri sont donc validés.
- L'utilisateur confirme que l'APK s'installe par-dessus la version précédente sans désinstallation et que l'installateur Windows fonctionne. L'essai Linux reste à effectuer. Ces retours ne détaillent pas encore les essais de lecture, Cast ou de conservation de chaque type de donnée.

Nettoyage complémentaire du code iOS :

- Suppression du module Swift du proxy vidéo, de son podspec et de son enregistrement Apple, du bloc iOS Expo, des branches de styles réservées à iOS et des icônes iOS générées par Tauri. Expo conserve les cibles Android et Web ; les valeurs de styles Android/Web restent identiques.
- Remplacement du plugin externe de version par un plugin local Android, puis retrait de sa dépendance et de ses entrées du lockfile. Les versions applicatives et le `versionCode` distribués ne sont pas modifiés.
- Les types MIME HLS et la reconnaissance des User-Agent iPhone/iPad dans le proxy Android sont conservés : ils décrivent les échanges avec les sources vidéo et ne sont pas une implémentation de l'application iOS. Les dépendances tierces multiplateformes restent gérées par Expo/React Native.
- Validations : installation `pnpm install --frozen-lockfile` réussie avec pnpm 12.3.4 et Node 26.8.1 temporaires (téléchargement nécessaire, cache local incomplet). Le lockfile ne retire que le plugin externe ; aucune autre dépendance n'est changée.
- `pnpm check` réussi : TypeScript des quatre packages, tests core/API/Desktop et 19 tests UI. Les tests ont nécessité les sockets locales hors du bac à sable. Les 24 tests de release passent, dont trois nouveaux tests exécutant réellement release-it dans des dossiers temporaires, sans Git ni publication : incrément Android seul et synchronisation des versions, compteurs invalides refusés sans écriture, préversion refusée.
- La configuration Android et la liste des plugins résolues par `expo config --type prebuild` sont identiques avant/après. `git diff --check` et la comparaison octet par octet du `package.json` racine passent. Aucun nouvel APK ou installateur n'a été construit pour ce nettoyage ; les retours utilisateur ci-dessus concernent les builds précédents. Aucun commit ni push effectué pour ce nettoyage.

État vérifié sur GitHub le 14 septembre 2026 :

- `desktop-v0.1.1` et `mobile-v1.4.1` sont publiées depuis le 12 septembre, respectivement à 02:40:20 et 02:40:42 UTC ; elles ne sont plus en brouillon. Le workflow Desktop complet est réussi. Aucun lancement du workflow manuel de publication n'apparaît dans les derniers runs consultés ; la publication observée ne valide donc pas à elle seule l'exécution de ce workflow.
- L'utilisateur confirme ensuite l'essai Linux concluant et la conservation des données Android. Le nettoyage EAS ci-dessous finalise la migration du build. Le chantier 4 n'est pas commencé.

Nettoyage EAS le 14 septembre 2026 :

- Suppression d'`eas.json`, du fichier dynamique `app.config.js` devenu inutile, du hook `useAppUpdater` non utilisé et de la commande `build:update`. `app.json` ne contient plus de propriétaire/projet EAS, d'URL OTA ou de politique de runtime ; `updates.enabled=false` reste explicite pour tous les builds.
- Retrait d'`expo-updates` et de ses dépendances devenues inutiles du lockfile, sans mise à jour des autres versions. `build:dev` compile et lance maintenant le client de développement Android via `expo run:android --variant debug`. Expo, React Native et `expo-dev-client` sont conservés.
- Les sauvegardes de la clé de signature, les secrets GitHub, les compteurs historiques de signature/version, les préférences et données applicatives sont conservés. `HORUS_ANDROID_RELEASE` reste utile au réglage Metro sans Watchman du build de release.
- Le premier prebuild local a détecté l'ancien runtime OTA dans le manifeste Android déjà généré. Le wrapper retire uniquement cette métadonnée avant Expo, sans supprimer le dossier natif ni les autres réglages. Le build de développement passe également par ce wrapper. Un test couvre une installation neuve, la conservation des autres entrées et l'idempotence de la migration.
- Validations : installation verrouillée réussie sous Node 26.8.1 et pnpm 12.3.4 ; seuls `expo-updates` et ses dépendances exclusives sont retirés du lockfile. `pnpm check` passe (TypeScript, tests core/API/Desktop, 19 tests UI), ainsi que les 25 tests de release. Le prebuild réussit sur le dossier Android existant ; l'URL et la métadonnée de runtime OTA sont absentes du manifeste généré, avec `updates.ENABLED=false`. Identifiant, version, `versionCode`, plugins et configuration Android applicative sont préservés.
- Après ce nettoyage, l'utilisateur a relancé la compilation locale (`BUILD SUCCESSFUL in 30s`), puis confirmé le contrôle de l'APK avec `verify-apk.mjs`. Le build signé et le contrôle du nouvel APK sont donc validés ; aucun APK n'est ajouté au dépôt. Les prochains builds complets sont lancés par l'utilisateur, sans surveillance répétée par l'agent.

Les cases manuelles encore ouvertes décrivent les contrôles détaillés non documentés
par les retours reçus : Finder/Gatekeeper sur Mac sans outils de développement,
parcours média et réseau détaillés sur les machines ciblées, sommes de contrôle
après téléchargement. Les installations Windows/Linux et la migration Android
avec conservation des données sont confirmées ; iOS est exclu du périmètre.
Les premiers tags ont été lancés par l'utilisateur ; les validations locales
n'ont créé aucun tag, push, brouillon ou release distant.

## 4. Détecter les mises à jour — HorusDesktop et HorusRemote

- [x] Définir le schéma du manifeste : application, plateforme, version, numéro de build si nécessaire, notes et URL des fichiers par architecture.
- [x] Configurer GitHub Pages en mode GitHub Actions, à l'adresse `https://corexe.github.io/Horus/` ; premier déploiement réussi et vérifié.
- [x] Préparer la génération et la publication des manifestes Android/macOS/Windows/Linux après publication des releases, sans mélanger les applications ni annoncer les préversions.
- [x] Valider le premier déploiement Pages après merge, puis l'accès public aux manifestes des plateformes ayant une release stable : Android 1.4.2/code 26 accessible. Desktop reste en préversion, sans manifeste attendu.
- [x] Comparer correctement les versions ; utiliser le numéro de build Android et éviter les comparaisons textuelles naïves.
- [x] Ajouter une vérification discrète au démarrage, limitée à une fois par jour.
- [x] Ajouter « Vérifier les mises à jour » dans les paramètres des deux applications.
- [x] Afficher la version disponible, ses nouveautés et les actions « Télécharger » / « Plus tard ».
- [x] Implémenter l'ouverture du téléchargement adapté dans le navigateur, sans installation silencieuse ; essais natifs encore à effectuer.
- [x] Gérer sans bloquer l'application les absences de réseau, réponses invalides et téléchargements indisponibles.
- [x] Tester les versions identiques, plus anciennes et plus récentes, ainsi que les plateformes et architectures différentes.
- [ ] Valider via les builds et essais utilisateur l'ouverture du navigateur sur les systèmes ciblés et les parcours Android sur appareil.

Travail réalisé le 14 septembre 2026 :

- Logique commune isolée dans `packages/core/src/updates.ts` : validation stricte du schéma et des URL GitHub, version stable numérique, code Android, sélection de l'architecture, temporisation et regroupement des appels simultanés. Stockage de la date de tentative dans une clé dédiée par version installée, sans modification des favoris, historiques ou préférences.
- Desktop : vérification automatique lorsque version Tauri et architecture sont connues, bouton dans les paramètres et notification non modale. Le runtime expose son architecture ; une commande native limitée aux URL des installateurs Horus ouvre le navigateur système. Le paquet Linux déclare `xdg-utils` pour cette ouverture.
- Android : ajout d'un panneau Paramètres depuis l'engrenage de l'en-tête et d'une notification discrète ; notes, téléchargement dans le navigateur et action « Plus tard ». La version et le code viennent de la configuration embarquée, contrôlée par le pipeline de release. Aucun retour à EAS/OTA.
- `updates.yml` utilise le code de la branche par défaut, les événements de release et la réussite du workflow de publication (`workflow_run`), ainsi qu'un lancement manuel. Il régénère toutes les plateformes disponibles dans un même déploiement Pages. Les brouillons et préversions sont ignorés ; une plateforme sans version stable n'a pas de manifeste. Une release sélectionnée mais incomplète/altérée bloque le déploiement.
- Le générateur contrôle `release-info.json`, `SHA256SUMS`, le commit du tag, la liste, la taille et le digest GitHub des installateurs. Il ne télécharge que les petites métadonnées, sans installer ni reconstruire d'application. Le guide `docs/UPDATES.md` décrit les premières publications et les comportements.

Validations effectuées :

- TypeScript des quatre packages réussi sous Node 26.8.1/pnpm 12.3.4. Les 22 tests UI Desktop passent, dont trois nouveaux parcours de vérification/téléchargement. Les 33 tests de release passent : versions et plateformes, Android à code supérieur, manifestes invalides, publications incomplètes/altérées, indépendance des canaux, limite quotidienne, appels simultanés, réseau absent et délai d'attente simulé.
- Génération locale sur les métadonnées réelles de GitHub réussie pour Android `mobile-v1.4.1`. Desktop `desktop-v0.1.1` est actuellement marqué **préversion**, donc exclu volontairement : il faudra une release Desktop stable pour générer ses manifestes. Aucun statut de release ni tag modifié.
- GitHub Pages activé via l'API en mode workflow ; aucun déploiement déclenché, aucun push effectué. L'environnement autorise uniquement `main` : les événements de release passent par un déclenchement sur la branche par défaut avant déploiement, sans élargir cette règle aux tags. Les workflows passent actionlint 1.7.12 ; le fichier Rust passe rustfmt et `git diff --check` passe.
- Aucun build natif ni essai sur appareil lancé par l'agent. Les appels natifs/réseau des tests UI sont simulés ; les branches Rust macOS/Windows/Linux seront compilées par les workflows lancés par l'utilisateur. Le déploiement public et les essais sur les binaires restent à valider après merge.

Validation : une release Android ne doit jamais être proposée à Desktop, et
inversement. Les manifestes et fichiers doivent être accessibles aux utilisateurs
sans embarquer de jeton GitHub privé dans les applications.

Validation du déploiement et des builds, le 14 septembre 2026 :

- L'utilisateur confirme les builds réussis après relance de Windows, initialement interrompu par des délais de téléchargement, ainsi que la publication des releases. Aucun correctif du build n'est apporté pour ce timeout transitoire.
- Les jobs de manifestes ont été consultés en lecture seule : le [dernier déploiement](https://github.com/CoRExE/Horus/actions/runs/34879127700) a réussi la génération, le transfert et GitHub Pages. Les autres déploiements consultés sont réussis ; un ancien événement `release` a été annulé, suivi de déploiements réussis. Les événements de release déclenchent une exécution supplémentaire sur `main`, conformément au workflow.
- Le manifeste public Android répond HTTP 200 et annonce `mobile-v1.4.2`, code 26. Les releases `desktop-v0.1.1` et `desktop-v0.1.2` sont publiées en préversion : les manifestes macOS/Windows/Linux sont absents (HTTP 404), conformément au filtre stable. Cela concorde avec l'erreur signalée sur Mac/Windows. Aucun statut de release n'a été modifié.
- Les essais des mises à jour sur appareil restent ouverts, notamment l'offre d'une version supérieure et l'ouverture du bon téléchargement. L'utilisateur autorise le passage au chantier 5 après vérification des jobs.

## 5. Améliorer le confort de lecture — HorusDesktop

- [x] Ajouter des raccourcis cohérents : lecture/pause, avance/recul et volume, sans intercepter la saisie dans les champs.
- [x] Implémenter le maintien éveillé pendant la lecture locale et sa libération à la pause, à l'arrêt et à la fermeture ; validation native sur machine encore à effectuer.
- [x] Améliorer la sélection des pistes audio et des sous-titres lorsque les sources et le lecteur les exposent, ainsi que la sélection des séries/animés en séparant les saisons des épisodes.
- [x] Compléter les essais automatisés du plein écran : raccourcis, fermeture, épisode suivant et retour au mode de fenêtre précédent.
- [ ] Valider la compilation des nouveaux appels natifs dans les prochains workflows Desktop macOS/Windows/Linux.
- [ ] Confirmer sur ces machines le maintien éveillé et sa libération, les pistes réellement exposées par HLS/la WebView et les interactions de plein écran.

Travail réalisé le 14 septembre 2026 :

- Ajout des raccourcis Espace/K, flèches, M et F, avec limites de volume et de déplacement dans les plages disponibles. Les champs, contrôles, dialogues et combinaisons système gardent leurs actions habituelles ; les commandes TV sont préservées.
- Sélecteurs audio/sous-titres alimentés par HLS.js ou les pistes natives exposées, avec désactivation des sous-titres, suivi des changements et nettoyage au changement de source. Les pistes de métadonnées ne sont pas affichées. Les commandes vidéo natives et les choix VF/VOSTFR de serveur sont conservés.
- Sélection Saison puis Épisode pour séries/animés ; reprise dans la bonne saison, premier épisode choisi au changement de saison, conservation des arcs/spéciaux et de l'ordre du fournisseur. Aucun changement des identifiants, du stockage ni des fournisseurs partagés avec Android.
- Maintien éveillé natif via `keepawake` 0.6.1 (écran et veille automatique seulement), sur un thread dédié pour créer et libérer le verrou sur le même thread Windows. Les demandes JS sont ordonnées ; pause/fin/erreur/remplacement/fermeture libèrent le verrou. Un refus laisse la lecture utilisable. L'aperçu navigateur utilise Screen Wake Lock si disponible.
- Transitions de plein écran ordonnées, y compris entre fermeture et nouveau lecteur : une sortie pendant l'entrée n'est plus perdue. Restauration du mode de fenêtre et du défilement, sans sortir une fenêtre déjà en plein écran à l'origine. Le parcours existant d'épisode suivant ferme/recrée le lecteur et revient au mode précédent.
- Guide des commandes et des essais manuels ajouté dans [docs/PLAYBACK.md](docs/PLAYBACK.md). Android, l'API, les données, les versions applicatives et les workflows de release ne sont pas modifiés.

Validations effectuées :

- TypeScript Desktop réussi avec Node 22.23.2 disponible localement. Les 40 tests Vitest/jsdom passent, dont 18 nouveaux tests de confort de lecture, ainsi que les 4 tests Desktop historiques (`node --import tsx --test tests/*.test.cts`). Le lanceur direct évite le socket IPC du CLI tsx interdit par le bac à sable.
- Les tests couvrent lecture/pause/volume et déplacement borné, respect des champs/dialogues, pistes HLS/natives et nettoyage, saison de reprise, fermeture pendant l'entrée en plein écran, sortie en attente, refus du système, plein écran initial et épisode suivant dans le parcours App réel.
- Les tests de veille simulent activation/pause/fin/erreur/fermeture, remplacement de source, absence d'activation TV, refus du service et acquisition tardive après fermeture ou pause/reprise.
- `rustfmt` 1.88.0 et les métadonnées Cargo `--locked --offline` passent. Résolution Cargo compatible Rust 1.88 : 45 entrées ajoutées pour la nouvelle dépendance, aucune version préexistante retirée ou modifiée. `git diff --check` passe.
- Aucun build natif ni essai de veille/lecture sur appareil lancé par l'agent. Les API natives, médias et plein écran sont simulés dans les tests JS ; leur compilation et leur comportement système restent à valider par les prochains workflows et essais utilisateur.

Compléments bibliothèque demandés et réalisés le 15 septembre 2026 :

- [x] Séparer « Ma liste » en sections Films, Séries et Animés, en conservant l'ordre des favoris dans chaque catégorie, leur ouverture et leur suppression individuelle.
- [x] Remplacer l'effacement immédiat de l'historique dans l'interface par un mode « Supprimer » : cases à cocher sur les contenus, Tout sélectionner, Tout désélectionner, confirmation avec le nombre sélectionné et Annuler. Le changement d'onglet abandonne la sélection.
- [x] Supprimer seulement les entrées sélectionnées, identifiées par fournisseur et média ; préserver les autres positions de reprise, les favoris, l'URL API et le format de stockage version 1. Un contenu ajouté après « Tout sélectionner » n'est pas supprimé sans être coché.
- Validations : TypeScript Desktop et les 45 tests UI réussis, dont cinq nouveaux tests de catégories, suppression partielle persistée/restaurée, sélection globale avec exclusion, annulation/navigation et arrivée d'une nouvelle lecture. Le parcours App existant de vidage de l'historique passe désormais par la sélection et la confirmation. `git diff --check` réussi.
- Les modifications préexistantes du chantier 5 sont conservées. Aucun changement Android, aucune compilation native et aucun essai manuel dans la WebView pour ce complément.

Corrections de lecture des animés le 19 septembre 2026 :

- [x] Afficher dans le lecteur Desktop le nom du serveur en cours, comme sur Remote.
- [x] Permettre de choisir un autre serveur de la même langue pendant la lecture d’un animé, sans attendre une erreur, avec sauvegarde/reprise de la position. Le sélecteur reste dans les contrôles en plein écran et est disponible en diffusion TV ; les fichiers hors ligne sont exclus.
- [x] Prioriser le serveur actuellement sélectionné à l’épisode suivant, manuel ou automatique, y compris après le bouton de repli sur erreur. Comparaison par nom et langue, indépendante de l’URL et de l’ordre des sources du nouvel épisode ; repli signalé dans la même langue si le serveur manque et choix explicite si la langue manque.
- Validations : TypeScript Desktop et 59 tests UI réussis, dont quatre nouveaux parcours App réels avec sources/appels natifs simulés : changement sans erreur avec conservation de la position, serveur conservé malgré changement d’URL/ordre, repli après erreur puis enchaînement automatique, serveur ou langue absents. `git diff --check` réussi. Aucun build natif ni essai sur source réelle/TV lancé.
- Le choix reste lié à la session de lecture ; stockage, fournisseurs partagés, Android et backend natif inchangés. Le chantier 6 et le déplacement du dossier vers Paramètres ont été committés séparément avant ces corrections (`b52d668`).

## 6. Améliorer les téléchargements — HorusDesktop

- [x] Ajouter une file d'attente avec suppression d'un élément et annulation du téléchargement actif.
- [x] Afficher une progression plus informative : état, octets, vitesse et estimation lorsque les informations sont disponibles.
- [x] Permettre le choix du dossier de destination et gérer les fichiers devenus introuvables : saisie d'un chemin absolu, conservation des anciens emplacements, signalement des fichiers absents.
- [x] Traiter explicitement le manque d'espace disque et les erreurs d'écriture.
- [x] Étudier séparément la reprise après interruption, selon les formats et les capacités de la source : étude documentée ; reprise partielle non implémentée.
- [ ] Valider en CI l'intégration native et le test média étendu, puis les téléchargements, dossiers externes et annulations dans les applications macOS/Windows/Linux.

Travail réalisé le 15 septembre 2026 :

- File séquentielle pendant la session : ajout depuis plusieurs fiches/épisodes, déduplication d'une demande identique, retrait d'un élément en attente, annulation de l'actif et démarrage du suivant après le nettoyage natif. Un échec signale le titre concerné et laisse la suite continuer. La fermeture abandonne la file et empêche le backend de démarrer de nouveaux téléchargements.
- Progression FFmpeg : état, octets du MP4 produit, débit d'écriture entre deux échantillons, pourcentage et temps restant estimés seulement quand la durée/vitesse du média sont disponibles. Aucun total de taille inventé ; la finalisation MP4 et les métadonnées restent nécessaires avant d'annoncer un succès.
- Dossier configurable dans Paramètres → Téléchargements par saisie d'un chemin absolu existant, contrôle d'écriture et retour au dossier par défaut. Le réglage est indisponible pendant la file. Les fichiers existants ne sont pas déplacés ; leur index reste central, avec un chemin facultatif pour préserver la compatibilité des anciennes entrées.
- Les fichiers absents restent visibles avec leur chemin ; lecture/Cast désactivés et suppression de leur référence possible. Rouvrir l'onglet actualise leur disponibilité après reconnexion d'un disque. Lecture locale et diffusion utilisent l'emplacement enregistré.
- Messages dédiés aux erreurs disque plein/écriture, sans exposer les journaux FFmpeg. Nettoyage après échec/annulation et journal des fichiers partiels pour les arrêts brutaux, limité aux fichiers identifiés du téléchargement, sans parcourir les fichiers personnels du dossier externe.
- Étude dans [docs/DOWNLOADS.md](docs/DOWNLOADS.md) : une reprise HTTP ou HLS demanderait un transfert séparé du remuxage, validation du contenu et gestion des URL/segments expirés. Aucun simple ajout d'octets au MP4 partiel ni reprise automatique n'est annoncé. Une nouvelle tentative repart du début.
- Android, API, fournisseurs partagés, bibliothèque/favoris/historique, dépendances, versions et workflows inchangés. Le répertoire de travail était propre au début du chantier.

Validations effectuées :

- TypeScript Desktop réussi sous Node 22.23.2. Les 54 tests Vitest/jsdom passent, dont neuf nouveaux tests de file, annulation, retrait, déduplication par épisode/langue, fermeture, réponse de liste obsolète, résultat pour la TV, fichiers absents, réglage de dossier et progression conditionnelle. Les quatre tests Desktop historiques passent également.
- Dix tests Rust de stockage/parseurs réussis avec Rust 1.88.0, dans un petit harnais Cargo temporaire important les modules réels, hors ligne, sans compiler Tauri : ancien index, changement de destination, absence de dossier sans repli silencieux, suppression ciblée, fichiers partiels externes, arrêt après enregistrement complet, identifiant déjà utilisé, erreur réelle d'écriture des métadonnées, diagnostics et estimations inconnues. Aucun disque réel n'a été rempli.
- Le test média existant est étendu au téléchargement HLS dans un dossier externe, à sa lecture via le relais et au refus d'un téléchargement pendant la fermeture. Cette extension n'a pas été exécutée localement ; elle sera vérifiée par la CI native.
- Compilation Vite de l’interface réussie ; seul l’avertissement existant sur les chunks de plus de 500 ko reste présent. Contrôle final le 16 septembre : TypeScript, tests ciblés de la file, rustfmt des modules modifiés et `git diff --check` réussis.
- Aucun build natif complet, essai sur appareil, commit, push, tag ou publication effectué pour ce chantier. La file ne persiste pas après fermeture et le choix de dossier se fait par saisie du chemin, sans sélecteur natif.

Ajustement de l’interface le 16 septembre 2026 :

- Le formulaire de destination est déplacé dans une carte dédiée des Paramètres. La page Téléchargements conserve un bouton discret « Dossier de téléchargement », qui ouvre cet onglet et place le focus sur la rubrique correspondante.
- Le contrôle d’écriture, l’enregistrement explicite, le retour au dossier par défaut et le verrouillage pendant le traitement de la file sont conservés. Aucun changement du backend ni des emplacements existants pour ce déplacement.
- Validation : TypeScript et `git diff --check` réussis ; 55 tests UI validés (52 au lancement complet, puis les trois tests de mise à jour après adaptation de leur simulation native au chargement du dossier). Le nouveau parcours vérifie le changement d’onglet, le focus sur la rubrique et l’absence de modification automatique du dossier.

Préparation de Desktop 0.1.4 le 19 septembre 2026 :

- La CI du merge #16 a compilé le code natif, puis détecté une fixture obsolète dans le test du relais hors ligne : le MP4 était créé sans son entrée d’index JSON. La fixture et son nettoyage sont complétés avec le format historique sans `filePath`, en conservant les assertions HTTP Range et la protection par URL de session. Aucun comportement applicatif modifié par cette correction.
- Versions Desktop alignées sur 0.1.4 ; Android reste inchangé. La nouvelle CI et la release doivent encore confirmer le test corrigé et les installateurs.

## 7. Valider la diffusion TV — HorusDesktop

- [ ] Tester DLNA et Chromecast sur de vrais appareils : découverte, démarrage, pause/reprise, volume et arrêt.
- [ ] Tester l'avance/recul sur les fichiers téléchargés ; conserver l'indication de la limite du relais MPEG-TS continu.
- [ ] Tester une déconnexion du récepteur, un changement de réseau et une nouvelle tentative de connexion.
- [ ] Documenter les appareils testés et les limites de codecs/sous-titres observées.

## Évolutions ultérieures — à décider

- [ ] Synchronisation des favoris et de l'historique entre Mobile et Desktop : définir le stockage et les règles de conflit avant implémentation.
- [ ] Mises à jour JavaScript à distance auto-hébergées, uniquement si le besoin justifie un service compatible avec le protocole Expo Updates.
