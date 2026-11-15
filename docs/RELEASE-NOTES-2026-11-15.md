# Desktop 0.1.15 et Remote 1.4.15 — code 39

## Anime-Sama

Depuis le 12 novembre 2026, les pages de saison listent leurs épisodes dans la
page elle-même, sous forme de références `lien:<n°>` accompagnées d'un jeton de
page. Horus lisait encore `episodes.js` et ne trouvait plus d'épisodes.

- Lecture des listes intégrées, avec repli sur `episodes.js` pour les anciennes
  pages.
- Les références sont résolues au lancement d'un épisode via
  `/api/lien.php`, avec un jeton frais ; les liens supprimés et les hébergeurs
  sans extracteur sont ignorés.
- Les saisons publiées séparément par Anime-Sama (par exemple Black Clover avec
  et sans fillers) apparaissent comme des saisons distinctes.

## Vidzy

- Depuis le 15 novembre 2026, Vidzy sert certains titres en MP4 direct
  (`/v/…/n.mp4`) au lieu d'un manifeste HLS, et alterne selon le titre. Horus
  choisit le HLS quand il est proposé et se rabat sur le MP4 sinon ; le jeton
  `gk` reste joint. Un MP4 doit venir d'un domaine Vidzy en HTTPS.
- Les sous-titres externes des versions VOSTFR en MP4 ne sont pas encore pris
  en charge.

## Diffusion TV (Desktop)

- Les décodeurs DLNA stricts refusaient Play (HTTP 500) sur un flux MP4 direct.
  Desktop annonce désormais les marqueurs DLNA (`DLNA.ORG_OP`, `CI`, `FLAGS`)
  comme Remote, et le relais envoie `contentFeatures.dlna.org` et
  `transferMode.dlna.org`.
- Le relais journalise les échecs de la source (délai, erreur HTTP, transfert
  interrompu) avec le domaine et l'extension, et le lecteur affiche le code
  HTTP de l'erreur.

## Constaté le 15 novembre 2026

- Desktop (`pnpm desktop`) : lecture Vidzy en MP4 et en HLS, et diffusion DLNA
  d'un film, d'une série et d'un anime (Black Clover) vers le décodeur TV.
  Ces trois diffusions passaient par des flux HLS.
- Non vérifié : diffusion DLNA d'un titre servi en MP4, lecture et diffusion
  d'un MP4 Vidzy sur Remote.
