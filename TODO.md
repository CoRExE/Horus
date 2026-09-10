# TODO — Prochaines évolutions de Horus

Dernière mise à jour : 10 septembre 2026.

Cette feuille de route reprend les prochaines évolutions discutées. Les cases
non cochées correspondent à du travail à réaliser, pas à des fonctionnalités
déjà livrées. L'ordre ci-dessous est un ordre de réalisation proposé.

## Périmètre

| Zone | Modifications prévues |
| --- | --- |
| `apps/HorusDesktop` | Réorganisation du code, lecteur, téléchargements, diffusion TV, builds macOS pour usage personnel et vérification des versions. |
| `apps/HorusRemote` | Builds Android sans EAS, gestion des versions et vérification des versions publiées. |
| `.github/workflows` et configuration du dépôt | Tests, compilation, releases et publication des informations de mise à jour. |
| `packages/core` | Uniquement les fonctions réellement communes aux deux clients, si leur extraction est utile ; vérifier les deux applications après modification. |
| `apps/HorusApi` | Aucun changement fonctionnel prévu pour ces chantiers. |

La réorganisation de l'interface et les améliorations du lecteur décrites ici
visent Desktop. Le travail sur les releases et la vérification des mises à jour
concerne aussi Mobile. La TODO graphique existante de
[HorusRemote](apps/HorusRemote/TODO.md) reste un document distinct.

## Décisions retenues

- Conserver Expo et React Native pour Mobile ; remplacer EAS Build par des builds natifs dans GitHub Actions.
- L'application est destinée à un usage personnel, sans objectif de distribution au public ni de publication sur les stores officiels.
- Commencer la génération automatisée des installateurs par macOS et Android.
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
- [ ] Configurer les dépendances et le cache Gradle lors de l'ajout du build Android au chantier 3 : aucun job Gradle n'existe encore.
- [ ] Faire dépendre les jobs de release de la réussite des vérifications. Le workflow est réutilisable via `workflow_call`, mais son appel et la dépendance `needs` seront à ajouter aux workflows de release du chantier 3.
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

- [ ] Alléger `src/App.tsx` en séparant les écrans catalogue, bibliothèque, téléchargements et paramètres.
- [ ] Extraire la fiche média : saisons/épisodes, langues et serveurs.
- [ ] Centraliser le cycle de lecture dans un hook ou service dédié : démarrage, reprise, arrêt, changement de serveur et épisode suivant.
- [ ] Isoler la coordination des téléchargements et celle de la diffusion TV de leur affichage.
- [ ] Garantir une séquence de fermeture cohérente : sauvegarde de progression, arrêt et libération des ressources.
- [ ] Procéder par extractions successives, à comportement identique, avec vérification des parcours après chaque étape.

Validation : les parcours actuels restent disponibles sans modification des
préférences, favoris ou historiques existants. Éviter une réécriture globale.

## 3. Automatiser les releases — Desktop, Mobile et dépôt

### Socle commun

- [ ] Ajouter des workflows déclenchés par les tags propres à chaque application, avec possibilité de lancement manuel.
- [ ] Définir la source de vérité des versions et vérifier la cohérence des fichiers de configuration avec le tag.
- [ ] Prévoir les secrets de signature dans GitHub, sans les ajouter au dépôt ni aux journaux.
- [ ] Construire les installateurs et préparer les notes de version.
- [ ] Définir le passage brouillon → publication, puis publier les informations de mise à jour seulement lorsque les fichiers sont disponibles.

### macOS — HorusDesktop

- [ ] Construire et vérifier les binaires Apple Silicon et Intel.
- [ ] Intégrer FFmpeg pour rendre les téléchargements autonomes ; vérifier les binaires par architecture et les obligations de redistribution.
- [ ] Vérifier la signature et l'installation des builds macOS pour l'usage personnel prévu.
- [ ] Publier des fichiers identifiables par version et architecture dans GitHub Releases.
- [ ] Tester l'installation depuis Finder sur un environnement sans les outils de développement du projet.

### Android — HorusRemote

- [ ] Récupérer et sauvegarder la clé de signature des APK existants si elle est gérée par EAS ; conserver la continuité des mises à jour.
- [ ] Générer le projet Android via `expo prebuild` et compiler un APK release signé avec Gradle.
- [ ] Vérifier l'intégration des modules natifs du projet, notamment le proxy vidéo et Google Cast.
- [ ] Remplacer les scripts de build EAS et reporter les variables de build nécessaires dans le nouveau workflow.
- [ ] Reprendre la gestion du `versionCode` depuis la dernière valeur réellement distribuée, y compris les incréments gérés à distance par EAS.
- [ ] Publier l'APK dans GitHub Releases et tester son installation par-dessus la version existante sans perte de données.
- [ ] Désactiver EAS Update dans le nouveau binaire et adapter les éventuels appels associés ; la migration exige l'installation de ce binaire.
- [ ] Retirer la configuration EAS devenue inutile une fois la migration validée.

Validation : les releases suivantes doivent pouvoir être produites sans EAS.
La récupération initiale des clés ou numéros de build peut nécessiter un accès
au projet EAS existant.

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

- [ ] Versions Desktop Windows/Linux : compilation, dépendances, installation et essais réels.
- [ ] Usage personnel sur iOS sans EAS : audit des modules natifs, build Xcode et installation sur les appareils de développement.
- [ ] Synchronisation des favoris et de l'historique entre Mobile et Desktop : définir le stockage et les règles de conflit avant implémentation.
- [ ] Mises à jour JavaScript à distance auto-hébergées, uniquement si le besoin justifie un service compatible avec le protocole Expo Updates.
