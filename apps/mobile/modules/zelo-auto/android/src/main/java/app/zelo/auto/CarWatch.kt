package app.zelo.auto

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.os.Handler
import android.os.Looper
import androidx.car.app.connection.CarConnection
import org.json.JSONObject

/**
 * Suit la connexion à Android Auto tant que le processus de l'app vit (app ouverte, ou Zelo
 * affiché dans la voiture). Déconnexion : la voiture vient d'être garée, on note la dernière
 * position connue. Reconnexion : on repart, la place se libère. L'app lit ces événements à son
 * retour au premier plan (`take`) : rien n'est envoyé nulle part depuis ici.
 */
internal object CarWatch {
  private const val FILE = "zelo_auto_car"
  private const val EVENT = "event"

  /** Appelé à chaque nouvel événement, pendant que l'app écoute. */
  @Volatile var listener: ((JSONObject) -> Unit)? = null
  private var started = false

  fun start(context: Context) {
    val app = context.applicationContext
    Handler(Looper.getMainLooper()).post {
      if (started) return@post
      started = true
      var last: Int? = null
      CarConnection(app).type.observeForever { type ->
        val connected = type != CarConnection.CONNECTION_TYPE_NOT_CONNECTED
        val was = last?.let { it != CarConnection.CONNECTION_TYPE_NOT_CONNECTED }
        last = type
        // Le premier état reçu est l'état actuel, pas un changement.
        if (was == null || was == connected) return@observeForever
        record(app, if (connected) departed() else parked(app))
      }
    }
  }

  /** Dernier événement non lu, ou null ; il est effacé. */
  fun take(context: Context): JSONObject? {
    val prefs = context.getSharedPreferences(FILE, Context.MODE_PRIVATE)
    val raw = prefs.getString(EVENT, null) ?: return null
    prefs.edit().remove(EVENT).apply()
    return JSONObject(raw)
  }

  fun record(context: Context, event: JSONObject) {
    // Seul le dernier compte : garé puis reparti avant d'ouvrir l'app, c'est « reparti ».
    context.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().putString(EVENT, event.toString()).apply()
    listener?.invoke(event)
  }

  fun departed() = JSONObject().put("kind", "departed").put("at", System.currentTimeMillis())

  /** Garée : `fix` si l'on vient de lire la position, sinon la dernière connue du système. */
  fun parked(context: Context, fix: Location? = null): JSONObject {
    val e = JSONObject().put("kind", "parked").put("at", System.currentTimeMillis())
    (fix ?: lastLocation(context))?.let {
      e.put("lat", it.latitude).put("lon", it.longitude).put("accuracy", it.accuracy.toDouble()).put("fixAt", it.time)
    }
    return e
  }

  /** La plus récente des positions connues du système ; null sans permission. */
  @SuppressLint("MissingPermission")
  fun lastLocation(context: Context): Location? {
    if (!canLocate(context)) return null
    val lm = context.getSystemService(LocationManager::class.java) ?: return null
    return lm.getProviders(true).mapNotNull { runCatching { lm.getLastKnownLocation(it) }.getOrNull() }.maxByOrNull { it.time }
  }

  fun canLocate(context: Context) =
    listOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
      .any { context.checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED }
}
