package app.zelo.auto

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothClass
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.os.Build
import android.os.CancellationSignal
import android.os.Handler
import android.os.Looper
import java.util.concurrent.Executors

/**
 * « Retenir où je me gare » : Android réveille l'app quand le téléphone se déconnecte du
 * Bluetooth de la voiture (ACL_DISCONNECTED fait partie des diffusions qu'un manifeste peut
 * encore recevoir, app fermée). Rien ne tourne entre-temps. La voiture est l'appareil choisi
 * par l'utilisateur ; sans choix, rien n'est fait.
 */
internal object CarBluetooth {
  private const val FILE = "zelo_auto_bluetooth"
  private const val DEVICE = "device"

  fun device(context: Context): String? =
    context.getSharedPreferences(FILE, Context.MODE_PRIVATE).getString(DEVICE, null)

  fun setDevice(context: Context, address: String?) {
    context.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().apply {
      if (address == null) remove(DEVICE) else putString(DEVICE, address)
    }.apply()
  }

  /** Appareils appairés, ceux qui ressemblent à une voiture (autoradio, kit mains libres) d'abord. */
  @SuppressLint("MissingPermission")
  fun paired(context: Context): List<Map<String, Any?>> {
    if (!canConnect(context)) return emptyList()
    val adapter = context.getSystemService(BluetoothManager::class.java)?.adapter ?: return emptyList()
    return adapter.bondedDevices.orEmpty()
      .map { mapOf("address" to it.address, "name" to (it.name ?: it.address), "car" to isCar(it)) }
      .sortedByDescending { it["car"] as Boolean }
  }

  @SuppressLint("MissingPermission")
  private fun isCar(d: BluetoothDevice) = when (d.bluetoothClass?.deviceClass) {
    BluetoothClass.Device.AUDIO_VIDEO_CAR_AUDIO, BluetoothClass.Device.AUDIO_VIDEO_HANDSFREE -> true
    else -> false
  }

  fun canConnect(context: Context) =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
      context.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED

  /** Position du moment, en moins de `timeoutMs` ; à défaut, la dernière connue. */
  @SuppressLint("MissingPermission")
  fun locate(context: Context, timeoutMs: Long, done: (Location?) -> Unit) {
    val lm = context.getSystemService(LocationManager::class.java)
    if (lm == null || !CarWatch.canLocate(context) || Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
      done(CarWatch.lastLocation(context))
      return
    }
    val provider = if (lm.isProviderEnabled(LocationManager.FUSED_PROVIDER)) LocationManager.FUSED_PROVIDER else LocationManager.GPS_PROVIDER
    val cancel = CancellationSignal()
    var finished = false
    val finish = { l: Location? ->
      if (!finished) {
        finished = true
        done(l ?: CarWatch.lastLocation(context))
      }
    }
    val main = Handler(Looper.getMainLooper())
    main.postDelayed({ cancel.cancel(); finish(null) }, timeoutMs)
    runCatching {
      lm.getCurrentLocation(provider, cancel, Executors.newSingleThreadExecutor()) { l -> main.post { finish(l) } }
    }.onFailure { main.post { finish(null) } }
  }
}

/** Connexion ou déconnexion Bluetooth : si c'est la voiture choisie, garée ou repartie. */
class CarBluetoothReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val device: BluetoothDevice? =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE, BluetoothDevice::class.java)
      } else {
        @Suppress("DEPRECATION") intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE)
      }
    val car = CarBluetooth.device(context) ?: return
    if (device?.address != car) return
    when (intent.action) {
      BluetoothDevice.ACTION_ACL_CONNECTED -> CarWatch.record(context, CarWatch.departed(CarWatch.BLUETOOTH))
      BluetoothDevice.ACTION_ACL_DISCONNECTED -> {
        // Le système laisse environ 10 s à un récepteur : la position est lue en 8 s au plus.
        val pending = goAsync()
        CarBluetooth.locate(context, 8_000) { fix ->
          CarWatch.record(context, CarWatch.parked(context, CarWatch.BLUETOOTH, fix))
          pending.finish()
        }
      }
    }
  }
}
