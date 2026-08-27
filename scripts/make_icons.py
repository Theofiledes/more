#!/usr/bin/env python3
"""Generate BMO's app icons from the palette the UI already uses.

Kept as a script rather than committing only the PNGs so the icon can be regenerated or
tweaked without hunting for the original artwork.

    python3 scripts/make_icons.py

Writes every Android density plus a web favicon. Requires Pillow (pip install pillow).
"""
import os
from PIL import Image, ImageDraw

# Straight from the running UI so the icon matches the app it opens.
BODY = (95, 211, 188)      # BMO's teal shell
SCREEN = (181, 214, 167)   # pale green display
INK = (45, 72, 46)         # dark green face
YELLOW = (255, 204, 0)     # D-pad
RED = (255, 59, 48)        # A button
GREEN = (52, 199, 89)      # B button

S = 1024  # master size, everything downsamples from here
ANDROID_RES = "android/app/src/main/res"
DENSITIES = {  # launcher icon sizes
    "mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192,
}
# Adaptive-icon foregrounds are 108dp with only the middle 72dp guaranteed visible.
FOREGROUND = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}


def rounded(draw, box, r, fill):
    draw.rounded_rectangle(box, radius=r, fill=fill)


def draw_bmo(img, inset=0.0, body=True):
    """Draw BMO. `inset` shrinks the art for adaptive-icon safe zones."""
    d = ImageDraw.Draw(img)
    m = S * inset
    x0, y0, x1, y1 = m, m, S - m, S - m
    w = x1 - x0

    if body:
        rounded(d, (x0, y0, x1, y1), int(w * 0.22), BODY)

    # Screen: wide, sitting in the upper two-thirds like the real thing.
    sx0 = x0 + w * 0.10
    sx1 = x1 - w * 0.10
    sy0 = y0 + w * 0.12
    sy1 = y0 + w * 0.62
    rounded(d, (sx0, sy0, sx1, sy1), int(w * 0.06), SCREEN)

    # Face — two eyes and a smile. Simple reads better at 48px than detail does.
    cx = (sx0 + sx1) / 2
    eye_y = sy0 + (sy1 - sy0) * 0.36
    eye_r = w * 0.045
    eye_dx = (sx1 - sx0) * 0.20
    for ex in (cx - eye_dx, cx + eye_dx):
        d.ellipse((ex - eye_r, eye_y - eye_r, ex + eye_r, eye_y + eye_r), fill=INK)

    mouth_w = (sx1 - sx0) * 0.34
    mouth_y = sy0 + (sy1 - sy0) * 0.62
    d.arc((cx - mouth_w / 2, mouth_y - mouth_w * 0.42,
           cx + mouth_w / 2, mouth_y + mouth_w * 0.42),
          start=15, end=165, fill=INK, width=int(w * 0.030))

    # Controls below the screen: D-pad cross on the left, two buttons on the right.
    ctrl_y = y0 + w * 0.79
    arm = w * 0.052
    dx = x0 + w * 0.26
    d.rounded_rectangle((dx - arm / 2, ctrl_y - arm * 1.6, dx + arm / 2, ctrl_y + arm * 1.6),
                        radius=int(arm * 0.25), fill=YELLOW)
    d.rounded_rectangle((dx - arm * 1.6, ctrl_y - arm / 2, dx + arm * 1.6, ctrl_y + arm / 2),
                        radius=int(arm * 0.25), fill=YELLOW)

    br = w * 0.055
    for bx, col in ((x1 - w * 0.30, RED), (x1 - w * 0.16, GREEN)):
        d.ellipse((bx - br, ctrl_y - br, bx + br, ctrl_y + br), fill=col)


def save_all():
    master = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    draw_bmo(master)

    # Round variant: same art clipped to a circle.
    round_img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    body = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(body).ellipse((0, 0, S, S), fill=BODY)
    art = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    draw_bmo(art, inset=0.06, body=False)
    round_img = Image.alpha_composite(body, art)

    # Adaptive foreground: no body slab — ic_launcher_background supplies BMO's teal —
    # and inset so the launcher's circular mask can't clip the face.
    fg = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    draw_bmo(fg, inset=0.17, body=False)

    written = 0
    for dens, px in DENSITIES.items():
        out = os.path.join(ANDROID_RES, f"mipmap-{dens}")
        os.makedirs(out, exist_ok=True)
        master.resize((px, px), Image.LANCZOS).save(os.path.join(out, "ic_launcher.png"))
        round_img.resize((px, px), Image.LANCZOS).save(os.path.join(out, "ic_launcher_round.png"))
        fpx = FOREGROUND[dens]
        fg.resize((fpx, fpx), Image.LANCZOS).save(os.path.join(out, "ic_launcher_foreground.png"))
        written += 3

    os.makedirs("public", exist_ok=True)
    master.resize((512, 512), Image.LANCZOS).save("public/icon-512.png")
    master.resize((192, 192), Image.LANCZOS).save("public/icon-192.png")
    master.resize((32, 32), Image.LANCZOS).save("public/favicon.png")
    written += 3
    print(f"  wrote {written} icon files")


if __name__ == "__main__":
    save_all()
