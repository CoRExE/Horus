# Audit fonctionnel Desktop / Remote — 22 septembre 2026

Audit du code local après l'ajout du statut « Vu », du regroupement de Ma Liste
et de la mise à niveau de l'historique Remote. Ces changements ne font pas encore partie des versions publiées.
Il s'agit des fonctions exposées par Horus, pas d'une validation sur téléviseur ou
téléphone. Les contrôles fournis par le lecteur natif Android peuvent varier selon
l'appareil ; leur simple délégation ne prouve pas une parité avec les commandes
développées dans Desktop.

## Bibliothèque et catalogue

| Fonction | Desktop | Remote Android |
| --- | --- | --- |
| Recherche films/séries et animés | Catalogue HorusApi/Vidzy et Anime-sama | Mêmes fournisseurs actifs et résolution des variantes VF |
| Worker du catalogue configurable | Paramètres, URL persistée ; valeur de build facultative | Paramètres, URL persistée ; aucun worker imposé |
| Ma Liste par catégorie | Films, Séries, Animés | Même regroupement ajouté dans ce changement ; « Wishlist » renommé « Ma liste » |
| Marquer comme vu sans retirer | Ajouté : bouton À voir/Vu | Ajouté : bouton À voir/Vu |
| Sémantique de Vu | Statut manuel du titre entier, réversible et persistant | Identique ; ni historique ni épisodes modifiés automatiquement |
| Retirer un favori | Cœur sur les cartes et dans les détails | Depuis les détails du média |
| Historique | Dernier épisode, position, durée, date ; jusqu'à 200 titres | Dernier épisode, position, durée et date ; conservation des anciennes entrées sans limite ajoutée |
| Supprimer certains titres de l'historique | Sélection, tout sélectionner/désélectionner, confirmation | Même parcours ajouté ; suppression indépendante des favoris et téléchargements |
| Synchronisation entre appareils | Absente | Absente ; favoris, historique, statuts Vu et paramètres restent locaux |

Sources : [bibliothèque Desktop](../apps/HorusDesktop/src/store/library.ts),
[écran Ma Liste/Historique Desktop](../apps/HorusDesktop/src/screens/LibraryScreen.tsx),
[store Remote](../apps/HorusRemote/store/useUserStore.ts),
[interface Remote](../apps/HorusRemote/App.tsx),
[statut et regroupement communs](../packages/core/src/library.ts).

Le statut Vu est conservé si un titre est retiré puis ajouté de nouveau. Les
listes existantes sont considérées comme non marquées ; l'historique n'est pas
utilisé pour déduire si un titre a été terminé. Les identifiants du statut incluent
le fournisseur, le type et l'identifiant du média.

## Lecture sur l'appareil

| Fonction | Desktop | Remote Android |
| --- | --- | --- |
| Reprise après fermeture | Reprise à la position mémorisée, sous réserve du flux | Reprise au dernier point enregistré, en lecture locale et sur TV si le déplacement est supporté ; anciennes entrées sans position au début de l'épisode |
| Nom du serveur | Affiché | Affiché |
| Langue avant lecture | Choix des sources/langues | Modale de langue |
| Changer de langue/serveur pendant une lecture qui fonctionne | Sélecteurs accessibles en mode fenêtre, conservation de position | Pas de sélecteur pendant la lecture ; bouton de repli proposé après erreur |
| Conservation du serveur au prochain épisode d'animé | Préférence pour le serveur actuel dans la même langue, repli signalé | Pas de préférence de serveur conservée ; nouvelles sources essayées dans leur ordre |
| Épisode suivant sur le lecteur local | Bouton et enchaînement à la fin | Aucun bouton suivant ni enchaînement automatique dans `VideoPlayer` |
| Pistes audio et sous-titres | Sélecteurs dédiés HLS/natifs ; audio seulement si plusieurs pistes | Contrôles délégués à Expo Video ; pas de sélecteur Horus équivalent |
| Plein écran | Gestion dédiée ; barre de choix des sources masquée | Plein écran natif et masquage de la navigation Android |
| Raccourcis clavier | Lecture, déplacement, volume, muet, plein écran | Interface tactile ; pas de raccourcis Horus équivalents |
| Image dans l'image | Pas de commande dédiée exposée | `allowsPictureInPicture` activé dans Expo Video ; support réel à confirmer sur appareil |

Sources : [lecteur Desktop](../apps/HorusDesktop/src/components/Player.tsx),
[orchestration Desktop](../apps/HorusDesktop/src/hooks/usePlayback.ts),
[pistes Desktop](../apps/HorusDesktop/src/components/usePlayerTracks.ts),
[lecteur Android](../apps/HorusRemote/components/VideoPlayer.tsx),
[orchestration Remote](../apps/HorusRemote/App.tsx).

## Téléchargements et diffusion TV

| Fonction | Desktop | Remote Android |
| --- | --- | --- |
| Téléchargement d'un épisode ou d'un lot | Oui, choix de langue ; traitement séquentiel | Oui, choix de langue ; traitement séquentiel |
| File d'attente | Visible dans Téléchargements, retrait d'une entrée en attente | Progression du lot dans une modale ; annulation globale, pas de gestion individuelle des entrées restantes |
| Persistance des lots restants | Non, file limitée à la session | Non ; seule la tâche active est mémorisée pour pouvoir être retentée au redémarrage, sans promettre une reprise des octets |
| Lecture et diffusion hors ligne | Oui | Oui |
| Dossier de destination | Configurable dans Paramètres ; anciens fichiers conservés à leur emplacement | Stockage privé Android ; pas de sélecteur de dossier |
| Fichier hors ligne manquant | Signalé comme introuvable dans la bibliothèque | Entrée supprimée lors de la réconciliation au démarrage |
| Découverte et contrôle DLNA/Chromecast | Oui : lecture/pause, arrêt, position et volume selon le récepteur | Oui ; télécommande avec ±10 s, muet et épisodes précédent/suivant |
| Épisode précédent sur la TV | Pas de bouton dédié ; suivant disponible | Précédent et suivant, avec conservation de la langue |
| Choisir explicitement la langue/le serveur en cours de diffusion | Sélecteurs disponibles | Pas de sélecteurs équivalents dans la télécommande |
| Télécharger avant de diffuser | Mode qui conserve le fichier dans la bibliothèque | Mode cache temporaire, distinct de la bibliothèque hors ligne |
| Qualité du cache TV | Pas de choix global 720p/1080p équivalent | Choix explicite 720p ou 1080p pour la préparation du cache |
| Prévention de la veille | Verrou natif pendant lecture locale/TV ; libération à la pause ou à l'arrêt | Service Android avec verrous CPU/Wi-Fi pour les opérations du proxy ; notification et commandes média selon le mode |
| Contrôles en arrière-plan | Pas d'interface de notification média comparable | Service de premier plan et notification pour les opérations prises en charge par le proxy |

Sources : [file Desktop](../apps/HorusDesktop/src/hooks/useDownloads.ts),
[écran téléchargements](../apps/HorusDesktop/src/screens/DownloadsScreen.tsx),
[destination](../apps/HorusDesktop/src/components/DownloadSettings.tsx),
[modes TV Desktop](../apps/HorusDesktop/src/hooks/useCasting.ts),
[télécommande Android](../apps/HorusRemote/components/CastController.tsx),
[modes TV Android](../apps/HorusRemote/components/UnifiedCastModal.tsx),
[service Android](../apps/HorusRemote/modules/local-video-proxy/android/src/main/java/expo/modules/localvideoproxy/StreamingForegroundService.kt).

Les deux applications restent soumises aux formats supportés par le téléviseur.
Le relais continu MPEG-TS limite le déplacement dans la vidéo ; la présence de
VOSTFR ne garantit pas que des sous-titres séparés seront affichés en DLNA.

## Plateformes et mises à jour

Les deux applications détectent les nouvelles versions via les manifestes communs,
proposent une vérification manuelle et ouvrent le téléchargement de l'installateur.
Elles n'installent pas silencieusement les mises à jour. Desktop cible macOS,
Windows et Linux ; Remote cible Android. iOS reste exclu. La preview Android
distincte, le clavier intégré et la gestion des boutons de navigation sont des
adaptations à Android, pas des fonctions à recopier telles quelles sur Desktop.

Sources : [vérification commune](../packages/core/src/updates.ts),
[mises à jour Remote](../apps/HorusRemote/hooks/useReleaseUpdates.ts),
[mises à jour Desktop](../apps/HorusDesktop/src/hooks/useUpdates.ts).

## Priorités proposées

1. Valider sur Android réel la reprise et la suppression sélective de l'historique,
   désormais implémentées : fermeture, redémarrage et essais DLNA/Chromecast.
2. Compléter le lecteur local Remote : épisode suivant, changement de langue/serveur
   sans attendre une erreur, conservation de position et préférence de serveur.
3. Améliorer la file Remote : consulter et retirer les épisodes en attente ; décider
   séparément si la file complète doit survivre à un redémarrage.
4. Sur Desktop, envisager les commandes TV précédent/muet/±10 s si elles sont utiles.
   Le choix d'un dossier Android et la synchronisation entre appareils nécessitent
   des décisions de stockage ; ils ne sont pas nécessaires pour aligner la lecture.

Point de fiabilité repéré, partiellement traité : les favoris/historiques
Desktop sont identifiés par fournisseur + identifiant, les favoris Remote par
identifiant seul. L'historique Remote utilise désormais fournisseur + type +
identifiant, avec inférence du fournisseur des anciennes entrées. `VidzyProvider`
encode toujours un média avec son numéro TMDB sans son type.
Un film et une série partageant le même numéro peuvent donc se confondre dans la
bibliothèque existante hors historique Remote. Ce risque mérite une migration dédiée des
identifiants, avec préservation des données, plutôt qu'un changement implicite ici.
Le nouveau statut Vu distingue déjà le type, mais ne migre pas ces anciennes clés.

Sources : [identifiants Vidzy](../packages/core/src/providers/Vidzy.ts),
[identifiants Desktop](../apps/HorusDesktop/src/store/library.ts),
[identifiants Remote](../apps/HorusRemote/store/useUserStore.ts).

## Validations de ce changement

TypeScript Core/Remote/Desktop, tests Core, 71 tests UI Desktop et 17 tests de
logique Remote réussis. Les nouveaux tests couvrent la persistance de Vu,
sa réversibilité, la conservation de la liste et de l'historique, le retrait/réajout
du favori, la distinction des identifiants et l'ordre des catégories.
Les sept tests ajoutés pour l'historique Remote couvrent la suppression ciblée
persistée, les anciennes entrées, la reprise du même épisode, les événements
tardifs, la fin de lecture, la libération du lecteur et la demande de reprise TV
avec récepteur simulé. TypeScript Remote et l'export Android ont été relancés
après cette modification.
La compilation Vite et l'export JavaScript Android Metro/Hermes passent.
Aucun APK ni build natif lancé ; le rendu tactile et la persistance après
redémarrage réel de Remote restent à confirmer sur téléphone, ainsi que la reprise
sur DLNA/Chromecast.
