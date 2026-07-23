# 1. Conserver tous les modules Expo et leurs définitions de fonctions
-keep class expo.modules.** { *; }
-keep class * extends expo.modules.core.interfaces.Module { *; }
-keep interface expo.modules.** { *; }

# 2. Conserver spécifiquement notre module local
-keep class expo.modules.localvideoproxy.** { *; }

# 3. Conserver intégralement le serveur HTTP NanoHTTPD
-keep class fi.iki.elonen.** { *; }
-keep class fi.iki.elonen.NanoHTTPD$** { *; }

# 4. Conserver la librairie d'UDP Sockets
-keep class com.tradle.react.** { *; }
