package httpapi

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func TestLiveFeedSendsHeartbeat(t *testing.T) {
	old := heartbeatEvery
	heartbeatEvery = 20 * time.Millisecond
	t.Cleanup(func() { heartbeatEvery = old })

	h, _, _ := newTestAPI()
	srv := httptest.NewServer(h)
	defer srv.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	c, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(srv.URL, "http")+"/v1/live", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer c.CloseNow()
	// Le client lit en continu pour répondre aux pings, comme le fait React Native.
	_, msg, err := c.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if string(msg) != `{"type":"hb"}` {
		t.Fatalf("premier message = %s, attendu le battement", msg)
	}
}

// Les délais du serveur HTTP (ReadTimeout, WriteTimeout) ne s'appliquent plus une fois la
// connexion passée en WebSocket : le flux reste ouvert bien au-delà.
func TestLiveFeedOutlivesServerTimeouts(t *testing.T) {
	old := heartbeatEvery
	heartbeatEvery = 50 * time.Millisecond
	t.Cleanup(func() { heartbeatEvery = old })

	h, _, _ := newTestAPI()
	srv := httptest.NewUnstartedServer(h)
	srv.Config.ReadTimeout = 200 * time.Millisecond
	srv.Config.WriteTimeout = 200 * time.Millisecond
	srv.Start()
	defer srv.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	c, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(srv.URL, "http")+"/v1/live", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer c.CloseNow()
	for start := time.Now(); time.Since(start) < time.Second; {
		if _, _, err := c.Read(ctx); err != nil {
			t.Fatalf("flux coupé après %v : %v", time.Since(start), err)
		}
	}
}
