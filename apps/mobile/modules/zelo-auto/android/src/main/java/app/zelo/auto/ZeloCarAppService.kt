package app.zelo.auto

import android.content.Intent
import android.content.pm.ApplicationInfo
import androidx.car.app.CarAppService
import androidx.car.app.Screen
import androidx.car.app.Session
import androidx.car.app.validation.HostValidator

/** Point d'entrée Android Auto : la voiture ouvre une session, qui affiche les lieux autour. */
class ZeloCarAppService : CarAppService() {
  override fun createHostValidator(): HostValidator =
    if (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) {
      // En développement : l'unité de test d'Android Auto (DHU) n'est pas signée par Google.
      HostValidator.ALLOW_ALL_HOSTS_VALIDATOR
    } else {
      HostValidator.Builder(applicationContext)
        .addAllowedHosts(R.array.zelo_car_hosts)
        .build()
    }

  override fun onCreateSession(): Session = object : Session() {
    override fun onCreateScreen(intent: Intent): Screen = SpotsScreen(carContext)
  }
}
