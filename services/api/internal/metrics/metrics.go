// Package metrics expose les mesures Prometheus de l'API (lues par Grafana).
package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	IngestRuns = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "zelo_ingest_runs_total",
		Help: "Collectes de données ouvertes, par source et résultat.",
	}, []string{"source", "result"})

	IngestRows = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Name: "zelo_ingest_rows",
		Help: "Nombre d'éléments lus lors de la dernière collecte réussie.",
	}, []string{"source"})

	IngestDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "zelo_ingest_duration_seconds",
		Help:    "Durée d'une collecte (téléchargement + enregistrement).",
		Buckets: []float64{0.5, 1, 2, 5, 10, 30, 60, 120},
	}, []string{"source"})

	IngestLastSuccess = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Name: "zelo_ingest_last_success_timestamp_seconds",
		Help: "Heure de la dernière collecte réussie (pour alerter si les données vieillissent).",
	}, []string{"source"})

	Reports = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "zelo_reports_total",
		Help: "Signalements reçus, par type.",
	}, []string{"kind"})

	Leader = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "zelo_collector_leader",
		Help: "1 si cette instance fait les collectes (verrou PostgreSQL), 0 sinon.",
	})

	Votes = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "zelo_report_votes_total",
		Help: "Votes sur les signalements (up=true : toujours là).",
	}, []string{"up"})

	// Requêtes HTTP par route déclarée (« GET /v1/route »), jamais par URL : cardinalité bornée.
	HTTPRequests = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "zelo_http_requests_total",
		Help: "Requêtes HTTP, par route et code de réponse.",
	}, []string{"route", "code"})

	HTTPDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "zelo_http_request_duration_seconds",
		Help:    "Durée de traitement d'une requête HTTP (hors flux temps réel).",
		Buckets: []float64{0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5},
	}, []string{"route"})

	Routes = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "zelo_routes_total",
		Help: "Calculs d'itinéraire, par mode et résultat (ok, hors_zone, sans_itineraire, erreur).",
	}, []string{"mode", "result"})

	RouteDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "zelo_route_duration_seconds",
		Help:    "Temps de calcul d'un itinéraire par Valhalla.",
		Buckets: []float64{0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5},
	}, []string{"mode"})
)
