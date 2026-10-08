# Patch préparé : Desktop 0.1.10 et Remote 1.4.8

Versions préparées le 9 octobre 2026. Android utilise le code 32.
Tags prévus : `desktop-v0.1.10` et `mobile-v1.4.8`.

## Correction commune

Rétablissement de l'extraction Vidzy lorsque la clé de décodage dépend de la
largeur d'un enfant à 50% d'un parent dont le décalage CSS varie entre réponses.
L'extracteur partagé suit les liens parent/enfant déclarés par `appendChild`
et résout les pourcentages à partir des largeurs déclarées. Les anciens formats
restent pris en charge, sans exécuter le JavaScript du site.

La résolution est bornée et refuse les cycles, parents ambigus, styles non pris
en charge et résultats fractionnaires. Les sources publicitaires restent exclues.

## Validation

`pnpm check` réussit pour Core, Remote, API et Desktop. Les régressions couvrent
les décalages variables, les pourcentages, plusieurs niveaux et les structures
invalides. Les contrôles de versions et les 40 tests des scripts de release
réussissent également.

Les flux VF/VOSTFR ont été vérifiés sur Breaking Bad S1E1/S5E16, Lucifer
S1E1/S6E10, Game of Thrones S1E1 et Fight Club : les 12 playlists principales
répondent HTTP 200. Aucun build natif n'a été lancé localement ; les installateurs
et la lecture native restent à valider après les workflows.

La comparaison de six profils d'en-têtes ne met pas en évidence de traitement
spécifique de Horus. Elle ne prouve ni n'exclut une réaction aux patchs ; voir
`docs/AUDIT-VIDZY-2026-10-09.md` pour les observations et leurs limites.

## Publication

Après fusion de la PR sur `main`, poser et pousser les deux tags sur le commit
fusionné. Les builds créent des brouillons de release à vérifier avant publication
selon `docs/RELEASES.md`.
