# Custom ProGuard Rules for HorusRemote

# Preserve local-video-proxy native module and NanoHTTPD
-keep class fi.iki.elonen.** { *; }
-keep class expo.modules.mymodule.** { *; }

# Preserve react-native-udp (often broken by R8 in release)
-keep class com.tradle.react.** { *; }

# Preserve Google Cast (usually handled by its own AAR consumer rules, but added for safety)
-keep class com.google.android.gms.cast.** { *; }
-keep class com.reactnative.googlecast.** { *; }
