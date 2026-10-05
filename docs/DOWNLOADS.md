# Téléchargements Desktop et Android

## File d’attente Desktop

Dans une fiche, « Télécharger » démarre le fichier ou l’ajoute à la suite du
fichier actif. Une même demande (fournisseur, média, épisode, langue et URL) ne
peut pas être ajoutée deux fois pendant son traitement. On peut changer
l’épisode ou ouvrir une autre fiche pour ajouter d’autres contenus.

L’onglet Téléchargements affiche les éléments en attente et leur bouton
« Retirer ». « Annuler » arrête le fichier actif ; le suivant ne démarre
qu’après la fin de la commande native et le nettoyage. Un échec est signalé avec
le titre concerné et laisse les demandes suivantes continuer. Le parcours
« Télécharger puis diffuser » conserve le résultat du téléchargement pour la TV.

La file vit pendant la session de l’application : elle n’est pas restaurée après
fermeture. Quitter annule le fichier actif et abandonne les demandes en attente.
Les URL des sources ne sont pas enregistrées dans un nouveau stockage persistant.

## Sélection d’épisodes — Desktop et Android

Pour une série ou un animé, « Télécharger plusieurs épisodes » ouvre une sélection
avec cases à cocher. Choisir la langue avant de confirmer : une langue absente est
signalée et ne se transforme jamais automatiquement en une autre langue. Les épisodes
sont traités dans l’ordre du catalogue, indépendamment de l’ordre des clics. Les sources
sont résolues au démarrage de chaque épisode pour éviter d’attendre avec des URL expirées.
Les épisodes déjà téléchargés dans la même langue sont ignorés.

Sur Desktop, la sélection ajoute les épisodes à la file habituelle. On peut sélectionner
ou désélectionner tous les épisodes, retirer individuellement ceux en attente et annuler
l’actif, y compris pendant la résolution des serveurs. Un échec laisse les suivants
continuer. Si un serveur était choisi dans la fiche, il est préféré lorsqu’il existe
dans la langue demandée ; sinon le premier serveur de cette langue est retenu.

Sur Android, la sélection peut couvrir plusieurs saisons. « Toute la saison » ajoute
les épisodes de la saison affichée et « Tout désélectionner » efface la sélection entière.
La confirmation affiche le titre, la langue, le numéro dans le lot et la progression du
fichier courant. Les serveurs de la langue demandée sont essayés successivement selon
le mécanisme existant. Un bilan final liste les échecs sans interrompre le lot. Annuler
arrête le fichier actif et abandonne les épisodes restants après nettoyage ; les fichiers
déjà terminés sont conservés. Arrêter la lecture ou la diffusion avant de lancer ce lot.

Les lots restent limités à la session. Android conserve le mécanisme existant de récupération
du seul épisode actif après interruption, désormais avec sa langue choisie ; les épisodes
pas encore commencés doivent être sélectionnés à nouveau. La récupération repart du début,
sans reprise partielle. Aucun changement du format des fichiers hors ligne existants.

Validation le 21 septembre 2026 : 66 tests Desktop, 6 tests de logique Android (lot,
annulation, clavier et cycle d’immersion), TypeScript Desktop/Remote, build Vite et export
JavaScript Android réussis. Les téléchargements et l’annulation sur appareils réels restent
à confirmer. Aucun APK ni binaire Desktop compilé par l’agent pour cette modification.

## Progression

### Audit du débit des animés — 25 septembre 2026

Signalement utilisateur : SNK et Radiant en VF, environ 500 Ko/s à 1 Mo/s
sur Desktop et un téléchargement encore plus lent sur Remote. Saison/épisode
exacts, version installée et mode Remote (hors ligne ou préparation TV) non précisés.
Les mesures ci-dessous portent sur les premiers épisodes de la saison 1 et ne
constituent pas une reproduction complète du cas utilisateur.

Constats dans le code :

- Desktop ne passe ni `-re` ni `-readrate` à FFmpeg et utilise `-c copy` : pas de
  cadence de lecture imposée ni de réencodage. Le relais Rust transmet le corps
  HTTP en continu et conserve les requêtes Range. Le débit affiché mesure le
  MP4 écrit, pas tout le trafic réseau.
- Remote utilise une seule connexion pour un MP4. Le cache HLS utilise jusqu'à
  quatre transferts de segments simultanés, assemblés dans l'ordre ; un segment
  lent en tête peut laisser les autres travailleurs inactifs. L'audio HLS séparé
  est téléchargé après la vidéo. Les événements de progression HLS comptent les
  segments assemblés, pas les octets déjà reçus par tous les travailleurs.
- Aucun plafond explicite en octets/seconde repéré dans ces parcours. Les pauses
  trouvées concernent les nouvelles tentatives après erreur ou d'autres parcours
  de lecture, pas la boucle normale de téléchargement.
- Remote vérifie l'espace libre à chaque bloc de lecture MP4/HLS et synchronise
  chaque segment HLS temporaire sur disque avant assemblage. Ce travail est une
  piste d'optimisation, pas une cause mesurée de la lenteur sur téléphone.
- Remote privilégie les sources MP4 et essaie les serveurs suivants seulement
  après un échec, sans choix manuel ni bascule sur simple lenteur. Desktop utilise
  le serveur choisi dans la fiche ; un lot préfère ce serveur s'il est disponible,
  sinon le premier de la langue demandée. Aucun des deux ne compare les débits.

Mesures effectuées sur le Mac, sans build ni téléchargement d'épisode complet :

| Échantillon | Résultat |
| --- | --- |
| Radiant S1E1 VF, Sibnet, GET direct limité à 8 Mio | HTTP 200, 1,99 s, environ 4,03 Mio/s |
| Même source, Range de 8 Mio | HTTP 206, 1,99 s, environ 4,02 Mio/s |
| Même source, FFmpeg en copie, extrait de 120 s de vidéo | Succès en 4,54 s, MP4 de 20 257 582 octets, environ 4,26 Mio/s ; une requête Range amont |
| Même source, GET direct limité à 64 Mio | HTTP 200, 5,25 s, environ 12,19 Mio/s |
| Radiant S1E2 VF, Sibnet, GET direct limité à 15 s | HTTP 200, 27 901 952 octets, environ 1,77 Mio/s ; arrêt volontaire à la limite |

Le test FFmpeg utilise les options de téléchargement de Desktop avec un relais
Node temporaire préservant les en-têtes et Range. Il vérifie le remuxage et le
transfert, **pas le relais Rust réel ni le binaire Desktop installé**. FFmpeg est
le binaire local du Mac ; l'échantillon MP4 a été supprimé. Les essais réseau sont
plafonnés en durée/volume, les corps des GET directs ne sont pas conservés. Les
variations entre essais ne permettent pas de conclure à un bridage fixe de Horus
ou du fournisseur. Aucun essai Android réel n'a été effectué.

Autre problème identifié : les listes VF de ces deux séries annoncent notamment
Sibnet, Sendvid et des lecteurs que Horus ne prend pas en charge. Pour Radiant
S1E1, Sendvid expose un MP4 dans `video_source`/`source`, alors que l'extracteur
actuel ne reconnaît qu'une URL `.m3u8` sans paramètres. Horus ignore donc cette
source. Le lien Sendvid observé contient `rate=250k` : indice d'une limitation
côté hébergeur, sans mesure du débit effectif de cette source. Restaurer son
extraction ne garantit pas d'accélérer les téléchargements.

Les sources Horus de SNK S1E1/S1E2 VF n'ont pas été résolues pendant ces essais ;
une requête complémentaire à la page Sibnet S1E1 a renvoyé une page « 400 Bad
request ». Aucun débit SNK n'a donc été mesuré ; cela ne prouve pas une
indisponibilité générale des autres saisons ou appareils.

Suite : reproduire avec l'épisode exact dans les applications installées,
identifier le serveur réellement utilisé, comparer le débit direct et le débit
du relais Rust, puis mesurer sur Android avec le même réseau et la même source.
Corriger séparément l'extraction Sendvid et ajouter un choix explicite du serveur
de téléchargement sur Remote. Évaluer les vérifications/synchronisations disque
Android avant de les réduire. Ne pas multiplier aveuglément les connexions MP4
ni changer automatiquement de langue/qualité pour afficher un meilleur débit.

Les événements [FFmpeg `-progress`](https://ffmpeg.org/ffmpeg.html#Advanced-options)
alimentent les octets du MP4 produit, le débit d’écriture mesuré entre deux
échantillons et l’état préparation/téléchargement/finalisation/annulation.
Ce débit décrit le fichier écrit, pas le trafic réseau total.

Lorsque FFmpeg expose une durée exploitable et une vitesse de traitement,
l’interface affiche une estimation du pourcentage et du temps restant. Aucun
volume final ni délai n’est inventé pour une source inconnue ou en direct. Le
pourcentage reste inférieur à 100 % jusqu’au succès : la préparation du MP4
(`faststart`) et l’enregistrement des métadonnées peuvent encore échouer.
Les erreurs disque plein et les erreurs d’écriture reconnues donnent des
messages dédiés, sans afficher les journaux FFmpeg ou leurs URL.

## Destination et fichiers absents

Dans Paramètres → Téléchargements, coller le **chemin absolu d’un dossier existant**, puis
« Enregistrer le dossier ». Le dossier est vérifié par création/suppression d’un
petit fichier temporaire ; il doit rester accessible pendant le téléchargement.
Le changement est désactivé pendant le traitement de la file. « Dossier par
défaut » restaure le dossier de données Horus. Il n’y a pas de sélecteur natif de
dossiers dans cette première interface.

La page Téléchargements garde uniquement un bouton « Dossier de téléchargement »
qui ouvre les Paramètres et cible cette rubrique.

Le choix concerne les futurs téléchargements. Aucun ancien fichier n’est déplacé.
L’index JSON reste dans les données de l’application ; chaque nouvelle entrée
indique le chemin du MP4. Les anciennes entrées, sans ce champ, continuent de
pointer vers le dossier historique. Favoris et historique de lecture ne changent
pas. Les noms UUID des fichiers sont conservés.

Un fichier absent reste affiché avec « Fichier introuvable » et son emplacement.
La lecture et la diffusion sont désactivées. Rebrancher son disque, puis rouvrir
l’onglet, actualise la liste. Supprimer une entrée dont le fichier est absent
retire sa référence de la bibliothèque ; cela ne supprimera pas ultérieurement
un fichier situé sur un disque actuellement débranché.

Les fichiers partiels sont nettoyés après échec ou annulation. Un petit journal
central permet également de nettoyer les fichiers précis d’un téléchargement
interrompu après un arrêt brutal, y compris dans un dossier externe, au prochain
démarrage. Aucun balayage destructif du dossier externe n’est effectué. Si son
disque est absent ou refuse le nettoyage, le journal reste présent pour une
prochaine ouverture de l’application avec le disque accessible.

## Reprise après interruption : étude et décision

La reprise partielle n’est **pas implémentée**. Relancer le téléchargement repart
du début. Le traitement actuel remuxe des flux MP4/HLS vers un nouveau MP4, dont
les tables et l’index final dépendent de la fin du traitement. Ajouter des octets
à un `.part` ne reconstitue pas un téléchargement valide.

Une reprise future devrait être traitée comme une fonctionnalité distincte :

- Pour une ressource HTTP unique : vérifier les requêtes Range, la stabilité du
  contenu (ETag/Last-Modified), la taille et la validité des URL/authentifications,
  puis séparer le transfert reprenable du remuxage final.
- Pour HLS à la demande : persister et valider une liste de segments, les pistes,
  discontinuités, initialisations et éventuelles clés. Une playlist en direct ne
  garantit pas que ses anciens segments restent accessibles.
- Résoudre de nouveau les sources expirées via le fournisseur, sans conserver
  durablement des URL temporaires sensibles, puis vérifier que le contenu est
  identique avant d’utiliser des fragments déjà présents.

Pour l’usage personnel actuel, la priorité reste une annulation propre et des
fichiers terminés fiables. Aucune capacité de reprise des fournisseurs réels
n’a été mesurée dans ce chantier.

## Validations

Le 15 septembre 2026 :

- TypeScript Desktop et suite Vitest/jsdom : file ordonnée, déduplication,
  retrait, annulation en attente du nettoyage, continuation après échec,
  fermeture, résultat conservé pour la TV, fichiers absents, saisie du dossier
  et estimations conditionnelles ; parcours existants conservés.
- Tests Rust ciblés du stockage et des parseurs : ancien index sans chemin,
  changement de destination, suppression ciblée, nettoyage des partiels externes,
  collisions d’identifiants, écriture des métadonnées en échec, diagnostics
  tronqués entre deux lectures, durées/vitesses inconnues et messages disque.
  Exécutés depuis un petit harnais Cargo temporaire important les deux modules
  réels, avec Rust 1.88, hors ligne, sans compiler Tauri.
- Compilation Vite de l’interface réussie, avec l’avertissement existant sur les
  chunks de plus de 500 ko. Relecture et contrôles finaux le 16 septembre.
- Le test média natif existant est étendu à une destination externe, à sa lecture
  via le relais et au refus de nouvelles demandes pendant la fermeture. Il n’a
  pas été exécuté localement pour cette modification.

Restent à valider en CI et dans les applications macOS/Windows/Linux :
compilation de l’intégration Tauri, téléchargement réel MP4/HLS, lecture/Cast du
fichier externe, annulation puis suivant, fermeture pendant un téléchargement,
disque absent/rebranché et erreurs d’écriture réelles. Les tests simulant le
manque d’espace n’ont pas rempli un disque réel. Aucun build natif complet,
release, tag ou publication n’est lancé pour cette implémentation.
