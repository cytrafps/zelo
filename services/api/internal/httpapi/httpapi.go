// Package httpapi expose l'API REST et le flux temps réel (WebSocket).
package httpapi

import (
	"cmp"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
	"golang.org/x/time/rate"

	"github.com/cytrafps/zelo/services/api/internal/closure"
	"github.com/cytrafps/zelo/services/api/internal/junction"
	"github.com/cytrafps/zelo/services/api/internal/live"
	"github.com/cytrafps/zelo/services/api/internal/metrics"
	"github.com/cytrafps/zelo/services/api/internal/route"
	"github.com/cytrafps/zelo/services/api/internal/store"
	"github.com/cytrafps/zelo/services/api/internal/tarif"
	"github.com/cytrafps/zelo/services/api/internal/transit"
	"github.com/cytrafps/zelo/services/api/internal/weather"
	"github.com/cytrafps/zelo/services/api/internal/zfe"
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
	Parkings(ctx context.Context, b store.BBox, limit int, vehicle string) ([]store.Parking, error)
	Controls(ctx context.Context, points [][2]float64, radius float64) ([]junction.Control, error)
	AreasAlong(ctx context.Context, line [][2]float64, within float64) ([]store.AreaOnRoute, error)
	Reports(context.Context, store.BBox, int) ([]store.Report, error)
	AddReport(ctx context.Context, kind string, lat, lon float64, ttl time.Duration, voter string) (store.Report, bool, error)
	Vote(ctx context.Context, id int64, voter string, up bool, ttl func(kind string) time.Duration) (store.Report, bool, error)
}

type Config struct {
	// TrustProxy : toute connexion vient d'un proxy de confiance (Cloudflare Tunnel sur l'hôte).
	TrustProxy bool
	// TrustedProxies : adresses des proxys de confiance (Traefik dans le cluster). Pour une
	// connexion qui en vient, l'IP cliente est lue dans X-Forwarded-For (jamais dans
	// CF-Connecting-IP, que Traefik laisse passer tel quel).
	TrustedProxies []netip.Prefix
	// OriginPatterns autorisés pour le WebSocket depuis un navigateur (tableau de bord web).
	OriginPatterns []string
	// Router calcule les itinéraires (Valhalla) ; nil : /v1/route répond 503.
	Router Router
	// Transit : horaires du tram et des bus en vigueur (rechargés chaque jour) ; nil ou nil renvoyé : aucun parking relais proposé.
	Transit func() *transit.Timetable
	// Realtime : dernier flux temps réel lu ; nil : horaires théoriques.
	Realtime func() *transit.Realtime
	// Closures : rues fermées publiées dans DiaLog (rechargées chaque jour) ; nil : aucune.
	Closures func() []closure.Closure
	// Zones : zones à faibles émissions de la base nationale (rechargées chaque jour) ; nil : aucune.
	Zones func() []zfe.Zone
	// Weather : prévision au quart d'heure (Open-Meteo, en cache) ; nil : pas de météo.
	Weather *weather.Cache
}

type Router interface {
	Routes(ctx context.Context, from, to route.Point, mode route.Mode, opts route.Options) ([]route.Route, error)
}

type API struct {
	store   Store
	hub     *live.Hub
	log     *slog.Logger
	cfg     Config
	limiter *ipLimiter // création de signalements
	votes   *ipLimiter // votes, plus fréquents
	routes  *ipLimiter // itinéraires (recalculés en roulant)
}

func New(s Store, hub *live.Hub, log *slog.Logger, cfg Config) http.Handler {
	a := &API{store: s, hub: hub, log: log, cfg: cfg,
		limiter: newIPLimiter(rate.Every(12*time.Second), 5),
		votes:   newIPLimiter(rate.Every(3*time.Second), 10),
		routes:  newIPLimiter(rate.Every(time.Second), 20)}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /livez", func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte("ok")) })
	mux.HandleFunc("GET /healthz", a.health)
	mux.HandleFunc("GET /v1/fuel-stations", a.fuelStations)
	mux.HandleFunc("GET /v1/charge-stations", a.chargeStations)
	mux.HandleFunc("GET /v1/parkings", a.parkings)
	mux.HandleFunc("GET /v1/reports", a.reports)
	mux.HandleFunc("POST /v1/reports", a.addReport)
	mux.HandleFunc("POST /v1/reports/{id}/votes", a.vote)
	mux.HandleFunc("GET /v1/live", a.liveFeed)
	mux.HandleFunc("GET /v1/route", a.route)
	mux.HandleFunc("GET /v1/park-ride", a.parkRide)
	mux.HandleFunc("GET /v1/zfe", a.zfe)
	mux.HandleFunc("GET /v1/weather", a.weather)
	return instrument(mux)
}

// instrument compte chaque requête par route déclarée et mesure sa durée. Le flux temps réel,
// ouvert pendant des heures, est compté mais pas chronométré. Une URL inconnue est rangée
// sous « autre » : un robot qui balaie des chemins ne crée pas de nouvelles séries.
func instrument(mux *http.ServeMux) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		mux.ServeHTTP(rec, r)
		route := r.Pattern
		if route == "" {
			route = "autre"
		}
		metrics.HTTPRequests.WithLabelValues(route, strconv.Itoa(rec.status)).Inc()
		if route != "GET /v1/live" {
			metrics.HTTPDuration.WithLabelValues(route).Observe(time.Since(start).Seconds())
		}
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (s *statusRecorder) WriteHeader(code int) {
	s.status = code
	s.ResponseWriter.WriteHeader(code)
}

// Unwrap laisse http.ResponseController (et le passage en WebSocket) atteindre la connexion.
func (s *statusRecorder) Unwrap() http.ResponseWriter { return s.ResponseWriter }

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

// parking : un parking OSM, avec ses tarifs quand ils ont été relevés.
type parking struct {
	store.Parking
	Tariff *tarif.Summary `json:"tariff"`
}

// parkings : GET /v1/parkings?bbox=…[&vehicle=car|moto|bike] (voiture par défaut).
func (a *API) parkings(w http.ResponseWriter, r *http.Request) {
	vehicle := cmp.Or(r.URL.Query().Get("vehicle"), "car")
	if vehicle != "car" && vehicle != "moto" && vehicle != "bike" {
		httpError(w, http.StatusBadRequest, "vehicle : car, moto ou bike")
		return
	}
	list(a, w, r, func(ctx context.Context, b store.BBox, limit int) ([]parking, error) {
		ps, err := a.store.Parkings(ctx, b, limit, vehicle)
		out := make([]parking, len(ps))
		for i, p := range ps {
			out[i] = parking{p, tarif.For(p.ID)}
		}
		return out, err
	}, 300) // données OSM rafraîchies une fois par jour
}

func (a *API) reports(w http.ResponseWriter, r *http.Request) {
	list(a, w, r, a.store.Reports, 0)
}

// zfe : GET /v1/zfe?bbox=… — zones à faibles émissions qui touchent la zone, en vigueur ou à
// venir. L'app décide selon la vignette du conducteur, qui ne quitte pas le téléphone.
func (a *API) zfe(w http.ResponseWriter, r *http.Request) {
	b, err := parseBBox(r.URL.Query().Get("bbox"))
	if err != nil {
		httpError(w, http.StatusBadRequest, err.Error())
		return
	}
	items := []zfe.Zone{}
	if a.cfg.Zones != nil {
		today := time.Now().In(transit.Paris).Format(time.DateOnly)
		for _, z := range a.cfg.Zones() {
			if (z.To == "" || z.To >= today) && zoneTouches(z, b) {
				items = append(items, z)
			}
		}
	}
	w.Header().Set("Cache-Control", "public, max-age=3600")
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

// weather : GET /v1/weather?at=lat,lon[&time=<secondes Unix>] — pluie et froid à l'heure
// d'arrivée (maintenant par défaut). La météo n'est qu'un conseil : sans prévision, outlook
// vaut null plutôt qu'une erreur.
func (a *API) weather(w http.ResponseWriter, r *http.Request) {
	p, err := parsePoint(r.URL.Query().Get("at"))
	if err != nil {
		httpError(w, http.StatusBadRequest, "attendu : at=lat,lon")
		return
	}
	at := time.Now()
	if s := r.URL.Query().Get("time"); s != "" {
		sec, err := strconv.ParseInt(s, 10, 64)
		if err != nil {
			httpError(w, http.StatusBadRequest, "time attendu en secondes Unix")
			return
		}
		at = time.Unix(sec, 0)
	}
	var out *weather.Outlook
	if a.cfg.Weather != nil {
		ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
		defer cancel()
		slots, err := a.cfg.Weather.Get(ctx, p.Lat, p.Lon)
		if err != nil {
			a.log.Warn("météo", "err", err)
		} else if o, ok := weather.At(slots, at); ok {
			out = &o
		}
	}
	w.Header().Set("Cache-Control", "public, max-age=300")
	writeJSON(w, http.StatusOK, map[string]any{"outlook": out})
}

func zoneTouches(z zfe.Zone, b store.BBox) bool {
	for _, poly := range z.Rings {
		for _, ring := range poly {
			minLon, minLat, maxLon, maxLat := 180.0, 90.0, -180.0, -90.0
			for _, p := range ring {
				minLon, maxLon = min(minLon, p[0]), max(maxLon, p[0])
				minLat, maxLat = min(minLat, p[1]), max(maxLat, p[1])
			}
			if minLon <= b.MaxLon && maxLon >= b.MinLon && minLat <= b.MaxLat && maxLat >= b.MinLat {
				return true
			}
		}
	}
	return false
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
	rep, created, err := a.store.AddReport(r.Context(), in.Kind, in.Lat, in.Lon, ttl, a.voter(r))
	if err != nil {
		a.serverError(w, r, err)
		return
	}
	// La diffusion passe par PostgreSQL (NOTIFY) pour atteindre les clients de toutes les instances.
	if !created { // doublon à moins de 150 m : compté comme une confirmation
		writeJSON(w, http.StatusOK, rep)
		return
	}
	metrics.Reports.WithLabelValues(in.Kind).Inc()
	writeJSON(w, http.StatusCreated, rep)
}

func (a *API) vote(w http.ResponseWriter, r *http.Request) {
	if !a.votes.allow(a.clientIP(r)) {
		httpError(w, http.StatusTooManyRequests, "trop de votes, réessaie dans un instant")
		return
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		httpError(w, http.StatusNotFound, store.ErrReportNotFound.Error())
		return
	}
	var in struct {
		Up *bool `json:"up"`
	}
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 256))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&in); err != nil || in.Up == nil {
		httpError(w, http.StatusBadRequest, `JSON attendu : {"up": true|false}`)
		return
	}
	rep, removed, err := a.store.Vote(r.Context(), id, a.voter(r), *in.Up, func(kind string) time.Duration { return ReportTTL[kind] })
	switch {
	case errors.Is(err, store.ErrReportNotFound):
		httpError(w, http.StatusNotFound, err.Error())
	case errors.Is(err, store.ErrOwnReport):
		httpError(w, http.StatusConflict, err.Error())
	case err != nil:
		a.serverError(w, r, err)
	default:
		metrics.Votes.WithLabelValues(strconv.FormatBool(*in.Up)).Inc()
		writeJSON(w, http.StatusOK, map[string]any{"report": rep, "removed": removed})
	}
}

// voter identifie un appareil sans compte : l'identifiant aléatoire envoyé par l'app
// (X-Zelo-Device), à défaut l'IP. Seule une empreinte est conservée.
func (a *API) voter(r *http.Request) string {
	id := r.Header.Get("X-Zelo-Device")
	if len(id) < 16 || len(id) > 64 {
		id = "ip:" + a.clientIP(r)
	}
	sum := sha256.Sum256([]byte("zelo-voter:" + id))
	return hex.EncodeToString(sum[:16])
}

// heartbeat est envoyé toutes les heartbeatEvery : le client, qui ne voit pas les pings WebSocket,
// sait ainsi que la connexion vit et la rouvre après un silence (réseau mobile changé, NAT expiré).
var heartbeat = []byte(`{"type":"hb"}`)

var heartbeatEvery = 25 * time.Second

// liveFeed pousse chaque nouveau signalement aux clients connectés.
func (a *API) liveFeed(w http.ResponseWriter, r *http.Request) {
	c, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: a.cfg.OriginPatterns})
	if err != nil {
		return // Accept a déjà répondu au client
	}
	defer c.CloseNow()
	events, unsubscribe, ok := a.hub.Subscribe()
	if !ok {
		c.Close(websocket.StatusTryAgainLater, "instance pleine")
		return
	}
	defer unsubscribe()

	ctx := c.CloseRead(r.Context()) // le client n'envoie rien ; on détecte seulement sa déconnexion
	ping := time.NewTicker(heartbeatEvery)
	defer ping.Stop()
	for {
		select {
		case <-ctx.Done():
			c.Close(websocket.StatusNormalClosure, "")
			return
		case msg, ok := <-events:
			if !ok {
				// Client trop lent ou instance qui s'arrête : il se reconnecte (ailleurs) et resynchronise.
				c.Close(websocket.StatusGoingAway, "")
				return
			}
			wctx, cancel := context.WithTimeout(ctx, 5*time.Second)
			err := c.Write(wctx, websocket.MessageText, msg)
			cancel()
			if err != nil {
				return
			}
		case <-ping.C:
			// Le battement garde le client informé ; le ping (qui attend la réponse) détecte un client parti.
			pctx, cancel := context.WithTimeout(ctx, 5*time.Second)
			err := c.Write(pctx, websocket.MessageText, heartbeat)
			if err == nil {
				err = c.Ping(pctx)
			}
			cancel()
			if err != nil {
				return
			}
		}
	}
}

var routeModes = map[string]route.Mode{"car": route.Car, "moto": route.Motorcycle, "bike": route.Bicycle, "walk": route.Walk}

// route : GET /v1/route?from=lat,lon&to=lat,lon&mode=car|moto|bike|walk
// [&alternates=0..2][&heading=0..360][&depart=<secondes Unix>][&avoid=tolls,highways]
func (a *API) route(w http.ResponseWriter, r *http.Request) {
	if a.cfg.Router == nil {
		httpError(w, http.StatusServiceUnavailable, "itinéraires indisponibles")
		return
	}
	if !a.routes.allow(a.clientIP(r)) {
		httpError(w, http.StatusTooManyRequests, "trop de calculs d'itinéraire, réessaie dans un instant")
		return
	}
	q := r.URL.Query()
	from, err1 := parsePoint(q.Get("from"))
	to, err2 := parsePoint(q.Get("to"))
	mode, ok := routeModes[q.Get("mode")]
	if err := errors.Join(err1, err2); err != nil || !ok {
		httpError(w, http.StatusBadRequest, `attendu : from=lat,lon&to=lat,lon&mode=car|moto|bike|walk`)
		return
	}
	opts, err := routeOptions(q, time.Now())
	if err != nil {
		httpError(w, http.StatusBadRequest, err.Error())
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	start := time.Now()
	at := opts.Depart
	if at.IsZero() {
		at = start
	}
	opts.Exclude = a.exclusions(ctx, from, to, mode, at)
	res, err := a.cfg.Router.Routes(ctx, from, to, mode, opts)
	if err != nil && len(opts.Exclude) > 0 && !errors.Is(err, route.ErrOutOfArea) {
		// Départ ou arrivée dans la rue fermée (rue piétonne aux heures où l'on y habite…), ou
		// zones refusées par Valhalla : mieux vaut un itinéraire qui l'emprunte que pas d'itinéraire.
		if !errors.Is(err, route.ErrNoRoute) {
			a.log.Warn("itinéraire avec rues fermées", "err", err, "zones", len(opts.Exclude))
		}
		opts.Exclude = nil
		res, err = a.cfg.Router.Routes(ctx, from, to, mode, opts)
	}
	metrics.RouteDuration.WithLabelValues(q.Get("mode")).Observe(time.Since(start).Seconds())
	switch {
	case errors.Is(err, route.ErrOutOfArea):
		metrics.Routes.WithLabelValues(q.Get("mode"), "hors_zone").Inc()
		httpError(w, http.StatusUnprocessableEntity, "cette adresse est hors de la zone couverte par Zelo")
	case errors.Is(err, route.ErrNoRoute):
		metrics.Routes.WithLabelValues(q.Get("mode"), "sans_itineraire").Inc()
		httpError(w, http.StatusUnprocessableEntity, "aucun itinéraire trouvé")
	case err != nil:
		metrics.Routes.WithLabelValues(q.Get("mode"), "erreur").Inc()
		a.log.Error("itinéraire", "err", err)
		httpError(w, http.StatusBadGateway, "calcul d'itinéraire indisponible")
	default:
		metrics.Routes.WithLabelValues(q.Get("mode"), "ok").Inc()
		if mode != route.Walk {
			a.annotate(ctx, res, mode.Motorized())
		}
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, http.StatusOK, map[string]any{"routes": res})
	}
}

// annotate ajoute feux et stops aux manœuvres, et les aires d'autoroute desservies. Sans eux,
// le trajet reste juste : une base indisponible est seulement journalisée.
func (a *API) annotate(ctx context.Context, routes []route.Route, areas bool) {
	for i := range routes {
		if !areas {
			break // à vélo, pas d'autoroute
		}
		found, err := a.store.AreasAlong(ctx, routes[i].Coordinates, route.AreaReach)
		if err != nil {
			a.log.Warn("aires", "err", err)
			break
		}
		route.PlaceAreas(&routes[i], toAreas(found))
	}
	var points [][2]float64
	for _, r := range routes {
		for _, s := range r.Steps {
			if s.Shape < len(r.Coordinates) {
				points = append(points, r.Coordinates[s.Shape])
			}
		}
	}
	found, err := a.store.Controls(ctx, points, route.ControlRadius)
	if err != nil {
		a.log.Warn("feux et stops", "err", err)
		return
	}
	controls := make([]route.Control, len(found))
	for i, c := range found {
		controls[i] = route.Control{Kind: c.Kind, Lat: c.Lat, Lon: c.Lon}
	}
	for i := range routes {
		route.Annotate(&routes[i], controls)
	}
}

func toAreas(found []store.AreaOnRoute) []route.Area {
	out := make([]route.Area, len(found))
	for i, f := range found {
		a := route.Area{ID: f.ID, Kind: f.Kind, Name: f.Name, Lat: f.Lat, Lon: f.Lon, Services: f.Services}
		if len(f.Fuel) > 0 {
			a.Fuel = f.Fuel
		}
		if f.ChargeTotal > 0 {
			a.Charge = &route.AreaCharge{Total: f.ChargeTotal}
			if f.ChargeKnown > 0 {
				free := f.ChargeFree
				a.Charge.Available = &free
			}
		}
		out[i] = a
	}
	return out
}

// Départ accepté : de quelques minutes dans le passé (horloge du téléphone) à une semaine.
const (
	departPast = 15 * time.Minute
	departMax  = 7 * 24 * time.Hour
)

func routeOptions(q url.Values, now time.Time) (route.Options, error) {
	var o route.Options
	o.Alternates, _ = strconv.Atoi(q.Get("alternates")) // borné par le client Valhalla
	if s := q.Get("heading"); s != "" {
		h, err := strconv.ParseFloat(s, 64)
		if err != nil || !(h >= 0 && h <= 360) {
			return o, errors.New("heading attendu entre 0 et 360")
		}
		o.Heading = &h
	}
	if s := q.Get("depart"); s != "" {
		sec, err := strconv.ParseInt(s, 10, 64)
		t := time.Unix(sec, 0)
		if err != nil || t.Before(now.Add(-departPast)) || t.After(now.Add(departMax)) {
			return o, errors.New("depart attendu : heure Unix dans les 7 prochains jours")
		}
		o.Depart = t
	}
	if s := q.Get("avoid"); s != "" {
		for _, v := range strings.Split(s, ",") {
			switch v {
			case "tolls":
				o.AvoidTolls = true
			case "highways":
				o.AvoidHighways = true
			default:
				return o, errors.New("avoid attendu : tolls, highways")
			}
		}
	}
	return o, nil
}

// --- utilitaires

func parsePoint(s string) (route.Point, error) {
	lat, lon, ok := strings.Cut(s, ",")
	if !ok {
		return route.Point{}, errors.New("point invalide")
	}
	p := route.Point{}
	var err1, err2 error
	p.Lat, err1 = strconv.ParseFloat(strings.TrimSpace(lat), 64)
	p.Lon, err2 = strconv.ParseFloat(strings.TrimSpace(lon), 64)
	// Écrit à l'envers pour rejeter aussi NaN.
	if err := errors.Join(err1, err2); err != nil || !(p.Lat >= -90 && p.Lat <= 90 && p.Lon >= -180 && p.Lon <= 180) {
		return route.Point{}, errors.New("point invalide")
	}
	return p, nil
}

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

// clientIP : l'adresse de la connexion, ou celle que donne un proxy de confiance. Un en-tête venu
// d'ailleurs est ignoré : sinon un client choisirait son IP et contournerait les quotas.
func (a *API) clientIP(r *http.Request) string {
	remote, err := netip.ParseAddrPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	addr := remote.Addr().Unmap()
	if a.cfg.TrustProxy {
		// Cloudflare Tunnel : il écrase toujours CF-Connecting-IP, un client ne peut pas le choisir.
		if ip, err := netip.ParseAddr(strings.TrimSpace(r.Header.Get("CF-Connecting-IP"))); err == nil {
			return ip.Unmap().String()
		}
		return addr.String()
	}
	if !a.trusted(addr) {
		return addr.String()
	}
	// X-Forwarded-For : chaque proxy ajoute à droite l'adresse qu'il a vue. On remonte depuis la
	// droite tant que c'est un proxy de confiance ; la première autre adresse est le client.
	hops := strings.Split(strings.Join(r.Header.Values("X-Forwarded-For"), ","), ",")
	for i := len(hops) - 1; i >= 0; i-- {
		ip, err := netip.ParseAddr(strings.TrimSpace(hops[i]))
		if err != nil {
			break
		}
		if ip = ip.Unmap(); !a.trusted(ip) || i == 0 {
			return ip.String()
		}
	}
	return addr.String()
}

func (a *API) trusted(ip netip.Addr) bool {
	for _, p := range a.cfg.TrustedProxies {
		if p.Contains(ip) {
			return true
		}
	}
	return false
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
