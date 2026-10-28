package app.zelo.auto

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Pont avec l'app : le seul réglage dont l'écran de la voiture a besoin est l'adresse de l'API. */
class ZeloAutoModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ZeloAuto")

    Function("setApiUrl") { url: String ->
      val context = appContext.reactContext ?: return@Function
      Settings.setApiUrl(context, url)
    }
  }
}
