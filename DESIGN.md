# Dirección de diseño

Dada por el dueño del proyecto el 26/10/2026.

## Identidad

- Minimalismo. Debe sentirse como una aplicación técnica, como un programa de ingeniería.

## Color

- Colores poco saturados, neutros.
- Modo claro y modo oscuro, con selector.
- El modo oscuro es negro total (#000000): fondo, paneles, barras, editor de código y monitor serie. Lo que flota (menús, diálogos) queda apenas por encima (#111315) con borde.

## Tipografía

- Se mantiene la actual: la fuente del sistema ("Segoe UI Variable Text", "Segoe UI", system-ui…).

## Textos

- Títulos con mayúscula inicial (nada de MAYÚSCULAS con espaciado).
- Sin emojis en ninguna parte.

## Diales (deducidos de lo anterior)

Dial: ENERGY 1 / RHYTHM 1 / MOTION 1

## Decisiones derivadas (cada una con su motivo)

- **Paleta:** grises neutros con un único acento azul acero apagado. El verde (Simular / ejecutando) y el rojo (errores) solo como estado. Motivo: neutralidad y poca saturación; el color se reserva para lo que significa algo.
- **Barra superior:** color liso, sin degradado. Motivo: el degradado índigo no encaja con lo neutro.
- **Plano y escenario del simulador:** siempre blancos, también en modo oscuro. Motivo: son la hoja del dibujo; los cables negros (0 V / GND), los rótulos y las fotos de los equipos se leen sobre blanco, y así se imprimen y exportan.
- **Editor de código:** oscuro en los dos modos, como en los entornos de programación.
- **Sombras:** solo en lo que flota sobre el plano (menús, cajones, diálogos, zoom, barra de selección). Motivo: elevación real, no decoración.
- **Movimiento:** solo cambios de estado al pasar el ratón y el deslizamiento funcional de cajones y menús.
