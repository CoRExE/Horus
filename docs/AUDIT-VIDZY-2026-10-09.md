# Vidzy : nouvelle mesure CSS et recherche d'un éventuel ciblage

Audit du 9 octobre 2026, heures de chronologie en Europe/Paris.

## Panne reproduite

Avec le code de Desktop 0.1.9 / Remote 1.4.7, Breaking Bad fournit toujours
62 épisodes, mais la résolution des flux échoue dans les deux langues.
Le lecteur de Fight Club répond HTTP 200 et contient une nouvelle structure :

```js
_p.style.cssText = "...;padding:0;border:0;margin:0;width:calc(1in + 80px)";
_ch.style.cssText = "padding:0;border:0;margin:0;height:1px;width:50%";
_p.appendChild(_ch);
BC = _ch.offsetWidth | 0;
```

La valeur ajoutée à la clé XOR est la largeur de l'enfant : dans cet exemple,
`(96 + 80) × 50% = 88`, et non la largeur du parent. L'extracteur précédent
lisait la largeur CSS de l'élément directement mesuré ; il refusait `50%`.
Le décalage du parent varie entre les réponses. Les autres étapes observées du
décodage, notamment la base64 inversée et la clé liée au nom d'hôte, sont conservées.

## Comparaison des clients

La même URL d'embed a été demandée depuis la même machine/IP avec six profils
d'en-têtes, en conservant curl comme transport réseau :

| Profil déclaré | HTTP | Décalage du parent observé | Mesure |
| --- | --- | --- | --- |
| En-têtes d'extraction Horus | 200 | 56px | Enfant à 50% |
| Chrome Windows avec indications de navigation | 200 | 84px | Enfant à 50% |
| Chrome Android | 200 | 100px | Enfant à 50% |
| Safari macOS | 200 | 20px | Enfant à 50% |
| `User-Agent: HorusRemote/1.4.7` explicite | 200 | 174px | Enfant à 50% |
| curl sans Referer | 200 | 52px | Enfant à 50% |

Après normalisation du décalage CSS et de la charge base64, les six expressions
de décodage ont la même empreinte SHA-256. Quatre répétitions avec exactement
les en-têtes Horus donnent 84px, 30px, 62px et 152px, avec cette même structure.
Les différences numériques entre profils ne constituent donc pas une preuve
de sélection selon le système ou le nom du client.

Ces essais ne sont pas six vrais navigateurs : ils ne comparent pas des
empreintes TLS Windows/macOS/Android distinctes, d'autres IP ou des sessions
avec cookies. Ils ne permettent pas d'exclure tout ciblage côté serveur.

## Chronologie et interprétation

- Le précédent correctif est daté du 8 octobre à 04:03 dans le commit public
  `ae776d9` ; les essais de cette préparation retrouvaient les flux.
- Les releases Desktop 0.1.9 et Remote 1.4.7 ont été publiées le 9 octobre
  à 00:44:04 et 00:44:13, d'après GitHub.
- La réponse inspectée contenant le nouveau mécanisme est datée du 9 octobre
  à 00:56:33 par son en-tête HTTP `Date`.

La première inspection suit la publication d'environ douze minutes, mais ce
n'est pas l'heure de mise en place du changement. Le lecteur a pu changer
avant la publication, pendant l'intervalle sans observation. Le code du patch
était également public avant les releases. La proximité temporelle ne démontre
donc pas une réaction à la publication ni une lecture de notre dépôt.

Le mécanisme est compatible avec une obfuscation générale destinée à compliquer
l'extraction hors navigateur. Une réaction à nos correctifs demeure possible,
mais les observations ne permettent pas de l'attribuer à Horus. Aucun traitement
spécifique de Horus n'est mis en évidence dans les profils testés.

## Correctif local et validation

L'extracteur partagé résout maintenant les largeurs en pourcentage à partir du
parent déclaré par `appendChild`, en conservant les formats précédents.
La résolution est bornée à huit éléments, rejette les cycles et parents ambigus,
et exige des boîtes sans padding/bordure pour ce parcours. Les styles inconnus
et les résultats fractionnaires restent refusés : aucun arrondi navigateur
n'est deviné et aucun JavaScript distant n'est exécuté.

Les tests couvrent les décalages variables, les pourcentages, plusieurs niveaux,
les noms de variables différents, les styles incompatibles et les cycles.
`pnpm check` réussit pour Core, Remote, API et Desktop.
La première exécution échouait sur l'attente du style de défilement dans un
test de plein écran Desktop, sans changement de ce code. Ce test réussit
isolément et la seconde exécution complète passe, sans modification entre les
deux essais ; il s'agit d'un échec intermittent observé à conserver dans l'audit.

Le fournisseur réel retrouve VF/VOSTFR pour Breaking Bad S1E1/S5E16, Lucifer
S1E1/S6E10, Game of Thrones S1E1 et Fight Club ; les 12 playlists principales
répondent HTTP 200. Aucune route film n'est interrogée pour les séries.
Aucune vidéo ni aucun build natif n'ont été téléchargés/construits. La lecture
native reste à valider après compilation. La phase d'audit n'a effectué aucun
commit, tag ou push ; la publication est préparée séparément.

Sources : [embed Fight Club](https://vidzy.cc/embed-8bbcxyiitroi.html),
[patch précédent](https://github.com/CoRExE/Horus/commit/ae776d9292f3a3c74e9bd0535aa6b6d5678e615f),
[release Desktop](https://github.com/CoRExE/Horus/releases/tag/desktop-v0.1.9),
[release Remote](https://github.com/CoRExE/Horus/releases/tag/mobile-v1.4.7).
