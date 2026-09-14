# Détection des mises à jour

Desktop et Android consultent un manifeste public, puis ouvrent l'installateur
dans le navigateur. L'installation reste manuelle. Aucun jeton GitHub n'est
embarqué dans les applications et aucun service EAS n'est utilisé.

## Manifestes

L'adresse de base est `https://corexe.github.io/Horus/updates`. Les fichiers
sont `android.json`, `macos.json`, `windows.json` et `linux.json`. Une plateforme
sans release stable n'a pas de manifeste ; une réponse 404 est gérée comme une
vérification temporairement indisponible.

Le schéma version 1 est défini et validé dans `packages/core/src/updates.ts` :

- `schemaVersion`, `application` (`desktop` ou `mobile`), `platform` et `version` ;
- `versionCode` uniquement pour Android ;
- `tag`, `publishedAt`, `notes` et `releaseUrl` ;
- `assets` : architecture, nom, URL exacte GitHub, taille et SHA-256 du fichier.

macOS exige les fichiers arm64 et x64, Windows et Linux un fichier x64, Android
un APK universel. Les URL sont limitées aux releases de `CoRExE/Horus`. Une
plateforme, une architecture ou un schéma inconnu est refusé.

## Publication

`.github/workflows/updates.yml` utilise GitHub Pages en mode **GitHub Actions**.
Il s'exécute après une publication/modification/suppression de release, après la
réussite de « Publier une release vérifiée », ou manuellement. Le déclenchement
`workflow_run` couvre les publications faites avec `GITHUB_TOKEN`, qui ne
déclenchent pas elles-mêmes les autres workflows via un événement `release`.
Voir les [workflows Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
et les [règles de déclenchement GitHub](https://docs.github.com/en/actions/how-tos/writing-workflows/choosing-when-your-workflow-runs/triggering-a-workflow).

L'environnement `github-pages` reste limité à `main`. Un événement de release
étant associé à un tag, son job lance une exécution manuelle du même workflow
sur la branche par défaut, puis se termine. Seules les exécutions sur cette
branche ont le job de déploiement ; aucune autorisation de déployer depuis les
tags n'est ajoutée à l'environnement Pages.

Le workflow utilise le code de la branche par défaut et régénère ensemble les
plateformes à partir de toutes les releases publiées. Il choisit la version
stable la plus élevée de chaque application, sans utiliser `releases/latest`.
Un build en brouillon ou une release marquée « pre-release » n'est jamais annoncé.
Si une plateforme n'a plus de release stable, son manifeste est retiré.

Avant d'écrire les fichiers, le générateur vérifie le tag et son commit, les
métadonnées `release-info.json`, la liste et la taille des installateurs, et
`SHA256SUMS` face aux [digests calculés par GitHub](https://docs.github.com/en/rest/releases/assets).
Seuls les petits fichiers de métadonnées sont téléchargés. Aucun build ni
téléchargement des installateurs n'est effectué. Une release sélectionnée mais
incomplète ou incohérente fait échouer le job avant tout déploiement Pages.

Le déploiement sérialise les publications pour éviter qu'une release Android
efface celle de Desktop. Chaque exécution repart de l'ensemble des releases
stables ; une exécution déclenchée par un ancien tag ne provoque pas de retour
à cette ancienne version. Un site vide est possible si aucune release stable
n'existe encore.

## Première mise en service

1. Pousser les changements et fusionner la PR vers `main`.
2. Dans Actions, lancer **Publier les manifestes de mise à jour** depuis `main`.
3. Vérifier les URL des manifestes des plateformes ayant une release stable.
4. Construire et installer une première version contenant cette fonctionnalité.
   Les anciens binaires ne peuvent pas acquérir ce code par une mise à jour OTA.
   Utiliser de nouvelles versions et de nouveaux tags, sans déplacer les tags publiés.
5. Tester le bouton de vérification, le téléchargement adapté et « Plus tard ».

Lors de la validation du 14 septembre 2026, Android `mobile-v1.4.1` est stable,
mais Desktop `desktop-v0.1.1` est marqué comme préversion sur GitHub : seul le
manifeste Android est donc généré. Pour annoncer Desktop, publier une version
stable ou décider explicitement de retirer le statut préversion de la release.

Pour vérifier la génération localement, sans publier :

```sh
node scripts/release/update-manifests.mjs build/updates-preview
```

## Comportement des applications

Une tentative automatique est effectuée au démarrage, au plus une fois par
24 heures pour la version installée, même si le réseau est indisponible. La date
est enregistrée séparément des favoris/historiques : localStorage sur Desktop,
AsyncStorage sur Android. La vérification manuelle ignore ce délai. Un stockage
inaccessible n'empêche pas la vérification, mais la limite ne peut alors pas
persister entre deux lancements.

Une notification non modale annonce une version plus récente. Le bouton manuel
se trouve dans les paramètres Desktop et dans le nouveau panneau Paramètres
Android, accessible par l'engrenage de l'en-tête. Les notes restent du texte.
« Plus tard » masque la notification pour cette session ; le bouton manuel
permet de la retrouver. Une erreur automatique n'interrompt ni l'écran courant
ni la lecture.

Les versions sont comparées numériquement. Android exige aussi un `versionCode`
strictement supérieur : un APK de même version mais de code supérieur peut être
proposé, jamais un APK au code identique/inférieur ni au nom de version inférieur.
Desktop utilise la version Tauri et l'architecture du binaire, sans deviner
l'architecture depuis le navigateur. Les architectures non distribuées sont
laissées sans proposition.

Le téléchargement vérifie d'abord la disponibilité de l'URL (HEAD), puis ouvre
le navigateur système. Linux nécessite `xdg-open` (`xdg-utils`, déclaré dans le
paquet `.deb`). L'échec d'ouverture ou un fichier indisponible produit un message
récupérable. La disponibilité peut néanmoins changer après ce contrôle.

## Validations légères

```sh
pnpm typecheck
node --test scripts/release/tests/*.test.mjs
pnpm --filter horus-desktop test:ui
```

Les tests couvrent les versions, plateformes/architectures, manifestes invalides,
digests et fichiers manquants, brouillons/préversions, limite quotidienne,
concurrence, réseau absent et délais d'attente simulés. Les tests UI Desktop
vérifient « Plus tard », la vérification manuelle et l'ouverture du bon DMG,
ainsi que les erreurs de téléchargement. Les builds natifs et essais sur appareil
sont lancés par l'utilisateur ; les appels réseau et natifs sont simulés dans
les tests UI.
