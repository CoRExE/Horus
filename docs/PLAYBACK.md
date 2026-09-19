# Lecteur Desktop — chantier 5

Les commandes vidéo natives restent disponibles. Les changements concernent
HorusDesktop ; les fournisseurs, identifiants d'épisodes, favoris, historique,
langues de serveur et parcours de diffusion TV sont conservés.

## Raccourcis pendant la lecture locale

| Touche | Action |
| --- | --- |
| Espace ou K | Lecture / pause |
| Flèche gauche / droite | Reculer / avancer de 10 secondes |
| Flèche haut / bas | Augmenter / diminuer le volume de 5 % |
| M | Activer / désactiver le son |
| F ou double-clic sur la vidéo | Basculer le plein écran |
| Échap | Quitter le plein écran du lecteur |

Les raccourcis n'interceptent ni la saisie, ni les boutons/liens, ni les sélecteurs
et curseurs. Ils sont suspendus lorsqu'un dialogue est ouvert et ignorent les
combinaisons système et la composition de texte. Les flèches peuvent être
maintenues ; les bascules lecture, son et plein écran ignorent la répétition.
Les déplacements sont limités à la durée connue et aux plages accessibles du
média : aucun saut arbitraire dans un direct sans durée ou hors de sa fenêtre.
Ces raccourcis n'envoient pas de commandes au téléviseur.

## Saisons, pistes audio et sous-titres

Pour une série ou un animé, la fiche affiche séparément Saison et Épisode.
La reprise sélectionne la saison de l'épisode enregistré. Changer de saison
sélectionne son premier épisode et recharge ses serveurs ; le sélecteur Épisode
ne propose que les épisodes de cette saison. Les arcs, films et épisodes spéciaux
AnimeSama gardent leurs intitulés et l'ordre fourni. Sans information de saison,
les épisodes restent dans « Tous les épisodes ». Les fiches de films n'ajoutent
pas de sélecteur Saison. L'ordre global de l'épisode suivant reste celui du fournisseur.

Le lecteur affiche les pistes audio et sous-titres exposées par HLS.js ou par la
WebView pour les fichiers et le HLS natif. Les listes suivent les changements du
manifeste et sont nettoyées lors du remplacement de la source. Les pistes de
métadonnées ne sont pas proposées comme sous-titres. « Désactivés » coupe les
sous-titres sélectionnables. Les contrôles restent accessibles en plein écran.

Le choix VF/VOSTFR des serveurs reste distinct des pistes internes à la vidéo.
Aucune piste n'est inventée lorsqu'un flux ou une WebView ne l'expose pas ; les
sous-titres incrustés dans l'image ne peuvent pas être désactivés. Aucun réglage
persistant de langue ou de sous-titres n'est ajouté.

## Veille et plein écran

Le maintien éveillé commence à l'événement de lecture effective (`playing`). Il
est libéré à la pause, à la fin, à l'erreur, au changement de source et à la
fermeture. Il concerne la lecture sur cet ordinateur, pas la diffusion TV.
Une indisponibilité du service de veille affiche une information sans bloquer
la lecture. La veille manuelle reste une décision du système/utilisateur.

Le backend utilise [keepawake 0.6.1](https://docs.rs/keepawake/0.6.1/keepawake/)
avec `display=true`, `idle=true`, `sleep=false`. Un thread dédié possède le verrou
et le libère sur ce même thread, nécessaire pour l'état d'exécution Windows.
Les appels du lecteur sont ordonnés même entre deux montages successifs.
La fermeture de la fenêtre ou de l'application arrête également ce service.
Sur Linux, les services D-Bus de la session et de gestion de la veille doivent
être disponibles. En aperçu navigateur, l'API Screen Wake Lock est utilisée
lorsqu'elle existe, avec réacquisition au retour sur l'onglet visible.

Les entrées/sorties de plein écran sont ordonnées : fermer pendant une transition
attend sa fin puis restaure le mode précédent. Une fenêtre qui était déjà en
plein écran avant l'ouverture du lecteur conserve ce mode. Le défilement de la
page est rétabli. Le parcours actuel « Épisode suivant » ferme puis recrée le
lecteur : il restaure donc le mode de fenêtre précédent, sans forcer une nouvelle
entrée en plein écran. Un changement de source sans démontage conserve le mode.

## Validations

Contrôles locaux réalisés avec Node 22.23.2 disponible sur la machine :
TypeScript Desktop, 40 tests UI (dont 18 nouveaux) et 4 tests Desktop historiques.
Les nouveaux tests couvrent raccourcis, champs/dialogues, bornes de déplacement,
pistes HLS/natives, saisons/reprise, veille et réponses tardives, plein écran et
épisode suivant via le parcours réel de l'application.

Le code Rust passe rustfmt 1.88.0 ; les métadonnées Cargo passent avec
`--locked --offline`. Le verrou ajoute 45 entrées pour keepawake et ses dépendances,
sans changer les versions des entrées existantes. Cela **ne valide pas la
compilation native** : aucun build natif ni essai de veille système n'a été lancé
par l'agent. Les builds complets restent lancés par l'utilisateur.

À tester avec les prochains builds Desktop sur les machines ciblées :

- Lecture/pause, raccourcis et saisie dans la recherche ou les dialogues.
- Absence de mise en veille automatique pendant la lecture ; retour au réglage
  habituel après pause, arrêt et fermeture, y compris pendant une transition.
- Pistes multiples réellement exposées par un flux HLS et par un fichier local,
  activation/désactivation des sous-titres et changement de serveur.
- Plein écran par F/double-clic, Échap, fermeture, épisode suivant et fenêtre
  initialement déjà en plein écran.

Pour observer les demandes de maintien éveillé sans changer les réglages système :
`pmset -g assertions` sur macOS, `powercfg /requests` sur Windows et
`systemd-inhibit --list` sur Linux (la protection de l'écran utilise aussi le bus
D-Bus de session). Les tests JS simulent les services natifs ; ils ne remplacent
pas ces essais sur machine.


## Serveurs des animés

Le lecteur Desktop affiche le serveur du flux en cours à côté de sa langue.
Pour un animé en ligne, le sélecteur « Serveur » permet de changer de source
à tout moment, même si la lecture fonctionne. Il reste accessible dans la barre
sous la vidéo en plein écran, ainsi que pendant une diffusion TV. Le lecteur
sauvegarde la position avant le changement et la reprend sur le nouveau flux.
La liste est limitée à la langue en cours ; les téléchargements hors ligne
n’ont pas de sélecteur de serveur.

À l’épisode suivant, demandé par le bouton ou à la fin de la vidéo, le serveur
actuellement choisi est prioritaire, y compris après « Serveur suivant » sur une
erreur. La correspondance utilise le nom du serveur et la langue, jamais l’URL
propre à l’épisode ; la qualité est conservée si elle est disponible. Si le serveur
manque, une autre source de même langue est utilisée avec un message explicatif.
Si la langue manque, la fiche de l’épisode demande un choix explicite.
Ce choix suit la lecture en cours : aucune préférence globale ni nouvelle donnée
persistante n’est ajoutée.

Validation le 19 septembre 2026 : TypeScript et 59 tests UI réussis, dont quatre
nouveaux tests du parcours App des animés (changement manuel, reprise de position,
serveur conservé après erreur, nouvel épisode et indisponibilités). Les sources
et commandes natives sont simulées ; les essais sur sources réelles restent à faire.
