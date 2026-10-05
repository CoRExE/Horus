# Mise à jour préparée : Desktop 0.1.7 et Remote 1.4.5

Versions préparées le 5 octobre 2026. Android utilise le code 29.
Les tags prévus sont `desktop-v0.1.7` et `mobile-v1.4.5`.

## Corrections communes à Desktop et Remote

- Rétablissement de l'extraction des flux Vidzy : le décodage prend désormais
  en compte la mesure de mise en page ajoutée par le lecteur VideoJS. Les anciens
  formats restent pris en charge, sans exécution du JavaScript du site.
- Retrait du lecteur Sibnet devenu indisponible. Anime-sama conserve les
  extracteurs Sendvid, Vidmoly et Smoothpre, ainsi que les variantes VF/VOSTFR.

## Autres changements déjà présents sur dev

- Bibliothèque regroupée par films, séries et animés, avec marquage des médias
  vus dans Desktop et Remote.
- Historique Remote : suppression avec sélection multiple et reprise à la
  position enregistrée.
- Nettoyage des sorties Android de développement sans lancer Gradle.
- Documentation de l'audit des téléchargements et des sous-titres externes Vidzy.
  L'extraction de ces sous-titres reste un travail prévu.

## Validation

`pnpm check` réussit : TypeScript et tests Core, Remote, API et Desktop.
Les 40 tests des scripts de release et les contrôles de cohérence des deux
versions réussissent également.

Les tests du cœur couvrent le nouveau décodage Vidzy, les anciens formats,
l'exclusion des sources publicitaires et les langues Anime-sama, sans requête
vers Sibnet. L'extraction actuelle a été vérifiée sur Fight Club et Game of
Thrones S1E1 : les playlists HLS principales et secondaires répondent HTTP 200
avec curl, en VF pour le film et en VF/VOSTFR pour la série.

Aucun APK ni installateur natif n'a été construit pour cette préparation.
La lecture dans les nouvelles versions Desktop et Remote reste à valider.
L'audit des débits d'animés conservé dans `docs/DOWNLOADS.md` porte sur les essais
du 25 septembre ; ce sont des mesures historiques, antérieures au retrait de Sibnet.

## Publication après fusion

Après fusion de la PR sur `main`, poser les deux tags sur le même commit fusionné.
Leur push déclenche les builds Desktop et Android et crée les brouillons de
release. Vérifier les installateurs, puis lancer « Publier une release vérifiée »
pour chacun des tags et contrôler les manifestes de mise à jour.
Ne pas déplacer les tags déjà publiés. Voir `docs/RELEASES.md`.
