#!/usr/bin/env python3
"""
Generate Talk To Bro extension icons matching the Tidal Calm brand identity:
Rounded squircle #143c4c background with centered white chat bubble outline.
Generates 16x16, 32x32, 48x48, 128x128 PNGs into src/icons/.
"""
import os
from PIL import Image, ImageDraw

def render_icon(target_size: int, stroke_factor: float = 2.0) -> Image.Image:
    scale_factor = 8
    canvas = target_size * scale_factor
    im = Image.new('RGBA', (canvas, canvas), (0, 0, 0, 0))
    draw = ImageDraw.Draw(im)

    # 1. Background rounded rect
    margin = int(canvas * 0.02)
    radius = int(canvas * 0.28)
    bg_color = (20, 60, 76, 255)  # #143c4c
    draw.rounded_rectangle([margin, margin, canvas - 1 - margin, canvas - 1 - margin], radius=radius, fill=bg_color)

    # 2. SVG coordinate system mapping (viewBox 0 0 24 24)
    svg_size = canvas * 0.58
    unit = svg_size / 24.0
    ox = (canvas - svg_size) / 2.0
    oy = (canvas - svg_size) / 2.0

    def p(x: float, y: float):
        return (ox + x * unit, oy + y * unit)

    stroke_w = max(int(round(stroke_factor * unit)), scale_factor)
    white = (255, 255, 255, 255)

    def draw_segment(p1, p2):
        draw.line([p1, p2], fill=white, width=stroke_w)
        r = stroke_w / 2.0
        draw.ellipse([p1[0]-r, p1[1]-r, p1[0]+r, p1[1]+r], fill=white)
        draw.ellipse([p2[0]-r, p2[1]-r, p2[0]+r, p2[1]+r], fill=white)

    # Outer bubble polygon segments:
    # M4 6h16v11H9l-5 3z
    draw_segment(p(4, 6), p(20, 6))
    draw_segment(p(20, 6), p(20, 17))
    draw_segment(p(20, 17), p(9, 17))
    draw_segment(p(9, 17), p(4, 20))
    draw_segment(p(4, 20), p(4, 6))

    # Inner lines:
    # M8 11h8; M8 14h5
    draw_segment(p(8, 11), p(16, 11))
    draw_segment(p(8, 14), p(13, 14))

    # Downscale with high-quality LANCZOS resampling
    return im.resize((target_size, target_size), Image.Resampling.LANCZOS)

def main():
    root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    target_dirs = [
        os.path.join(root_dir, 'src', 'icons'),
        os.path.join(root_dir, 'icons'),
        os.path.join(root_dir, 'dist', 'icons'),
    ]

    for d in target_dirs:
        os.makedirs(d, exist_ok=True)

    configs = [
        (16, 2.5),
        (32, 2.2),
        (48, 2.0),
        (128, 2.0),
    ]

    for sz, sf in configs:
        icon = render_icon(sz, sf)
        for d in target_dirs:
            path = os.path.join(d, f'icon{sz}.png')
            icon.save(path)
            print(f'Generated {path} ({sz}x{sz})')

if __name__ == '__main__':
    main()
