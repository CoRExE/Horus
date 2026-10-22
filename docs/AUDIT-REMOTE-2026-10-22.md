# Recherche Anime-Sama et refus des segments Vidzy

Audit du 22 octobre 2026, code Desktop 0.1.11 / Remote 1.4.9.

## Recherche Anime-Sama : corrigée localement

Le catalogue renvoie des cartes dont le titre est dans `h3.as-carte-titre`.
Le parseur cherchait seulement `h2.card-title` ou `h1`, et ignorait donc tous
les résultats malgré une réponse valide. Le sélecteur actuel est ajouté en
conservant les anciens formats et les identifiants.

Les recherches réelles Naruto et One Piece retrouvent respectivement cinq et
un résultats. Les tests couvrent le nouveau HTML, l'ancien HTML, les doublons,
les liens de navigation et les images relatives. `pnpm check` réussit pour
Core, Remote, API et Desktop (73 tests UI Desktop).

## Vidzy : panne reproduite, correction non validée

Les flux sont décodés et les manifestes master et média sont accessibles.
Avec les en-têtes fournis par Horus, les requêtes HEAD donnent :

| Film | Langue | Segment 9 | Segment 10 | Segment 11 |
| --- | --- | --- | --- | --- |
| Robots (2005), TMDB 9928 | VF et VOSTFR | 200 | 403 | 403 |
| La Fée Clochette (2008), TMDB 13179 | VF et VOSTFR | 200 | 403 | 403 |

Fight Club présente aussi ce seuil, avec les segments 12 et 21 refusés.
Ces sondes HTTP ne constituent pas une validation de lecture native et ne
téléchargent pas les segments vidéo. Le refus est reproduit hors du proxy
Android ; il ne provient donc pas exclusivement de son assemblage des segments.

Le lecteur observé inclut un appel à `https://v6.vidzy.cc/gate.php`, avec les
paramètres `v`, `cw`, `cw2`, `wg`, `dpr`, `sw`, `hw`, `ft` et `rf`. Il mesure
notamment du texte sur canvas et la disponibilité de WebGL. Si la réponse
contient `gk`, le lecteur ajoute ce jeton aux requêtes `/hls2/` et `/v/`, via
les hooks VideoJS ou en rechargeant la source pour le lecteur natif.

Horus extrait actuellement l'URL vidéo sans effectuer cette étape. Un appel
minimal au point d'entrée exact avec `v=p1`, Origin et Referer renvoie
`{"ok":0}`. Une validation de session manquante est une hypothèse,
mais aucun test positif avec un jeton accepté n'a encore confirmé le déblocage.
Les conditions exactes d'acceptation, la durée et les contraintes du jeton
restent inconnues. Ne pas inventer des valeurs de fingerprint ni présenter
l'ajout d'un paramètre quelconque comme un correctif validé.

L'utilisateur confirme ensuite que le lecteur du site bloque également sur
le même téléphone et le même réseau. Il ne fournit pas de trace HTTP de cet
essai navigateur : on ne peut pas affirmer que son échec a exactement la même
cause technique. Ce résultat oriente néanmoins vers un problème du service ou
une restriction touchant aussi le navigateur sur ce réseau. Il ne démontre ni
une panne mondiale, ni un blocage ciblant Horus. L'absence de `gk` dans Horus
ne suffit plus à expliquer à elle seule les symptômes rapportés.

Avant de modifier la gestion des sessions natives, il faut obtenir une lecture
fonctionnelle sur le site et comparer les requêtes acceptées et refusées.
Le résolveur Android actuel transmet les paramètres du manifeste uniquement
aux références relatives sans query ; la propagation éventuelle de `gk` devra
également être vérifiée pour les URL absolues et les références déjà signées.
Un test au-delà du segment 10 sera obligatoire avant d'annoncer la réparation.

Sources inspectées :
- https://anime-sama.to/catalogue/?search=naruto&type%5B%5D=Anime
- https://vidzy.cc/embed-8bbcxyiitroi.html

À l'issue du diagnostic initial, aucun changement Vidzy ni publication effectué.

## Suite après confirmation utilisateur

L'utilisateur confirme que les deux films continuent correctement dans le site
sur le même téléphone/réseau. Une intégration Android est préparée : WebView
isolée chargeant l'embed Vidzy avec son Referer, lecture bornée du jeton produit
par le site, puis destruction de la WebView. Aucun pont JavaScript natif ni accès
aux fichiers ; navigation et ressources limitées à Vidzy, médias bloqués pendant
la validation, délai maximal de 20 secondes et annulation à la destruction du
module. L'agent utilisateur réel de cette WebView accompagne les requêtes natives.

Le fournisseur reçoit cette capacité via un callback Android optionnel. Les
lecteurs sans gate conservent leur chemin existant. Les deux langues disposent
de sessions indépendantes. Le jeton est ajouté au manifeste et propagé aux URL
Vidzy absolues ou déjà signées par le résolveur HLS Android commun au relais et
au téléchargement. Les références vers un autre domaine ne reçoivent pas les
paramètres du manifeste.

Les tests de fournisseur vérifient le chemin historique, les deux langues,
l'encodage du jeton, l'agent utilisateur Android et l'échec de validation.
`pnpm check` réussit ; les tests Core ajoutés ensuite réussissent également.
Aucun appareil n'est connecté à ADB : l'obtention réelle du jeton dans Android,
sa durée de validité et le passage du segment 10 restent à valider. Cette
implémentation ne constitue pas encore une correction confirmée sur appareil.

La compilation `:local-video-proxy:compileDebugKotlin` réussit également
(45 tâches, Java 17 / Android SDK 36). Aucun APK, commit, tag ou push produit.

## Extension Desktop après signalement utilisateur

Le même mécanisme est intégré au fournisseur Desktop via la commande Rust
`resolve_vidzy_session`. Elle ouvre une WebView distante temporaire, invisible
et en contexte incognito, limitée à l'URL embed Vidzy validée. Les nouvelles
fenêtres sont refusées. La récupération de `__vzgk` et du véritable User-Agent
est bornée à 20 secondes ; la fenêtre est fermée au retour ou à l'annulation.
Les commandes applicatives natives sont explicitement réservées au label
`main` ; les capacités Tauri existantes ne sont pas étendues aux fenêtres
Vidzy. La fermeture d'une fenêtre de session ne coupe plus le maintien éveillé
du lecteur principal.

Le relais Rust transmet `gk` aux ressources HTTPS Vidzy `/hls2/` et `/v/`, y
compris les URL absolues et déjà signées. Un jeton enfant existant est conservé,
les signatures propres aux segments aussi ; aucun jeton n'est ajouté à un
hôte étranger, une URL HTTP ou une ressource hors média. La lecture, le cast
et les téléchargements Desktop réutilisent ce relais. La plateforme déclarée
dans les en-têtes suit Android/macOS/Linux/Windows selon l'agent navigateur.

Validation : `pnpm check` réussit (73 tests UI Desktop), et `cargo test --locked
--lib` sous Rust 1.88.0 réussit avec 17 tests et un test média d'intégration ignoré
nécessitant les fixtures FFmpeg. Les nouveaux tests couvrent les URL de session
refusées et la propagation des jetons, y compris les caractères réservés et
les hôtes trompeurs. Aucun essai de session réelle dans l'application, aucune
lecture au-delà du segment 10, aucun installateur et aucune publication effectués.
La confirmation fonctionnelle reste donc nécessaire sur Android et Desktop.

## Confirmation et préparation des versions

L’utilisateur confirme le 22 octobre que la partie films et séries est réparée.
Cette confirmation complète les validations automatisées ci-dessus ; elle ne
précise pas une matrice exhaustive des systèmes, langues et modes de diffusion.
La durée de validité des sessions sur des lectures longues reste à surveiller.
Publication préparée séparément : Desktop 0.1.12 et Remote 1.4.10 (Android 34),
voir `RELEASE-NOTES-2026-10-22.md`.
