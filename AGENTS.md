# Super Soccer 26 — Reglas y Contexto para el Agente

Este proyecto es un juego de fútbol arcade top-down **5 vs 5** desarrollado con **Phaser 3 + Vite + TypeScript**.
Antes de realizar modificaciones importantes, consulta [CONTEXT.md](./CONTEXT.md) y la skill del proyecto en `.agents/skills/super-soccer-dev/SKILL.md`.

## Convenciones Clave del Proyecto
1. **Arquitectura basada en FSM (`src/fsm/StateMachine.ts`)**:
   - Toda nueva lógica de comportamiento para jugadores (`Player`), porteros, IA o estados de partido debe integrarse limpiamente como estados dentro de `StateMachine`, evitando banderas booleanas sueltas.
2. **Física 2.5D del Balón (`src/objects/Ball.ts`)**:
   - El balón se mueve en `(x, y)` mediante `Phaser.Physics.Arcade.Body` y simula la altura en el eje `z` (`z`, `vz`, `gravityZ`).
   - Al ejecutar un pase o disparo desde un jugador (`executeMoveFromPlayer`), siempre debe asignarse `lastKicker` con ventana de salida (`captureCooldown`) y posicionar el balón fuera del radio de colisión (`>= 26px`) para evitar auto-colisiones en carrera.
3. **Cancha 5 vs 5 (`src/objects/Pitch.ts`)**:
   - Lienzo `1280 × 720`, área de juego `1152 × 600` (`x: 64..1216`, `y: 60..660`).
   - Las bocas de las porterías (`leftGoalBounds`, `rightGoalBounds`) están abiertas en `wallsGroup` y rodeadas por `netsGroup` y `postsGroup`.
4. **Verificación**:
   - Ejecuta siempre `npx tsc --noEmit` tras editar archivos TypeScript para asegurar cero errores de tipos.
