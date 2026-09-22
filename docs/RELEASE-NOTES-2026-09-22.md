# Mise à jour préparée : Desktop 0.1.6 et Remote 1.4.3

Versions préparées localement le 22 septembre 2026. Android utilise le code 27.
Les tags prévus sont `desktop-v0.1.6` et `mobile-v1.4.3`.

## Desktop 0.1.6

- Accès aux variantes VF disponibles sur Anime-sama, avec choix de langue puis
  de serveur pendant la lecture et conservation de la position.
- Sélection de plusieurs épisodes de séries ou d'animés à télécharger dans
  l'ordre, avec choix de langue et poursuite du lot après un échec.
- Plein écran sans la barre des sélecteurs ; le choix de piste audio apparaît
  uniquement quand plusieurs pistes sont disponibles.
- Maintien éveillé de l'ordinateur pendant la diffusion DLNA/Chromecast,
  libéré à la pause, à l'arrêt ou à la fermeture, puis réactivé à la reprise.

## Remote 1.4.3

- Accès aux variantes VF disponibles sur Anime-sama.
- Sélection de plusieurs épisodes à télécharger successivement, avec choix
  de langue, progression, annulation et bilan du lot.
- Clavier Android intégré pour la recherche et la configuration du catalogue ;
  correction du réaffichage de la barre de navigation autour du lecteur.
- Adresse du worker HorusApi configurable et conservée dans les paramètres.
  **Après la mise à jour, renseigner cette adresse pour rechercher des films et
  séries : aucun worker n'est désormais imposé par l'application.** Les favoris,
  l'historique et les téléchargements existants sont conservés.
- Pour les essais locaux, `pnpm build:preview` produit une application distincte
  « Horus Preview » sans demander la clé de production. Elle possède ses propres
  données ; les mises à jour officielles conservent leur signature habituelle.

## Validation et publication restantes

Les contrôles locaux passent : TypeScript Core/Remote/Desktop/API, tests Core,
70 tests UI Desktop et 4 tests historiques, 8 tests Remote, 3 tests API et
37 tests des scripts de release. Les versions sont validées par
`scripts/release/version.mjs`. L'export JavaScript Android et la compilation
Vite ont aussi été validés pendant le développement.

Aucun APK ni installateur natif n'a été compilé localement pour cette préparation.
Les essais sur appareils restent à confirmer : VF/changement de langue,
téléchargements par lots, clavier et navigation Android, réglage du worker,
plein écran et maintien éveillé pendant une diffusion TV prolongée.

Après push et fusion sur `main`, créer les deux nouveaux tags sur le commit
fusionné pour déclencher les builds. Vérifier leurs résultats et les installateurs,
puis lancer « Publier une release vérifiée » pour chaque tag. Vérifier ensuite
la publication des manifestes de mise à jour. Ne pas déplacer les anciens tags.
