"""Generate native raster icons from Lime's original SVG design (Pillow, no project dependency).
Run: uv run --no-project --with pillow python tools/generate-native-icons.py
"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'src-tauri' / 'icons'
OUT.mkdir(parents=True, exist_ok=True)
size = 1024
scale = size / 512
image = Image.new('RGBA', (size, size))
mask = Image.new('L', (size, size))
ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=112 * scale, fill=255)
pixels = image.load()
for y in range(size):
    for x in range(size):
        t = (x + y) / (2 * (size - 1))
        pixels[x, y] = tuple(round(a + (b - a) * t) for a, b in zip((143, 164, 189), (91, 107, 128))) + (255,)
image.putalpha(mask)
draw = ImageDraw.Draw(image)
xy = lambda values: tuple(round(v * scale) for v in values)
draw.ellipse(xy((124, 140, 388, 404)), fill='#d9e88c', outline='#b6cc66', width=round(10 * scale))
# Leaf and face use the same colors and silhouette as assets/icon.svg.
draw.polygon([xy(point) for point in [(256, 140), (284, 118), (318, 117), (352, 128), (328, 139), (304, 172), (280, 149)]], fill='#7fae5b')
for x in (212, 300):
    draw.ellipse(xy((x - 16, 240, x + 16, 272)), fill='#3d4a2c')
points = []
for i in range(65):
    t = i / 64
    points.append(xy(((1 - t) ** 2 * 222 + 2 * (1 - t) * t * 256 + t ** 2 * 290,
                      (1 - t) ** 2 * 316 + 2 * (1 - t) * t * 346 + t ** 2 * 316)))
draw.line(points, fill='#3d4a2c', width=round(14 * scale), joint='curve')
for point in (points[0], points[-1]):
    radius = 7 * scale
    draw.ellipse((point[0] - radius, point[1] - radius, point[0] + radius, point[1] + radius), fill='#3d4a2c')
for name, dimension in [('32x32.png', 32), ('128x128.png', 128), ('128x128@2x.png', 256)]:
    image.resize((dimension, dimension), Image.Resampling.LANCZOS).save(OUT / name)
image.resize((256, 256), Image.Resampling.LANCZOS).save(OUT / 'icon.ico', sizes=[(16, 16), (32, 32), (48, 48), (128, 128), (256, 256)])
print(f'Generated 4 native icon files in {OUT}')
