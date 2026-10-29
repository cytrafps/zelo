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
import org.json.JSONArray
import org.json.JSONObject

/**
 * Suit la connexion à Android Auto tant que le processus de l'app vit (app ouverte, ou Zelo
 * affiché dans la voiture). Déconnexion : la voiture vient d'être garée, on note la dernière
 * position connue. Reconnexion : on repart, la place se libère. L'app lit ces événements à son
 * retour au premier plan (`take`) : rien n'est envoyé nulle part depuis ici. Ils sont tous gardés,
 * dans l'ordre : garé en B puis reparti avant d'ouvrir l'app, c'est la place B qui se libère.
 */
internal object CarWatch {
  private const val FILE = "zelo_auto_car"
  private const val EVENTS = "events"
  /** Au-delà, les plus anciens sont oubliés : seuls les derniers décrivent où est la voiture. */
  private const val MAX_EVENTS = 8

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
        record(app, if (connected) departed(AUTO) else parked(app, AUTO))
      }
    }
  }

  const val AUTO = "auto"
  const val BLUETOOTH = "bluetooth"

  /** Événements non lus, du plus ancien au plus récent ; ils sont effacés. */
  @Synchronized
  fun take(context: Context): List<JSONObject> {
    val prefs = context.getSharedPreferences(FILE, Context.MODE_PRIVATE)
    val events = read(prefs.getString(EVENTS, null))
    if (events.isNotEmpty()) prefs.edit().remove(EVENTS).apply()
    return events
  }

  @Synchronized
  fun record(context: Context, event: JSONObject) {
    val prefs = context.getSharedPreferences(FILE, Context.MODE_PRIVATE)
    val events = (read(prefs.getString(EVENTS, null)) + event).takeLast(MAX_EVENTS)
    prefs.edit().putString(EVENTS, JSONArray(events).toString()).apply()
    listener?.invoke(event)
  }

  private fun read(raw: String?): List<JSONObject> {
    if (raw == null) return emptyList()
    return runCatching { JSONArray(raw).let { a -> List(a.length()) { a.getJSONObject(it) } } }.getOrDefault(emptyList())
  }

  /** `via` : Android Auto ou le Bluetooth de la voiture, pour le dire à l'utilisateur. */
  fun departed(via: String) = JSONObject().put("kind", "departed").put("at", System.currentTimeMillis()).put("via", via)

  /** Garée : `fix` si l'on vient de lire la position, sinon la dernière connue du système. */
  fun parked(context: Context, via: String, fix: Location? = null): JSONObject {
    val e = JSONObject().put("kind", "parked").put("at", System.currentTimeMillis()).put("via", via)
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
