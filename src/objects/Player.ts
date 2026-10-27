import Phaser from 'phaser';
import { StateMachine } from '../fsm/StateMachine';
import { Ball, MoveType } from './Ball';

export type PlayerStateName =
  | 'IDLE'
  | 'MOVING'
  | 'DRIBBLING_IDLE'
  | 'DRIBBLING_MOVE'
  | 'CHARGING'
  | 'KICKING';

export interface PendingMoveRequest {
  type: MoveType;
  label: string;
  isHolding: boolean;
}

export interface PlayerStats {
  speed: number; // Velocidad (10..50): modifica la velocidad máxima de movimiento
  shoot: number; // Disparo (10..50): modifica la fuerza al patear el balón
  defense: number; // Defensa (10..50): modifica la masa/densidad para choques
  technique: number; // Técnica (10..50): modifica el radio/distancia de toque y control del balón
  attack: number; // Ataque (10..50): modifica el tiempo de enfriamiento (cooldown) entre patadas
}

export const DEFAULT_PLAYER_STATS: PlayerStats = {
  speed: 35,
  shoot: 35,
  defense: 35,
  technique: 35,
  attack: 35
};

export interface PlayerConfig {
  scene: Phaser.Scene;
  x: number;
  y: number;
  team: 'blue' | 'red';
  isControlled?: boolean;
  stats?: PlayerStats;
  name?: string;
  initialFacingAngle?: number;
}

export class Player extends Phaser.GameObjects.Container {
  public declare body: Phaser.Physics.Arcade.Body;

  public readonly fsm: StateMachine<Player, PlayerStateName>;
  public readonly team: 'blue' | 'red';
  public readonly stats: PlayerStats;
  public readonly playerName: string;

  private selectionRing: Phaser.GameObjects.Graphics;
  private nameLabelText: Phaser.GameObjects.Text;
  private powerBarGraphics: Phaser.GameObjects.Graphics;
  private actionLabelText: Phaser.GameObjects.Text;
  private bodyGroup: Phaser.GameObjects.Container;
  private leftFoot: Phaser.GameObjects.Image;
  private rightFoot: Phaser.GameObjects.Image;
  private leftArm: Phaser.GameObjects.Image;
  private rightArm: Phaser.GameObjects.Image;
  private torso: Phaser.GameObjects.Image;

  private walkCycle: number = 0;
  private kickAnimTimer: number = 0;
  private kickCooldownTimer: number = 0;
  private tackleCooldownTimer: number = 0;
  private tackleImmunityTimer: number = 0;
  private stunTimer: number = 0;
  private stunColor: number = 0xef4444;

  // Parámetros físicos derivados de los 5 atributos (Velocidad, Disparo, Defensa, Técnica, Ataque)
  private readonly maxSpeed: number;
  private readonly accelRate: number;
  private readonly decelRate: number;
  private readonly turnSpeed: number;
  private readonly dribbleSpeedMultiplier: number;
  private readonly kickPowerMultiplier: number;
  private readonly shotGrassRetention: number;
  private readonly defenseImpactMultiplier: number;
  private readonly knockbackResistance: number;
  private readonly touchRadius: number;
  private readonly controlConeRad: number;
  private readonly kickSpreadRad: number;
  private readonly kickCooldownMs: number;
  private readonly maxChargeMs: number;
  private readonly attackPassBoost: number;

  private facingAngle: number = 0;
  private isControlled: boolean;

  // Entradas actuales inyectadas en cada frame para la Máquina de Estados
  public currentInputVector = new Phaser.Math.Vector2(0, 0);
  public activeBall: Ball | null = null;
  public currentMoveRequest: PendingMoveRequest | null = null;

  // Datos del estado CHARGING -> KICKING
  private chargingMoveType: MoveType = 'short_pass';
  private chargingMoveLabel: string = '';
  private chargeTimeMs: number = 0;
  private lockedPowerRatio: number = 0.25;

  constructor(config: PlayerConfig) {
    super(config.scene, config.x, config.y);

    this.team = config.team;
    this.isControlled = config.isControlled ?? false;
    this.stats = { ...(config.stats ?? DEFAULT_PLAYER_STATS) };
    this.playerName = (config.name ?? (config.team === 'blue' ? 'JUGADOR 1' : 'JUGADOR 2')).trim() || 'JUGADOR';
    this.facingAngle = config.initialFacingAngle ?? (config.team === 'red' ? Math.PI : 0);

    const norm = (val: number) => Phaser.Math.Clamp((val - 10) / 40, 0, 1);
    const curve = (val: number) => Math.pow(norm(val), 1.35);

    // 1. Velocidad (10..50) -> Velocidad máxima (145 a 385 px/s) + aceleración de arranque (0.09 a 0.26)
    const speedT = curve(this.stats.speed);
    this.maxSpeed = Phaser.Math.Linear(145, 385, speedT);
    this.accelRate = Phaser.Math.Linear(0.09, 0.26, speedT);
    this.decelRate = Phaser.Math.Linear(0.11, 0.22, norm(this.stats.speed));

    // 2. Disparo (10..50) -> Potencia de patada (0.42x a 1.65x) + retención de velocidad sobre el césped (0.18 a 0.68)
    const shootT = curve(this.stats.shoot);
    this.kickPowerMultiplier = Phaser.Math.Linear(0.42, 1.65, shootT);
    this.shotGrassRetention = Phaser.Math.Linear(0.18, 0.68, shootT);

    // 3. Defensa (10..50) -> Masa corporal (0.45 a 3.2), fuerza de empuje (0.45x a 1.85x) y resistencia al retroceso
    const defT = curve(this.stats.defense);
    this.defenseImpactMultiplier = Phaser.Math.Linear(0.45, 1.85, defT);
    this.knockbackResistance = Phaser.Math.Linear(0.35, 1.8, defT);
    const bodyMass = Phaser.Math.Linear(0.45, 3.2, defT);

    // 4. Técnica (10..50) -> Radio de toque (22 a 58px), conducción (0.72x a 0.98x), giro (0.16 a 0.34) y dispersión angular (±9° a 0°)
    const techT = curve(this.stats.technique);
    this.touchRadius = Phaser.Math.Linear(22, 58, norm(this.stats.technique));
    this.controlConeRad = Phaser.Math.DegToRad(
      Phaser.Math.Linear(38, 95, norm(this.stats.technique))
    );
    this.dribbleSpeedMultiplier = Phaser.Math.Linear(0.72, 0.98, techT);
    this.turnSpeed = Phaser.Math.Linear(0.16, 0.34, norm(this.stats.technique));
    this.kickSpreadRad = Phaser.Math.DegToRad(
      Phaser.Math.Linear(9, 0, Math.pow(norm(this.stats.technique), 0.85))
    );

    // 5. Ataque (10..50) -> Enfriamiento entre patadas (900ms a 90ms), rapidez de carga (950ms a 240ms) y velocidad de pase ofensivo
    const atkT = curve(this.stats.attack);
    this.kickCooldownMs = Phaser.Math.Linear(900, 90, atkT);
    this.maxChargeMs = Phaser.Math.Linear(950, 240, atkT);
    this.attackPassBoost = Phaser.Math.Linear(0.85, 1.22, atkT);

    const prefix = config.team === 'blue' ? 'player_blue' : 'player_red';

    // 1. Aro indicador debajo del jugador
    this.selectionRing = config.scene.add.graphics();
    this.drawSelectionRing();
    this.add(this.selectionRing);

    // 2. Contenedor rotatorio del cuerpo (orientación 360°)
    this.bodyGroup = config.scene.add.container(0, 0);
    this.bodyGroup.setScale(1.2);

    this.leftFoot = config.scene.add.image(0, -6, `${prefix}_foot`);
    this.rightFoot = config.scene.add.image(0, 6, `${prefix}_foot`);
    this.leftArm = config.scene.add.image(0, -11, `${prefix}_arm`);
    this.rightArm = config.scene.add.image(0, 11, `${prefix}_arm`);
    this.torso = config.scene.add.image(0, 0, `${prefix}_body`);

    this.bodyGroup.add([
      this.leftFoot,
      this.rightFoot,
      this.leftArm,
      this.rightArm,
      this.torso
    ]);
    this.bodyGroup.setRotation(this.facingAngle);
    this.selectionRing.setRotation(this.facingAngle);
    this.add(this.bodyGroup);

    // 3. Etiqueta con el nombre del jugador en cancha, barra de potencia y etiqueta de acción
    this.nameLabelText = config.scene.add
      .text(0, -28, this.playerName, {
        fontFamily: 'sans-serif',
        fontSize: '12px',
        fontStyle: 'bold',
        color: this.team === 'blue' ? '#fef08a' : '#fecaca',
        stroke: '#0f172a',
        strokeThickness: 3,
        padding: { x: 4, y: 1 }
      })
      .setOrigin(0.5);

    this.powerBarGraphics = config.scene.add.graphics();
    this.actionLabelText = config.scene.add
      .text(0, -54, '', {
        fontFamily: 'sans-serif',
        fontSize: '11px',
        fontStyle: 'bold',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 3
      })
      .setOrigin(0.5)
      .setVisible(false);

    this.add([this.nameLabelText, this.powerBarGraphics, this.actionLabelText]);

    config.scene.add.existing(this);
    config.scene.physics.add.existing(this);

    const radius = 14;
    this.body.setCircle(radius, -radius, -radius);
    this.body.setCollideWorldBounds(true);
    this.body.setMass(bodyMass);

    // 4. Inicializar Máquina de Estados (FSM)
    this.fsm = new StateMachine<Player, PlayerStateName>(this);
    this.setupStates();
    this.fsm.setState('IDLE');
  }

  private setupStates(): void {
    this.fsm
      // ESTADO 1: IDLE (Sin balón, detenido)
      .addState('IDLE', {
        name: 'IDLE',
        onEnter: (p) => {
          p.setPowerBar(0);
        },
        onUpdate: (p, delta) => {
          p.applyLocomotion(delta, 1.0);
          p.animateLimbs(delta);

          if (p.hasBallPossession()) {
            p.fsm.setState(p.isMovingInput() ? 'DRIBBLING_MOVE' : 'DRIBBLING_IDLE');
            return;
          }
          if (p.currentMoveRequest && p.canKickBallNow()) {
            p.startCharging(p.currentMoveRequest);
            return;
          }
          if (p.isMovingInput()) {
            p.fsm.setState('MOVING');
          }
        }
      })

      // ESTADO 2: MOVING (Sin balón, corriendo en 360°)
      .addState('MOVING', {
        name: 'MOVING',
        onEnter: (p) => {
          p.setPowerBar(0);
        },
        onUpdate: (p, delta) => {
          p.applyLocomotion(delta, 1.0);
          p.animateLimbs(delta);

          if (p.hasBallPossession()) {
            p.fsm.setState(p.isMovingInput() ? 'DRIBBLING_MOVE' : 'DRIBBLING_IDLE');
            return;
          }
          if (p.currentMoveRequest && p.canKickBallNow()) {
            p.startCharging(p.currentMoveRequest);
            return;
          }
          if (!p.isMovingInput() && p.body.velocity.length() < 6) {
            p.fsm.setState('IDLE');
          }
        }
      })

      // ESTADO 3: DRIBBLING_IDLE (Con balón en los pies, detenido)
      .addState('DRIBBLING_IDLE', {
        name: 'DRIBBLING_IDLE',
        onEnter: (p) => {
          p.setPowerBar(0);
        },
        onUpdate: (p, delta) => {
          p.applyLocomotion(delta, p.dribbleSpeedMultiplier);
          p.animateLimbs(delta);

          if (!p.hasBallPossession()) {
            p.fsm.setState(p.isMovingInput() ? 'MOVING' : 'IDLE');
            return;
          }
          if (p.currentMoveRequest && p.isKickCooldownReady()) {
            p.startCharging(p.currentMoveRequest);
            return;
          }
          if (p.isMovingInput()) {
            p.fsm.setState('DRIBBLING_MOVE');
          }
        }
      })

      // ESTADO 4: DRIBBLING_MOVE (Conduciendo el balón en movimiento 360°)
      .addState('DRIBBLING_MOVE', {
        name: 'DRIBBLING_MOVE',
        onEnter: (p) => {
          p.setPowerBar(0);
        },
        onUpdate: (p, delta) => {
          p.applyLocomotion(delta, p.dribbleSpeedMultiplier);
          p.animateLimbs(delta);

          if (!p.hasBallPossession()) {
            p.fsm.setState(p.isMovingInput() ? 'MOVING' : 'IDLE');
            return;
          }
          // Si presiona pase o tiro mientras va caminando/corriendo, entra a CHARGING sin frenarse
          if (p.currentMoveRequest && p.isKickCooldownReady()) {
            p.startCharging(p.currentMoveRequest);
            return;
          }
          if (!p.isMovingInput() && p.body.velocity.length() < 6) {
            p.fsm.setState('DRIBBLING_IDLE');
          }
        }
      })

      // ESTADO 5: CHARGING (Cargando barra de potencia mientras camina o está quieto)
      .addState('CHARGING', {
        name: 'CHARGING',
        onEnter: (p) => {
          p.chargeTimeMs = 0;
        },
        onUpdate: (p, delta) => {
          // El jugador puede seguir moviéndose y orientando el ángulo 360° mientras carga el pase/tiro
          p.applyLocomotion(delta, p.dribbleSpeedMultiplier);
          p.animateLimbs(delta);

          if (!p.canKickBallNow()) {
            p.setPowerBar(0);
            p.fsm.setState(p.isMovingInput() ? 'MOVING' : 'IDLE');
            return;
          }

          p.chargeTimeMs += delta;
          const powerRatio = Phaser.Math.Clamp(p.chargeTimeMs / p.maxChargeMs, 0.15, 1);
          p.setPowerBar(powerRatio, p.chargingMoveLabel);

          const stillHoldingSameMove =
            p.currentMoveRequest !== null &&
            p.currentMoveRequest.type === p.chargingMoveType &&
            p.currentMoveRequest.isHolding;

          // Si suelta el botón o llega al 100% de carga, transiciona a KICKING y ejecuta el movimiento
          if (!stillHoldingSameMove || p.chargeTimeMs >= p.maxChargeMs) {
            p.lockedPowerRatio = powerRatio;
            p.fsm.setState('KICKING');
          }
        },
        onExit: (p) => {
          p.setPowerBar(0);
        }
      })

      // ESTADO 6: KICKING (Golpeo efectivo del balón + animación de patada + inicio de cooldown de Ataque)
      .addState('KICKING', {
        name: 'KICKING',
        onEnter: (p) => {
          p.kickAnimTimer = 180;
          p.kickCooldownTimer = p.kickCooldownMs;
          if (p.activeBall) {
            p.activeBall.executeMoveFromPlayer(p, p.chargingMoveType, p.lockedPowerRatio);
          }
          p.currentMoveRequest = null;
        },
        onUpdate: (p, delta) => {
          p.applyLocomotion(delta, 1.0);
          p.kickAnimTimer = Math.max(0, p.kickAnimTimer - delta);

          // Animación de extensión de pierna de golpeo
          const kickProgress = Math.sin((p.kickAnimTimer / 180) * Math.PI);
          p.rightFoot.x = 12 * kickProgress;
          p.leftFoot.x = -4 * kickProgress;
          p.leftArm.x = 6 * kickProgress;
          p.rightArm.x = -6 * kickProgress;

          if (p.kickAnimTimer <= 0) {
            p.fsm.setState(p.isMovingInput() ? 'MOVING' : 'IDLE');
          }
        }
      });
  }

  private startCharging(req: PendingMoveRequest): void {
    this.chargingMoveType = req.type;
    this.chargingMoveLabel = req.label;
    this.fsm.setState('CHARGING');
  }

  public isKickCooldownReady(): boolean {
    return this.kickCooldownTimer <= 0;
  }

  public hasBallPossession(): boolean {
    return this.activeBall !== null && this.activeBall.owner === this;
  }

  public canKickBallNow(): boolean {
    if (!this.activeBall || !this.isKickCooldownReady()) return false;
    if (this.activeBall.owner === this) return true;
    const dist = Phaser.Math.Distance.Between(
      this.x,
      this.y,
      this.activeBall.x,
      this.activeBall.y
    );
    return dist <= this.touchRadius && !this.activeBall.isHighInAir();
  }

  private isMovingInput(): boolean {
    return this.currentInputVector.length() > 0.02;
  }

  private drawSelectionRing(): void {
    this.selectionRing.clear();
    if (!this.isControlled) return;

    const ringColor = this.team === 'blue' ? 0xfacc15 : 0xf87171;
    const touchColor = this.team === 'blue' ? 0x38bdf8 : 0xfb7185;

    // Anillo sutil exterior que refleja el radio de alcance/toque (Técnica)
    this.selectionRing.lineStyle(1.5, touchColor, 0.32);
    this.selectionRing.strokeCircle(0, 0, this.touchRadius);

    this.selectionRing.fillStyle(0x000000, 0.22);
    this.selectionRing.fillCircle(0, 2, 16);

    this.selectionRing.lineStyle(2.5, ringColor, 0.95);
    this.selectionRing.strokeCircle(0, 0, 20);

    this.selectionRing.fillStyle(ringColor, 0.95);
    this.selectionRing.fillTriangle(26, 0, 19, -5, 19, 5);
  }

  public setPowerBar(ratio: number, label: string = ''): void {
    this.powerBarGraphics.clear();

    if (ratio <= 0) {
      this.actionLabelText.setVisible(false);
      return;
    }

    const clamped = Phaser.Math.Clamp(ratio, 0, 1);
    const barWidth = 42;
    const barHeight = 6;
    const x = -barWidth / 2;
    const y = -43;

    this.powerBarGraphics.fillStyle(0x111827, 0.85);
    this.powerBarGraphics.fillRect(x - 1, y - 1, barWidth + 2, barHeight + 2);

    let fillColor = 0x22c55e;
    if (clamped > 0.75) {
      fillColor = 0xef4444;
    } else if (clamped > 0.4) {
      fillColor = 0xfacc15;
    }

    this.powerBarGraphics.fillStyle(fillColor, 1);
    this.powerBarGraphics.fillRect(x, y, barWidth * clamped, barHeight);

    if (label) {
      this.actionLabelText.setText(label);
      this.actionLabelText.setVisible(true);
    } else {
      this.actionLabelText.setVisible(false);
    }
  }

  private applyLocomotion(_delta: number, speedMultiplier: number): void {
    if (this.stunTimer > 0) {
      // Mientras está aturdido o desestabilizado por el placaje, prevalece la inercia del choque
      const newVx = Phaser.Math.Linear(this.body.velocity.x, 0, this.decelRate * 0.7);
      const newVy = Phaser.Math.Linear(this.body.velocity.y, 0, this.decelRate * 0.7);
      this.body.setVelocity(newVx, newVy);
      this.bodyGroup.setRotation(this.facingAngle);
      this.selectionRing.setRotation(this.facingAngle);
      return;
    }

    const magnitude = Phaser.Math.Clamp(this.currentInputVector.length(), 0, 1);
    const effectiveMaxSpeed = this.maxSpeed * speedMultiplier;

    if (magnitude > 0.02) {
      const targetAngle = Math.atan2(this.currentInputVector.y, this.currentInputVector.x);
      const targetVx = Math.cos(targetAngle) * effectiveMaxSpeed * magnitude;
      const targetVy = Math.sin(targetAngle) * effectiveMaxSpeed * magnitude;

      const newVx = Phaser.Math.Linear(this.body.velocity.x, targetVx, this.accelRate);
      const newVy = Phaser.Math.Linear(this.body.velocity.y, targetVy, this.accelRate);
      this.body.setVelocity(newVx, newVy);

      this.facingAngle = Phaser.Math.Angle.RotateTo(
        this.facingAngle,
        targetAngle,
        this.turnSpeed
      );
    } else {
      const newVx = Phaser.Math.Linear(this.body.velocity.x, 0, this.decelRate);
      const newVy = Phaser.Math.Linear(this.body.velocity.y, 0, this.decelRate);
      if (Math.hypot(newVx, newVy) < 4) {
        this.body.setVelocity(0, 0);
      } else {
        this.body.setVelocity(newVx, newVy);
      }
    }

    this.bodyGroup.setRotation(this.facingAngle);
    this.selectionRing.setRotation(this.facingAngle);
  }

  private animateLimbs(delta: number): void {
    const currentSpeed = this.body.velocity.length();
    if (currentSpeed > 8) {
      const speedRatio = currentSpeed / this.maxSpeed;
      this.walkCycle += (delta / 1000) * (10 + speedRatio * 10);

      const swing = Math.sin(this.walkCycle);
      this.leftFoot.x = swing * 7;
      this.rightFoot.x = -swing * 7;

      this.leftArm.x = -swing * 5;
      this.rightArm.x = swing * 5;
      this.leftArm.rotation = -swing * 0.25;
      this.rightArm.rotation = swing * 0.25;
    } else {
      this.leftFoot.x = Phaser.Math.Linear(this.leftFoot.x, 0, 0.2);
      this.rightFoot.x = Phaser.Math.Linear(this.rightFoot.x, 0, 0.2);
      this.leftArm.x = Phaser.Math.Linear(this.leftArm.x, 0, 0.2);
      this.rightArm.x = Phaser.Math.Linear(this.rightArm.x, 0, 0.2);
      this.leftArm.rotation = Phaser.Math.Linear(this.leftArm.rotation, 0, 0.2);
      this.rightArm.rotation = Phaser.Math.Linear(this.rightArm.rotation, 0, 0.2);
    }
  }

  public updatePlayer(
    inputVector: Phaser.Math.Vector2,
    ball: Ball,
    moveRequest: PendingMoveRequest | null,
    delta: number
  ): void {
    if (this.kickCooldownTimer > 0) {
      this.kickCooldownTimer = Math.max(0, this.kickCooldownTimer - delta);
    }
    if (this.tackleCooldownTimer > 0) {
      this.tackleCooldownTimer = Math.max(0, this.tackleCooldownTimer - delta);
    }
    if (this.tackleImmunityTimer > 0) {
      this.tackleImmunityTimer = Math.max(0, this.tackleImmunityTimer - delta);
    }
    if (this.stunTimer > 0) {
      this.stunTimer = Math.max(0, this.stunTimer - delta);
      if (this.stunTimer <= 0) {
        this.torso.clearTint();
        this.leftFoot.clearTint();
        this.rightFoot.clearTint();
      }
    }
    this.currentInputVector.copy(inputVector);
    this.activeBall = ball;
    this.currentMoveRequest = moveRequest;
    this.fsm.update(delta);
  }

  public getFacingAngle(): number {
    return this.facingAngle;
  }

  public resetToPosition(x: number, y: number, facingAngle: number): void {
    this.setPosition(x, y);
    this.body.reset(x, y);
    this.body.setVelocity(0, 0);
    this.facingAngle = facingAngle;
    this.bodyGroup.setRotation(this.facingAngle);
    this.selectionRing.setRotation(this.facingAngle);
    this.setPowerBar(0);
    this.tackleCooldownTimer = 0;
    this.tackleImmunityTimer = 0;
    this.stunTimer = 0;
    this.torso.clearTint();
    this.leftFoot.clearTint();
    this.rightFoot.clearTint();
    this.fsm.setState('IDLE');
  }

  public canTackle(): boolean {
    return this.tackleCooldownTimer <= 0 && this.stunTimer <= 0;
  }

  public isTackleImmune(): boolean {
    return this.tackleImmunityTimer > 0;
  }

  public isStunned(): boolean {
    return this.stunTimer > 0;
  }

  public triggerTackleCooldown(cooldownMs: number = 1200): void {
    this.tackleCooldownTimer = cooldownMs;
  }

  public triggerTackleImmunity(durationMs: number = 380): void {
    this.tackleImmunityTimer = durationMs;
  }

  public applyStun(durationMs: number, tintColor: number = 0xef4444): void {
    this.stunTimer = durationMs;
    this.stunColor = tintColor;
    this.torso.setTint(tintColor);
    this.leftFoot.setTint(tintColor);
    this.rightFoot.setTint(tintColor);
  }

  public getStunColor(): number {
    return this.stunColor;
  }

  public getWalkCycle(): number {
    return this.walkCycle;
  }

  public getKickPowerMultiplier(): number {
    return this.kickPowerMultiplier;
  }

  public getShotGrassRetention(): number {
    return this.shotGrassRetention;
  }

  public getDefenseImpactMultiplier(): number {
    return this.defenseImpactMultiplier;
  }

  public getKnockbackResistance(): number {
    return this.knockbackResistance;
  }

  public getTouchRadius(): number {
    return this.touchRadius;
  }

  public getControlConeRad(): number {
    return this.controlConeRad;
  }

  public getKickSpreadRad(): number {
    return this.kickSpreadRad;
  }

  public getAttackPassBoost(): number {
    return this.attackPassBoost;
  }

  public getKickCooldownRemainingMs(): number {
    return this.kickCooldownTimer;
  }

  public getPowerBarState(): { ratio: number; label: string } {
    if (!this.fsm.isInState('CHARGING')) {
      return { ratio: 0, label: '' };
    }
    const ratio = Phaser.Math.Clamp(this.chargeTimeMs / this.maxChargeMs, 0.15, 1);
    return { ratio, label: this.chargingMoveLabel };
  }

  /**
   * Renderizado e interpolación suave en el Cliente a partir de los datos autoritativos del Host
   */
  public syncRemoteVisuals(
    sync: {
      x: number;
      y: number;
      vx: number;
      vy: number;
      angle: number;
      state: string;
      powerRatio: number;
      powerLabel: string;
      isStunned?: boolean;
      stunColor?: number;
    },
    delta: number,
    lerpFactor: number
  ): void {
    const dist = Phaser.Math.Distance.Between(this.x, this.y, sync.x, sync.y);
    const nx = dist > 140 ? sync.x : Phaser.Math.Linear(this.x, sync.x, lerpFactor);
    const ny = dist > 140 ? sync.y : Phaser.Math.Linear(this.y, sync.y, lerpFactor);

    this.setPosition(nx, ny);
    this.body.reset(nx, ny);
    this.body.setVelocity(sync.vx, sync.vy);

    this.facingAngle = Phaser.Math.Angle.RotateTo(
      this.facingAngle,
      sync.angle,
      Math.max(0.28, lerpFactor)
    );
    this.bodyGroup.setRotation(this.facingAngle);
    this.selectionRing.setRotation(this.facingAngle);

    this.setPowerBar(sync.powerRatio, sync.powerLabel);

    if (sync.isStunned) {
      this.applyStun(160, sync.stunColor ?? 0xef4444);
    } else if (this.stunTimer > 0) {
      this.stunTimer = 0;
      this.torso.clearTint();
      this.leftFoot.clearTint();
      this.rightFoot.clearTint();
    }

    if (sync.state === 'KICKING') {
      this.kickAnimTimer = 140;
    }

    if (this.kickAnimTimer > 0) {
      this.kickAnimTimer = Math.max(0, this.kickAnimTimer - delta);
      const kickProgress = Math.sin((this.kickAnimTimer / 140) * Math.PI);
      this.rightFoot.x = 12 * kickProgress;
      this.leftFoot.x = -4 * kickProgress;
      this.leftArm.x = 6 * kickProgress;
      this.rightArm.x = -6 * kickProgress;
    } else {
      this.animateLimbs(delta);
    }
  }
}
