# Desktop 0.1.13 et Remote 1.4.12 — code 36

Anime-Sama a remplacé la plupart de ses lecteurs : les épisodes étaient listés,
mais aucun serveur n'était reconnu, sur Android comme sur Desktop.

Le code commun lit désormais les lecteurs JW Player de Vidmoly, Smoothpre,
Uqload et Ansembed, avec ou sans le packer Dean Edwards, sans exécuter leurs
scripts. Smoothpre expose maintenant plusieurs miroirs (`var links`) : `hls4`,
relatif à la page du lecteur, est retenu en premier comme dans le lecteur
officiel, puis `hls2` et `hls3`. Le premier lien `.txt` retenu auparavant pointait
vers un miroir injoignable.

Constaté le 4 novembre 2026 : les liens Sendvid échantillonnés renvoient 404,
Sibnet et VK restent refusés, et les domaines VOE (shanelocaldog.com et ses
redirections) chiffrent leur source ; ces lecteurs ne sont pas pris en charge.

Validation : extraction réelle VOSTFR et VF sur le premier épisode de Frieren,
Naruto, One Piece et Solo Leveling ; manifestes HLS Smoothpre, Uqload et Ansembed
accessibles sans Referer. `pnpm check` et les tests des scripts de release
réussissent. Lecture sur téléphone, Desktop et TV non vérifiée par l'agent.
