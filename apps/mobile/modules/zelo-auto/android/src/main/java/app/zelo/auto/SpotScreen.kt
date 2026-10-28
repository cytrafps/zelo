package app.zelo.auto

import android.content.Intent
import android.net.Uri
import androidx.car.app.CarContext
import androidx.car.app.versioning.CarAppApiLevels
import androidx.car.app.Screen
import androidx.car.app.model.Action
import androidx.car.app.model.Pane
import androidx.car.app.model.PaneTemplate
import androidx.car.app.model.Row
import androidx.car.app.model.Template

/** Fiche d'un parking ou d'une borne : ce qui aide à choisir, puis « Y aller ». */
internal class SpotScreen(carContext: CarContext, private val spot: Spot) : Screen(carContext) {
  override fun onGetTemplate(): Template {
    val pane = Pane.Builder()
    // Une ligne par information, dans la limite d'affichage de la voiture (4 lignes au minimum garanties).
    spot.details.take(4).forEach { (label, value) ->
      pane.addRow(Row.Builder().setTitle(label).addText(value).build())
    }
    val go = Action.Builder().setTitle("Y aller").setOnClickListener { navigate() }
    // Bouton mis en avant : seulement sur les voitures qui le gèrent (API 4 et plus).
    if (carContext.carAppApiLevel >= CarAppApiLevels.LEVEL_4) go.setFlags(Action.FLAG_PRIMARY)
    pane.addAction(go.build())
    return PaneTemplate.Builder(pane.build())
      .setTitle(spot.name)
      .setHeaderAction(Action.BACK)
      .build()
  }

  /** Le guidage est confié à l'app de navigation de la voiture (Google Maps, Waze…). */
  private fun navigate() {
    val uri = Uri.parse("geo:0,0?q=${spot.lat},${spot.lon}(${Uri.encode(spot.name)})")
    carContext.startCarApp(Intent(CarContext.ACTION_NAVIGATE, uri))
  }
}
