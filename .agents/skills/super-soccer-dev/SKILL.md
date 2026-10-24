---
name: super-soccer-dev
description: >-
  Guía de arquitectura, máquina de estados (FSM), físicas 2.5D del balón, controles 360° y catálogo de assets (sports-pack y ui) para desarrollar nuevas funcionalidades en Super Soccer 26 (Phaser 3 + TypeScript). Activa esta skill al continuar el desarrollo del juego, agregar compañeros/rivales 5v5, IA, porteros, mecánicas de balón o interfaz de usuario.
---

# Super Soccer 26 — Skill de Desarrollo

Utiliza esta guía para extender **Super Soccer 26** manteniendo la coherencia con la arquitectura de escenas, objetos y Máquinas de Estados Finitos (FSM).

## 1. Comandos Rápidos y Verificación

- **Servidor de desarrollo**: `npm run dev` (corre en `http://localhost:5173/`)
- **Verificación de tipos (obligatoria tras cada cambio)**: `npx tsc --noEmit`
- **Build de producción**: `npm run build`

## 2. Mapa de Archivos Clave

- [CONTEXT.md](../../../CONTEXT.md): Estado actual del proyecto y hoja de ruta paso a paso.
- [src/fsm/StateMachine.ts](../../../src/fsm/StateMachine.ts): Clase genérica `StateMachine<TContext, TStateName>`.
- [src/objects/Pitch.ts](../../../src/objects/Pitch.ts): Geometría de la cancha 5v5 (`bounds`, `leftGoalBounds`, `rightGoalBounds`, `leftPenaltyBox`, `rightPenaltyBox`, `leftGoalArea`, `rightGoalArea`) y grupos de colisión (`wallsGroup`, `netsGroup`, `postsGroup`).
- [src/objects/Player.ts](../../../src/objects/Player.ts): Entidad de jugador compuesta por `torso`, `leftArm`, `rightArm`, `leftFoot`, `rightFoot`, anillo selector, barra de potencia y FSM (`IDLE`, `MOVING`, `DRIBBLING_IDLE`, `DRIBBLING_MOVE`, `CHARGING`, `KICKING`).
- [src/objects/Ball.ts](../../../src/objects/Ball.ts): Entidad del balón con eje Z (`z`, `vz`), sombra, marcador de destino, moveset (`short_pass`, `through_pass`, `long_pass`, `shoot`) y FSM (`FREE_GROUND`, `FREE_AIR`, `DRIBBLED`).
- [src/scenes/MenuScene.ts](../../../src/scenes/MenuScene.ts): Menú inicial con assets de `ui/`.
- [src/scenes/MainScene.ts](../../../src/scenes/MainScene.ts): Escena principal del partido, lectura de input analógico 360° y buffer de acciones de `220ms`.

## 3. Reglas de Físicas, Colisiones y FSM

1. **Conducción vs Rebote Físico**:
   - Cuando un jugador libre colisiona con el balón y `ball.canBeCapturedBy(player)` es verdadero:
     - Si el ángulo relativo hacia el balón está dentro de `±65°` del `facingAngle` del jugador, el jugador toma posesión (`ball.attachTo(player)` -> estado `DRIBBLED`).
     - Si golpea por el costado o la espalda (`> 65°`), rebota físicamente.
2. **Patear en Movimiento (Prevención de Auto-Colisión)**:
   - Nunca liberes el balón dentro del radio `14 + 9 = 23px` sin inmunidad.
   - Usa `ball.executeMoveFromPlayer(kicker, moveType, powerRatio)`: coloca el balón a `26px` delante del jugador y registra `ball.lastKicker = kicker` durante `captureCooldown`, de modo que `ball.shouldIgnoreCollisionWith(kicker)` devuelva `true` mientras el balón sale del pie.
3. **Altura Aérea (Eje Z)**:
   - Cuando `ball.isHighInAir()` (`z > 26`), el balón vuela por encima de los jugadores de campo y no colisiona con sus pies.

## 4. Catálogo de Assets Disponibles

- **Jugadores (`public/sports-pack/PNG/<Team>/`)**:
  - Equipos disponibles: `Blue`, `Red`, `Green`, `White`, `Special` (árbitros/arqueros).
  - Índices `(1)` a `(10)`: Variantes de cabeza/pelo y torso (`21×31` px, miran hacia `+X` / `0 rad`).
  - Índices `(11)` y `(12)`: Brazos/manos (`19×13` px).
  - Índices `(13)` y `(14)`: Pies/botines (`19×13` px).
- **Equipamiento (`public/sports-pack/PNG/Equipment/`)**:
  - Balones de fútbol: `ball_soccer1.png`, `ball_soccer2.png`, `ball_soccer3.png`, `ball_soccer4.png` (`18×18` px).
  - Tarjetas y banderines: `card_yellow.png`, `card_red.png`, `flag_green.png`, `flag_checkered.png`.
- **Interfaz (`public/ui/`)**:
  - Botones y paneles en `ui/PNG/{Blue,Green,Red,Yellow,Grey}/Double/`.
  - Iconos en `ui/PNG/Extra/Double/` (`icon_play_light.png`, `icon_repeat_light.png`, flechas, divisores).
  - Fuentes CSS ya registradas en `index.html`: `KenneyFuture` y `KenneyFutureNarrow`.
  - Sonidos en `ui/Sounds/`: `click-a.ogg`, `click-b.ogg`, `tap-a.ogg`, `tap-b.ogg`, `switch-a.ogg`, `switch-b.ogg`.
