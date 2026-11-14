# -*- coding: utf-8 -*-
"""Genera los logos de ESC System que usa la aplicacion.

Parte del maestro `manual_capturas/AZUL-SIN-FONDO.png` (1080x1080, fondo
transparente, con mucho margen vacio). Recorta ese margen y produce dos
variantes: la de marca para fondos claros y una de texto blanco para la barra
lateral y el login, que son azul oscuro.

Solo recolorea el TEXTO; el icono conserva siempre el cian corporativo.

    python scripts/generar-logos.py
"""
import os
from PIL import Image

AQUI = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(AQUI)
MAESTRO = os.path.join(os.path.dirname(APP), "manual_capturas", "AZUL-SIN-FONDO.png")
DESTINO = os.path.join(APP, "public")

# Ancho de salida: suficiente para pantallas a 2x sin pesar de mas.
ANCHO = 512
TEXTO_BLANCO = (255, 255, 255)


def frontera_icono(im: Image.Image) -> int:
    """Primera columna vacia tras el icono: separa el simbolo del texto."""
    ancho, alto = im.size
    px = im.load()
    densidad = [sum(1 for y in range(alto) if px[x, y][3] > 30) for x in range(ancho)]
    inicio = next(x for x in range(ancho) if densidad[x] > alto * 0.30)
    for x in range(inicio, ancho):
        if densidad[x] == 0:
            return x
    raise RuntimeError("No se pudo separar el icono del texto.")


def recolorear_texto(im: Image.Image, corte: int, rgb) -> Image.Image:
    out = im.copy()
    px = out.load()
    ancho, alto = out.size
    for x in range(corte, ancho):
        for y in range(alto):
            a = px[x, y][3]
            if a > 0:
                px[x, y] = (*rgb, a)
    return out


def escalar(im: Image.Image) -> Image.Image:
    alto = round(im.size[1] * ANCHO / im.size[0])
    return im.resize((ANCHO, alto), Image.LANCZOS)


def main() -> int:
    if not os.path.exists(MAESTRO):
        print(f"ERROR: no se encontro el maestro en {MAESTRO}")
        return 1

    maestro = Image.open(MAESTRO).convert("RGBA")

    # Recortar ANTES de buscar la frontera: el maestro es un lienzo de 1080x1080
    # con el logo ocupando una franja central, así que un umbral relativo a la
    # altura del lienzo no lo alcanza ninguna columna.
    im = maestro.crop(maestro.getbbox())
    corte = frontera_icono(im)
    print(f"Maestro {maestro.size[0]}x{maestro.size[1]} | contenido {im.size[0]}x{im.size[1]} "
          f"| corte icono/texto x={corte}")

    salidas = {
        "logo-escsystem.png": im,
        "logo-escsystem-blanco.png": recolorear_texto(im, corte, TEXTO_BLANCO),
    }

    os.makedirs(DESTINO, exist_ok=True)
    for nombre, imagen in salidas.items():
        final = escalar(imagen)
        ruta = os.path.join(DESTINO, nombre)
        final.save(ruta, optimize=True)
        print(f"  -> public/{nombre}  {final.size[0]}x{final.size[1]}")

    # El icono suelto, cuadrado: para la barra lateral colapsada y cualquier
    # sitio donde un logo horizontal no cabe.
    icono = im.crop((0, 0, corte, im.size[1]))
    icono = icono.crop(icono.getbbox()).resize((256, 256), Image.LANCZOS)
    icono.save(os.path.join(DESTINO, "logo-escsystem-icono.png"), optimize=True)
    print("  -> public/logo-escsystem-icono.png  256x256")

    # Favicon. Va en app/favicon.ico y no en public/: es la convención del App
    # Router de Next, y ese archivo tiene prioridad sobre cualquier otro icono.
    # Multi-resolución porque Windows y los marcadores piden tamaños distintos.
    favicon = os.path.join(APP, "src", "app", "favicon.ico")
    icono.save(favicon, sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print("  -> src/app/favicon.ico  (16 a 256 px)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
