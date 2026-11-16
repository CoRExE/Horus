# Desktop 0.1.17

Remote reste en 1.4.15. Desktop 0.1.16 n'a pas été publiée : son correctif ne
réglait pas Windows (voir plus bas). Le tag `desktop-v0.1.16` reste sans
release publiée.

## Vidzy sous Windows

Desktop 0.1.15 lisait Vidzy sur macOS, mais sous Windows le relais recevait le
faux manifeste de Vidzy (« La source a envoyé un faux flux… »).

Vidzy sert ce faux manifeste, et des segments factices, aux clients qui se
présentent comme Chrome ou Edge sans en être. Le relais transmettait l'agent
utilisateur de la WebView qui obtient le jeton `gk` : Edge (WebView2) sous
Windows, refusé ; Safari (WebKit) sous macOS, accepté. Le jeton n'est pas lié à
cet agent.

- Le relais se présente désormais comme `HorusDesktop/<version>`, sans indice de
  plateforme. Android garde l'agent de Cronet, qui est la pile réseau de Chrome.
- Mesuré le 16 novembre 2026 avec un jeton valide : les agents Edge et Chrome
  reçoivent le faux manifeste ; Safari, Linux WebKit, curl et `HorusDesktop`
  reçoivent le vrai manifeste et de vrais segments vidéo.
- Comme sur Android, la WebView de validation ne charge plus aucun média :
  video.js n'est pas chargé et les requêtes `/hls2/`, `/v/`, `.m3u8`, `.ts`,
  `.m4s` et `.mp4` sont bloquées. L'appel à `gate.php` n'est pas touché. Ce
  blocage, introduit en 0.1.16, évite un préchargement inutile mais ne
  corrigeait pas Windows à lui seul.

## Intégration continue

- La release Android ne lance plus le job Desktop macOS des vérifications.
- Sur une pull request, ce job ne tourne que si Desktop, le core, les
  dépendances ou les workflows changent.
- Les actions GitHub passent à leurs versions Node 24.

## Constaté le 16 novembre 2026

- macOS (`pnpm desktop`) : lecture Vidzy réussie avec l'agent `HorusDesktop`.
- Windows : brouillon 0.1.16 toujours refusé ; 0.1.17 à confirmer sur le
  brouillon avant publication.
