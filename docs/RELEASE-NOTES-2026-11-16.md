# Desktop 0.1.16

Remote reste en 1.4.15.

## Vidzy sous Windows

Desktop 0.1.15 lisait Vidzy sur macOS, mais sous Windows le relais recevait le
faux manifeste de Vidzy (« La source a envoyé un faux flux… »).

Pour obtenir le jeton de session `gk`, Desktop ouvre une WebView invisible sur
le lecteur Vidzy. Sous Windows, c'est WebView2 (Chromium) : le lecteur video.js
de la page peut y demander le manifeste avec le jeton tout juste obtenu, avant
le relais Horus. Sur macOS, WebKit ne le faisait pas.

Comme la WebView de validation d'Android, celle de Desktop ne charge plus aucun
média : video.js n'est pas chargé et les requêtes `/hls2/`, `/v/`, `.m3u8`,
`.ts`, `.m4s` et `.mp4` sont bloquées. L'appel à `gate.php`, qui calcule le
jeton, n'est pas touché.

## Intégration continue

- La release Android ne lance plus le job Desktop macOS des vérifications.
- Sur une pull request, ce job ne tourne que si Desktop, le core, les
  dépendances ou les workflows changent.
- Les actions GitHub passent à leurs versions Node 24.

## Constaté le 16 novembre 2026

- macOS (`pnpm desktop`) : lecture Vidzy réussie avec la nouvelle validation.
- Windows : correctif à confirmer sur le brouillon de release avant publication.
