package expo.modules.localvideoproxy

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log

class StreamingForegroundService : Service() {
    companion object {
        private const val CHANNEL_ID = "horus_tv_streaming"
        private const val NOTIFICATION_ID = 4815
        private const val ACTION_START = "expo.modules.localvideoproxy.START"

        fun start(context: Context) {
            val intent = Intent(context, StreamingForegroundService::class.java)
                .setAction(ACTION_START)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, StreamingForegroundService::class.java))
        }
    }

    private var wakeLock: PowerManager.WakeLock? = null
    private var wifiLock: WifiManager.WifiLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        createNotificationChannel()
        val notification = createNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
        acquireLocks()
        Log.i("LocalVideoProxy", "TV streaming foreground service started")
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        stopForeground(STOP_FOREGROUND_REMOVE)
        releaseLocks()
        Log.i("LocalVideoProxy", "TV streaming foreground service stopped")
        super.onDestroy()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(NotificationManager::class.java)
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Diffusion vers la TV",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Maintient la diffusion vidéo active lorsque l’écran est éteint"
            setShowBadge(false)
        }
        manager.createNotificationChannel(channel)
    }

    private fun createNotification(): Notification {
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
        val contentIntent = launchIntent?.let {
            PendingIntent.getActivity(
                this,
                0,
                it,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        }
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            Notification.Builder(this)
        }
        return builder
            .setSmallIcon(android.R.drawable.stat_sys_upload)
            .setContentTitle("Horus diffuse vers la TV")
            .setContentText("Le téléphone reste disponible comme serveur vidéo")
            .setCategory(Notification.CATEGORY_SERVICE)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .apply { if (contentIntent != null) setContentIntent(contentIntent) }
            .build()
    }

    private fun acquireLocks() {
        try {
            if (wakeLock?.isHeld != true) {
                val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
                wakeLock = powerManager.newWakeLock(
                    PowerManager.PARTIAL_WAKE_LOCK,
                    "Horus:LocalVideoProxyWakeLock"
                ).apply {
                    setReferenceCounted(false)
                    acquire()
                }
            }

            if (wifiLock?.isHeld != true) {
                val wifiManager = applicationContext.getSystemService(Context.WIFI_SERVICE)
                    as WifiManager
                wifiLock = wifiManager.createWifiLock(
                    WifiManager.WIFI_MODE_FULL_HIGH_PERF,
                    "Horus:LocalVideoProxyWifiLock"
                ).apply {
                    setReferenceCounted(false)
                    acquire()
                }
            }
        } catch (error: Exception) {
            Log.e("LocalVideoProxy", "Failed to acquire streaming locks", error)
        }
    }

    private fun releaseLocks() {
        try {
            if (wakeLock?.isHeld == true) wakeLock?.release()
            if (wifiLock?.isHeld == true) wifiLock?.release()
        } catch (error: Exception) {
            Log.e("LocalVideoProxy", "Failed to release streaming locks", error)
        } finally {
            wakeLock = null
            wifiLock = null
        }
    }
}
