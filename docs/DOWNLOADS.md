# Téléchargements Desktop

## File d’attente

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

## Progression

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
