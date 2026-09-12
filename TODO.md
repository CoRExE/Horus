# TODO — Prochaines évolutions de Horus

Dernière mise à jour : 12 septembre 2026.

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
- [ ] Publier des fichiers identifiables par version et architecture dans GitHub Releases.
- [ ] Tester l'installation depuis Finder sur un environnement sans les outils de développement du projet.

### Android — HorusRemote

- [x] Récupérer et sauvegarder la clé de signature des APK existants si elle est gérée par EAS ; conserver la continuité des mises à jour.
- [x] Générer le projet Android via `expo prebuild` et compiler un APK release signé avec Gradle.
- [x] Vérifier l'intégration des modules natifs à la compilation et dans l'APK, notamment le proxy vidéo et Google Cast ; les essais sur appareil restent à effectuer.
- [x] Remplacer les scripts de build EAS de production/preview Android et reporter les variables nécessaires dans le nouveau workflow ; les scripts EAS de développement Android sont conservés jusqu'à validation de la migration. Les commandes iOS sont retirées à la suite de l'abandon de cette cible.
- [x] Reprendre la gestion du `versionCode` depuis la dernière valeur réellement distribuée, y compris les incréments gérés à distance par EAS.
- [x] Tester l'installation de l'APK par-dessus la version existante sans désinstallation : mise à jour confirmée par l'utilisateur.
- [ ] Publier l'APK dans GitHub Releases et confirmer explicitement la conservation des favoris, historiques et préférences.
- [x] Désactiver EAS Update dans le nouveau binaire et adapter les éventuels appels associés ; la migration exige l'installation de ce binaire.
- [ ] Retirer la configuration EAS devenue inutile une fois la migration validée.

### Windows — HorusDesktop

- [x] Retenir une cible initiale : Windows 11 x64, installateur NSIS `.exe` pour l'utilisateur courant ; adéquation aux machines personnelles à confirmer par l'utilisateur.
- [x] Configurer le build Windows dans GitHub Actions avec MSVC, MSYS2 UCRT64, dépendances, caches et commandes de tests Desktop/média.
- [x] Compiler Windows et exécuter les tests Desktop/média sur GitHub ; installateur NSIS généré et installation silencieuse terminée sans erreur.
- [x] Valider jusqu'au bout les contrôles des fichiers installés Windows et le workflow complet.
- [x] Embarquer FFmpeg pour Windows avec ses sources et licences, et vérifier son exécution sans installation système de FFmpeg.
- [x] Produire l'installateur et documenter les dépendances d'exécution ainsi que les éventuelles étapes de confiance nécessaires à l'installation pour un usage personnel.
- [x] Valider l'installation Windows sur la machine de l'utilisateur : installateur confirmé fonctionnel.
- [ ] Tester sur une machine Windows sans outils de développement l'installation, le lancement, la lecture, les téléchargements et l'accès au réseau local ; vérifier qu'une mise à jour conserve les préférences, favoris et historiques.
- [ ] Publier l'installateur dans la release Desktop avec un nom indiquant version, plateforme et architecture, et vérifier sa somme de contrôle après téléchargement.

### Linux — HorusDesktop

- [x] Retenir une cible initiale : Ubuntu 24.04 x64, paquet `.deb` ; adéquation aux machines personnelles à confirmer par l'utilisateur.
- [x] Configurer le build Linux dans GitHub Actions avec les dépendances système Tauri, caches et commandes de tests Desktop/média.
- [x] Compiler Linux et exécuter les tests Desktop/média sur GitHub ; paquet `.deb` généré, version/architecture du paquet vérifiées et extraction réussie.
- [x] Valider jusqu'au bout les contrôles des fichiers extraits Linux et le workflow complet.
- [x] Embarquer FFmpeg pour Linux avec ses sources et licences, et vérifier son exécution sans installation système de FFmpeg.
- [ ] Produire les paquets retenus et documenter leurs dépendances d'exécution ; vérifier leur compatibilité sur les distributions ciblées.
- [ ] Tester sur une machine Linux sans outils de développement l'installation, le lancement, la lecture, les téléchargements et l'accès au réseau local ; vérifier qu'une mise à jour conserve les préférences, favoris et historiques.
- [ ] Publier les paquets dans la release Desktop avec des noms indiquant version, plateforme et architecture, et vérifier leurs sommes de contrôle après téléchargement.

Windows et Linux ont été intégrés au périmètre le 11 septembre 2026 ; leur
pipeline 0.1.1 est entièrement réussi. L'installation Windows est confirmée par
l'utilisateur ; l'essai manuel Linux reste à effectuer.
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

À terminer avant de clôturer ce chantier : essais Finder/Gatekeeper sur un Mac sans
outils de développement, confirmation de la conservation des données Android et
essai des modules natifs sur appareil, puis essais Linux et publication. Aucun
appareil Android n'était connecté lors de la détection ADB. La configuration EAS
restante ne sera retirée qu'après ces validations Android ; iOS est désormais exclu du périmètre.
L'extension Windows et Linux décrite ci-dessus, jusqu'à la publication et aux
essais sur les machines ciblées, est également nécessaire pour clôturer le chantier.
Les premiers tags ont été lancés par l'utilisateur ; les validations locales
n'ont créé aucun tag, push, brouillon ou release distant.

## 4. Détecter les mises à jour — HorusDesktop et HorusRemote

- [ ] Définir le schéma du manifeste : application, plateforme, version, numéro de build si nécessaire, notes et URL des fichiers par architecture.
- [ ] Configurer un hébergement public statique, par exemple GitHub Pages : `updates/android.json` et `updates/macos.json`.
- [ ] Générer et publier chaque manifeste depuis le workflow de release, sans écraser celui de l'autre plateforme ni annoncer une préversion comme stable.
- [ ] Comparer correctement les versions ; utiliser le numéro de build Android lorsque nécessaire et éviter les comparaisons textuelles naïves.
- [ ] Ajouter une vérification discrète au démarrage, limitée à une fois par jour.
- [ ] Ajouter « Vérifier les mises à jour » dans les paramètres des deux applications.
- [ ] Afficher la version disponible, ses nouveautés et les actions « Télécharger » / « Plus tard ».
- [ ] Ouvrir le téléchargement adapté dans le navigateur ; aucune installation silencieuse prévue.
- [ ] Gérer sans bloquer l'application les absences de réseau, réponses invalides et téléchargements indisponibles.
- [ ] Tester les versions identiques, plus anciennes et plus récentes, ainsi que les plateformes et architectures différentes.

Validation : une release Android ne doit jamais être proposée à Desktop, et
inversement. Les manifestes et fichiers doivent être accessibles aux utilisateurs
sans embarquer de jeton GitHub privé dans les applications.

## 5. Améliorer le confort de lecture — HorusDesktop

- [ ] Ajouter des raccourcis cohérents : lecture/pause, avance/recul et volume, sans intercepter la saisie dans les champs.
- [ ] Empêcher la mise en veille pendant la lecture locale et rétablir le comportement normal à la pause, à l'arrêt et à la fermeture.
- [ ] Améliorer la sélection des pistes audio et des sous-titres lorsque les sources et le lecteur les exposent.
- [ ] Compléter les essais du plein écran : raccourcis, fermeture, épisode suivant et retour au mode de fenêtre précédent.

## 6. Améliorer les téléchargements — HorusDesktop

- [ ] Ajouter une file d'attente avec suppression d'un élément et annulation du téléchargement actif.
- [ ] Afficher une progression plus informative : état, octets, vitesse et estimation lorsque les informations sont disponibles.
- [ ] Permettre le choix du dossier de destination et gérer les fichiers devenus introuvables.
- [ ] Traiter explicitement le manque d'espace disque et les erreurs d'écriture.
- [ ] Étudier séparément la reprise après interruption, selon les formats et les capacités de la source.

## 7. Valider la diffusion TV — HorusDesktop

- [ ] Tester DLNA et Chromecast sur de vrais appareils : découverte, démarrage, pause/reprise, volume et arrêt.
- [ ] Tester l'avance/recul sur les fichiers téléchargés ; conserver l'indication de la limite du relais MPEG-TS continu.
- [ ] Tester une déconnexion du récepteur, un changement de réseau et une nouvelle tentative de connexion.
- [ ] Documenter les appareils testés et les limites de codecs/sous-titres observées.

## Évolutions ultérieures — à décider

- [ ] Synchronisation des favoris et de l'historique entre Mobile et Desktop : définir le stockage et les règles de conflit avant implémentation.
- [ ] Mises à jour JavaScript à distance auto-hébergées, uniquement si le besoin justifie un service compatible avec le protocole Expo Updates.
