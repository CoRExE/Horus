# Desktop 0.1.14 et Remote 1.4.13 — code 37

Vidzy sert désormais ses manifestes HLS depuis des sous-domaines numérotés de
`vidzy.org` (`u14`), alors que le jeton de session `gk` est toujours délivré par
`v6.vidzy.cc`.

## Vidzy

- Core, Desktop et Android acceptent `vidzy.org` et ses sous-domaines pour les
  lecteurs et les flux. Le jeton `gk` n'est transmis qu'en HTTPS et uniquement
  aux chemins `/hls2/` et `/v/` de ces domaines ; les domaines qui imitent Vidzy
  (`vidzy.org.evil.test`, `evilvidzy.org`) restent refusés.
- Détection du faux manifeste : Vidzy peut répondre aux clients qu'il refuse par
  un master dont l'unique variante renvoie à elle-même, ce qui faisait tourner
  la lecture en boucle. Le relais Desktop et le proxy Android l'arrêtent avec un
  message explicite (« La source a envoyé un faux flux… »), affiché par le lecteur
  et, sur Desktop, par les téléchargements. Les journaux indiquent
  « Flux HLS valide (N segments) » lorsqu'une vraie playlist est atteinte.

## Diffusion TV (Remote)

- Une position DLNA absente ou illisible n'est plus lue comme zéro : la barre de
  lecture ne revient plus au début par moments, et ce zéro n'est plus enregistré
  comme point de reprise. Un `00:00:00` isolé est ignoré jusqu'à confirmation.
- Les boutons ±10 s de l'appli et de la notification partent de la position
  réelle de la TV, et non plus d'une estimation périmée après le verrouillage du
  téléphone. L'état est rafraîchi dès le retour de l'appli au premier plan.
- La dernière phase d'un téléchargement s'intitule « Conversion en MP4 ».

## Socle technique

- Remote passe à Expo SDK 58 (React Native 0.88, React 19.3) ; Desktop est aligné
  sur React 19.3. La CI de release Android utilise la plateforme 37.0 et les
  build-tools 37.0.0.
- `pnpm mobile` lance un aperçu de l'interface dans Expo Go, avec des substituts
  inactifs pour Google Cast, la découverte DLNA et le relais vidéo local.

## Constaté le 9 novembre 2026

- Lecture locale, diffusion DLNA et téléchargement de films Vidzy réussis sur
  Android (preview, Galaxy S21) ; lecture Vidzy réussie sur Desktop (`pnpm desktop`).
  Le relais Rust et le proxy Cronet reçoivent le vrai master avec le jeton et les
  en-têtes de la session, sans imitation de navigateur.
- Elysium en VF : le serveur Vidzy répond 404 pour le master, y compris dans le
  lecteur du site. Le fichier manque chez Vidzy ; ce n'est pas une régression.

Validation : `pnpm check`, tests Rust Desktop (18) et compilation Kotlin du
module Android réussis. Les corrections de la barre et des ±10 s n'ont pas encore
été confirmées sur TV par un nouvel essai.
