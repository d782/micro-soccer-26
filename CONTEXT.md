# Super Soccer 26 — Contexto del Proyecto y Hoja de Ruta

## 1. Resumen Técnico
- **Motor y Stack**: Phaser 3 (`^3.88.2`) + Vite (`^6.0.0`) + TypeScript (`^5.7.2`).
- **Resolución base**: `1280 × 720` (`Phaser.Scale.FIT`, `CENTER_BOTH`), física `arcade` sin gravedad global (`gravity: { x: 0, y: 0 }`) y soporte de `gamepad` activado.
- **Assets disponibles** (enlazados en `public/sports-pack` y `public/ui`):
  - `sports-pack/`: Sprites top-down de Kenney (jugadores por partes: torso/cabeza `21×31`, brazos `19×13`, pies/botines `19×13` en equipos Blue, Red, Green, White, Special; balones `18×18`; elementos de cancha).
  - `ui/`: Botones, paneles `nineslice`, iconos (`icon_play_light.png`, estrellas), fuentes `Kenney Future.ttf` / `Kenney Future Narrow.ttf` y sonidos (`click-a.ogg`, `tap-a.ogg`).

---

## 2. Arquitectura Actual (`src/`)

```text
src/
├── main.ts                 # Configuración de Phaser.Game (1280x720) y registro de escenas
├── fsm/
│   └── StateMachine.ts     # Máquina de Estados Finitos genérica (onEnter, onUpdate, onExit)
├── scenes/
│   ├── Boot.ts             # Inicio rápido hacia Preloader
│   ├── Preloader.ts        # Carga de sprites (sports-pack), interfaz (ui) y sonidos -> MenuScene
│   ├── MenuScene.ts        # Menú principal con tarjeta NineSlice, título y botón PLAY -> SkillScene
│   ├── SkillScene.ts       # Menú de nombre y distribución de 175 puntos (50 restantes) en 5 atributos -> MainScene
│   └── MainScene.ts        # Escena del partido 5v5, entrada 360°, buffer de acciones y detección de gol
└── objects/
    ├── Pitch.ts            # Cancha 5v5 (1152x600), franjas de césped, áreas, arcos abiertos, redes y postes
    ├── Player.ts           # Jugador compuesto (torso+brazos+pies), locomoción 360°, barra de potencia y FSM
    └── Ball.ts             # Balón con física 2.5D (eje Z para altura/parábola), sombra, moveset y FSM
```

---

## 3. Estado Actual (Completado hasta hoy)

1. **Cancha 5 vs 5 (`Pitch.ts`)**:
   - Superficie activa de `1152 × 600` px (`18` franjas verticales de `64px`), ideal para **5 vs 5** (1 portero + 4 jugadores de campo por equipo).
   - Líneas reglamentarias, áreas penales (`170 × 330`), áreas de portero (`68 × 200`), puntos de penal, medialunas, córners y porterías (`140px` de boca × `44px` de fondo).
   - Colisionadores estáticos separados: `wallsGroup` (bandas y líneas de fondo dejando abierta la boca de los arcos), `postsGroup` (4 postes circulares con rebote real) y `netsGroup` (redes laterales/traseras que amortiguan la pelota al entrar).
2. **Jugador con Movimiento Analógico / 360° Continuo (`Player.ts`)**:
   - Soporta simultáneamente: **Joystick virtual con Mouse/Touch**, **Gamepad físico** y **Teclado (`WASD` / Flechas)** con vector suavizado e inercia.
   - Animación procedural de zancada, braceo y extensión de pierna al patear.
3. **Colisión Direccional y Conducción (`MainScene.ts` + `Ball.ts`)**:
   - **Cono frontal (`±65°`)**: El jugador recibe y conduce el balón pegado al pie (`DRIBBLLED`).
   - **Costado o espalda (`> 65°`)**: El balón rebota físicamente en el cuerpo del jugador.
4. **Moveset de 4 Acciones con Barra de Potencia y Eje Z (`Ball.ts`)**:
   - `J / X / 1` → **Toque corto (`short_pass`)**: Al ras del césped (`z = 0`), preciso.
   - `K / Z / 2` → **Pase al vacío (`through_pass`)**: Adelantado al espacio con menor fricción inicial y marcador celeste de destino.
   - `L / C / 3` → **Pase largo (`long_pass`)**: Parábola aérea en el **eje Z** (el balón sube, crece en escala, proyecta sombra en el suelo, supera jugadores por arriba si `z > 26` y pica al caer) con marcador amarillo.
   - `ESPACIO / V / 4` → **Patear (`shoot`)**: Tiro potente a puerta con elevación media.
5. **Máquinas de Estados Finitos (`StateMachine.ts`)**:
   - **FSM Partido (`MainScene.ts`)**: `PLAYING`, `GOAL_CELEBRATION`, `FULL_TIME` (temporizador de 3 minutos `03:00` con retorno automático a `MenuScene` al finalizar).
   - **FSM Jugador**: `IDLE`, `MOVING`, `DRIBBLING_IDLE`, `DRIBBLING_MOVE`, `CHARGING` (permite seguir corriendo y apuntando en 360° mientras carga la barra), `KICKING` (con inmunidad de salida `lastKicker` para nunca auto-colisionar al patear en carrera).
   - **FSM Balón**: `FREE_GROUND`, `FREE_AIR`, `DRIBBLED`.
6. **Marcador, Cronómetro, Nombre/Atributos y Menú (`SkillScene.ts` + `MainScene.ts` + `MenuScene.ts`)**:
   - **Menú de Habilidades (`SkillScene.ts`)**: Campo de entrada de texto para el **nombre del jugador** (mostrado sobre el jugador en cancha) y distribución de **175 puntos totales** (iniciando con `25` por atributo y **50 puntos restantes por repartir**, `+25` adicionales) entre 5 atributos (`Velocidad`, `Disparo`, `Defensa`, `Técnica`, `Ataque`) con límites `10..50` y activación del botón **INICIAR PARTIDO** al asignar todos los puntos.
   - **Impacto directo en el partido (`Player.ts` + `Ball.ts` + `MainScene.ts`)**:
     - `Velocidad`: Escala `maxSpeed` (`175..345 px/s`).
     - `Disparo`: Escala `kickPowerMultiplier` (`0.72x..1.42x`) al patear el balón.
     - `Defensa`: Escala la masa corporal (`0.6..2.4`) y la fuerza de choque físico (`0.75x..1.50x`).
     - `Técnica`: Escala el radio de alcance/toque (`25..54 px`), el cono de recepción (`45°..88°`) y la velocidad de conducción.
     - `Ataque`: Reduce el enfriamiento entre patadas (`kickCooldownMs`: `680ms` a `110ms`) y el tiempo de carga.
   - Marcador superior (`AZUL 0 | 03:00 | 0 ROJO`) con paneles `NineSlice` (`ui_panel_blue`, `ui_panel_grey`, `ui_panel_red`), conteo automático de goles según el arco (`right` suma a Azul, `left` suma a Rojo), reposicionamiento tras gol y retorno a `MenuScene` al cumplirse los 3 minutos.
   - Menú inicial con los assets de `ui/`, botón **PLAY** interactivo y sonidos que lleva a `SkillScene`.

---

## 4. Próximos Pasos para Continuar Mañana

- [ ] **Paso siguiente sugerido — Formaciones y Equipos 5 vs 5**:
  - Instanciar los 4 compañeros de campo + 1 portero del equipo Azul y los 5 del equipo Rojo en sus posiciones tácticas iniciales sobre la cancha.
- [ ] **Cambio de jugador activo y Recepción de Pases**:
  - Al hacer un `Toque corto`, `Pase al vacío` o `Pase largo`, cambiar el control (`isControlled`) al compañero receptor más cercano a la trayectoria/destino del balón (o con una tecla de cambio de jugador `Q` / `Tab`).
- [ ] **Porteros (Goalkeepers)**:
  - Máquina de estados del portero (`POSITIONING`, `DIVING_SAVE`, `HOLDING_BALL`, `DISTRIBUTING`) dentro de `leftGoalArea` / `rightGoalArea`.
- [ ] **IA Básica de Compañeros y Rivales**:
  - Compañeros desmarcándose al espacio y rivales presionando o cubriendo líneas de pase.
- [ ] **Marcador y Flujo de Partido (HUD UI)**:
  - Marcador superior (`AZUL 0 - 0 ROJO`) usando paneles/fuentes de `ui/`, cronómetro y reposicionamiento tras gol o saque de banda/esquina.
