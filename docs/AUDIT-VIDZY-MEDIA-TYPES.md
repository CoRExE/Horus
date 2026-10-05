# Audit : des séries ouvrent des films dans Desktop et Remote

Audit du 5 octobre 2026, sur le code partagé de `dev`, également présent dans
les versions Desktop 0.1.7 et Remote 1.4.5. Vérifications sur les réponses
publiques Vidzy et le fournisseur réel de Horus, sans télécharger les vidéos.

## Cause confirmée

Un identifiant TMDB numérique doit être accompagné du type film ou série.
Vidzy propose une API `/api/{id}` avec autodétection. Pour les deux séries
signalées, elle renvoie `detectedType: "movie"`, sans saisons, alors que les
lecteurs série existent. Les routes film et série mènent à des médias différents.

| Média sélectionné | ID TMDB | Résultat de `getEpisodes` dans Horus | Lecteur effectivement choisi |
| --- | --- | --- | --- |
| Breaking Bad | 1396 | Une entrée `vidzy::movie::1396`, titre « Film » | `/movie/1396/vf` : **Le Miroir (1975)** |
| Lucifer | 63174 | Une entrée `vidzy::movie::63174`, titre « Film » | `/movie/63174/vf` : **La Fille prodigue (1981)** |
| Game of Thrones | 1399 | 73 épisodes, saisons 1 à 8 | API avec `detectedType: "tv"` et liste des saisons |
| Fight Club | 550 | Une entrée film, comme attendu | API avec `detectedType: "movie"` |

Les métadonnées erronées sont trompeuses : `/api/1396` annonce « Breaking Bad -
Saison 1 » et `/api/63174` « Lucifer - Saison 1 », mais leurs types et liens
`embed` pointent vers la route film. Le titre seul ne permet donc pas de valider
la réponse.

Les bonnes routes existent :

- `/serie/1396/1/1/vf` et `/serie/1396/1/1/vostfr` ouvrent Breaking Bad S1E1.
  Leur configuration JSON `CFG` indique le type `tv` et les sept épisodes de S1.
- `/serie/63174/1/1/vf` ouvre Lucifer S1E1. Sa configuration indique le type `tv`
  et les treize épisodes de S1.
- `getStreams('vidzy::tv::1396::1::1')` et
  `getStreams('vidzy::tv::63174::1::1')` extraient les flux de ces lecteurs série.
  Leurs chemins HLS diffèrent de ceux des films ouverts automatiquement.

Le paramètre testé `/api/1396?type=tv` laisse la réponse inchangée. La
documentation publique ne décrit pas de paramètre pour imposer ce type.

## Parcours dans le code avant le correctif

1. `apps/HorusApi/src/index.ts`, `mapTmdbResults`, conserve correctement le type
   TMDB (`tv` devient `series`).
2. `packages/core/src/providers/Vidzy.ts`, `search`, conserve ce type dans le
   résultat, mais encode seulement l'identifiant numérique : `vidzy::{id}`.
3. `apps/HorusDesktop/src/hooks/useMediaDetails.ts` et
   `apps/HorusRemote/App.tsx` appellent `getEpisodes(media.id)` : le fournisseur
   ne reçoit plus le type connu du catalogue. La recharge de la file d'épisodes
   Remote utilise le même appel.
4. `VidzyProvider.getEpisodes` fait confiance à `detectedType`. Pour `movie`, il
   crée immédiatement une entrée `vidzy::movie::{id}`.
5. `getStreams` reçoit cet identifiant film et utilise `/movie/{id}/{langue}`.
   Les deux applications partagent ce parcours et reproduisent donc le bug.

La recherche directe par identifiant numérique dans `VidzyProvider.search`
fait également confiance à l'autodétection et est exposée au même problème.

## Correctif appliqué dans Desktop 0.1.8 et Remote 1.4.6

- Transmettre le type connu du catalogue jusqu'à la résolution du fournisseur,
  y compris depuis les favoris, l'historique et la recharge de file Remote.
- Pour une série connue, utiliser exclusivement la route série. Une réponse
  film de l'API d'autodétection ne doit pas la convertir en film.
- Récupérer et valider les saisons/épisodes malgré l'absence de `seasons` dans
  ces réponses. Les configurations de lecteurs observées donnent les épisodes
  d'une saison ; elles ne donnent pas à elles seules la liste de toutes les
  saisons. Remplacer seulement la chaîne `movie` par `tv` ne suffit donc pas.
- Déterminer les langues depuis la source série, plutôt que se fier aux langues
  d'un film partageant le même ID.
- Préserver les entrées enregistrées et vérifier la séparation film/série dans
  les identifiants ou clés de bibliothèque ; tout changement d'identifiant doit
  traiter la compatibilité des favoris et de l'historique.
- Ajouter des tests de régression reproduisant les réponses contradictoires de
  Lucifer et Breaking Bad, une série correctement détectée et un vrai film.
  Vérifier qu'aucune route film n'est interrogée pour une série connue.

Ces points sont désormais implémentés dans le fournisseur partagé et ses appels
Desktop/Remote. Le type du catalogue est transmis à `getEpisodes` et
`getStreams`. Une série ne devient plus un film en raison de l'autodétection.
La recherche numérique inspecte les deux routes typées et affiche séparément
le film et la série avec leurs titres réels.

Lorsque l'API ne fournit pas de saisons de série, le fournisseur lit et valide
la configuration JSON `CFG` de chaque saison, sans exécuter le JavaScript du
site. Cette découverte parcourt les saisons numérotées à partir de 1 et s'arrête
au premier HTTP 404. Elle suppose donc une numérotation continue dans ce mode
de secours ; la liste de saisons de l'API reste utilisée lorsqu'elle est valide.
Les autres erreurs HTTP/réseau et les configurations invalides sont signalées,
et une limite de 100 saisons évite une récupération sans fin. Les flux VF et
VOSTFR sont recherchés directement sur le lecteur typé demandé.

Les identifiants enregistrés `vidzy::{id}` restent inchangés. Les clés des
favoris et de l'historique distinguent fournisseur, type et identifiant. Une
ancienne entrée film enregistrée sous une série ouvre sa fiche d'épisodes,
sans reprendre le mauvais film ni sa position mémorisée.

`pnpm check` réussit pour Core, Remote, API et Desktop. Les tests reproduisent
les réponses contradictoires, contrôlent l'absence de requête film pour une
série, les erreurs de découverte, la reprise d'un ancien historique erroné et
la persistance de films/séries partageant un ID.

Les essais avec le fournisseur réel retrouvent Breaking Bad (62 épisodes,
5 saisons), Lucifer (93 épisodes, 6 saisons), Game of Thrones (73 épisodes,
8 saisons) et Fight Club (un film). Pour Breaking Bad et Lucifer, les premiers
et derniers épisodes exposent des flux VF/VOSTFR dont les playlists principales
répondent HTTP 200 avec curl et les en-têtes du fournisseur. Les playlists de
Game of Thrones S1E1 et Fight Club répondent également dans les deux langues.
Aucune vidéo, aucun APK et aucun installateur natif n'ont été téléchargés ou
construits ; la lecture dans les applications natives reste à valider.
Aucun changement du Worker catalogue n'est nécessaire pour ce correctif.

Sources publiques : [documentation Vidzy](https://api.vidzy.org/),
[API Breaking Bad](https://vidzy.org/api/1396),
[API Lucifer](https://vidzy.org/api/63174),
[API Game of Thrones](https://vidzy.org/api/1399),
[lecteur série Breaking Bad](https://vidzy.org/serie/1396/1/1/vf),
[lecteur série Lucifer](https://vidzy.org/serie/63174/1/1/vf).
