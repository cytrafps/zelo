package app.zelo.auto

import android.content.Context

/** Réglages partagés entre l'app (qui les écrit) et le service Android Auto (qui les lit). */
internal object Settings {
  private const val FILE = "zelo_auto"
  private const val API_URL = "api_url"

  fun setApiUrl(context: Context, url: String) {
    context.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().putString(API_URL, url.trimEnd('/')).apply()
  }

  /** null tant que l'app n'a jamais été ouverte sur le téléphone. */
  fun apiUrl(context: Context): String? =
    context.getSharedPreferences(FILE, Context.MODE_PRIVATE).getString(API_URL, null)
}
