# Releases personnelles Desktop et Android

Les workflows `release-desktop.yml` et `release-mobile.yml` construisent des
installateurs après réussite du workflow réutilisable `checks.yml`. Tous les
jobs utilisent le même commit du tag. Chaque build crée un **brouillon** GitHub
Release ; aucune publication ni création de tag n'est effectuée par les scripts
de build locaux. Ne pas démarrer les deux workflows pour le même tag.

iOS est exclu du périmètre depuis le 12 septembre 2026 : aucune version iPhone/iPad
ni aucun workflow iOS n'est prévu. Les commandes `ios`, `build:prod:ios` et
`build:prod:all` ont été retirées ; utiliser `build:prod:android` pour Mobile.

## Versions et déclenchement

| Application | Source de vérité | Fichiers à maintenir cohérents | Tag |
| --- | --- | --- | --- |
| Desktop | `apps/HorusDesktop/package.json` | `src-tauri/tauri.conf.json`, `Cargo.toml`, entrée `horus-desktop` de `Cargo.lock` | `desktop-vX.Y.Z` |
| Android | `apps/HorusRemote/app.json` : `expo.version` et `android.versionCode` | `apps/HorusRemote/package.json` | `mobile-vX.Y.Z` |

Seules les versions stables `X.Y.Z` sont acceptées dans ce premier pipeline.
Augmenter `versionCode` à chaque nouvel APK, même si le changement ne concerne
que le code JavaScript. Ne plus utiliser le compteur distant EAS pour les builds
Android Gradle. Le script mobile `release` conserve release-it, avec le préfixe
`mobile-v` ; le plugin local `scripts/release/android-version-plugin.mjs` met à
jour `expo.version` et incrémente uniquement `android.versionCode`. Il refuse un
compteur invalide ou épuisé et une version non stable. Aucun bloc iOS n'est requis.
Vérifier son diff avant de committer. Un changement de version Desktop demande
également de mettre à jour l'entrée du package dans le verrou Cargo.

Depuis la racine, avant de créer et pousser un tag :

```sh
node scripts/release/version.mjs desktop-v0.1.1
node scripts/release/version.mjs mobile-v1.4.1
pnpm check
node --test scripts/release/tests/*.test.mjs
```

Remplacer les versions des exemples par celles préparées. Committer les fichiers
de version avant de créer le tag. Un push du tag déclenche la construction ; le
lancement manuel du workflow prend aussi un **tag existant**. Pour que les
workflows manuels apparaissent dans GitHub Actions, leurs fichiers doivent être
présents sur la branche par défaut (`main`). Un merge seul ne crée pas de release.

Les exécutions affichent explicitement leur application et leur tag (par exemple
`Release Desktop · desktop-v0.1.0`). Les vérifications affichent la branche ou le
numéro de PR et ses branches, plutôt que le message du commit de merge.
Ce titre est défini par [`run-name`](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#run-name).

Après une correction du pipeline, relancer une ancienne exécution ne suffit pas :
elle réutilise son ancien commit. Un lancement manuel avec un ancien tag utilise
aussi le code pointé par ce tag. Fusionner les correctifs puis préparer une nouvelle
version et un nouveau tag pour les inclure ; ne pas déplacer un tag déjà publié.

Le pipeline refuse les versions divergentes, les APK qui ne dépassent pas le
compteur historique ou celui d'une release Android publiée, et l'écrasement d'une
release existante. Après un échec de transfert laissant un brouillon incomplet,
examiner ce brouillon et le supprimer explicitement avant de relancer le build.
Ne jamais déplacer un tag déjà publié.

Les builds macOS/Android sur le commit `6067717` ont réussi et créé les brouillons
`desktop-v0.1.0` et `mobile-v1.4.1`. Ils restent disponibles pour les essais puis
la publication manuelle. Le workflow de publication recharge le code du tag :
il conserve donc la liste de fichiers macOS attendue par l'ancien brouillon.
L'extension Windows/Linux prépare Desktop **0.1.1**, soit un futur tag
`desktop-v0.1.1` après commit et merge. Ne pas réutiliser le tag du brouillon 0.1.0
pour cette extension. Android reste en 1.4.1/code 25.

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
Il passe directement à Gradle une limite de heap de 2 Gio et de Metaspace de
2 Gio, ainsi que des limites explicites pour le daemon Kotlin (heap 2 Gio,
Metaspace 1 Gio), avec deux workers au maximum. Ces options remplacent le plafond
Metaspace de 512 Mio du template Expo pour les builds de release et survivent au
prebuild ; elles ne modifient pas les commandes de développement. Voir les
[options mémoire Gradle](https://docs.gradle.org/current/userguide/build_environment.html)
et les [options du daemon Kotlin](https://kotlinlang.org/docs/gradle-compilation-and-caches.html).
Les builds Android de release utilisent la lecture directe du système de fichiers
par Metro, sans dépendre de l'état d'un daemon Watchman local. Le mode de
développement conserve sa configuration actuelle.
Le plugin de signature refuse un build release sans identifiants ; il ne laisse
pas le template signer la release avec la clé de debug. `build:preview` utilise
aussi ce build Android signé. L'URL API vient de `EXPO_PUBLIC_HORUS_API_URL`, avec
le même défaut que l'ancien profil EAS preview. Dans GitHub, la variable facultative
`HORUS_API_URL` permet de la remplacer.

La migration et la conservation des données Android sont confirmées par
l'utilisateur. La configuration EAS, son identifiant de projet, son URL OTA,
le hook OTA inutilisé et la dépendance `expo-updates` sont retirés.
`updates.enabled=false` reste explicite dans `app.json` et contrôlé dans l'APK.
Les anciens APK ne sont pas modifiés à distance. La clé historique et sa sauvegarde
restent indispensables aux mises à jour signées ; ne pas les supprimer.

`pnpm --filter horusremote build:dev` lance le prebuild puis `expo run:android --variant debug`
sur le SDK Android local, avec un appareil ou émulateur. Le prebuild retire de façon
ciblée l'ancien marqueur de runtime OTA des projets Android déjà générés, puis Expo
retire l'URL OTA et la ressource associée ; aucun nettoyage global du dossier natif
n'est nécessaire. `expo-dev-client` est
conservé pour ce développement local ; il ne nécessite pas EAS Build.
`HORUS_ANDROID_RELEASE=1` conserve uniquement les réglages Metro des builds de
release. Le chantier 4 ajoutera la détection des versions GitHub ; elle n'est pas
implémentée ici.

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

## Windows et Linux — extension Desktop 0.1.1

Cibles initiales retenues pour préparer le pipeline, à confirmer selon les
machines personnelles : Windows 11 x64 avec un installateur NSIS `.exe`, et
Ubuntu 24.04 x64 avec un paquet `.deb`. Les premiers builds et tests automatisés
Windows/Linux ont réussi ; la vérification complète des installateurs et les essais
sur appareil restent à valider. Les autres distributions et architectures
ne sont pas annoncées comme prises en charge.

Le workflow ajoute deux jobs natifs, sous `windows-2022` et `ubuntu-24.04`.
Ils compilent FFmpeg depuis la même archive vérifiée que macOS. Windows utilise
MSYS2 UCRT64/MinGW pour ce sous-processus indépendant et MSVC pour Tauri ; les
imports de FFmpeg sont limités aux DLL système. Linux vérifie les dépendances
ELF de FFmpeg, sans bibliothèques multimédia externes. Les sources, licences et
recettes sont incluses dans chaque paquet.

Les configurations `tauri.windows.release.conf.json` et
`tauri.linux.release.conf.json` embarquent `horus-ffmpeg.exe` ou `horus-ffmpeg`.
Le runtime préfère ce fichier voisin sur Windows/Linux, puis conserve les
recherches antérieures. Le paquet Linux ne remplace pas `/usr/bin/ffmpeg`.
macOS conserve le nom et la priorité de son sidecar existant.

Les fixtures H.264 sont générées avec FFmpeg système (qui dispose de libx264),
puis les tests Rust, y compris MP4/HLS, annulation et nettoyage, utilisent le
sidecar Horus. Les builds exécutent aussi les tests Desktop et compilent son
interface. Aucun changement de stockage, d'identifiant ou de parcours applicatif
n'est introduit par l'extension.

Sur Windows, l'installateur s'exécute pour l'utilisateur courant. Il télécharge
WebView2 si nécessaire : un accès réseau est alors requis. Aucune signature
Authenticode n'est configurée pour cet usage personnel. Le runner installe le
paquet silencieusement dans un dossier temporaire, vérifie les binaires x64
contre ceux du build en tenant compte du marqueur de packaging Tauri, vérifie leurs licences, exécute FFmpeg avec uniquement les
dossiers système dans le PATH, puis désinstalle. Ce contrôle ne remplace pas
l'essai de l'interface sur Windows 11 ou l'installation sans outils de développement.

Sur Ubuntu, le `.deb` déclare WebKitGTK/GTK, glibc 2.39 et les plugins GStreamer
nécessaires à la lecture. Le build sur Ubuntu 24.04 ne garantit pas la compatibilité
avec une distribution plus ancienne. Le runner extrait le paquet, vérifie version,
architecture, binaires, sources et licences, exécute FFmpeg, contrôle les liens
dynamiques et simule la résolution des dépendances avec APT. Installation manuelle :

```sh
sudo apt install ./HorusDesktop-0.1.1-linux-x64.deb
```

Sur chaque machine cible, vérifier installation et lancement depuis le menu
d'applications, lecture distante, téléchargement puis lecture locale, accès au
réseau local et mise à jour en conservant favoris, historique et préférences.
Les essais TV approfondis restent au chantier 7.

Le contrôle du binaire principal tient compte d'une transformation précise de
[Tauri 2.11.4](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.11.4/crates/tauri-bundler/src/bundle.rs) :
le premier marqueur `__TAURI_BUNDLE_TYPE_VAR_UNK` devient
`__TAURI_BUNDLE_TYPE_VAR_NSS` pour NSIS ou `__TAURI_BUNDLE_TYPE_VAR_DEB` pour Debian.
Tauri restaure ensuite le binaire non modifié dans le dossier de build.
Le vérificateur calcule donc le contenu attendu avec ce seul remplacement ;
tout autre écart est rejeté. FFmpeg reste comparé sans transformation.

Références : [NSIS et WebView2](https://v2.tauri.app/distribute/windows-installer/),
[paquets Debian Tauri](https://v2.tauri.app/distribute/debian/),
[compilation FFmpeg Windows](https://ffmpeg.org/platform.html#Native-Windows-compilation-using-MSYS2).

## Du brouillon à la publication

Les noms d'installateurs sont distincts et contiennent leur version :

- `HorusDesktop-X.Y.Z-macos-arm64.dmg` ;
- `HorusDesktop-X.Y.Z-macos-x64.dmg` ;
- `HorusDesktop-X.Y.Z-windows-x64.exe` ;
- `HorusDesktop-X.Y.Z-linux-x64.deb` ;
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
Pour Desktop 0.1.1, le brouillon et sa publication exigent les quatre installateurs :
un échec Windows ou Linux empêche de publier une release Desktop incomplète.
