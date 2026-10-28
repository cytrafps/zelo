"""Icônes des feux, stops et cédez-le-passage posés sur le tracé pendant le guidage.

    python3 scripts/control-icons.py   # écrit apps/mobile/assets/map/control-*@2x.png et @3x.png

Dessinées à 8× puis réduites (anticrénelage), 26 pt de côté, ombre légère pour rester lisibles sur
les bâtiments en 3D comme sur la route.
"""

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

PT = 26
OUT = Path(__file__).resolve().parent.parent / "apps/mobile/assets/map"
FONT = "/usr/share/fonts/opentype/inter/Inter-Black.otf"
RED, WHITE, INK = (214, 32, 39, 255), (255, 255, 255, 255), (28, 28, 30, 255)


def octagon(cx, cy, r):
    return [(cx + r * math.cos(math.radians(22.5 + 45 * i)), cy + r * math.sin(math.radians(22.5 + 45 * i))) for i in range(8)]


def draw(kind, s):
    """Icône de s×s pixels (s = 8 × taille finale)."""
    im = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    c, u = s / 2, s / PT  # u : 1 pt
    if kind == "feu":
        w, h = 12 * u, 23 * u
        box = (c - w / 2, c - h / 2, c + w / 2, c + h / 2)
        d.rounded_rectangle(box, radius=4 * u, fill=WHITE)
        inner = (box[0] + 1.6 * u, box[1] + 1.6 * u, box[2] - 1.6 * u, box[3] - 1.6 * u)
        d.rounded_rectangle(inner, radius=3 * u, fill=INK)
        for i, col in enumerate([(255, 59, 48, 255), (255, 179, 0, 255), (52, 199, 89, 255)]):
            y = inner[1] + (inner[3] - inner[1]) * (i + 0.5) / 3
            r = 2.7 * u
            d.ellipse((c - r, y - r, c + r, y + r), fill=col)
    elif kind == "stop":
        d.polygon(octagon(c, c, 12.5 * u), fill=WHITE)
        d.polygon(octagon(c, c, 11 * u), fill=RED)
        font = ImageFont.truetype(FONT, int(6.6 * u))
        d.text((c, c + 0.3 * u), "STOP", font=font, fill=WHITE, anchor="mm")
    else:  # cédez : triangle pointe en bas, bord rouge
        def tri(r):
            # Centré en hauteur : le centre du cercle circonscrit est au tiers supérieur.
            return [(c + r * math.cos(math.radians(a)), c - 13 * u / 4 + r * math.sin(math.radians(a))) for a in (90, 210, 330)]

        d.polygon(tri(13 * u), fill=WHITE)
        d.polygon(tri(11.2 * u), fill=RED)
        d.polygon(tri(6 * u), fill=WHITE)
    # Ombre portée douce, sous l'icône.
    shadow = Image.new("RGBA", im.size, (0, 0, 0, 0))
    shadow.putalpha(im.getchannel("A").point(lambda a: int(a * 0.35)))
    shadow = shadow.filter(ImageFilter.GaussianBlur(1.2 * u))
    out = Image.new("RGBA", im.size, (0, 0, 0, 0))
    out.alpha_composite(shadow, (0, int(0.8 * u)))
    out.alpha_composite(im)
    return out


for kind, name in (("feu", "feu"), ("stop", "stop"), ("cedez", "cedez")):
    for scale in (2, 3):
        size = PT * scale
        draw(kind, size * 8).resize((size, size), Image.LANCZOS).save(OUT / f"control-{name}@{scale}x.png", optimize=True)
