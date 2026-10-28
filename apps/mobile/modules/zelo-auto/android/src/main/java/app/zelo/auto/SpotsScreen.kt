package app.zelo.auto

import android.Manifest
import android.annotation.SuppressLint
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.os.Handler
import android.os.Looper
import android.text.SpannableString
import android.text.Spanned
import androidx.car.app.CarContext
import androidx.car.app.CarToast
import androidx.car.app.Screen
import androidx.car.app.constraints.ConstraintManager
import androidx.car.app.model.Action
import androidx.car.app.model.ActionStrip
import androidx.car.app.model.CarColor
import androidx.car.app.model.CarLocation
import androidx.car.app.model.Distance
import androidx.car.app.model.DistanceSpan
import androidx.car.app.model.ItemList
import androidx.car.app.model.MessageTemplate
import androidx.car.app.model.Metadata
import androidx.car.app.model.Place
import androidx.car.app.model.PlaceListMapTemplate
import androidx.car.app.model.PlaceMarker
import androidx.car.app.model.Row
import androidx.car.app.model.Template
import androidx.core.content.ContextCompat
import androidx.core.location.LocationManagerCompat
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import java.util.concurrent.Executors

/**
 * Liste des parkings (ou des bornes libres) les plus proches, posés sur la carte de la voiture.
 * La carte est dessinée par Android Auto ; Zelo fournit les lieux et ce qui aide à choisir.
 */
@Suppress("DEPRECATION") // PlaceListMapTemplate reste le gabarit des catégories parking et recharge.
internal class SpotsScreen(carContext: CarContext) : Screen(carContext) {
  private val io = Executors.newSingleThreadExecutor()
  private val main = Handler(Looper.getMainLooper())

  private var category = Category.PARKING
  private var spots: List<Spot>? = null
  private var error: String? = null

  init {
    lifecycle.addObserver(object : DefaultLifecycleObserver {
      override fun onStart(owner: LifecycleOwner) = load()
      override fun onDestroy(owner: LifecycleOwner) = io.shutdown()
    })
  }

  override fun onGetTemplate(): Template {
    error?.let { return message(it) }

    val switch = Action.Builder()
      .setTitle(if (category == Category.PARKING) "Recharge" else "Parkings")
      .setOnClickListener {
        category = if (category == Category.PARKING) Category.CHARGE else Category.PARKING
        load()
      }
      .build()

    val template = PlaceListMapTemplate.Builder()
      .setTitle(category.title)
      .setHeaderAction(Action.APP_ICON)
      .setActionStrip(ActionStrip.Builder().addAction(switch).build())
      .setCurrentLocationEnabled(hasLocationPermission())

    val list = spots ?: return template.setLoading(true).build()
    val items = ItemList.Builder()
    if (list.isEmpty()) {
      items.setNoItemsMessage(if (category == Category.PARKING) "Aucun parking à moins de 2 km" else "Aucune borne libre à moins de 2 km")
    }
    list.forEach { spot ->
      // La distance passe par un DistanceSpan : la voiture l'affiche dans son format et ses unités.
      // Le premier caractère est remplacé par la distance : « 350 m · 1 h : 1,20 € ».
      val text = SpannableString(if (spot.summary.isEmpty()) " " else " · ${spot.summary}")
      text.setSpan(DistanceSpan.create(distance(spot.meters)), 0, 1, Spanned.SPAN_INCLUSIVE_INCLUSIVE)
      items.addItem(
        Row.Builder()
          .setTitle(spot.name)
          .addText(text)
          .setMetadata(
            Metadata.Builder()
              .setPlace(
                Place.Builder(CarLocation.create(spot.lat, spot.lon))
                  .setMarker(PlaceMarker.Builder().setColor(markerColor()).build())
                  .build(),
              )
              .build(),
          )
          .setOnClickListener { screenManager.push(SpotScreen(carContext, spot)) }
          .build(),
      )
    }
    return template.setItemList(items.build()).build()
  }

  private fun load() {
    spots = null
    error = null
    invalidate()
    val apiUrl = Settings.apiUrl(carContext)
    if (apiUrl == null) return fail("Ouvre Zelo une fois sur ton téléphone pour le relier à la voiture.")
    if (!hasLocationPermission()) return fail("Autorise la localisation dans Zelo, sur ton téléphone.")
    currentLocation { location ->
      if (location == null) return@currentLocation fail("Position introuvable pour le moment.")
      val limit = carContext.getCarService(ConstraintManager::class.java)
        .getContentLimit(ConstraintManager.CONTENT_LIMIT_TYPE_PLACE_LIST)
      val wanted = category
      io.execute {
        val result = runCatching { ZeloApi.nearby(apiUrl, wanted, location.latitude, location.longitude, limit) }
        main.post {
          if (wanted != category) return@post // l'utilisateur a changé de catégorie entre-temps
          result
            .onSuccess { spots = it; invalidate() }
            .onFailure {
              CarToast.makeText(carContext, "Zelo injoignable", CarToast.LENGTH_LONG).show()
              fail("Zelo est injoignable. Vérifie la connexion du téléphone.")
            }
        }
      }
    }
  }

  private fun fail(message: String) {
    error = message
    invalidate()
  }

  private fun message(text: String): Template =
    MessageTemplate.Builder(text)
      .setTitle("Zelo")
      .setHeaderAction(Action.APP_ICON)
      .addAction(Action.Builder().setTitle("Réessayer").setOnClickListener { load() }.build())
      .build()

  private fun hasLocationPermission() =
    ContextCompat.checkSelfPermission(carContext, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
      ContextCompat.checkSelfPermission(carContext, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

  /** Position du téléphone : une mesure fraîche, ou la dernière connue si le GPS tarde. */
  @SuppressLint("MissingPermission") // vérifiée par hasLocationPermission()
  private fun currentLocation(callback: (Location?) -> Unit) {
    val lm = carContext.getSystemService(LocationManager::class.java)
    val provider = if (lm.isProviderEnabled(LocationManager.GPS_PROVIDER)) LocationManager.GPS_PROVIDER else LocationManager.NETWORK_PROVIDER
    val last = lm.getLastKnownLocation(provider)
    LocationManagerCompat.getCurrentLocation(lm, provider, null, ContextCompat.getMainExecutor(carContext)) { location ->
      callback(location ?: last)
    }
  }

  private fun markerColor() = if (category == Category.PARKING) CarColor.BLUE else CarColor.GREEN

  private fun distance(meters: Double): Distance =
    if (meters < 1000) {
      Distance.create(meters, Distance.UNIT_METERS)
    } else {
      Distance.create(meters / 1000, Distance.UNIT_KILOMETERS)
    }
}
