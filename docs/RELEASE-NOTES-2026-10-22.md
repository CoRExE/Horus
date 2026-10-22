# Patch préparé : Desktop 0.1.12 et Remote 1.4.10

Versions préparées le 22 octobre 2026. Android utilise le code 34.
Tags prévus : `desktop-v0.1.12` et `mobile-v1.4.10`.

## Corrections

Vidzy refusait les segments à partir du dixième alors que les premières
playlists et les premiers segments étaient accessibles. Desktop et Remote
obtiennent maintenant la validation du lecteur dans une WebView temporaire
isolée, puis transmettent son jeton aux requêtes HLS natives. Les relais
conservent le jeton sur les sous-playlists et segments Vidzy, y compris les
URL absolues ou déjà signées. Les signatures et jetons enfants sont préservés.
Le jeton n'est pas ajouté aux ressources étrangères.

La recherche Anime-Sama reconnaît les titres du nouveau HTML du catalogue,
tout en conservant les anciens formats et identifiants de bibliothèque.

## Validation

L'utilisateur confirme la réparation des films et séries. Les recherches
réelles Naruto et One Piece retrouvent des résultats. Les tests couvrent les
sessions par langue, le transport du jeton, les paramètres signés, les hôtes
étrangers et les nouvelles cartes Anime-Sama.

`pnpm check`, les contrôles de versions et les tests des scripts de release
sont exécutés avant le commit. La compilation Kotlin du proxy Android réussit.
Les tests Rust Desktop réussissent : 17 tests, plus un test d'intégration média
ignoré localement faute de lancement des fixtures FFmpeg. Le workflow de PR
valide également la compilation et les tests média Desktop avant fusion.

L'audit détaillé et les limites des essais sont conservés dans
`AUDIT-REMOTE-2026-10-22.md`.

## Publication

Après réussite des contrôles et fusion de la PR sur `main`, poser et pousser
les deux tags sur le commit fusionné. Les workflows créent des brouillons de
release à vérifier avant publication selon `RELEASES.md`.
