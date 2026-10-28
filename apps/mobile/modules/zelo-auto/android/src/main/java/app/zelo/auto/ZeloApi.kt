package app.zelo.auto

import java.net.HttpURLConnection
import java.net.URL
import java.text.NumberFormat
import java.util.Locale
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt
import org.json.JSONObject

/** Un lieu affiché dans la voiture : parking ou borne, avec ce qui aide à choisir. */
internal data class Spot(
  val id: String,
  val name: String,
  val lat: Double,
  val lon: Double,
  val meters: Double,
  /** Ce qui départage deux lieux : prix pour 1 h, places libres… */
  val summary: String,
  /** Lignes de la fiche détaillée. */
  val details: List<Pair<String, String>>,
)

internal enum class Category(val title: String, val path: String) {
  PARKING("Parkings", "/v1/parkings"),
  CHARGE("Bornes de recharge", "/v1/charge-stations"),
}

/** Client minimal de l'API Zelo (mêmes routes que l'app). Appels bloquants : jamais sur le fil principal. */
internal object ZeloApi {
  /** ~2 km autour de la position : la voiture affiche au plus quelques lieux, les plus proches. */
  private const val HALF_SIDE_DEG = 0.02

  fun nearby(baseUrl: String, category: Category, lat: Double, lon: Double, limit: Int): List<Spot> {
    val bbox = "%.5f,%.5f,%.5f,%.5f".format(
      Locale.ROOT, lon - HALF_SIDE_DEG * 1.5, lat - HALF_SIDE_DEG, lon + HALF_SIDE_DEG * 1.5, lat + HALF_SIDE_DEG,
    )
    val items = JSONObject(get("$baseUrl${category.path}?bbox=$bbox")).getJSONArray("items")
    val spots = (0 until items.length()).mapNotNull { i ->
      val o = items.getJSONObject(i)
      when (category) {
        Category.PARKING -> parking(o, lat, lon)
        Category.CHARGE -> charge(o, lat, lon)
      }
    }
    return spots.sortedBy { it.meters }.take(limit)
  }

  private fun parking(o: JSONObject, lat: Double, lon: Double): Spot {
    val details = mutableListOf<Pair<String, String>>()
    val tariff = o.optJSONObject("tariff")
    var price: String? = null
    if (tariff != null) {
      val free = tariff.optInt("free")
      if (free > 0) details += "$free min" to "Offertes"
      val prices = tariff.getJSONArray("prices")
      for (i in 0 until prices.length()) {
        val p = prices.getJSONObject(i)
        val line = stay(p.getInt("minutes")) to euros(p.getInt("cents"))
        if (i == 0) price = "${line.first} : ${line.second}"
        details += line
      }
    } else if (!o.isNull("fee")) {
      price = if (o.getBoolean("fee")) "Payant" else "Gratuit"
      details += "Tarif" to price
    }
    if (!o.isNull("capacity")) details += "Places" to o.getInt("capacity").toString()
    if (!o.isNull("maxHeight")) details += "Hauteur max." to "%.2f m".format(Locale.FRANCE, o.getDouble("maxHeight"))
    val name = o.optString("name").ifBlank { "Parking" }
    return spot(o, name, lat, lon, listOfNotNull(price).joinToString(" · "), details)
  }

  private fun charge(o: JSONObject, lat: Double, lon: Double): Spot? {
    val total = o.getInt("total")
    val available = if (o.isNull("available")) null else o.getInt("available")
    // Une borne pleine ne mérite pas le détour : on ne propose que celles annoncées libres ou sans état publié.
    if (available == 0) return null
    val power = "${o.getDouble("maxPowerKw").toInt()} kW"
    val state = available?.let { "$it libre${if (it > 1) "s" else ""} sur $total" } ?: "État non publié"
    val details = mutableListOf("Disponibilité" to state, "Puissance max." to power)
    o.optJSONObject("price")?.let { p ->
      details += "Prix" to if (p.getBoolean("free")) "Gratuite" else (if (p.getBoolean("from")) "dès " else "") + kwh(p.getDouble("kwh"))
    }
    o.optString("operator").takeIf { it.isNotBlank() }?.let { details += "Opérateur" to it }
    val name = o.optString("name").ifBlank { "Borne" }
    return spot(o, name, lat, lon, "$state · $power", details)
  }

  private fun spot(o: JSONObject, name: String, lat: Double, lon: Double, summary: String, details: List<Pair<String, String>>): Spot {
    val sLat = o.getDouble("lat")
    val sLon = o.getDouble("lon")
    return Spot(o.getString("id"), name, sLat, sLon, distance(lat, lon, sLat, sLon), summary, details)
  }

  private fun get(url: String): String {
    val c = URL(url).openConnection() as HttpURLConnection
    c.connectTimeout = 5_000
    c.readTimeout = 10_000
    try {
      if (c.responseCode != 200) error("HTTP ${c.responseCode}")
      return c.inputStream.bufferedReader().use { it.readText() }
    } finally {
      c.disconnect()
    }
  }

  private fun stay(minutes: Int) = if (minutes < 60) "$minutes min" else "${minutes / 60} h"

  private fun euros(cents: Int): String =
    if (cents == 0) "Gratuit" else NumberFormat.getCurrencyInstance(Locale.FRANCE).format(cents / 100.0)

  private fun kwh(v: Double): String =
    NumberFormat.getNumberInstance(Locale.FRANCE).apply { minimumFractionDigits = 2; maximumFractionDigits = 3 }.format(v) + " €/kWh"

  /** Distance à vol d'oiseau (haversine), en mètres. */
  fun distance(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
    val r = Math::toRadians
    val h = sin(r(lat2 - lat1) / 2).pow(2) + cos(r(lat1)) * cos(r(lat2)) * sin(r(lon2 - lon1) / 2).pow(2)
    return 2 * 6_371_008.8 * asin(sqrt(h))
  }
}
