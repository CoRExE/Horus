# Releases personnelles macOS et Android

Les workflows `release-desktop.yml` et `release-mobile.yml` construisent des
installateurs après réussite du workflow réutilisable `checks.yml`. Tous les
jobs utilisent le même commit du tag. Chaque build crée un **brouillon** GitHub
Release ; aucune publication ni création de tag n'est effectuée par les scripts
de build locaux. Ne pas démarrer les deux workflows pour le même tag.

## Versions et déclenchement

| Application | Source de vérité | Fichiers à maintenir cohérents | Tag |
| --- | --- | --- | --- |
| Desktop | `apps/HorusDesktop/package.json` | `src-tauri/tauri.conf.json`, `Cargo.toml`, entrée `horus-desktop` de `Cargo.lock` | `desktop-vX.Y.Z` |
| Android | `apps/HorusRemote/app.json` : `expo.version` et `android.versionCode` | `apps/HorusRemote/package.json` | `mobile-vX.Y.Z` |

Seules les versions stables `X.Y.Z` sont acceptées dans ce premier pipeline.
Augmenter `versionCode` à chaque nouvel APK, même si le changement ne concerne
que le code JavaScript. Ne plus utiliser le compteur distant EAS pour les builds
Android Gradle. Le script mobile `release` conserve release-it, avec le préfixe
`mobile-v` ; son plugin incrémente les numéros de build Android et iOS comme avant.
Vérifier son diff avant de committer. Un changement de version Desktop demande
également de mettre à jour l'entrée du package dans le verrou Cargo.

Depuis la racine, avant de créer et pousser un tag :

```sh
node scripts/release/version.mjs desktop-v0.1.0
node scripts/release/version.mjs mobile-v1.4.1
pnpm check
node --test scripts/release/tests/*.test.mjs
```

Remplacer les versions des exemples par celles préparées. Committer les fichiers
de version avant de créer le tag. Un push du tag déclenche la construction ; le
lancement manuel du workflow prend aussi un **tag existant**. Pour que les
workflows manuels apparaissent dans GitHub Actions, leurs fichiers doivent être
présents sur la branche par défaut (`main`). Un merge seul ne crée pas de release.

Le pipeline refuse les versions divergentes, les APK qui ne dépassent pas le
compteur historique ou celui d'une release Android publiée, et l'écrasement d'une
release existante. Après un échec de transfert laissant un brouillon incomplet,
examiner ce brouillon et le supprimer explicitement avant de relancer le build.
Ne jamais déplacer un tag déjà publié.

## Android : continuité de signature

L'APK public attaché à `v1.4.1` a été inspecté : son identité réelle est
`com.horus.remote`, version **1.4.0**, `versionCode` **24**. Le compteur EAS
production est également **24**. La migration commence avec **1.4.1 / 25**.
Ces références et l'empreinte SHA-256 du certificat public sont enregistrées dans
`scripts/release/android-baseline.json`. Le nom de la release historique ne doit
pas servir à déduire la version du binaire.

La clé historique a été exportée depuis `eas credentials --platform android`,
profil production, menu `credentials.json`, puis téléchargement depuis EAS.
Elle est sauvegardée dans `apps/HorusRemote/credentials/android/keystore.jks` avec
ses paramètres dans `apps/HorusRemote/credentials.json`. Ces fichiers ont des
permissions locales restreintes et sont ignorés par Git. Conserver ensemble une
copie privée de ces deux fichiers pour pouvoir reconstruire après une perte de
la machine. Ne pas créer de nouvelle clé pour remplacer la clé historique.

Les quatre secrets du dépôt GitHub utilisés par le workflow sont :

- `ANDROID_KEYSTORE_BASE64` : contenu du keystore encodé en base64 ;
- `ANDROID_KEYSTORE_PASSWORD` ;
- `ANDROID_KEY_ALIAS` ;
- `ANDROID_KEY_PASSWORD`.

Ils peuvent être configurés à partir d'un export local avec :

```sh
node scripts/release/configure-android-secrets.mjs apps/HorusRemote/credentials.json CoRExE/Horus
```

Ce script vérifie le certificat historique, transmet les valeurs à `gh` par
l'entrée standard, et conserve les secrets déjà présents. Aucun secret n'est
écrit dans le projet Android généré ni dans les journaux. Le workflow place le
keystore dans le dossier temporaire du runner et efface cette copie en fin de job.

Le build utilise Java 17, le SDK Android 36, les build-tools 36.0.0, le NDK
27.1.12297006 et CMake 3.22.1. Expo 54 génère le wrapper Gradle 8.14.3 depuis
les dépendances installées. `setup-gradle` gère son cache ; pnpm installe avec
`--frozen-lockfile`. Certaines dépendances Maven natives restent dynamiques dans
les modules existants : ce pipeline ne garantit pas une reproduction octet pour
octet des APK.

Pour un build local, définir `ANDROID_HOME` et les quatre variables
`HORUS_ANDROID_KEYSTORE` (chemin absolu), `HORUS_ANDROID_STORE_PASSWORD`,
`HORUS_ANDROID_KEY_ALIAS`, `HORUS_ANDROID_KEY_PASSWORD` dans l'environnement :

```sh
pnpm --filter horusremote build:prod:android
node scripts/release/verify-apk.mjs mobile-v1.4.1 apps/HorusRemote/android/app/build/outputs/apk/release/app-release.apk
```

Le script de build appelle Expo prebuild puis `:app:assembleRelease`. Il conserve
les scripts de démarrage du projet malgré leur réécriture habituelle par Expo.
Les builds Android de release utilisent la lecture directe du système de fichiers
par Metro, sans dépendre de l'état d'un daemon Watchman local. Le mode de
développement conserve sa configuration actuelle.
Le plugin de signature refuse un build release sans identifiants ; il ne laisse
pas le template signer la release avec la clé de debug. `build:preview` utilise
aussi ce build Android signé. L'URL API vient de `EXPO_PUBLIC_HORUS_API_URL`, avec
le même défaut que l'ancien profil EAS preview. Dans GitHub, la variable facultative
`HORUS_API_URL` permet de la remplacer.

`HORUS_ANDROID_RELEASE=1`, défini par ces scripts et le workflow, désactive EAS
Update dans le nouveau binaire. Installer cet APK est nécessaire pour sortir du
protocole OTA ; les APK déjà installés ne sont pas modifiés à distance. Les
parcours de développement/iOS et la configuration EAS sont conservés tant que la
migration sur un appareil n'est pas validée. Le script EAS `build:update` ne met
pas à jour les nouveaux APK Gradle. Le chantier 4 ajoutera leur détection de
versions GitHub ; elle n'est pas implémentée ici.

Le workflow contrôle l'identifiant, la version, le certificat, l'arrêt d'EAS
Update, le bundle JavaScript et les bibliothèques Hermes/React Native pour les
quatre ABI Android, ainsi que la présence des classes du proxy vidéo local,
Google Cast, Expo Video et UDP dans l'APK. Cela ne remplace pas un test de lecture
et de diffusion sur un téléphone. Installer avec `adb install -r CHEMIN_APK` conserve normalement les
données si la signature et l'identifiant correspondent ; vérifier les favoris,
l'historique, les préférences et la lecture avant publication. Ne pas désinstaller
l'ancienne application pour contourner une erreur de signature.

## macOS : DMG autonome pour Apple Silicon et Intel

Les runners natifs `macos-15` (arm64) et `macos-15-intel` (x64) compilent chacun
FFmpeg et Tauri avec Rust 1.88.0. La configuration
`src-tauri/tauri.release.conf.json` s'ajoute à la configuration de développement :
elle embarque le sidecar FFmpeg et les notices dans le bundle, et utilise une
signature **ad hoc** (`-`), adaptée à l'usage personnel sans abonnement Apple.
Ce n'est ni une signature Developer ID ni une notarisation Apple.

```sh
bash scripts/release/build-ffmpeg.sh
# Sur Apple Silicon ; remplacer par x86_64-apple-darwin sur Intel.
RUSTUP_TOOLCHAIN=1.88.0 pnpm --filter horus-desktop exec tauri build \
  --config src-tauri/tauri.release.conf.json \
  --target aarch64-apple-darwin --bundles dmg -- --locked
```

Les DMG se trouvent dans `apps/HorusDesktop/src-tauri/target/<target>/release/bundle/dmg/`.
Le pipeline vérifie architecture, signature, intégrité du DMG et absence de
dépendance dynamique à Homebrew. Le moteur média est aussi testé avec le FFmpeg
compilé. L'exécutable embarqué est recherché avant le `PATH` ; les builds sans
sidecar gardent les chemins système existants.

FFmpeg 8.0.1 est compilé depuis l'archive officielle dont le SHA-256 est fixé dans
`scripts/release/ffmpeg.json`. Les sources ne sont pas modifiées, les bibliothèques
externes ne sont pas autodétectées et les options GPL/nonfree/version3 sont
désactivées. Horus lance FFmpeg comme un programme distinct, sans lier ses
bibliothèques. `Contents/Resources/licenses/ffmpeg/` contient l'archive source
exacte, la licence LGPL 2.1+, la notice amont, les paramètres et la recette de
compilation. Conserver ces fichiers lors de la distribution du bundle.

Tester l'installation depuis Finder : monter le DMG, copier l'application,
lancer sans outil de développement dans le PATH, puis télécharger/lire/diffuser
un média. Gatekeeper peut bloquer un téléchargement non notarié ; utiliser
l'autorisation ciblée dans Réglages Système → Confidentialité et sécurité pour
l'application connue. Ne pas désactiver Gatekeeper globalement. Une signature
Developer ID et la notarisation peuvent être ajoutées ultérieurement si ce
confort devient nécessaire.

Références : [FFmpeg et licences](https://ffmpeg.org/legal.html),
[signature macOS Tauri](https://v2.tauri.app/distribute/sign/macos/),
[sidecars Tauri](https://v2.tauri.app/develop/sidecar/),
[build Android local Expo](https://docs.expo.dev/guides/local-app-production/),
[compteurs EAS](https://docs.expo.dev/build-reference/app-versions/).

## Du brouillon à la publication

Les noms d'installateurs sont distincts et contiennent leur version :

- `HorusDesktop-X.Y.Z-macos-arm64.dmg` ;
- `HorusDesktop-X.Y.Z-macos-x64.dmg` ;
- `HorusRemote-X.Y.Z-N-android.apk`.

Le brouillon contient aussi `SHA256SUMS`, `release-info.json` et les notes de
version générées, basées sur la release précédente de la même application si
elle existe. Le JSON décrit le commit et les fichiers pour vérification : il
ne constitue pas le manifeste public de mise à jour du chantier 4.

Après les essais, relire les notes dans le brouillon, puis lancer **Publier une
release vérifiée** dans Actions avec son tag. Ce workflow télécharge les fichiers,
vérifie la liste complète, leurs tailles, SHA-256 et correspondance avec le tag,
puis publie. Il n'utilise et ne modifie jamais le `releases/latest` global.
La publication des manifestes sera branchée après cette étape au chantier 4.
