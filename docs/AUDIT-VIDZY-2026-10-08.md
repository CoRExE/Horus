# Vidzy : nouvelle panne d'extraction observée le 8 octobre 2026

## Cause reproduite

Le lecteur embarqué continue de chiffrer l'URL HLS avec une clé XOR dépendant
du nom d'hôte, de l'index du caractère et de la largeur d'un élément invisible.
Sa déclaration CSS est désormais `width:calc(1in + 43px)`, soit 139 pixels CSS,
au lieu de `width:1in`, soit 96 pixels. Le reste de ce calcul est inchangé.

L'extracteur partagé reconnaissait exclusivement `1in` et refusait la nouvelle
expression. Les pages Vidzy et les listes d'épisodes répondent normalement,
mais les deux langues échouaient au décodage, d'où le message « Aucun flux
direct Vidzy n'a pu être extrait ». Desktop et Remote partagent cet extracteur.

Le changement a été observé sur les lecteurs de Fight Club, Breaking Bad,
Lucifer et Game of Thrones. La panne est reproduite avec le fournisseur réel
avant modification ; elle est indépendante de la précédente confusion film/série.

## Correctif

`FsvidExtractor` lit la largeur dans la déclaration `cssText` de l'élément dont
`offsetWidth` participe à la clé. Il accepte l'ancien `1in` et la forme
`calc(1in + Npx)` ou `calc(1in - Npx)`, avec un entier borné et une largeur
positive. Le décalage 43 n'est pas codé en dur. Aucune exécution du JavaScript
du site ni aucun navigateur embarqué n'est nécessaire.

Les autres expressions CSS restent refusées. Les anciens formats base64/XOR,
le contrôle du domaine HLS et l'exclusion des sources publicitaires sont conservés.
Une future modification vers un autre algorithme ou une autre expression CSS
pourra nécessiter une nouvelle adaptation.

## Validation

- Les régressions couvrent le nouveau décalage 43, d'autres décalages positifs
  et négatifs, l'ancien format et les expressions non prises en charge.
- `pnpm check` réussit : TypeScript et tests Core, Remote, API et Desktop.
- Le fournisseur réel récupère VF et VOSTFR pour Breaking Bad S1E1 et S5E16,
  Lucifer S1E1 et S6E10, Game of Thrones S1E1 et Fight Club.
- Les 12 playlists principales répondent HTTP 200 avec curl et les en-têtes
  renvoyés par le fournisseur. Aucune route film n'est appelée pour les séries.

Aucune vidéo n'a été téléchargée. Aucun build natif n'a été lancé ; la lecture
dans les nouvelles applications natives reste à valider après compilation.

Sources observées : [lecteur Fight Club](https://vidzy.org/movie/550/vf),
[embed Fight Club](https://vidzy.cc/embed-8bbcxyiitroi.html),
[lecteur Breaking Bad](https://vidzy.org/serie/1396/1/1/vf),
[lecteur Lucifer](https://vidzy.org/serie/63174/1/1/vostfr),
[lecteur Game of Thrones](https://vidzy.org/serie/1399/1/1/vf).
