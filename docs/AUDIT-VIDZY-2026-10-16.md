# Vidzy : calcul de largeur avec pourcentage et décalage

Audit du 16 octobre 2026, heures en Europe/Paris.

## Cause reproduite

Avec le code de Desktop 0.1.10 / Remote 1.4.8, la liste des épisodes reste
accessible : 62 épisodes pour Breaking Bad et 93 pour Lucifer. En revanche,
la résolution des flux échoue pour ces deux séries et pour Fight Club.

Le lecteur répond HTTP 200. La réponse inspectée à 10:28:57 contient :

```js
_p.style.cssText = "...;padding:0;border:0;margin:0;width:calc(1in + 50px)";
_ch.style.cssText = "padding:0;border:0;margin:0;height:1px;width:calc(100% - 57px)";
_p.appendChild(_ch);
BC = _ch.offsetWidth | 0;
```

La largeur utilisée dans la clé XOR vaut ici `96 + 50 - 57 = 89` pixels.
Le correctif précédent gérait un enfant à `50%`, mais refusait cette nouvelle
forme `calc(pourcentage ± pixels)`. L'extracteur renvoie alors `null`, puis le
fournisseur affiche « Aucun flux direct Vidzy n’a pu être extrait ».

Les offsets varient entre les réponses : d'autres lecteurs observés utilisent
notamment un parent à `calc(1in + 84px)` et un enfant à `calc(100% - 30px)`.
Les étapes base64 inversée, XOR par index et somme du nom d'hôte restent
présentes. Cette panne s'explique donc par un format de calcul non pris en
charge dans le parseur partagé. Ces observations ne permettent pas d'attribuer
le changement à une réaction à Horus.

## Correctif

`packages/core/src/utils/FsvidExtractor.ts` résout maintenant les pourcentages
avec addition ou soustraction d'un décalage entier en pixels à partir du parent
déclaré. Les protections existantes restent appliquées : styles limités,
padding/bordure nuls, parent unique, profondeur bornée, refus des cycles et des
largeurs finales fractionnaires, nulles, négatives ou supérieures à 10 000.
Aucun JavaScript distant n'est exécuté. Les anciens formats restent couverts.

Le correctif bénéficie à Desktop et Remote via le paquet Core commun.

## Validation

- Avant correction : échec des flux sur Breaking Bad, Lucifer et Fight Club.
- Après correction : VF et VOSTFR pour Breaking Bad S1E1/S5E16, Lucifer
  S1E1/S6E10 et Fight Club. Les dix playlists principales commencent par
  `#EXTM3U`, sans téléchargement des segments vidéo.
- Les séries ne déclenchent aucune requête vers une route `/movie/`.
- Tests de régression : formule observée, offsets variables, addition,
  pourcentage décimal, parents imbriqués, noms de variables différents et
  refus des calculs/styles non pris en charge.
- `pnpm check` : vérifications TypeScript et tests Core, Remote, API et
  Desktop réussis, dont les 73 tests d'interface Desktop.

La lecture native dans les applications compilées reste à vérifier.
La phase d'audit n'a effectué aucun commit, push ou tag ; la publication est
préparée séparément dans `docs/RELEASE-NOTES-2026-10-16.md`.

Source inspectée : [lecteur Fight Club](https://vidzy.cc/embed-8bbcxyiitroi.html).
