# Patch préparé : Desktop 0.1.8 et Remote 1.4.6

Versions préparées le 5 octobre 2026. Android utilise le code 30.
Les prochains tags sont `desktop-v0.1.8` et `mobile-v1.4.6`.

## Corrections communes

- Lucifer et Breaking Bad ouvrent désormais leurs épisodes au lieu d'un film
  partageant le même identifiant TMDB. Le type du catalogue est conservé lors
  de la résolution des épisodes, de la lecture et des téléchargements.
- Les saisons sont récupérées depuis les lecteurs série lorsque l'API Vidzy
  renvoie à tort un film. VF et VOSTFR sont recherchées sur le bon lecteur.
- La recherche par identifiant numérique distingue les films et les séries.
- Les favoris et l'historique distinguent les films/séries partageant un ID,
  avec conservation des entrées existantes. Les anciens historiques erronés
  rouvrent la fiche série pour choisir un épisode.

## Validation

`pnpm check` réussit : TypeScript et tests Core, Remote, API et Desktop,
dont 73 tests d'interface Desktop. Les 40 tests des scripts de release et
les contrôles de cohérence des versions réussissent également.

Vérification réelle : Breaking Bad compte 62 épisodes sur 5 saisons et Lucifer
93 épisodes sur 6 saisons. Leurs premiers et derniers épisodes exposent des
playlists principales VF/VOSTFR répondant HTTP 200. Game of Thrones S1E1 et
Fight Club passent aussi cette vérification. Aucun lecteur film n'est interrogé
pour ces séries. Voir `docs/AUDIT-VIDZY-MEDIA-TYPES.md` pour la cause et les
limites du mode de découverte des saisons.

Aucun APK ni installateur natif n'a été construit. La lecture dans les nouvelles
versions natives reste à valider.

## Publication après fusion

Après fusion de la PR sur `main`, poser les deux nouveaux tags sur le commit
fusionné, puis les pousser pour déclencher les workflows Desktop et Android.
Ne pas déplacer les tags déjà publiés. Vérifier les installateurs avant la
publication des releases et des manifestes de mise à jour, selon
`docs/RELEASES.md`.
