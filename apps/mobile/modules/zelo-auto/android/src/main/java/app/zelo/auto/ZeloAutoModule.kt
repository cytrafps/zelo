package app.zelo.auto

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject

/** Pont avec l'app : adresse de l'API pour l'écran de la voiture, et connexions à Android Auto. */
class ZeloAutoModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ZeloAuto")
    Events("onCarEvent")

    OnCreate {
      appContext.reactContext?.let { CarWatch.start(it) }
    }

    OnStartObserving {
      CarWatch.listener = { sendEvent("onCarEvent", it.toMap()) }
    }

    OnStopObserving {
      CarWatch.listener = null
    }

    Function("setApiUrl") { url: String ->
      val context = appContext.reactContext ?: return@Function
      Settings.setApiUrl(context, url)
    }

    Function("takeCarEvent") {
      appContext.reactContext?.let { CarWatch.take(it)?.toMap() }
    }

    // « Retenir où je me gare » : la voiture est un appareil Bluetooth appairé, choisi par l'utilisateur.
    Function("pairedDevices") {
      val context = appContext.reactContext ?: return@Function emptyList<Map<String, Any?>>()
      CarBluetooth.paired(context)
    }

    Function("carDevice") {
      appContext.reactContext?.let { CarBluetooth.device(it) }
    }

    Function("setCarDevice") { address: String? ->
      appContext.reactContext?.let { CarBluetooth.setDevice(it, address) }
    }
  }
}

private fun JSONObject.toMap(): Map<String, Any?> = keys().asSequence().associateWith { get(it) }
