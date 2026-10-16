# Patch préparé : Desktop 0.1.11 et Remote 1.4.9

Versions préparées le 16 octobre 2026. Android utilise le code 33.
Tags prévus : `desktop-v0.1.11` et `mobile-v1.4.9`.

## Correction commune

Rétablissement de l'extraction Vidzy lorsque la largeur utilisée dans la clé
de décodage est calculée avec un pourcentage et un décalage en pixels, comme
`calc(100% - 57px)`. Le parseur partagé par Desktop et Remote résout cette forme
à partir du parent déclaré, tout en conservant les formats précédents.

Le calcul reste borné et refuse les styles inconnus, parents ambigus, cycles
et largeurs finales invalides. Aucun JavaScript distant n'est exécuté.
La formule XOR observée reste identique ; c'est le calcul de sa composante
de largeur qui a changé. Voir `docs/AUDIT-VIDZY-2026-10-16.md`.

## Validation

`pnpm check` réussit pour Core, Remote, API et Desktop, dont les 73 tests
d'interface Desktop. Les tests couvrent les décalages variables, les calculs
imbriqués et les valeurs refusées. Les contrôles de versions et les 40 tests des
scripts de release réussissent également.

Les flux VF/VOSTFR ont été vérifiés sur Breaking Bad S1E1/S5E16, Lucifer
S1E1/S6E10 et Fight Club : les dix playlists principales sont valides.
Aucun segment vidéo n'a été téléchargé. Les installateurs et la lecture native
restent à valider après les workflows.

## Publication

Après réussite des contrôles et fusion de la PR sur `main`, poser et pousser
les deux tags sur le commit fusionné. Les builds créent des brouillons de
release à vérifier avant publication selon `docs/RELEASES.md`.
