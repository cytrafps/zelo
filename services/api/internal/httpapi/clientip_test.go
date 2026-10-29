package httpapi

import (
	"net/http/httptest"
	"net/netip"
	"testing"
)

func TestClientIP(t *testing.T) {
	cluster := []netip.Prefix{netip.MustParsePrefix("10.42.0.0/16")}
	tunnel := []netip.Prefix{netip.MustParsePrefix("172.30.0.0/24")}
	cases := []struct {
		name   string
		cfg    Config
		remote string
		xff    string
		cf     string
		want   string
	}{
		{"direct, en-têtes ignorés", Config{}, "203.0.113.7:5000", "1.2.3.4", "5.6.7.8", "203.0.113.7"},
		{"Traefik : client à droite de X-Forwarded-For", Config{TrustedProxies: cluster}, "10.42.0.9:5000", "1.2.3.4, 198.51.100.2", "", "198.51.100.2"},
		{"Traefik derrière un autre proxy du cluster", Config{TrustedProxies: cluster}, "10.42.0.9:5000", "198.51.100.2, 10.42.1.1", "", "198.51.100.2"},
		{"Traefik : CF-Connecting-IP falsifiable, ignoré", Config{TrustedProxies: cluster}, "10.42.0.9:5000", "198.51.100.2", "192.0.2.1", "198.51.100.2"},
		{"connexion hors cluster : en-tête refusé", Config{TrustedProxies: cluster}, "203.0.113.7:5000", "1.2.3.4", "", "203.0.113.7"},
		{"Cloudflare Tunnel", Config{TrustProxy: true, TrustedProxies: tunnel}, "172.30.0.3:5000", "", "192.0.2.1", "192.0.2.1"},
		{"nginx du tableau de bord à côté du tunnel : X-Forwarded-For", Config{TrustProxy: true, TrustedProxies: tunnel}, "172.30.0.4:5000", "1.2.3.4", "", "1.2.3.4"},
		// Port de l'API publié sur le réseau local : CF-Connecting-IP vient du client, pas du tunnel.
		{"Cloudflare Tunnel : connexion directe, en-tête refusé", Config{TrustProxy: true, TrustedProxies: tunnel}, "192.168.1.20:5000", "", "192.0.2.1", "192.168.1.20"},
		{"IPv4 dans IPv6", Config{}, "[::ffff:203.0.113.7]:5000", "", "", "203.0.113.7"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			r := httptest.NewRequest("GET", "/", nil)
			r.RemoteAddr = c.remote
			if c.xff != "" {
				r.Header.Set("X-Forwarded-For", c.xff)
			}
			if c.cf != "" {
				r.Header.Set("CF-Connecting-IP", c.cf)
			}
			if got := (&API{cfg: c.cfg}).clientIP(r); got != c.want {
				t.Fatalf("clientIP = %s, attendu %s", got, c.want)
			}
		})
	}
}
