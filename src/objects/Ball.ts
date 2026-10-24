import Phaser from 'phaser';
import { Player } from './Player';
import { Pitch } from './Pitch';
import { StateMachine } from '../fsm/StateMachine';

export type MoveType = 'short_pass' | 'through_pass' | 'long_pass' | 'shoot';
export type BallStateName = 'FREE_GROUND' | 'FREE_AIR' | 'DRIBBLED';

export class Ball extends Phaser.GameObjects.Container {
  public declare body: Phaser.Physics.Arcade.Body;

  public readonly fsm: StateMachine<Ball, BallStateName>;
  private pitch: Pitch;
  private shadow: Phaser.GameObjects.Graphics;
  private ballSprite: Phaser.GameObjects.Image;
  private targetMarker: Phaser.GameObjects.Graphics;
  private targetMarkerTimer: number = 0;

  public owner: Player | null = null;
  public lastKicker: Player | null = null;
  private captureCooldown: number = 0;
  private interceptFreeRollTimer: number = 0;
  public isShotInFlight: boolean = false;
  public isAirborne: boolean = false;
  private airborneTimerMs: number = 0;
  private readonly dribbleDistance: number = 24;

  // Físicas de altura (Eje Z para Pase Largo y Tiro)
  public z: number = 0;
  public vz: number = 0;
  private readonly gravityZ: number = 760;

  // Factor de retención de velocidad sobre el césped
  private grassRetentionPerSec: number = 0.28;

  // Seguimiento continuo anti-tunneling (CCD) y verificación de entrada frontal al arco
  private prevX: number = 0;
  private prevY: number = 0;
  public enteredGoalThroughFront: 'left' | 'right' | null = null;

  constructor(scene: Phaser.Scene, x: number, y: number, pitch: Pitch) {
    super(scene, x, y);
    this.pitch = pitch;
    this.prevX = x;
    this.prevY = y;

    this.targetMarker = scene.add.graphics();
    this.targetMarker.setDepth(2);

    this.shadow = scene.add.graphics();
    this.shadow.fillStyle(0x000000, 0.28);
    this.shadow.fillCircle(2, 3, 9);
    this.add(this.shadow);

    this.ballSprite = scene.add.image(0, 0, 'ball');
    this.add(this.ballSprite);
    this.setDepth(10);

    scene.add.existing(this);
    scene.physics.add.existing(this);

    const radius = 9;
    this.body.setCircle(radius, -radius, -radius);
    this.body.setCollideWorldBounds(false);
    this.body.setBounce(0.8, 0.8);

    // Configurar Máquina de Estados del Balón
    this.fsm = new StateMachine<Ball, BallStateName>(this);
    this.setupStates();
    this.fsm.setState('FREE_GROUND');
  }

  private setupStates(): void {
    this.fsm
      .addState('FREE_GROUND', {
        name: 'FREE_GROUND',
        onEnter: (ball) => {
          ball.z = 0;
          ball.vz = 0;
          ball.isAirborne = false;
          ball.airborneTimerMs = 0;
          ball.ballSprite.y = 0;
          ball.ballSprite.setScale(1);
          ball.shadow.setScale(1);
          ball.shadow.setAlpha(1);
        },
        onUpdate: (ball, delta) => {
          if (ball.owner) {
            ball.fsm.setState('DRIBBLED');
            return;
          }
          if (ball.z > 0 || Math.abs(ball.vz) > 0) {
            ball.fsm.setState('FREE_AIR');
            return;
          }
          ball.applyHorizontalFriction(delta / 1000);
        }
      })
      .addState('FREE_AIR', {
        name: 'FREE_AIR',
        onUpdate: (ball, delta) => {
          if (ball.owner) {
            ball.fsm.setState('DRIBBLED');
            return;
          }
          const dt = delta / 1000;
          ball.z += ball.vz * dt;
          ball.vz -= ball.gravityZ * dt;

          if (ball.z <= 0) {
            ball.z = 0;
            if (Math.abs(ball.vz) > 55) {
              ball.vz = -ball.vz * 0.5;
              ball.body.setVelocity(
                ball.body.velocity.x * 0.86,
                ball.body.velocity.y * 0.86
              );
            } else {
              ball.vz = 0;
              ball.fsm.setState('FREE_GROUND');
              return;
            }
          }

          ball.ballSprite.y = -ball.z * 0.65;
          const airScale = 1 + Math.min(ball.z / 150, 0.75);
          ball.ballSprite.setScale(airScale);

          const shadowScale = Math.max(0.5, 1 - ball.z / 240);
          ball.shadow.setScale(shadowScale);
          ball.shadow.setAlpha(Math.max(0.35, 1 - ball.z / 260));

          ball.applyHorizontalFriction(dt);
        }
      })
      .addState('DRIBBLED', {
        name: 'DRIBBLED',
        onEnter: (ball) => {
          ball.z = 0;
          ball.vz = 0;
          ball.ballSprite.y = 0;
          ball.ballSprite.setScale(1);
          ball.shadow.setScale(1);
          ball.shadow.setAlpha(1);
          ball.clearTargetMarker();
        },
        onUpdate: (ball, delta) => {
          if (!ball.owner) {
            ball.fsm.setState(ball.z > 0 || ball.vz !== 0 ? 'FREE_AIR' : 'FREE_GROUND');
            return;
          }

          const dt = delta / 1000;
          const angle = ball.owner.getFacingAngle();
          const playerSpeed = ball.owner.body.velocity.length();

          // Pequeño toque rítmico con el pie al correr conduciendo
          const strideOffset =
            playerSpeed > 10 ? Math.abs(Math.sin(ball.owner.getWalkCycle())) * 2.5 : 0;
          const dist = ball.dribbleDistance + strideOffset;

          const targetX = ball.owner.x + Math.cos(angle) * dist;
          const targetY = ball.owner.y + Math.sin(angle) * dist;

          const pad = 9;
          const b = ball.pitch.bounds;
          const inGoalMouthY =
            targetY >= ball.pitch.leftGoalBounds.top + pad &&
            targetY <= ball.pitch.leftGoalBounds.bottom - pad;

          const minX = inGoalMouthY ? ball.pitch.leftGoalBounds.left + pad : b.left + pad;
          const maxX = inGoalMouthY ? ball.pitch.rightGoalBounds.right - pad : b.right - pad;

          const clampedX = Phaser.Math.Clamp(targetX, minX, maxX);
          const clampedY = Phaser.Math.Clamp(targetY, b.top + pad, b.bottom - pad);

          // Mantener sincronizada delante de los pies sin rezago que meta el balón dentro del jugador
          ball.setPosition(clampedX, clampedY);
          ball.body.reset(clampedX, clampedY);
          ball.body.setVelocity(ball.owner.body.velocity.x, ball.owner.body.velocity.y);

          if (playerSpeed > 5) {
            ball.ballSprite.rotation += (playerSpeed * dt) / 10;
          }
        }
      });
  }

  private applyHorizontalFriction(dt: number): void {
    const inGoalArea =
      this.x < this.pitch.bounds.left || this.x > this.pitch.bounds.right;

    const speed = this.body.velocity.length();
    if (speed > 4) {
      const retention = inGoalArea
        ? 0.04
        : this.z > 2
          ? 0.78
          : this.grassRetentionPerSec;
      const frictionFactor = Math.pow(retention, dt);
      this.body.setVelocity(
        this.body.velocity.x * frictionFactor,
        this.body.velocity.y * frictionFactor
      );
      this.ballSprite.rotation += (speed * dt) / 9;
    } else if (speed > 0 && this.z === 0) {
      this.body.setVelocity(0, 0);
    }
  }

  public canBeCapturedBy(player: Player): boolean {
    if (this.z > 26) return false;
    if (this.interceptFreeRollTimer > 0) return false;
    if (this.owner !== null && this.owner !== player) return false;
    if (this.lastKicker === player && this.captureCooldown > 0) return false;
    // Si es un disparo activo, cualquier jugador en su trayectoria lo intercepta/rebota en vez de pegarlo al pie
    if (this.isShotInFlight) return false;
    return true;
  }

  /**
   * Indica si la colisión física con este jugador debe ignorarse (p.ej. si lo conduce,
   * si lo acaba de patear y sigue en ventana de salida, o si es un pase bombeado alto).
   */
  public shouldIgnoreCollisionWith(player: Player): boolean {
    if (this.owner === player) return true;
    if (this.lastKicker === player && this.captureCooldown > 0) return true;
    // Los disparos (isShotInFlight) van a media altura y siempre son interceptables por jugadores en su trayectoria
    if (!this.isShotInFlight && this.isHighInAir()) return true;
    return false;
  }

  public isHighInAir(): boolean {
    return this.z > 26;
  }

  public attachTo(player: Player): void {
    if (!this.canBeCapturedBy(player)) return;
    this.owner = player;
    this.lastKicker = null;
    this.isShotInFlight = false;
    this.isAirborne = false;
    this.airborneTimerMs = 0;
    this.fsm.setState('DRIBBLED');
  }

  public release(
    velocityX: number,
    velocityY: number,
    velocityZ: number = 0,
    cooldownMs: number = 280,
    grassRetention: number = 0.28,
    kicker: Player | null = null,
    isShot: boolean = false,
    isAirborneLongPass: boolean = false,
    airborneDurationMs: number = 0
  ): void {
    this.owner = null;
    this.lastKicker = kicker;
    this.captureCooldown = cooldownMs;
    this.isShotInFlight = isShot;
    this.isAirborne = isAirborneLongPass;
    this.airborneTimerMs = isAirborneLongPass ? airborneDurationMs : 0;
    this.vz = velocityZ;
    this.grassRetentionPerSec = grassRetention;
    this.body.setVelocity(velocityX, velocityY);
    this.fsm.setState(velocityZ > 0 ? 'FREE_AIR' : 'FREE_GROUND');
  }

  /**
   * Libera el balón tras una intercepción (choque con el portador o bloqueo de disparo)
   * haciendo que ruede libremente al estilo HaxBall según el vector resultante.
   */
  public triggerHaxballInterception(
    velocityX: number,
    velocityY: number,
    velocityZ: number = 0,
    freeRollMs: number = 320
  ): void {
    this.owner = null;
    this.lastKicker = null;
    this.captureCooldown = 0;
    this.interceptFreeRollTimer = freeRollMs;
    this.isShotInFlight = false;
    this.isAirborne = false;
    this.airborneTimerMs = 0;
    this.z = velocityZ > 0 ? Math.min(this.z, 16) : 0;
    this.vz = velocityZ;
    this.grassRetentionPerSec = 0.34;
    this.clearTargetMarker();
    this.body.setVelocity(velocityX, velocityY);
    this.fsm.setState(velocityZ > 0 ? 'FREE_AIR' : 'FREE_GROUND');
  }

  public resetTo(x: number, y: number): void {
    this.owner = null;
    this.lastKicker = null;
    this.captureCooldown = 200;
    this.interceptFreeRollTimer = 0;
    this.isShotInFlight = false;
    this.isAirborne = false;
    this.airborneTimerMs = 0;
    this.z = 0;
    this.vz = 0;
    this.enteredGoalThroughFront = null;
    this.prevX = x;
    this.prevY = y;
    this.clearTargetMarker();
    this.setPosition(x, y);
    this.body.reset(x, y);
    this.fsm.setState('FREE_GROUND');
  }

  public onHitPost(postObj: Phaser.GameObjects.GameObject): void {
    const postZone = postObj as Phaser.GameObjects.Zone;
    const normalAngle = Math.atan2(this.y - postZone.y, this.x - postZone.x);
    const speed = Math.max(180, this.body.velocity.length() * 0.82);
    this.body.setVelocity(Math.cos(normalAngle) * speed, Math.sin(normalAngle) * speed);
  }

  /**
   * Rebote sólido contra el travesaño (crossbar) cuando el balón va elevado por un pase largo (isAirborne = true),
   * devolviéndolo al terreno de juego sin marcar gol ni interrumpir el partido.
   */
  public onHitCrossbar(side: 'left' | 'right'): void {
    const pad = 9;
    const b = this.pitch.bounds;
    const reboundVx =
      side === 'left'
        ? Math.max(190, Math.abs(this.body.velocity.x) * 0.82)
        : -Math.max(190, Math.abs(this.body.velocity.x) * 0.82);

    this.x = side === 'left' ? b.left + pad + 2 : b.right - pad - 2;
    this.body.x = this.x - pad;
    this.body.setVelocity(reboundVx, this.body.velocity.y * 0.88);
    this.vz = Math.max(80, Math.abs(this.vz) * 0.55);
    this.clearTargetMarker();
  }

  public onHitNet(): void {
    this.body.setVelocity(
      this.body.velocity.x * 0.22,
      this.body.velocity.y * 0.22
    );
    this.vz *= 0.3;
  }

  /**
   * Ejecuta uno de los 4 movimientos del moveset desde los pies del jugador pateador
   */
  public executeMoveFromPlayer(
    kicker: Player,
    move: MoveType,
    powerRatio: number
  ): void {
    const p = Phaser.Math.Clamp(powerRatio, 0.15, 1);
    const baseAngle = kicker.getFacingAngle();
    const baseCos = Math.cos(baseAngle);
    const baseSin = Math.sin(baseAngle);
    const playerVelocity = kicker.body.velocity;

    // Colocar el balón justo por delante del radio de colisión (14 + 9 = 23 -> 26px)
    // asegurando que nunca atraviese las paredes ni las redes laterales al patear cerca del borde
    const spawnDist = 26;
    const rawSpawnX = kicker.x + baseCos * spawnDist;
    const rawSpawnY = kicker.y + baseSin * spawnDist;

    const pad = 9;
    const b = this.pitch.bounds;
    const goalTop = this.pitch.leftGoalBounds.top;
    const goalBottom = this.pitch.leftGoalBounds.bottom;
    const inMouthY = rawSpawnY >= goalTop + pad && rawSpawnY <= goalBottom - pad;

    const minX = inMouthY ? this.pitch.leftGoalBounds.left + pad : b.left + pad;
    const maxX = inMouthY ? this.pitch.rightGoalBounds.right - pad : b.right - pad;
    const spawnX = Phaser.Math.Clamp(rawSpawnX, minX, maxX);
    const spawnY = Phaser.Math.Clamp(rawSpawnY, b.top + pad, b.bottom - pad);

    this.prevX = kicker.x;
    this.prevY = kicker.y;
    this.setPosition(spawnX, spawnY);
    this.body.reset(spawnX, spawnY);

    // Aplicar dispersión angular según la Técnica del jugador (mayor dispersión a baja Técnica y alta potencia)
    const maxSpread = kicker.getKickSpreadRad() * (0.35 + 0.65 * p);
    const angleOffset = maxSpread > 0 ? Phaser.Math.FloatBetween(-maxSpread, maxSpread) : 0;
    const kickAngle = baseAngle + angleOffset;
    const cos = Math.cos(kickAngle);
    const sin = Math.sin(kickAngle);

    const kickMul = kicker.getKickPowerMultiplier();
    const shotRetention = kicker.getShotGrassRetention();
    const atkBoost = kicker.getAttackPassBoost();

    switch (move) {
      case 'short_pass': {
        const speed =
          Phaser.Math.Linear(230, 440, p) *
          Phaser.Math.Linear(0.62, 1.38, (kickMul - 0.42) / 1.23) *
          atkBoost;
        const vx = playerVelocity.x * 0.28 + cos * speed;
        const vy = playerVelocity.y * 0.28 + sin * speed;
        const retention = Phaser.Math.Linear(0.2, 0.38, (shotRetention - 0.18) / 0.5);
        this.release(vx, vy, 0, 280, retention, kicker);
        break;
      }

      case 'through_pass': {
        const speed =
          Phaser.Math.Linear(300, 560, p) *
          Phaser.Math.Linear(0.58, 1.42, (kickMul - 0.42) / 1.23) *
          atkBoost;
        const vx = playerVelocity.x * 0.36 + cos * speed;
        const vy = playerVelocity.y * 0.36 + sin * speed;
        const vz = 48 * p * kickMul;
        const retention = Phaser.Math.Linear(0.25, 0.52, (shotRetention - 0.18) / 0.5);
        this.release(vx, vy, vz, 300, retention, kicker);
        this.showTargetMarker(this.x + cos * speed * 0.72, this.y + sin * speed * 0.72, 0x38bdf8);
        break;
      }

      case 'long_pass': {
        const groundSpeed =
          Phaser.Math.Linear(260, 510, p) *
          Phaser.Math.Linear(0.55, 1.45, (kickMul - 0.42) / 1.23);
        const vx = playerVelocity.x * 0.28 + cos * groundSpeed;
        const vy = playerVelocity.y * 0.28 + sin * groundSpeed;
        const vz =
          Phaser.Math.Linear(220, 460, p) *
          Phaser.Math.Linear(0.65, 1.35, (kickMul - 0.42) / 1.23);
        const flightTime = (2 * vz) / this.gravityZ;
        const airborneDurationMs = Math.max(1200, flightTime * 1000 + 420);

        // Activar ball.isAirborne = true durante toda la trayectoria del pase largo
        this.release(vx, vy, vz, 320, 0.32, kicker, false, true, airborneDurationMs);

        this.showTargetMarker(
          this.x + vx * flightTime * 0.88,
          this.y + vy * flightTime * 0.88,
          0xfacc15
        );
        break;
      }

      case 'shoot': {
        // Con Disparo 10 (kickMul = 0.42), un tiro al 100% sale a ~275 px/s y frena rápido (retention 0.18).
        // Con Disparo 50 (kickMul = 1.65), un tiro al 100% sale a ~1090 px/s y mantiene velocidad (retention 0.68).
        const speed = Phaser.Math.Linear(380, 660, p) * kickMul;
        const vx = playerVelocity.x * 0.32 + cos * speed;
        const vy = playerVelocity.y * 0.32 + sin * speed;
        const vz = Phaser.Math.Linear(75, 235, p) * kickMul;
        this.release(vx, vy, vz, 320, shotRetention, kicker, true);
        break;
      }
    }
  }

  private showTargetMarker(targetX: number, targetY: number, color: number): void {
    const b = this.pitch.bounds;
    const cx = Phaser.Math.Clamp(targetX, b.left + 16, b.right - 16);
    const cy = Phaser.Math.Clamp(targetY, b.top + 16, b.bottom - 16);

    this.targetMarker.clear();
    this.targetMarker.lineStyle(2, color, 0.75);
    this.targetMarker.strokeCircle(cx, cy, 12);
    this.targetMarker.lineBetween(cx - 6, cy, cx + 6, cy);
    this.targetMarker.lineBetween(cx, cy - 6, cx, cy + 6);
    this.targetMarkerTimer = 950;
  }

  private clearTargetMarker(): void {
    this.targetMarker.clear();
    this.targetMarkerTimer = 0;
  }

  public updateBall(delta: number): void {
    if (this.captureCooldown > 0) {
      this.captureCooldown = Math.max(0, this.captureCooldown - delta);
      if (this.captureCooldown <= 0) {
        this.lastKicker = null;
      }
    }

    if (this.interceptFreeRollTimer > 0) {
      this.interceptFreeRollTimer = Math.max(0, this.interceptFreeRollTimer - delta);
    }

    if (this.airborneTimerMs > 0) {
      this.airborneTimerMs = Math.max(0, this.airborneTimerMs - delta);
      if (this.airborneTimerMs <= 0) {
        this.isAirborne = false;
      }
    }

    if (this.isShotInFlight && this.body.velocity.length() < 240) {
      this.isShotInFlight = false;
    }

    if (this.targetMarkerTimer > 0) {
      this.targetMarkerTimer = Math.max(0, this.targetMarkerTimer - delta);
      if (this.targetMarkerTimer <= 0) {
        this.targetMarker.clear();
      }
    }

    this.fsm.update(delta);
    this.enforceGoalAndWallContainment();
    this.prevX = this.x;
    this.prevY = this.y;
  }

  public getPrevX(): number {
    return this.prevX;
  }

  public getPrevY(): number {
    return this.prevY;
  }

  /**
   * Renderizado e interpolación suave en el Cliente a partir del estado autoritativo del Host
   */
  public syncRemoteVisuals(
    sync: {
      x: number;
      y: number;
      vx: number;
      vy: number;
      z: number;
      vz: number;
      isAirborne: boolean;
    },
    delta: number,
    lerpFactor: number
  ): void {
    const dist = Phaser.Math.Distance.Between(this.x, this.y, sync.x, sync.y);
    const nx = dist > 180 ? sync.x : Phaser.Math.Linear(this.x, sync.x, lerpFactor);
    const ny = dist > 180 ? sync.y : Phaser.Math.Linear(this.y, sync.y, lerpFactor);

    this.prevX = this.x;
    this.prevY = this.y;
    this.setPosition(nx, ny);
    this.body.reset(nx, ny);
    this.body.setVelocity(sync.vx, sync.vy);

    this.z = Phaser.Math.Linear(this.z, sync.z, lerpFactor);
    this.vz = sync.vz;
    this.isAirborne = sync.isAirborne;

    if (this.z > 0.5) {
      this.ballSprite.y = -this.z * 0.65;
      const airScale = 1 + Math.min(this.z / 150, 0.75);
      this.ballSprite.setScale(airScale);
      const shadowScale = Math.max(0.5, 1 - this.z / 240);
      this.shadow.setScale(shadowScale);
      this.shadow.setAlpha(Math.max(0.2, 0.9 - this.z / 200));
    } else {
      this.ballSprite.y = 0;
      this.ballSprite.setScale(1);
      this.shadow.setScale(1);
      this.shadow.setAlpha(1);
    }

    const speed = Math.hypot(sync.vx, sync.vy);
    if (speed > 5) {
      this.ballSprite.rotation += (speed / 280) * (delta / 1000) * 8;
    }
  }

  /**
   * Prevención continua de tunneling (CCD) para las 3 paredes de la red y las líneas de fondo:
   * - Verifica que al cruzar x = left o x = right lo haya hecho exclusivamente por la boca frontal del arco (entre los postes).
   * - Si ya entró legítimamente al arco, confina el balón dentro de las 3 paredes de la red para que jamás la atraviese por velocidad.
   * - Si no entró por la boca frontal, impide que penetre las redes laterales o las paredes de fondo desde afuera.
   */
  private enforceGoalAndWallContainment(): void {
    const pad = 9;
    const b = this.pitch.bounds;
    const goalTop = this.pitch.leftGoalBounds.top;
    const goalBottom = this.pitch.leftGoalBounds.bottom;

    // 1. Si el balón ya había entrado por la boca frontal al arco izquierdo, mantenerlo dentro de sus 3 paredes de red
    if (this.enteredGoalThroughFront === 'left') {
      if (this.x >= b.left + pad) {
        this.enteredGoalThroughFront = null;
      } else {
        const minX = this.pitch.leftGoalBounds.left + pad;
        const minY = goalTop + pad;
        const maxY = goalBottom - pad;

        if (this.x < minX) {
          this.x = minX;
          this.body.x = minX - pad;
          this.body.velocity.x = Math.abs(this.body.velocity.x) * 0.2;
          this.onHitNet();
        }
        if (this.y < minY) {
          this.y = minY;
          this.body.y = minY - pad;
          this.body.velocity.y = Math.abs(this.body.velocity.y) * 0.2;
          this.onHitNet();
        } else if (this.y > maxY) {
          this.y = maxY;
          this.body.y = maxY - pad;
          this.body.velocity.y = -Math.abs(this.body.velocity.y) * 0.2;
          this.onHitNet();
        }
        return;
      }
    }

    // 2. Si el balón ya había entrado por la boca frontal al arco derecho, mantenerlo dentro de sus 3 paredes de red
    if (this.enteredGoalThroughFront === 'right') {
      if (this.x <= b.right - pad) {
        this.enteredGoalThroughFront = null;
      } else {
        const maxX = this.pitch.rightGoalBounds.right - pad;
        const minY = goalTop + pad;
        const maxY = goalBottom - pad;

        if (this.x > maxX) {
          this.x = maxX;
          this.body.x = maxX - pad;
          this.body.velocity.x = -Math.abs(this.body.velocity.x) * 0.2;
          this.onHitNet();
        }
        if (this.y < minY) {
          this.y = minY;
          this.body.y = minY - pad;
          this.body.velocity.y = Math.abs(this.body.velocity.y) * 0.2;
          this.onHitNet();
        } else if (this.y > maxY) {
          this.y = maxY;
          this.body.y = maxY - pad;
          this.body.velocity.y = -Math.abs(this.body.velocity.y) * 0.2;
          this.onHitNet();
        }
        return;
      }
    }

    // 3. Evaluar cruce de la línea de meta izquierda (x < b.left)
    if (this.x < b.left) {
      const dx = this.x - this.prevX;
      const t = Math.abs(dx) > 0.001 ? Phaser.Math.Clamp((b.left - this.prevX) / dx, 0, 1) : 1;
      const crossY = this.prevY + (this.y - this.prevY) * t;
      const enteredFrontMouth = crossY >= goalTop + 5 && crossY <= goalBottom - 5;

      if (enteredFrontMouth && this.prevX >= b.left - pad) {
        // Si el balón va en estado aéreo de Pase Largo (isAirborne = true), golpea el travesaño sólido y rebota al campo
        if (this.isAirborne) {
          this.onHitCrossbar('left');
        } else {
          this.enteredGoalThroughFront = 'left';
          const minX = this.pitch.leftGoalBounds.left + pad;
          if (this.x < minX) {
            this.x = minX;
            this.body.x = minX - pad;
            this.onHitNet();
          }
          this.y = Phaser.Math.Clamp(this.y, goalTop + pad, goalBottom - pad);
          this.body.y = this.y - pad;
        }
      } else {
        // Bloquear entrada lateral o tunneling por fuera de los postes
        this.x = b.left + pad;
        this.body.x = this.x - pad;
        this.body.velocity.x = Math.abs(this.body.velocity.x) * 0.75;
      }
    }

    // 4. Evaluar cruce de la línea de meta derecha (x > b.right)
    if (this.x > b.right) {
      const dx = this.x - this.prevX;
      const t = Math.abs(dx) > 0.001 ? Phaser.Math.Clamp((b.right - this.prevX) / dx, 0, 1) : 1;
      const crossY = this.prevY + (this.y - this.prevY) * t;
      const enteredFrontMouth = crossY >= goalTop + 5 && crossY <= goalBottom - 5;

      if (enteredFrontMouth && this.prevX <= b.right + pad) {
        // Si el balón va en estado aéreo de Pase Largo (isAirborne = true), golpea el travesaño sólido y rebota al campo
        if (this.isAirborne) {
          this.onHitCrossbar('right');
        } else {
          this.enteredGoalThroughFront = 'right';
          const maxX = this.pitch.rightGoalBounds.right - pad;
          if (this.x > maxX) {
            this.x = maxX;
            this.body.x = maxX - pad;
            this.onHitNet();
          }
          this.y = Phaser.Math.Clamp(this.y, goalTop + pad, goalBottom - pad);
          this.body.y = this.y - pad;
        }
      } else {
        // Bloquear entrada lateral o tunneling por fuera de los postes
        this.x = b.right - pad;
        this.body.x = this.x - pad;
        this.body.velocity.x = -Math.abs(this.body.velocity.x) * 0.75;
      }
    }

    // 5. Contención en bandas superior e inferior del campo
    if (this.y < b.top + pad) {
      this.y = b.top + pad;
      this.body.y = this.y - pad;
      this.body.velocity.y = Math.abs(this.body.velocity.y) * 0.75;
    } else if (this.y > b.bottom - pad) {
      this.y = b.bottom - pad;
      this.body.y = this.y - pad;
      this.body.velocity.y = -Math.abs(this.body.velocity.y) * 0.75;
    }
  }
}
