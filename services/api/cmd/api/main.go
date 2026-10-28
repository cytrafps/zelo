// Commande api : collecte les données ouvertes et sert l'API Zelo.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"net/netip"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"

	"github.com/cytrafps/zelo/services/api/internal/closure"
	"github.com/cytrafps/zelo/services/api/internal/fuel"
	"github.com/cytrafps/zelo/services/api/internal/httpapi"
	"github.com/cytrafps/zelo/services/api/internal/irve"
	"github.com/cytrafps/zelo/services/api/internal/junction"
	"github.com/cytrafps/zelo/services/api/internal/live"
	"github.com/cytrafps/zelo/services/api/internal/metrics"
	"github.com/cytrafps/zelo/services/api/internal/overpass"
	"github.com/cytrafps/zelo/services/api/internal/parking"
	"github.com/cytrafps/zelo/services/api/internal/route"
	"github.com/cytrafps/zelo/services/api/internal/servicearea"
	"github.com/cytrafps/zelo/services/api/internal/store"
	"github.com/cytrafps/zelo/services/api/internal/tarif"
	"github.com/cytrafps/zelo/services/api/internal/transit"
	"github.com/cytrafps/zelo/services/api/internal/weather"
	"github.com/cytrafps/zelo/services/api/internal/zfe"
)

func main() {
	once := flag.Bool("once", false, "collecter une fois toutes les sources puis quitter")
	flag.Parse()

	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	if err := run(log, *once); err != nil {
		log.Error("arrêt", "err", err)
		os.Exit(1)
	}
}

func run(log *slog.Logger, once bool) error {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		return errors.New("DATABASE_URL manquant")
	}
	bbox, err := parseBBox(os.Getenv("IMPORT_BBOX"))
	if err != nil {
		return fmt.Errorf("IMPORT_BBOX: %w", err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	db, err := store.Open(ctx, dbURL)
	if err != nil {
		return fmt.Errorf("base de données: %w", err)
	}
	defer db.Close()

	client := &http.Client{Timeout: 3 * time.Minute}
	jobs := []job{
		{"carburant", 10 * time.Minute, func(ctx context.Context) (int, error) {
			s, err := fuel.Fetch(ctx, client, fuel.FeedURL)
			if err != nil {
				return 0, err
			}
			return len(s), db.SaveFuel(ctx, s)
		}},
		{"bornes_statique", 24 * time.Hour, func(ctx context.Context) (int, error) {
			p, err := irve.FetchStatic(ctx, client, irve.StaticURL, bbox)
			if err != nil {
				return 0, err
			}
			return len(p), db.SaveChargePoints(ctx, p)
		}},
		{"bornes_dynamique", 5 * time.Minute, func(ctx context.Context) (int, error) {
			s, err := irve.FetchDynamic(ctx, client, irve.DynamicURL)
			if err != nil {
				return 0, err
			}
			return len(s), db.SaveChargeStatus(ctx, s)
		}},
		{"purge_signalements", time.Hour, func(ctx context.Context) (int, error) {
			n, err := db.PurgeReports(ctx)
			return int(n), err
		}},
	}

	// Overpass ne sert qu'une zone limitée : sans IMPORT_BBOX, pas d'import de parkings ni de feux.
	if bbox != (irve.BBox{}) {
		osmURL, zone := envOr("OVERPASS_URL", overpass.URL), overpass.BBox(bbox)
		jobs = append(jobs, job{"parkings", 24 * time.Hour, func(ctx context.Context) (int, error) {
			p, err := parking.Fetch(ctx, client, osmURL, zone)
			if err != nil {
				return 0, err
			}
			return len(p), db.SaveParkings(ctx, p)
		}}, job{"feux_stops", 24 * time.Hour, func(ctx context.Context) (int, error) {
			c, err := junction.Fetch(ctx, client, osmURL, zone)
			if err != nil {
				return 0, err
			}
			return len(c), db.SaveControls(ctx, c)
		}})
	} else {
		log.Warn("IMPORT_BBOX vide : import des parkings et des feux désactivé")
	}

	// Les aires servent les trajets : leur zone suit celle du graphe routier (la Marne), plus
	// large que celle des parkings. À défaut, IMPORT_BBOX.
	areasBox, err := parseBBox(envOr("AREAS_BBOX", os.Getenv("IMPORT_BBOX")))
	if err != nil {
		return fmt.Errorf("AREAS_BBOX: %w", err)
	}
	if areasBox != (irve.BBox{}) {
		jobs = append(jobs, job{"aires", 24 * time.Hour, func(ctx context.Context) (int, error) {
			a, err := servicearea.Fetch(ctx, client, envOr("OVERPASS_URL", overpass.URL), overpass.BBox(areasBox))
			if err != nil {
				return 0, err
			}
			return len(a), db.SaveAreas(ctx, a)
		}})
	}

	if once {
		for _, j := range jobs {
			if err := j.runOnce(ctx, log); err != nil {
				return err
			}
		}
		return nil
	}

	// Plusieurs instances peuvent tourner : une seule, élue par verrou PostgreSQL, fait les collectes.
	go db.RunAsLeader(ctx, store.CollectorLock, func(ctx context.Context) {
		var wg sync.WaitGroup
		for _, j := range jobs {
			wg.Go(func() { j.loop(ctx, log) })
		}
		wg.Wait()
	}, func(leader bool) {
		v := 0.0
		if leader {
			v = 1
		}
		metrics.Leader.Set(v)
		log.Info("collectes", "meneur", leader)
	})

	maxLive, err := strconv.Atoi(envOr("LIVE_MAX_CLIENTS", "5000"))
	if err != nil {
		return fmt.Errorf("LIVE_MAX_CLIENTS: %w", err)
	}
	trusted, err := parsePrefixes(os.Getenv("TRUSTED_PROXIES"))
	if err != nil {
		return fmt.Errorf("TRUSTED_PROXIES: %w", err)
	}
	hub := live.NewHub(maxLive)
	go db.Listen(ctx, log, hub.Broadcast)
	prometheus.MustRegister(prometheus.NewGaugeFunc(prometheus.GaugeOpts{
		Name: "zelo_live_clients", Help: "Clients connectés au flux temps réel.",
	}, func() float64 { return float64(hub.Len()) }))
	registerPoolMetrics(db)

	// Horaires du tram et des bus : chaque réplique garde les siens en mémoire (quelques Mo), rechargés chaque jour.
	var timetable atomic.Pointer[transit.Timetable]
	var realtime atomic.Pointer[transit.Realtime]
	go loadTimetable(ctx, log, client, envOr("GTFS_URL", transit.FeedURL), envOr("OVERPASS_URL", overpass.URL), &timetable)
	go loadRealtime(ctx, log, envOr("GTFS_RT_URL", transit.RealtimeURL), &realtime)
	go loadTariffs(ctx, log, client)
	var closures atomic.Pointer[[]closure.Closure]
	if bbox != (irve.BBox{}) {
		go loadClosures(ctx, log, client, envOr("DIALOG_URL", closure.FeedURL), closure.BBox(bbox), &closures)
	}
	var zones atomic.Pointer[[]zfe.Zone]
	if bbox != (irve.BBox{}) {
		go loadZones(ctx, log, client, envOr("ZFE_URL", zfe.FeedURL), zfe.BBox(bbox), &zones)
	}

	mux := http.NewServeMux()
	mux.Handle("/metrics", promhttp.Handler())
	weatherClient := &http.Client{Timeout: 4 * time.Second}
	cfg := httpapi.Config{
		TrustProxy:     os.Getenv("TRUST_PROXY") == "true",
		TrustedProxies: trusted,
		Transit:        timetable.Load,
		Realtime:       realtime.Load,
		Weather: &weather.Cache{TTL: 15 * time.Minute, Fetch: func(ctx context.Context, lat, lon float64) ([]weather.Slot, error) {
			return weather.Fetch(ctx, weatherClient, envOr("WEATHER_URL", weather.BaseURL), lat, lon)
		}},
		Zones: func() []zfe.Zone {
			if z := zones.Load(); z != nil {
				return *z
			}
			return nil
		},
		Closures: func() []closure.Closure {
			if c := closures.Load(); c != nil {
				return *c
			}
			return nil
		},
		OriginPatterns: splitList(os.Getenv("WS_ORIGINS")),
	}
	if u := os.Getenv("VALHALLA_URL"); u != "" {
		cfg.Router = route.New(strings.TrimRight(u, "/"))
	} else {
		log.Warn("VALHALLA_URL vide : itinéraires désactivés")
	}
	mux.Handle("/", httpapi.New(db, hub, log, cfg))

	srv := &http.Server{
		Addr:              envOr("ADDR", ":8080"),
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		// Les délais ne s'appliquent plus aux connexions passées en WebSocket (testé dans httpapi).
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  2 * time.Minute,
	}
	// Shutdown n'attend pas les WebSocket (connexions détournées) : on les ferme proprement
	// (« going away ») pour que les clients rejoignent tout de suite une autre réplique.
	srv.RegisterOnShutdown(hub.Close)
	errc := make(chan error, 1)
	go func() {
		log.Info("écoute", "addr", srv.Addr)
		errc <- srv.ListenAndServe()
	}()

	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
	}
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return srv.Shutdown(shutdownCtx)
}

type job struct {
	name  string
	every time.Duration
	fn    func(context.Context) (int, error)
}

func (j job) runOnce(ctx context.Context, log *slog.Logger) error {
	start := time.Now()
	ctx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()
	n, err := j.fn(ctx)
	metrics.IngestDuration.WithLabelValues(j.name).Observe(time.Since(start).Seconds())
	if err != nil {
		metrics.IngestRuns.WithLabelValues(j.name, "erreur").Inc()
		log.Error("collecte", "source", j.name, "err", err)
		return fmt.Errorf("%s: %w", j.name, err)
	}
	metrics.IngestRuns.WithLabelValues(j.name, "ok").Inc()
	metrics.IngestRows.WithLabelValues(j.name).Set(float64(n))
	metrics.IngestLastSuccess.WithLabelValues(j.name).SetToCurrentTime()
	log.Info("collecte", "source", j.name, "elements", n, "duree", time.Since(start).Round(time.Millisecond).String())
	return nil
}

// loop lance la collecte tout de suite puis à intervalle régulier ; une erreur n'arrête pas la boucle.
func (j job) loop(ctx context.Context, log *slog.Logger) {
	t := time.NewTicker(j.every)
	defer t.Stop()
	for {
		_ = j.runOnce(ctx, log)
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

func parseBBox(s string) (irve.BBox, error) {
	if s == "" {
		return irve.BBox{}, nil
	}
	p := strings.Split(s, ",")
	if len(p) != 4 {
		return irve.BBox{}, errors.New("format attendu : minLon,minLat,maxLon,maxLat")
	}
	var v [4]float64
	for i := range p {
		f, err := strconv.ParseFloat(strings.TrimSpace(p[i]), 64)
		if err != nil {
			return irve.BBox{}, err
		}
		v[i] = f
	}
	return irve.BBox{MinLon: v[0], MinLat: v[1], MaxLon: v[2], MaxLat: v[3]}, nil
}

// parsePrefixes lit « 10.42.0.0/16, 10.43.0.0/16 » ; une adresse seule vaut pour elle-même.
func parsePrefixes(s string) ([]netip.Prefix, error) {
	var out []netip.Prefix
	for _, x := range splitList(s) {
		if !strings.Contains(x, "/") {
			a, err := netip.ParseAddr(x)
			if err != nil {
				return nil, err
			}
			out = append(out, netip.PrefixFrom(a, a.BitLen()))
			continue
		}
		p, err := netip.ParsePrefix(x)
		if err != nil {
			return nil, err
		}
		out = append(out, p.Masked())
	}
	return out, nil
}

func splitList(s string) []string {
	var out []string
	for _, x := range strings.Split(s, ",") {
		if x = strings.TrimSpace(x); x != "" {
			out = append(out, x)
		}
	}
	return out
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// loadTimetable charge le GTFS (tram et bus) au démarrage puis chaque jour ; après un échec, réessaie dans 15 min.
// Les horaires précédents restent servis tant que les nouveaux ne sont pas lus.
func loadTimetable(ctx context.Context, log *slog.Logger, client *http.Client, url, osmURL string, into *atomic.Pointer[transit.Timetable]) {
	for {
		wait := 24 * time.Hour
		start := time.Now()
		tt, err := transit.Fetch(ctx, client, url)
		if err != nil {
			log.Error("horaires tram et bus", "err", err)
			metrics.IngestRuns.WithLabelValues("transports", "erreur").Inc()
			wait = 15 * time.Minute
		} else {
			// Noms accentués d'OSM : sans eux, les noms GTFS (en capitales) restent.
			if osm, err := tt.FetchNames(ctx, client, osmURL); err != nil {
				log.Warn("noms des arrêts", "err", err)
			} else {
				log.Info("noms des arrêts", "renommes", tt.Rename(osm))
			}
			into.Store(tt)
			metrics.IngestRuns.WithLabelValues("transports", "ok").Inc()
			metrics.IngestRows.WithLabelValues("transports").Set(float64(len(tt.Stops)))
			metrics.IngestLastSuccess.WithLabelValues("transports").SetToCurrentTime()
			log.Info("horaires tram et bus", "arrets", len(tt.Stops), "duree", time.Since(start).Round(time.Millisecond).String())
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(wait):
		}
	}
}

// loadZones lit chaque jour la base nationale des zones à faibles émissions ; après un échec,
// les précédentes restent servies et un nouvel essai a lieu dans 1 h.
func loadZones(ctx context.Context, log *slog.Logger, client *http.Client, url string, zone zfe.BBox, into *atomic.Pointer[[]zfe.Zone]) {
	for {
		wait := 24 * time.Hour
		z, err := zfe.Fetch(ctx, client, url, zone)
		if err != nil {
			log.Warn("zones à faibles émissions", "err", err)
			metrics.IngestRuns.WithLabelValues("zfe", "erreur").Inc()
			wait = time.Hour
		} else {
			into.Store(&z)
			metrics.IngestRuns.WithLabelValues("zfe", "ok").Inc()
			metrics.IngestRows.WithLabelValues("zfe").Set(float64(len(z)))
			metrics.IngestLastSuccess.WithLabelValues("zfe").SetToCurrentTime()
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(wait):
		}
	}
}

// loadClosures lit chaque jour les fermetures de rues publiées dans DiaLog (flux national
// d'environ 80 Mo, lu au fil de l'eau : seules celles de la zone restent en mémoire). Après
// un échec, les précédentes restent appliquées et un nouvel essai a lieu dans 1 h.
func loadClosures(ctx context.Context, log *slog.Logger, client *http.Client, url string, zone closure.BBox, into *atomic.Pointer[[]closure.Closure]) {
	for {
		wait := 24 * time.Hour
		start := time.Now()
		c, err := closure.Fetch(ctx, client, url, zone)
		if err != nil {
			log.Warn("fermetures de rues (DiaLog)", "err", err)
			metrics.IngestRuns.WithLabelValues("fermetures", "erreur").Inc()
			wait = time.Hour
		} else {
			into.Store(&c)
			metrics.IngestRuns.WithLabelValues("fermetures", "ok").Inc()
			metrics.IngestRows.WithLabelValues("fermetures").Set(float64(len(c)))
			metrics.IngestLastSuccess.WithLabelValues("fermetures").SetToCurrentTime()
			log.Info("fermetures de rues (DiaLog)", "fermetures", len(c), "duree", time.Since(start).Round(time.Millisecond).String())
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(wait):
		}
	}
}

// loadTariffs relit chaque jour les tarifs des parkings sur le site des exploitants, sur chaque
// réplique (ils sont gardés en mémoire). Une page illisible garde la grille précédente et
// réessaie dans 1 h : un exploitant qui refond son site se voit à l'alerte de fraîcheur.
func loadTariffs(ctx context.Context, log *slog.Logger, client *http.Client) {
	for {
		wait := 24 * time.Hour
		n, changed, err := tarif.Refresh(ctx, client)
		if len(changed) > 0 {
			log.Info("tarifs des parkings modifiés", "parkings", changed)
		}
		metrics.IngestRows.WithLabelValues("tarifs").Set(float64(n))
		if err != nil {
			log.Warn("tarifs des parkings", "err", err, "a_jour", n)
			metrics.IngestRuns.WithLabelValues("tarifs", "erreur").Inc()
			wait = time.Hour
		} else {
			metrics.IngestRuns.WithLabelValues("tarifs", "ok").Inc()
			metrics.IngestLastSuccess.WithLabelValues("tarifs").SetToCurrentTime()
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(wait):
		}
	}
}

// loadRealtime lit le temps réel (GTFS-RT) toutes les 30 s ; un flux en échec n'efface pas le
// précédent, que Plan ignore de lui-même passé quelques minutes.
func loadRealtime(ctx context.Context, log *slog.Logger, url string, into *atomic.Pointer[transit.Realtime]) {
	client := &http.Client{Timeout: 10 * time.Second}
	failures := 0
	for {
		rt, err := transit.FetchRealtime(ctx, client, url)
		if err != nil {
			if failures++; failures == 1 || failures%20 == 0 {
				log.Warn("temps réel tram et bus", "err", err, "echecs", failures)
			}
			metrics.IngestRuns.WithLabelValues("temps_reel", "erreur").Inc()
		} else {
			failures = 0
			into.Store(rt)
			metrics.IngestRuns.WithLabelValues("temps_reel", "ok").Inc()
			metrics.IngestLastSuccess.WithLabelValues("temps_reel").SetToCurrentTime()
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(30 * time.Second):
		}
	}
}

// registerPoolMetrics expose le pool PostgreSQL : un pool saturé (acquisitions qui attendent)
// explique une API lente avant que la base elle-même ne le soit.
func registerPoolMetrics(db *store.Store) {
	gauge := func(name, help string, v func() float64) {
		prometheus.MustRegister(prometheus.NewGaugeFunc(prometheus.GaugeOpts{Name: name, Help: help}, v))
	}
	counter := func(name, help string, v func() float64) {
		prometheus.MustRegister(prometheus.NewCounterFunc(prometheus.CounterOpts{Name: name, Help: help}, v))
	}
	gauge("zelo_db_pool_acquired_conns", "Connexions PostgreSQL en cours d'utilisation.",
		func() float64 { return float64(db.PoolStat().AcquiredConns()) })
	gauge("zelo_db_pool_idle_conns", "Connexions PostgreSQL ouvertes et libres.",
		func() float64 { return float64(db.PoolStat().IdleConns()) })
	gauge("zelo_db_pool_max_conns", "Taille maximale du pool PostgreSQL.",
		func() float64 { return float64(db.PoolStat().MaxConns()) })
	counter("zelo_db_pool_empty_acquire_total", "Acquisitions qui ont dû attendre une connexion libre.",
		func() float64 { return float64(db.PoolStat().EmptyAcquireCount()) })
	counter("zelo_db_pool_acquire_wait_seconds_total", "Temps total passé à attendre une connexion.",
		func() float64 { return db.PoolStat().AcquireDuration().Seconds() })
}
