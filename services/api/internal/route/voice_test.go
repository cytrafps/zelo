package route

import "testing"

func TestTidyVoice(t *testing.T) {
	for in, want := range map[string]string{
		"Dans 100 mètres, Tournez à gauche.":                                  "Dans 100 mètres, tournez à gauche.",
		"Tournez à gauche. Ensuite, Tournez à droite..":                       "Tournez à gauche. Ensuite, tournez à droite.",
		"Tournez à droite. Ensuite, Dans 80 mètres, Tournez à droite dans X.": "Tournez à droite. Ensuite, dans 80 mètres, tournez à droite dans X.",
		"Prenez Boulevard Lundy.":                                             "Prenez Boulevard Lundy.",
	} {
		if got := tidyVoice(in); got != want {
			t.Errorf("tidyVoice(%q) = %q, attendu %q", in, got, want)
		}
	}
}
