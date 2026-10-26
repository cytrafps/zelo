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
)
