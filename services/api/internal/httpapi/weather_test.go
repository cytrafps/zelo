package httpapi

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/cytrafps/zelo/services/api/internal/live"
	"github.com/cytrafps/zelo/services/api/internal/weather"
)

func TestWeather(t *testing.T) {
	quiet := slog.New(slog.NewTextHandler(io.Discard, nil))
	now := time.Now().Truncate(15 * time.Minute)
	rainy := &weather.Cache{TTL: time.Minute, Fetch: func(context.Context, float64, float64) ([]weather.Slot, error) {
		return []weather.Slot{{At: now, RainMM: 0.8, TempC: 6}, {At: now.Add(15 * time.Minute), RainMM: 0.4, TempC: 6}}, nil
	}}
	call := func(c *weather.Cache, q string) (int, string) {
		rec := httptest.NewRecorder()
		New(&fakeStore{}, live.NewHub(0), quiet, Config{Weather: c}).ServeHTTP(rec, httptest.NewRequest("GET", "/v1/weather?"+q, nil))
		return rec.Code, rec.Body.String()
	}
	if code, body := call(rainy, "at=49.25,4.03&time="+strconv.FormatInt(now.Unix(), 10)); code != 200 || !strings.Contains(body, `"rain":true`) {
		t.Errorf("%d %s", code, body)
	}
	down := &weather.Cache{TTL: time.Minute, Fetch: func(context.Context, float64, float64) ([]weather.Slot, error) {
		return nil, errors.New("hors service")
	}}
	if code, body := call(down, "at=49.25,4.03"); code != 200 || !strings.Contains(body, `"outlook":null`) {
		t.Errorf("Open-Meteo indisponible : %d %s", code, body)
	}
	if code, _ := call(rainy, "at=x"); code != 400 {
		t.Errorf("point illisible : %d", code)
	}
}
