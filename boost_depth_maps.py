# ════════════════════════════════════════════════════════════════════════
#  QU33PH DEPTH BOOST — make every depth map as deep & layered as the Dozer
#  Run in Google Colab (colab.research.google.com). No GPU needed.
#
#  1. New notebook → paste this whole file into one cell → press ▶
#  2. Upload depthmaps-needed.zip (the 33 depth maps you already have)
#  3. It downloads:
#       depthmaps-boosted.zip  → upload these to GitHub (same names, they
#                                replace the old ones)
#       depth-previews.zip     → before/after sheet + a wiggle GIF per image
#                                so you can see the 3D before uploading
#
#  Why the Dozer looks deepest: its map uses the whole range, from bright
#  (near cabinet front) to black (far tunnel), in big distinct regions. Most
#  maps sit in a narrow band of light greys, so everything moves together and
#  reads flat. This script gives every map that same full-range, layered
#  structure.
#
#  Tweak the knobs below and re-run until the previews look right.
# ════════════════════════════════════════════════════════════════════════

# ── KNOBS (0 = off, 1 = full) ──────────────────────────────────────────────
EQUALIZE   = 0.85   # spread the greys over the whole near→far range
LOCAL      = 0.45   # boost contrast between neighbouring regions (big-scale)
LAYERS     = 7      # number of depth "planes" for the pop-up-book look
LAYER_MIX  = 0.35   # how strongly to snap to those planes (0 = smooth only)
PUSH       = 0.30   # S-curve: pushes near nearer and far farther (too high = flat white/black)
SMOOTH_PX  = 1.5    # final light smoothing (the game smooths more on its own)

# ── enhancement ────────────────────────────────────────────────────────────
import io, os, zipfile
import numpy as np
import cv2
from PIL import Image

def _normalize(d, mask):
    """Stretch the object's own depth values to 0..1, ignoring the extreme 1%."""
    v = d[mask]
    if v.size < 16: return d
    lo, hi = np.percentile(v, 1), np.percentile(v, 99)
    return np.clip((d - lo) / max(hi - lo, 1e-6), 0, 1)

def _equalize(d, mask):
    """Histogram-equalize over the object only, so every depth band is used."""
    v = (d[mask] * 1023).astype(np.int32)
    hist = np.bincount(v, minlength=1024).astype(np.float64)
    cdf = np.cumsum(hist); cdf /= cdf[-1]
    return cdf[np.clip((d * 1023).astype(np.int32), 0, 1023)]

def _local(d):
    """Large-tile CLAHE: raises contrast between big regions (not tiny detail —
    the game smooths fine detail away anyway, so only big structure counts)."""
    d8 = (d * 255).astype(np.uint8)
    h, w = d8.shape
    tiles = (max(2, round(w / 160)), max(2, round(h / 160)))
    out = cv2.createCLAHE(clipLimit=3.0, tileGridSize=tiles).apply(d8)
    return out.astype(np.float32) / 255.0

def _terrace(d, n):
    """Snap to n soft-edged planes: flat layers with smooth ramps between them."""
    x = d * (n - 1)
    base = np.floor(x); f = x - base
    f = np.clip((f - 0.30) / 0.40, 0, 1)            # flat for 60% of each step,
    f = f * f * (3 - 2 * f)                          # smooth ramp for the rest
    return (base + f) / (n - 1)

def _push(d, k):
    """S-curve around the middle: separates near from far."""
    if k <= 0: return d
    s = 1 + 9 * k
    y = 1 / (1 + np.exp(-s * (d - 0.5)))
    y0, y1 = 1 / (1 + np.exp(s * 0.5)), 1 / (1 + np.exp(-s * 0.5))
    return (y - y0) / (y1 - y0)

def enhance(depth_u8):
    d = depth_u8.astype(np.float32) / 255.0
    # transparent areas were written as pure black when the maps were made;
    # a big pure-black region = background of a cut-out image
    bg = d < (2 / 255.0)
    cutout = bg.mean() > 0.04
    mask = ~bg if cutout else np.ones_like(bg)
    d = _normalize(d, mask)
    if EQUALIZE > 0:  d = (1 - EQUALIZE) * d + EQUALIZE * _equalize(d, mask)
    if LOCAL > 0:     d = (1 - LOCAL) * d + LOCAL * _local(d)
    if LAYERS >= 2 and LAYER_MIX > 0:
        d = (1 - LAYER_MIX) * d + LAYER_MIX * _terrace(d, LAYERS)
    d = _push(d, PUSH)
    d = _normalize(d, mask)
    if cutout:
        # the object keeps its whole near→far range (that range is what makes it
        # look deep); its transparent surroundings stay at the very back
        d = 0.06 + 0.94 * d
        d[bg] = 0.0
    if SMOOTH_PX > 0:
        d = cv2.GaussianBlur(d, (0, 0), SMOOTH_PX)
    return (np.clip(d, 0, 1) * 255 + 0.5).astype(np.uint8)

# ── previews: before/after sheet + a wiggle GIF (what the tilt will look like)
def wiggle_gif(depth_u8, size=220, amp=0.06, frames=16):
    d = cv2.resize(depth_u8, None, fx=size / max(depth_u8.shape), fy=size / max(depth_u8.shape),
                   interpolation=cv2.INTER_AREA).astype(np.float32) / 255.0
    h, w = d.shape
    # a checkerboard stand-in picture: the bending shows the depth clearly
    yy, xx = np.mgrid[0:h, 0:w]
    img = (((xx // 11) + (yy // 11)) % 2 * 150 + 60).astype(np.uint8)
    img = cv2.cvtColor(img, cv2.COLOR_GRAY2RGB)
    img[..., 0] = np.clip(img[..., 0] * 0.6 + d * 100, 0, 255)
    out = []
    for i in range(frames):
        t = np.sin(2 * np.pi * i / frames)
        mx = (xx - (d - 0.5) * amp * w * t).astype(np.float32)
        out.append(cv2.remap(img, mx, yy.astype(np.float32), cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE))
    return out

def run(pairs):
    """pairs: list of (name, depth uint8 array). Returns (boosted zip bytes, previews zip bytes)."""
    import imageio
    zb, zp = io.BytesIO(), io.BytesIO()
    boosted = zipfile.ZipFile(zb, 'w', zipfile.ZIP_DEFLATED)
    prev = zipfile.ZipFile(zp, 'w', zipfile.ZIP_DEFLATED)
    thumbs = []
    for name, dep in pairs:
        e = enhance(dep)
        b = io.BytesIO(); Image.fromarray(e, 'L').save(b, 'PNG', optimize=True)
        boosted.writestr(name, b.getvalue())
        g = io.BytesIO(); imageio.mimsave(g, wiggle_gif(e), format='GIF', duration=0.07, loop=0)
        prev.writestr(name.replace('-depth.png', '-wiggle.gif'), g.getvalue())
        th = 180
        a = Image.fromarray(dep, 'L'); a.thumbnail((th, th))
        c = Image.fromarray(e, 'L');   c.thumbnail((th, th))
        pair = Image.new('L', (th * 2 + 6, th), 30); pair.paste(a, (0, 0)); pair.paste(c, (th + 6, 0))
        thumbs.append(pair)
        print(f'✓ {name}')
    cols = 3; rows = (len(thumbs) + cols - 1) // cols
    sheet = Image.new('L', (cols * (thumbs[0].width + 12), rows * (thumbs[0].height + 12)), 0)
    for i, t in enumerate(thumbs):
        sheet.paste(t, ((i % cols) * (t.width + 12), (i // cols) * (t.height + 12)))
    s = io.BytesIO(); sheet.save(s, 'PNG'); prev.writestr('before-after-sheet.png', s.getvalue())
    boosted.close(); prev.close()
    return zb.getvalue(), zp.getvalue()

# ── Colab: upload → boost → download ───────────────────────────────────────
if __name__ == '__main__':
    try:
        from google.colab import files
    except ImportError:
        files = None
    if files:
        print('Upload depthmaps-needed.zip …')
        up = files.upload()
        src = zipfile.ZipFile(io.BytesIO(next(iter(up.values()))))
        pairs = []
        for n in src.namelist():
            base = os.path.basename(n)
            if base.lower().endswith('-depth.png') and not base.startswith('.'):
                pairs.append((base, np.array(Image.open(io.BytesIO(src.read(n))).convert('L'))))
        zb, zp = run(pairs)
        open('depthmaps-boosted.zip', 'wb').write(zb)
        open('depth-previews.zip', 'wb').write(zp)
        print(f'\nDone: {len(pairs)} maps boosted.')
        files.download('depthmaps-boosted.zip')
        files.download('depth-previews.zip')
