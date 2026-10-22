# Patch Android 1.4.11 — code 35

Le build `mobile-v1.4.10` échouait dans `:app:checkReleaseAarMetadata`.
La version dynamique Google Cast `+` avait sélectionné 23.0.0 et sa dépendance
MediaRouter 1.9.0-beta01, qui exige SDK 37 et AGP 9.1.0. Le projet utilise
SDK 36 et AGP 8.11.0.

L'option Expo `androidPlayServicesCastFrameworkVersion` fixe maintenant Cast à
22.3.1. Le plugin officiel met à jour aussi bien un nouveau projet Android
qu'un projet existant lors du prebuild. Le graphe Gradle vérifié résout Cast
22.3.1 et MediaRouter 1.8.0-beta01, sans forcer une version transitive isolée.

Validation : prebuild réel, `:app:checkPreviewAarMetadata` et compilation Java
du module Google Cast réussis. La preview utilise les dépendances release des
bibliothèques, sans les secrets de signature de production. `pnpm check`, les
contrôles de version et les 41 tests des scripts de release réussissent.
Le nouveau test vérifie le remplacement de l'ancien `+` et l'idempotence du
prebuild sur le code du plugin installé.

Le tag prévu est `mobile-v1.4.11` sur le commit fusionné. Il déclenche un nouveau
build signé et son brouillon ; le tag précédent reste inchangé. La validation
AAR locale ne remplace pas la construction complète de l'APK sur GitHub.
Desktop conserve 0.1.12.

Références :
- Build échoué : https://github.com/CoRExE/Horus/actions/runs/39828927833
- POM Cast 23.0.0 : https://dl.google.com/dl/android/maven2/com/google/android/gms/play-services-cast-framework/23.0.0/play-services-cast-framework-23.0.0.pom
- POM Cast 22.3.1 : https://dl.google.com/dl/android/maven2/com/google/android/gms/play-services-cast-framework/22.3.1/play-services-cast-framework-22.3.1.pom
