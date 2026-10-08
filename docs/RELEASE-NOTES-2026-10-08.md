# Patch préparé : Desktop 0.1.9 et Remote 1.4.7

Versions préparées le 8 octobre 2026. Android utilise le code 31.
Tags prévus : `desktop-v0.1.9` et `mobile-v1.4.7`.

## Correction commune

Rétablissement de l'extraction Vidzy après le changement de largeur CSS utilisé
dans sa clé de décodage : le lecteur utilise désormais `calc(1in + 43px)`.
Le fournisseur partagé lit le décalage déclaré dans le lecteur et accepte les
variations entières de cette forme, au lieu de fixer la largeur à 96 pixels.
Les anciens formats restent pris en charge. Le JavaScript du site n'est pas
exécuté et les sources publicitaires restent exclues.

## Validation

`pnpm check` réussit pour Core, Remote, API et Desktop. Les tests couvrent
l'ancien format, le décalage actuel, d'autres décalages et les expressions
non prises en charge. Les contrôles de versions et les 40 tests des scripts
de release réussissent également.

Les flux VF/VOSTFR ont été vérifiés avec le fournisseur réel pour Breaking Bad
S1E1 et S5E16, Lucifer S1E1 et S6E10, Game of Thrones S1E1 et Fight Club :
les 12 playlists principales répondent HTTP 200. Aucun build natif n'a été
lancé localement ; les installateurs et la lecture native restent à valider
après les workflows de release.

Voir `docs/AUDIT-VIDZY-2026-10-08.md` pour le diagnostic et les limites.

## Publication

Après fusion de la PR sur `main`, poser les deux tags sur le commit fusionné
et les pousser pour lancer les workflows. Les builds créent des brouillons
de release à vérifier avant publication selon `docs/RELEASES.md`.
