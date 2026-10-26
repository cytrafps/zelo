// Package httpapi expose l'API REST et le flux temps réel (WebSocket).
package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
	"golang.org/x/time/rate"

	"github.com/cytrafps/zelo/services/api/internal/live"
	"github.com/cytrafps/zelo/services/api/internal/metrics"
	"github.com/cytrafps/zelo/services/api/internal/store"
)

const (
	maxResults = 500
	maxSpanDeg = 1.0 // une requête couvre au plus ~110 km de côté
)

// ReportTTL fixe la durée de vie de chaque type de signalement.
// Volontairement aucun type « police » ou « radar » (décret 2012-3, art. R413-15).
var ReportTTL = map[string]time.Duration{
	"accident":      time.Hour,
	"travaux":       24 * time.Hour,
	"bouchon":       30 * time.Minute,
	"obstacle":      time.Hour,
	"route_fermee":  12 * time.Hour,
	"place_liberee": 10 * time.Minute,
	"borne_hs":      6 * time.Hour,
}

type Store interface {
	Ping(context.Context) error
	FuelStations(context.Context, store.BBox, int) ([]store.FuelStation, error)
	ChargeStations(context.Context, store.BBox, int) ([]store.ChargeStation, error)
	Parkings(context.Context, store.BBox, int) ([]store.Parking, error)
	Reports(context.Context, store.BBox, int) ([]store.Report, error)
	AddReport(context.Context, string, float64, float64, time.Duration) (store.Report, error)
}

type Config struct {
	// TrustProxy : lire l'IP cliente dans CF-Connecting-IP (derrière Cloudflare uniquement).
	TrustProxy bool
	// OriginPatterns autorisés pour le WebSocket depuis un navigateur (tableau de bord web).
	OriginPatterns []string
}

type API struct {
	store   Store
	hub     *live.Hub
	log     *slog.Logger
	cfg     Config
	limiter *ipLimiter
}

func New(s Store, hub *live.Hub, log *slog.Logger, cfg Config) http.Handler {
	a := &API{store: s, hub: hub, log: log, cfg: cfg, limiter: newIPLimiter(rate.Every(12*time.Second), 5)}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /livez", func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte("ok")) })
	mux.HandleFunc("GET /healthz", a.health)
	mux.HandleFunc("GET /v1/fuel-stations", a.fuelStations)
	mux.HandleFunc("GET /v1/charge-stations", a.chargeStations)
	mux.HandleFunc("GET /v1/parkings", a.parkings)
	mux.HandleFunc("GET /v1/reports", a.reports)
	mux.HandleFunc("POST /v1/reports", a.addReport)
	mux.HandleFunc("GET /v1/live", a.liveFeed)
	return mux
}

func (a *API) health(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if err := a.store.Ping(ctx); err != nil {
		http.Error(w, "base de données injoignable", http.StatusServiceUnavailable)
		return
	}
	w.Write([]byte("ok"))
}

func (a *API) fuelStations(w http.ResponseWriter, r *http.Request) {
	list(a, w, r, a.store.FuelStations, 60)
}

func (a *API) chargeStations(w http.ResponseWriter, r *http.Request) {
	list(a, w, r, a.store.ChargeStations, 60)
}

func (a *API) parkings(w http.ResponseWriter, r *http.Request) {
	list(a, w, r, a.store.Parkings, 300) // données OSM rafraîchies une fois par jour
}

func (a *API) reports(w http.ResponseWriter, r *http.Request) {
	list(a, w, r, a.store.Reports, 0)
}

func list[T any](a *API, w http.ResponseWriter, r *http.Request,
	query func(context.Context, store.BBox, int) ([]T, error), maxAge int) {
	b, err := parseBBox(r.URL.Query().Get("bbox"))
	if err != nil {
		httpError(w, http.StatusBadRequest, err.Error())
		return
	}
	items, err := query(r.Context(), b, maxResults)
	if err != nil {
		a.serverError(w, r, err)
		return
	}
	if maxAge > 0 {
		w.Header().Set("Cache-Control", fmt.Sprintf("public, max-age=%d", maxAge))
	}
	if items == nil {
		items = []T{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

type reportInput struct {
	Kind string  `json:"kind"`
	Lat  float64 `json:"lat"`
	Lon  float64 `json:"lon"`
}

func (a *API) addReport(w http.ResponseWriter, r *http.Request) {
	if !a.limiter.allow(a.clientIP(r)) {
		httpError(w, http.StatusTooManyRequests, "trop de signalements, réessaie dans une minute")
		return
	}
	var in reportInput
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<10))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&in); err != nil {
		httpError(w, http.StatusBadRequest, "JSON invalide")
		return
	}
	ttl, ok := ReportTTL[in.Kind]
	if !ok {
		httpError(w, http.StatusBadRequest, "type de signalement inconnu")
		return
	}
	if !validLatLon(in.Lat, in.Lon) {
		httpError(w, http.StatusBadRequest, "position invalide")
		return
	}
	rep, err := a.store.AddReport(r.Context(), in.Kind, in.Lat, in.Lon, ttl)
	if err != nil {
		a.serverError(w, r, err)
		return
	}
	metrics.Reports.WithLabelValues(in.Kind).Inc()
	if msg, err := json.Marshal(map[string]any{"type": "report", "report": rep}); err == nil {
		a.hub.Broadcast(msg)
	}
	writeJSON(w, http.StatusCreated, rep)
}

// liveFeed pousse chaque nouveau signalement aux clients connectés.
func (a *API) liveFeed(w http.ResponseWriter, r *http.Request) {
	c, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: a.cfg.OriginPatterns})
	if err != nil {
		return // Accept a déjà répondu au client
	}
	defer c.CloseNow()
	events, unsubscribe := a.hub.Subscribe()
	defer unsubscribe()

	ctx := c.CloseRead(r.Context()) // le client n'envoie rien ; on détecte seulement sa déconnexion
	ping := time.NewTicker(30 * time.Second)
	defer ping.Stop()
	for {
		select {
		case <-ctx.Done():
			c.Close(websocket.StatusNormalClosure, "")
			return
		case msg, ok := <-events:
			if !ok {
				return
			}
			wctx, cancel := context.WithTimeout(ctx, 5*time.Second)
			err := c.Write(wctx, websocket.MessageText, msg)
			cancel()
			if err != nil {
				return
			}
		case <-ping.C:
			pctx, cancel := context.WithTimeout(ctx, 5*time.Second)
			err := c.Ping(pctx)
			cancel()
			if err != nil {
				return
			}
		}
	}
}

// --- utilitaires

func parseBBox(s string) (store.BBox, error) {
	parts := strings.Split(s, ",")
	if len(parts) != 4 {
		return store.BBox{}, errors.New("bbox attendu : minLon,minLat,maxLon,maxLat")
	}
	var v [4]float64
	for i, p := range parts {
		f, err := strconv.ParseFloat(strings.TrimSpace(p), 64)
		if err != nil || math.IsNaN(f) || math.IsInf(f, 0) {
			return store.BBox{}, errors.New("bbox : nombre invalide")
		}
		v[i] = f
	}
	b := store.BBox{MinLon: v[0], MinLat: v[1], MaxLon: v[2], MaxLat: v[3]}
	if !validLatLon(b.MinLat, b.MinLon) || !validLatLon(b.MaxLat, b.MaxLon) || b.MinLon >= b.MaxLon || b.MinLat >= b.MaxLat {
		return store.BBox{}, errors.New("bbox : coordonnées hors limites")
	}
	if b.MaxLon-b.MinLon > maxSpanDeg || b.MaxLat-b.MinLat > maxSpanDeg {
		return store.BBox{}, fmt.Errorf("bbox : zone trop grande (max %.0f° de côté)", maxSpanDeg)
	}
	return b, nil
}

func validLatLon(lat, lon float64) bool {
	return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180 && !(lat == 0 && lon == 0)
}

func (a *API) clientIP(r *http.Request) string {
	if a.cfg.TrustProxy {
		if ip := r.Header.Get("CF-Connecting-IP"); ip != "" {
			return ip
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func (a *API) serverError(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, context.Canceled) {
		return
	}
	a.log.Error("requête", "path", r.URL.Path, "err", err)
	httpError(w, http.StatusInternalServerError, "erreur interne")
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func httpError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// ipLimiter limite les écritures par adresse IP et oublie les IP inactives.
type ipLimiter struct {
	mu        sync.Mutex
	every     rate.Limit
	burst     int
	clients   map[string]*limiterEntry
	lastSweep time.Time
}

type limiterEntry struct {
	l    *rate.Limiter
	seen time.Time
}

func newIPLimiter(every rate.Limit, burst int) *ipLimiter {
	return &ipLimiter{every: every, burst: burst, clients: make(map[string]*limiterEntry)}
}

func (l *ipLimiter) allow(ip string) bool {
	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()
	if now.Sub(l.lastSweep) > time.Minute {
		for k, e := range l.clients {
			if now.Sub(e.seen) > 10*time.Minute {
				delete(l.clients, k)
			}
		}
		l.lastSweep = now
	}
	e, ok := l.clients[ip]
	if !ok {
		e = &limiterEntry{l: rate.NewLimiter(l.every, l.burst)}
		l.clients[ip] = e
	}
	e.seen = now
	return e.l.AllowN(now, 1)
}
