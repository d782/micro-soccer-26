import Phaser from 'phaser';
import { Pitch } from '../objects/Pitch';
import {
  Player,
  PendingMoveRequest,
  PlayerStats,
  DEFAULT_PLAYER_STATS
} from '../objects/Player';
import { Ball, MoveType } from '../objects/Ball';
import { StateMachine } from '../fsm/StateMachine';
import {
  peerManager,
  LobbyPlayerProfile,
  RemoteInputPayload,
  MatchSyncPayload,
  AuthoritativePlayerSync,
  TackleSyncEvent
} from '../network/PeerManager';

export type MatchStateName = 'PLAYING' | 'GOAL_CELEBRATION' | 'FULL_TIME';

interface MoveBinding {
  type: MoveType;
  label: string;
  keys: Phaser.Input.Keyboard.Key[];
  wasDown: boolean;
  isTouchDown: boolean;
  activeTouchPointers: Set<number>;
}

interface TouchActionButtonUI {
  type: MoveType;
  container: Phaser.GameObjects.Container;
  bgCircle: Phaser.GameObjects.Graphics;
  radius: number;
  color: number;
  activePointers: Set<number>;
}

interface DirectionalKeySet {
  up: Phaser.Input.Keyboard.Key[];
  down: Phaser.Input.Keyboard.Key[];
  left: Phaser.Input.Keyboard.Key[];
  right: Phaser.Input.Keyboard.Key[];
}

interface PlayerControllerState {
  peerId: string;
  player: Player;
  moveKeys?: DirectionalKeySet;
  bindings: MoveBinding[];
  smoothVector: Phaser.Math.Vector2;
  analogVector: Phaser.Math.Vector2;
  activeMoveRequest: PendingMoveRequest | null;
  bufferedMove: { type: MoveType; label: string; timerMs: number } | null;
  spawnX: number;
  spawnY: number;
  spawnAngle: number;
}

export class MainScene extends Phaser.Scene {
  public pitch!: Pitch;
  private controllers: PlayerControllerState[] = [];
  private controllersByPeerId: Map<string, PlayerControllerState> = new Map();
  private matchProfiles: LobbyPlayerProfile[] = [];
  private ball!: Ball;

  private player1Stats: PlayerStats = { ...DEFAULT_PLAYER_STATS };
  private player2Stats: PlayerStats = { ...DEFAULT_PLAYER_STATS };
  private player1Name = 'JUGADOR 1';
  private player2Name = 'JUGADOR 2';

  // Máquina de estados del partido, marcador y temporizador (3 minutos = 180,000 ms)
  public matchFsm!: StateMachine<MainScene, MatchStateName>;
  private readonly matchDurationMs = 3 * 60 * 1000;
  private remainingTimeMs = this.matchDurationMs;

  private tackleEventSeq = 0;
  private lastTackleSync: TackleSyncEvent | null = null;
  private lastHandledTackleSeq = 0;
  private celebrationTimer?: Phaser.Time.TimerEvent;

  private blueScore = 0;
  private redScore = 0;
  private lastGoalScoringTeam: 'blue' | 'red' | null = null;

  private blueScoreText!: Phaser.GameObjects.Text;
  private redScoreText!: Phaser.GameObjects.Text;
  private timerText!: Phaser.GameObjects.Text;
  private goalBannerText!: Phaser.GameObjects.Text;
  private fsmStatusText!: Phaser.GameObjects.Text;

  // Detección de dispositivo móvil vs PC
  private isMobile = false;
  private cameraMode: 'cancha' | 'accion' = 'cancha';
  private camTarget = new Phaser.Math.Vector2(640, 360);

  // Joystick virtual analógico (Multi-touch independiente en mitad izquierda) y botonera táctil derecha (solo en móviles)
  private isPointerDown = false;
  private stickPointerId: number | null = null;
  private readonly stickDefaultPos = new Phaser.Math.Vector2(150, 545);
  private stickOrigin = new Phaser.Math.Vector2(150, 545);
  private stickCurrent = new Phaser.Math.Vector2(150, 545);
  private readonly stickMaxRadius = 65;
  private stickGraphics!: Phaser.GameObjects.Graphics;
  private touchActionButtons: TouchActionButtonUI[] = [];

  // Estado de red para arquitectura Host-Authoritative (soporta de 2 hasta 8 jugadores: 1v1, 2v1, 3v2, 4v4)
  private guestInputsByPeerId: Map<string, RemoteInputPayload> = new Map();
  private latestHostSync: MatchSyncPayload | null = null;
  private inputSeq = 0;
  private lastHostTickTime = 0;
  private hostBackgroundTimer: number | null = null;

  constructor() {
    super('MainScene');
  }

  init(data?: {
    matchPlayers?: LobbyPlayerProfile[];
    playerStats?: PlayerStats;
    player2Stats?: PlayerStats;
    playerName?: string;
    player2Name?: string;
  }): void {
    const regStats = this.registry.get('playerStats') as PlayerStats | undefined;
    if (data?.playerStats) {
      this.player1Stats = { ...data.playerStats };
    } else if (regStats) {
      this.player1Stats = { ...regStats };
    } else {
      this.player1Stats = { ...DEFAULT_PLAYER_STATS };
    }

    this.player2Stats = data?.player2Stats
      ? { ...data.player2Stats }
      : { ...this.player1Stats };

    const regName = this.registry.get('playerName') as string | undefined;
    this.player1Name = (data?.playerName ?? regName ?? 'JUGADOR 1').trim() || 'JUGADOR 1';
    this.player2Name = (data?.player2Name ?? 'JUGADOR 2').trim() || 'JUGADOR 2';

    const roomList = data?.matchPlayers ?? peerManager.getPlayersList();
    if (roomList && roomList.length >= 2) {
      this.matchProfiles = roomList.map((p) => ({
        ...p,
        stats: { ...p.stats }
      }));
    } else {
      this.matchProfiles = [
        {
          peerId: peerManager.localPeerId || 'local-player-1',
          name: this.player1Name,
          team: 'blue',
          stats: { ...this.player1Stats },
          isHost: true,
          isReady: true
        },
        {
          peerId: 'local-player-2',
          name: this.player2Name,
          team: 'red',
          stats: { ...this.player2Stats },
          isHost: false,
          isReady: true
        }
      ];
    }
  }

  create(): void {
    this.cameras.main.fadeIn(250, 15, 23, 42);

    const menuMusic = this.sound.get('menu_music');
    if (menuMusic && menuMusic.isPlaying) {
      menuMusic.stop();
    }

    this.remainingTimeMs = this.matchDurationMs;
    this.blueScore = 0;
    this.redScore = 0;
    this.lastGoalScoringTeam = null;
    this.isPointerDown = false;
    this.stickPointerId = null;
    this.stickOrigin.copy(this.stickDefaultPos);
    this.stickCurrent.copy(this.stickDefaultPos);
    this.touchActionButtons = [];
    this.controllers = [];
    this.controllersByPeerId.clear();
    this.guestInputsByPeerId.clear();

    // Detección: solo activar punteros multitáctiles y controles en pantalla si es un dispositivo móvil real
    this.isMobile = this.checkIsMobileDevice();
    if (this.isMobile) {
      this.input.addPointer(3);
    }

    // 1. Crear y renderizar la cancha
    this.pitch = new Pitch(this, {
      x: 64,
      y: 60,
      width: 1152,
      height: 600,
      stripeWidth: 64,
      goalWidth: 140,
      goalDepth: 44
    });

    this.pitch.render();

    this.physics.world.setBounds(
      this.pitch.leftGoalBounds.left,
      this.pitch.bounds.y,
      this.pitch.bounds.width + this.pitch.leftGoalBounds.width * 2,
      this.pitch.bounds.height
    );

    // 2. Instanciar a todos los jugadores de la sala (de 2 a 8 jugadores: 1v1, 2v1, 2v2, 3v2, hasta 4v4)
    const blueProfiles = this.matchProfiles.filter((p) => p.team === 'blue');
    const redProfiles = this.matchProfiles.filter((p) => p.team === 'red');
    const localId = peerManager.localPeerId || this.matchProfiles[0]?.peerId;

    const spawnGroup = (profiles: LobbyPlayerProfile[], team: 'blue' | 'red') => {
      profiles.forEach((prof, idx) => {
        const pos = this.getFormationSpawnPosition(team, idx, profiles.length);
        const facingAngle = team === 'blue' ? 0 : Math.PI;
        const isLocalPlayer = prof.peerId === localId;

        const playerInstance = new Player({
          scene: this,
          x: pos.x,
          y: pos.y,
          team,
          isControlled: isLocalPlayer,
          stats: prof.stats,
          name: prof.name,
          initialFacingAngle: facingAngle
        });
        playerInstance.setDepth(5);

        const ctrl: PlayerControllerState = {
          peerId: prof.peerId,
          player: playerInstance,
          bindings: [],
          smoothVector: new Phaser.Math.Vector2(0, 0),
          analogVector: new Phaser.Math.Vector2(0, 0),
          activeMoveRequest: null,
          bufferedMove: null,
          spawnX: pos.x,
          spawnY: pos.y,
          spawnAngle: facingAngle
        };

        this.controllers.push(ctrl);
        this.controllersByPeerId.set(prof.peerId, ctrl);
      });
    };

    spawnGroup(blueProfiles, 'blue');
    spawnGroup(redProfiles, 'red');

    this.ball = new Ball(this, this.pitch.centerSpot.x, this.pitch.centerSpot.y, this.pitch);

    // 3. Configurar esquema de controles unificado para el jugador local de este navegador
    this.setupLocalPlayerControls();

    // 4. Colisiones con bandas, postes, redes, balón y choques cuerpo a cuerpo entre los N jugadores
    const allPlayers = this.controllers.map((c) => c.player);
    for (const p of allPlayers) {
      this.physics.add.collider(p, this.pitch.wallsGroup);
      this.physics.add.collider(p, this.pitch.netsGroup);
      this.physics.add.collider(p, this.pitch.postsGroup);

      // Colisión Jugador <-> Balón gobernada por la Máquina de Estados y los atributos de cada jugador
      this.physics.add.collider(
        p,
        this.ball,
        () => {
          this.handlePhysicalBounce(p);
        },
        () => {
          return this.shouldBouncePhysically(p);
        },
        this
      );
    }

    // Choques físicos cuerpo a cuerpo entre todos los pares de jugadores en cancha (hasta 8 jugadores)
    for (let i = 0; i < allPlayers.length; i++) {
      for (let j = i + 1; j < allPlayers.length; j++) {
        const pA = allPlayers[i];
        const pB = allPlayers[j];
        this.physics.add.collider(pA, pB, () => {
          this.handlePlayersBodyClash(pA, pB);
        });
      }
    }

    this.physics.add.collider(this.ball, this.pitch.wallsGroup);
    this.physics.add.collider(this.ball, this.pitch.postsGroup, (_ballObj, postObj) => {
      this.ball.onHitPost(postObj as Phaser.GameObjects.GameObject);
    });
    // Travesaño físico: actúa como barrera sólida e impenetrable cuando el balón está en estado aéreo (ball.isAirborne === true)
    this.physics.add.collider(
      this.ball,
      this.pitch.crossbarsGroup,
      (_ballObj, crossbarObj) => {
        const cbZone = crossbarObj as Phaser.GameObjects.Zone;
        const side = cbZone.x < this.pitch.centerSpot.x ? 'left' : 'right';
        this.ball.onHitCrossbar(side);
      },
      () => {
        return this.ball.isAirborne;
      },
      this
    );
    this.physics.add.collider(this.ball, this.pitch.netsGroup, () => {
      this.ball.onHitNet();
    });

    // Sensores internos de gol: sólo activan gol cuando el balón ingresó por la boca frontal del arco
    this.physics.add.overlap(this.ball, this.pitch.leftGoalSensorZone, () => {
      this.onGoalSensorTriggered('left');
    });
    this.physics.add.overlap(this.ball, this.pitch.rightGoalSensorZone, () => {
      this.onGoalSensorTriggered('right');
    });

    // Joystick analógico virtual multitáctil + Botonera táctil derecha (SOLO en dispositivos móviles)
    this.stickGraphics = this.add.graphics().setDepth(100);

    if (this.isMobile) {
      this.createMobileActionButtons();

      this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
        if (this.matchFsm?.isInState('FULL_TIME')) return;
        // Solo activar la palanca de movimiento si el toque ocurre en la mitad izquierda y no hay otro dedo ya en la palanca
        if (pointer.x < this.scale.width * 0.52 && this.stickPointerId === null) {
          this.stickPointerId = pointer.id;
          this.isPointerDown = true;
          this.stickOrigin.set(pointer.x, pointer.y);
          this.stickCurrent.set(pointer.x, pointer.y);
        }
      });

      this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
        if (this.isPointerDown && pointer.id === this.stickPointerId) {
          this.stickCurrent.set(pointer.x, pointer.y);
        }
      });

      const releasePointer = (pointer: Phaser.Input.Pointer) => {
        if (pointer.id === this.stickPointerId) {
          this.isPointerDown = false;
          this.stickPointerId = null;
          this.stickOrigin.copy(this.stickDefaultPos);
          this.stickCurrent.copy(this.stickDefaultPos);
        }
        this.releaseTouchActionPointer(pointer.id);
      };

      this.input.on('pointerup', releasePointer);
      this.input.on('pointerupoutside', releasePointer);

      // En móviles ampliamos la vista de la cancha (zoom 1.18x) para eliminar márgenes vacíos y ver jugadores grandes
      this.cameras.main.setZoom(1.18);
      this.cameras.main.centerOn(640, 360);
    } else {
      this.cameras.main.setZoom(1.0);
      this.cameras.main.centerOn(640, 360);
    }

    // 5. HUD: Marcador (AZUL vs ROJO), Temporizador de partido (3:00), controles unificados e indicador FSM
    this.createHud();

    // 6. Inicializar Máquina de Estados del Partido (PLAYING | GOAL_CELEBRATION | FULL_TIME)
    this.setupMatchStateMachine();

    // 7. Sincronización WebRTC P2P de entradas y estado del partido
    this.setupNetworkListeners();
  }

  private isLocalGuest(): boolean {
    return peerManager.isOnlineSession && !peerManager.isHost;
  }

  private getLocalController(): PlayerControllerState {
    const localId = peerManager.localPeerId;
    if (localId && this.controllersByPeerId.has(localId)) {
      return this.controllersByPeerId.get(localId)!;
    }
    return this.controllers[0];
  }

  /**
   * Calcula la formación táctica de cada equipo en su mitad de cancha según cuántos jugadores tenga (1, 2, 3 o 4 jugadores)
   */
  private getFormationSpawnPosition(
    team: 'blue' | 'red',
    indexInTeam: number,
    teamSize: number
  ): { x: number; y: number } {
    const dir = team === 'blue' ? -1 : 1;
    const cx = this.pitch.centerSpot.x;
    const cy = this.pitch.centerSpot.y;

    if (teamSize <= 1) {
      return { x: cx + dir * 140, y: cy };
    }

    if (teamSize === 2) {
      const yOffsets = [-95, 95];
      return {
        x: cx + dir * 145,
        y: cy + yOffsets[indexInTeam % 2]
      };
    }

    if (teamSize === 3) {
      // Formación 2-1: 1 delantero adelantado y 2 defensas/medios abiertos
      const offsets = [
        { dx: 120, dy: 0 },
        { dx: 255, dy: -115 },
        { dx: 255, dy: 115 }
      ];
      const off = offsets[indexInTeam % 3];
      return { x: cx + dir * off.dx, y: cy + off.dy };
    }

    // Formación 2-2 para 4 jugadores (4 vs 4 máximo)
    const offsets4 = [
      { dx: 120, dy: -82 },
      { dx: 120, dy: 82 },
      { dx: 280, dy: -128 },
      { dx: 280, dy: 128 }
    ];
    const off4 = offsets4[indexInTeam % 4];
    return { x: cx + dir * off4.dx, y: cy + off4.dy };
  }

  private setupLocalPlayerControls(): void {
    const localCtrl = this.getLocalController();
    if (!localCtrl) return;

    const kb = this.input.keyboard;
    const KC = Phaser.Input.Keyboard.KeyCodes;

    if (kb) {
      kb.addCapture([
        KC.W,
        KC.A,
        KC.S,
        KC.D,
        KC.UP,
        KC.DOWN,
        KC.LEFT,
        KC.RIGHT,
        KC.SPACE,
        KC.J,
        KC.K,
        KC.L,
        KC.X,
        KC.Z,
        KC.C,
        KC.V,
        KC.ONE,
        KC.TWO,
        KC.THREE,
        KC.FOUR,
        KC.ENTER,
        KC.M,
        KC.NUMPAD_ZERO,
        KC.NUMPAD_ONE,
        KC.NUMPAD_TWO,
        KC.NUMPAD_THREE
      ]);

      const cursors = kb.createCursorKeys();
      localCtrl.moveKeys = {
        up: [kb.addKey(KC.W), cursors.up],
        down: [kb.addKey(KC.S), cursors.down],
        left: [kb.addKey(KC.A), cursors.left],
        right: [kb.addKey(KC.D), cursors.right]
      };
    }

    // Esquema de controles UNIFICADO para teclado + botones táctiles móviles
    localCtrl.bindings = [
      {
        type: 'short_pass',
        label: 'TOQUE CORTO',
        keys: kb
          ? [
              kb.addKey(KC.J),
              kb.addKey(KC.X),
              kb.addKey(KC.ONE),
              kb.addKey(KC.NUMPAD_ONE)
            ]
          : [],
        wasDown: false,
        isTouchDown: false,
        activeTouchPointers: new Set<number>()
      },
      {
        type: 'through_pass',
        label: 'PASE AL VACÍO',
        keys: kb
          ? [
              kb.addKey(KC.K),
              kb.addKey(KC.Z),
              kb.addKey(KC.TWO),
              kb.addKey(KC.NUMPAD_TWO)
            ]
          : [],
        wasDown: false,
        isTouchDown: false,
        activeTouchPointers: new Set<number>()
      },
      {
        type: 'long_pass',
        label: 'PASE LARGO',
        keys: kb
          ? [
              kb.addKey(KC.L),
              kb.addKey(KC.C),
              kb.addKey(KC.THREE),
              kb.addKey(KC.NUMPAD_THREE)
            ]
          : [],
        wasDown: false,
        isTouchDown: false,
        activeTouchPointers: new Set<number>()
      },
      {
        type: 'shoot',
        label: 'TIRO',
        keys: kb
          ? [
              kb.addKey(KC.SPACE),
              kb.addKey(KC.V),
              kb.addKey(KC.FOUR),
              kb.addKey(KC.ENTER),
              kb.addKey(KC.M),
              kb.addKey(KC.NUMPAD_ZERO)
            ]
          : [],
        wasDown: false,
        isTouchDown: false,
        activeTouchPointers: new Set<number>()
      }
    ];
  }

  /**
   * Crea la botonera táctil derecha en formato diamante arcade para dispositivos móviles y pantallas táctiles:
   * - Soporta mantener presionado cualquier botón para cargar la barra de potencia (CHARGING) mientras el pulgar izquierdo mueve al jugador en 360°, y patear al soltar (KICKING).
   */
  private createMobileActionButtons(): void {
    const buttonConfigs: Array<{
      type: MoveType;
      title: string;
      subtitle: string;
      x: number;
      y: number;
      radius: number;
      color: number;
    }> = [
      {
        type: 'short_pass',
        title: 'CORTO',
        subtitle: 'PASE',
        x: 1096,
        y: 614,
        radius: 34,
        color: 0x22c55e
      },
      {
        type: 'through_pass',
        title: 'VACÍO',
        subtitle: 'FILTRAR',
        x: 1020,
        y: 546,
        radius: 34,
        color: 0x38bdf8
      },
      {
        type: 'long_pass',
        title: 'LARGO',
        subtitle: 'GLOBO',
        x: 1096,
        y: 478,
        radius: 34,
        color: 0xfacc15
      },
      {
        type: 'shoot',
        title: 'TIRO',
        subtitle: 'PATEAR',
        x: 1176,
        y: 546,
        radius: 39,
        color: 0xef4444
      }
    ];

    for (const cfg of buttonConfigs) {
      const container = this.add.container(cfg.x, cfg.y).setDepth(100);
      const bgCircle = this.add.graphics();
      this.drawTouchButtonCircle(bgCircle, cfg.radius, cfg.color, false);

      const titleTxt = this.add
        .text(0, -5, cfg.title, {
          fontFamily: 'KenneyFutureNarrow, sans-serif',
          fontSize: cfg.type === 'shoot' ? '14px' : '12px',
          fontStyle: 'bold',
          color: '#ffffff',
          stroke: '#0f172a',
          strokeThickness: 3
        })
        .setOrigin(0.5);

      const subTxt = this.add
        .text(0, 10, cfg.subtitle, {
          fontFamily: 'sans-serif',
          fontSize: '9px',
          fontStyle: 'bold',
          color: '#e2e8f0',
          stroke: '#0f172a',
          strokeThickness: 2
        })
        .setOrigin(0.5);

      // Zona táctil ligeramente ampliada (+8px de radio) para facilitar el toque con el pulgar en móviles
      const hitRadius = cfg.radius + 8;
      const hitZone = this.add
        .zone(0, 0, hitRadius * 2, hitRadius * 2)
        .setInteractive(new Phaser.Geom.Circle(hitRadius, hitRadius, hitRadius), Phaser.Geom.Circle.Contains);

      container.add([bgCircle, titleTxt, subTxt, hitZone]);

      const btnUI: TouchActionButtonUI = {
        type: cfg.type,
        container,
        bgCircle,
        radius: cfg.radius,
        color: cfg.color,
        activePointers: new Set<number>()
      };

      hitZone.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
        if (this.matchFsm?.isInState('FULL_TIME')) return;
        this.pressTouchActionButton(btnUI, pointer.id);
      });

      hitZone.on('pointerup', (pointer: Phaser.Input.Pointer) => {
        this.releaseTouchActionButton(btnUI, pointer.id);
      });

      hitZone.on('pointerout', (pointer: Phaser.Input.Pointer) => {
        this.releaseTouchActionButton(btnUI, pointer.id);
      });

      this.touchActionButtons.push(btnUI);
    }
  }

  private drawTouchButtonCircle(
    g: Phaser.GameObjects.Graphics,
    radius: number,
    color: number,
    isPressed: boolean
  ): void {
    g.clear();
    // Sombra exterior suave
    g.fillStyle(0x0f172a, isPressed ? 0.68 : 0.42);
    g.fillCircle(0, 2, radius + 2);

    // Relleno circular translúcido con el color de la acción
    g.fillStyle(color, isPressed ? 0.92 : 0.56);
    g.fillCircle(0, 0, radius);

    // Borde circular brillante
    g.lineStyle(isPressed ? 3.5 : 2.5, 0xffffff, isPressed ? 1 : 0.78);
    g.strokeCircle(0, 0, radius);
  }

  private pressTouchActionButton(btn: TouchActionButtonUI, pointerId: number): void {
    btn.activePointers.add(pointerId);
    btn.container.setScale(0.92);
    this.drawTouchButtonCircle(btn.bgCircle, btn.radius, btn.color, true);

    const localCtrl = this.getLocalController();
    const binding = localCtrl?.bindings.find((b) => b.type === btn.type);
    if (binding) {
      binding.activeTouchPointers.add(pointerId);
      binding.isTouchDown = true;
    }
  }

  private releaseTouchActionButton(btn: TouchActionButtonUI, pointerId: number): void {
    if (!btn.activePointers.has(pointerId)) return;
    btn.activePointers.delete(pointerId);

    const stillPressed = btn.activePointers.size > 0;
    btn.container.setScale(stillPressed ? 0.92 : 1);
    this.drawTouchButtonCircle(btn.bgCircle, btn.radius, btn.color, stillPressed);

    const localCtrl = this.getLocalController();
    const binding = localCtrl?.bindings.find((b) => b.type === btn.type);
    if (binding) {
      binding.activeTouchPointers.delete(pointerId);
      binding.isTouchDown = binding.activeTouchPointers.size > 0;
    }
  }

  private releaseTouchActionPointer(pointerId: number): void {
    for (const btn of this.touchActionButtons) {
      this.releaseTouchActionButton(btn, pointerId);
    }
  }

  private clearAllTouchActions(): void {
    for (const btn of this.touchActionButtons) {
      btn.activePointers.clear();
      btn.container.setScale(1);
      this.drawTouchButtonCircle(btn.bgCircle, btn.radius, btn.color, false);
    }
    const localCtrl = this.getLocalController();
    if (localCtrl) {
      for (const b of localCtrl.bindings) {
        b.activeTouchPointers.clear();
        b.isTouchDown = false;
      }
    }
  }

  private setupNetworkListeners(): void {
    this.guestInputsByPeerId.clear();
    this.latestHostSync = null;
    this.inputSeq = 0;
    this.lastHostTickTime = performance.now();

    // Evitar que Phaser pause el bucle o congele el audio al cambiar de foco entre navegadores
    this.sound.pauseOnBlur = false;
    this.game.events.off(Phaser.Core.Events.BLUR);
    this.game.events.off(Phaser.Core.Events.HIDDEN);

    // En cualquier Cliente (Invitado), desactivar los cuerpos físicos locales para que Phaser
    // no sobreescriba en postUpdate() las coordenadas autoritativas recibidas del Host
    if (this.isLocalGuest()) {
      for (const ctrl of this.controllers) {
        ctrl.player.body.enable = false;
      }
      this.ball.body.enable = false;
    }

    // 1. RECEPCIÓN DE INPUTS EN EL HOST (Clientes 2..8 -> Host por WebRTC Data Channel)
    const onGuestInput = (input: RemoteInputPayload) => {
      if (!peerManager.isHost) return;
      if (input.peerId) {
        this.guestInputsByPeerId.set(input.peerId, input);
      }
    };

    // 2. RECEPCIÓN DE ESTADO AUTORITATIVO EN LOS CLIENTES (Host -> Clientes por WebRTC Data Channel)
    const onMatchSync = (sync: MatchSyncPayload) => {
      if (peerManager.isHost) return;
      this.latestHostSync = sync;

      if (this.blueScore !== sync.blueScore || this.redScore !== sync.redScore) {
        this.blueScore = sync.blueScore;
        this.redScore = sync.redScore;
        this.blueScoreText.setText(String(this.blueScore));
        this.redScoreText.setText(String(this.redScore));
      }

      this.remainingTimeMs = sync.remainingTimeMs;
      this.updateTimerHud();

      this.lastGoalScoringTeam = sync.lastGoalTeam;
      const currentState = this.matchFsm.getStateName();
      if (sync.matchState && currentState !== sync.matchState) {
        this.matchFsm.setState(sync.matchState);
      }
      if (sync.matchState === 'PLAYING') {
        this.tweens.killTweensOf(this.goalBannerText);
        this.goalBannerText.setVisible(false);
      }

      // Sincronización del evento de placaje (Host -> Guest)
      if (sync.lastTackle && sync.lastTackle.seq !== this.lastHandledTackleSeq) {
        this.lastHandledTackleSeq = sync.lastTackle.seq;
        this.handleRemoteTackleFeedback(sync.lastTackle);
      }
    };

    peerManager.on('guest-input', onGuestInput);
    peerManager.on('match-sync', onMatchSync);

    if (peerManager.isOnlineSession && peerManager.isHost) {
      this.hostBackgroundTimer = window.setInterval(() => {
        const now = performance.now();
        const elapsed = now - this.lastHostTickTime;
        if (elapsed >= 28 && this.scene.isActive()) {
          const dt = Math.min(elapsed, 33.3);
          this.lastHostTickTime = now;
          this.physics.world.update(now, dt);
          this.physics.world.postUpdate();
          this.stepAuthoritativeHost(dt);
        }
      }, 16);
    }

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      peerManager.off('guest-input', onGuestInput);
      peerManager.off('match-sync', onMatchSync);
      if (this.hostBackgroundTimer !== null) {
        window.clearInterval(this.hostBackgroundTimer);
        this.hostBackgroundTimer = null;
      }
    });
  }

  private createHud(): void {
    const bluePanel = this.add
      .nineslice(134, 30, 'ui_panel_blue', undefined, 140, 42, 16, 16, 16, 16)
      .setDepth(30)
      .setAlpha(0.95);
    bluePanel.setOrigin(0.5);

    this.add
      .text(80, 29, 'AZUL', {
        fontFamily: 'KenneyFutureNarrow, sans-serif',
        fontSize: '16px',
        fontStyle: 'bold',
        color: '#e0f2fe',
        stroke: '#0f172a',
        strokeThickness: 3
      })
      .setOrigin(0, 0.5)
      .setDepth(31);

    this.blueScoreText = this.add
      .text(184, 29, '0', {
        fontFamily: 'KenneyFuture, monospace',
        fontSize: '22px',
        fontStyle: 'bold',
        color: '#ffffff',
        stroke: '#0f172a',
        strokeThickness: 4
      })
      .setOrigin(0.5)
      .setDepth(31);

    const timerPanel = this.add
      .nineslice(272, 30, 'ui_panel_grey', undefined, 124, 42, 16, 16, 16, 16)
      .setDepth(30)
      .setAlpha(0.96);
    timerPanel.setOrigin(0.5);

    this.timerText = this.add
      .text(272, 29, this.formatMatchTime(this.remainingTimeMs), {
        fontFamily: 'KenneyFuture, monospace',
        fontSize: '20px',
        fontStyle: 'bold',
        color: '#0f172a',
        stroke: '#ffffff',
        strokeThickness: 3
      })
      .setOrigin(0.5)
      .setDepth(31);

    const redPanel = this.add
      .nineslice(410, 30, 'ui_panel_red', undefined, 140, 42, 16, 16, 16, 16)
      .setDepth(30)
      .setAlpha(0.95);
    redPanel.setOrigin(0.5);

    this.redScoreText = this.add
      .text(360, 29, '0', {
        fontFamily: 'KenneyFuture, monospace',
        fontSize: '22px',
        fontStyle: 'bold',
        color: '#ffffff',
        stroke: '#0f172a',
        strokeThickness: 4
      })
      .setOrigin(0.5)
      .setDepth(31);

    this.add
      .text(464, 29, 'ROJO', {
        fontFamily: 'KenneyFutureNarrow, sans-serif',
        fontSize: '16px',
        fontStyle: 'bold',
        color: '#fee2e2',
        stroke: '#0f172a',
        strokeThickness: 3
      })
      .setOrigin(1, 0.5)
      .setDepth(31);

    if (!this.isMobile) {
      this.add
        .text(
          this.pitch.bounds.right,
          29,
          '[WASD / FLECHAS] Mover  |  [J/X/1] Corto  |  [K/Z/2] Vacío  |  [L/C/3] Largo  |  [ESPACIO/V/4] Tiro',
          {
            fontFamily: 'sans-serif',
            fontSize: '13px',
            fontStyle: 'bold',
            color: '#e2e8f0'
          }
        )
        .setOrigin(1, 0.5)
        .setAlpha(0.95);
    } else {
      // Botón de pantalla completa en móvil para colapsar barras del navegador
      const fsBtn = this.add
        .nineslice(this.pitch.bounds.right - 10, 29, 'ui_panel_grey', undefined, 140, 36, 10, 10, 10, 10)
        .setOrigin(1, 0.5)
        .setDepth(31)
        .setInteractive({ useHandCursor: true });

      const fsTxt = this.add
        .text(this.pitch.bounds.right - 80, 29, '⛶ PANTALLA', {
          fontFamily: 'sans-serif',
          fontSize: '12px',
          fontStyle: 'bold',
          color: '#0f172a'
        })
        .setOrigin(0.5)
        .setDepth(32);

      fsBtn.on('pointerup', () => {
        if (this.scale.isFullscreen) {
          this.scale.stopFullscreen();
          fsTxt.setText('⛶ PANTALLA');
        } else {
          this.scale.startFullscreen();
          fsTxt.setText('✕ SALIR');
        }
      });

      // Botón de cámara (Zoom Cancha Completa 1.18x vs Acción Dinámica 1.38x)
      const camBtn = this.add
        .nineslice(this.pitch.bounds.right - 165, 29, 'ui_panel_grey', undefined, 140, 36, 10, 10, 10, 10)
        .setOrigin(1, 0.5)
        .setDepth(31)
        .setInteractive({ useHandCursor: true });

      const camTxt = this.add
        .text(this.pitch.bounds.right - 235, 29, '🔍 CANCHA', {
          fontFamily: 'sans-serif',
          fontSize: '12px',
          fontStyle: 'bold',
          color: '#0f172a'
        })
        .setOrigin(0.5)
        .setDepth(32);

      camBtn.on('pointerup', () => {
        if (this.cameraMode === 'cancha') {
          this.cameraMode = 'accion';
          this.cameras.main.setZoom(1.38);
          camTxt.setText('🎥 ACCIÓN');
        } else {
          this.cameraMode = 'cancha';
          this.cameras.main.setZoom(1.18);
          this.cameras.main.centerOn(640, 360);
          camTxt.setText('🔍 CANCHA');
        }
      });
    }

    this.fsmStatusText = this.add
      .text(64, 686, '', {
        fontFamily: 'monospace',
        fontSize: '13px',
        fontStyle: 'bold',
        color: '#fef08a',
        backgroundColor: '#111827cc',
        padding: { x: 10, y: 4 }
      })
      .setOrigin(0, 0.5)
      .setDepth(30);

    this.goalBannerText = this.add
      .text(this.scale.width / 2, this.scale.height / 2, '¡GOOOOL!', {
        fontFamily: 'KenneyFuture, sans-serif',
        fontSize: '58px',
        fontStyle: 'bold',
        color: '#facc15',
        stroke: '#111827',
        strokeThickness: 8,
        align: 'center'
      })
      .setOrigin(0.5)
      .setDepth(50)
      .setVisible(false);
  }

  private setupMatchStateMachine(): void {
    this.matchFsm = new StateMachine<MainScene, MatchStateName>(this);

    this.matchFsm
      .addState('PLAYING', {
        name: 'PLAYING',
        onEnter: (scene) => {
          scene.tweens.killTweensOf(scene.goalBannerText);
          scene.goalBannerText.setVisible(false);
        },
        onUpdate: (scene, delta) => {
          scene.remainingTimeMs = Math.max(0, scene.remainingTimeMs - delta);
          scene.updateTimerHud();

          if (scene.remainingTimeMs <= 0) {
            scene.matchFsm.setState('FULL_TIME');
            return;
          }
        }
      })
      .addState('GOAL_CELEBRATION', {
        name: 'GOAL_CELEBRATION',
        onEnter: (scene) => {
          if (scene.cache.audio.exists('goal_sfx')) {
            scene.sound.stopByKey('goal_sfx');
            const goalSfx = scene.sound.add('goal_sfx');
            goalSfx.addMarker({
              name: 'goal_roar',
              start: 0.95,
              duration: 2.4,
              config: { volume: 0.85 }
            });
            goalSfx.play('goal_roar');

            scene.tweens.add({
              targets: goalSfx,
              volume: 0,
              delay: 1800,
              duration: 550,
              onComplete: () => {
                if (goalSfx.isPlaying) {
                  goalSfx.stop();
                }
                goalSfx.destroy();
              }
            });
          }

          if (scene.ball.owner) {
            const owner = scene.ball.owner;
            scene.ball.release(
              owner.body.velocity.x * 0.3,
              owner.body.velocity.y * 0.3,
              0,
              500,
              0.28,
              owner
            );
          }

          const teamLabel = scene.lastGoalScoringTeam === 'red' ? 'ROJO' : 'AZUL';
          const bannerColor = scene.lastGoalScoringTeam === 'red' ? '#f87171' : '#38bdf8';
          scene.goalBannerText.setText(
            `¡GOOOOL ${teamLabel}!\n${scene.blueScore} - ${scene.redScore}`
          );
          scene.goalBannerText.setColor(bannerColor);
          scene.goalBannerText.setVisible(true);
          scene.goalBannerText.setScale(0.5);
          scene.tweens.killTweensOf(scene.goalBannerText);
          scene.tweens.add({
            targets: scene.goalBannerText,
            scale: 1.05,
            duration: 280,
            ease: 'Back.easeOut'
          });

          // Solo la autoridad (Host o modo local) gobierna el reinicio del balón y el regreso a PLAYING
          if (!scene.isLocalGuest()) {
            if (scene.celebrationTimer) {
              scene.celebrationTimer.remove(false);
            }
            scene.celebrationTimer = scene.time.delayedCall(1600, () => {
              if (!scene.matchFsm.isInState('GOAL_CELEBRATION')) return;
              scene.goalBannerText.setVisible(false);
              scene.ball.resetTo(scene.pitch.centerSpot.x, scene.pitch.centerSpot.y);

              // Reposicionar a todos los jugadores en su formación táctica inicial
              for (const ctrl of scene.controllers) {
                ctrl.player.resetToPosition(ctrl.spawnX, ctrl.spawnY, ctrl.spawnAngle);
              }

              scene.matchFsm.setState('PLAYING');
            });
          } else {
            // Salvaguarda en cliente por si hay latencia en el paquete de estado
            scene.time.delayedCall(2200, () => {
              scene.tweens.killTweensOf(scene.goalBannerText);
              scene.goalBannerText.setVisible(false);
            });
          }
        },
        onExit: (scene) => {
          scene.tweens.killTweensOf(scene.goalBannerText);
          scene.goalBannerText.setVisible(false);
          if (scene.celebrationTimer) {
            scene.celebrationTimer.remove(false);
            scene.celebrationTimer = undefined;
          }
        }
      })
      .addState('FULL_TIME', {
        name: 'FULL_TIME',
        onEnter: (scene) => {
          scene.tweens.killTweensOf(scene.goalBannerText);
          scene.goalBannerText.setVisible(false);
          if (scene.celebrationTimer) {
            scene.celebrationTimer.remove(false);
            scene.celebrationTimer = undefined;
          }
          scene.remainingTimeMs = 0;
          scene.updateTimerHud();

          scene.isPointerDown = false;
          scene.stickPointerId = null;
          scene.stickGraphics.clear();
          scene.clearAllTouchActions();

          for (const ctrl of scene.controllers) {
            ctrl.analogVector.set(0, 0);
            ctrl.smoothVector.set(0, 0);
            ctrl.activeMoveRequest = null;
            ctrl.bufferedMove = null;
          }

          if (scene.ball.owner) {
            scene.ball.release(0, 0, 0, 600, 0.2, scene.ball.owner);
          }

          if (scene.cache.audio.exists('ui_click')) {
            scene.sound.play('ui_click', { volume: 0.8 });
          }

          scene.goalBannerText.setText(
            `¡FINAL DEL PARTIDO!\nAZUL ${scene.blueScore} - ${scene.redScore} ROJO`
          );
          scene.goalBannerText.setColor('#fef08a');
          scene.goalBannerText.setVisible(true);
          scene.goalBannerText.setScale(0.5);
          scene.tweens.add({
            targets: scene.goalBannerText,
            scale: 0.95,
            duration: 320,
            ease: 'Back.easeOut'
          });

          scene.time.delayedCall(1800, () => {
            scene.cameras.main.fadeOut(350, 15, 23, 42);
            scene.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
              scene.scene.start('MenuScene');
            });
          });
        }
      });

    this.matchFsm.setState('PLAYING');
  }

  /**
   * Se dispara únicamente cuando el balón colisiona con el sensor interno de la portería
   * habiendo ingresado legítimamente por la boca frontal del arco.
   */
  private onGoalSensorTriggered(goalSide: 'left' | 'right'): void {
    if (!this.matchFsm.isInState('PLAYING')) return;
    // Ignorar el sensor de gol durante el estado aéreo de un Pase Largo (ball.isAirborne === true)
    if (this.ball.isAirborne) return;
    if (this.ball.enteredGoalThroughFront !== goalSide) return;

    // El equipo Azul ataca el arco derecho ('right'); el equipo Rojo ataca el arco izquierdo ('left')
    if (goalSide === 'right') {
      this.blueScore += 1;
      this.lastGoalScoringTeam = 'blue';
    } else {
      this.redScore += 1;
      this.lastGoalScoringTeam = 'red';
    }

    this.updateScoreHud(this.lastGoalScoringTeam);
    this.matchFsm.setState('GOAL_CELEBRATION');
  }

  private updateScoreHud(scoringTeam?: 'blue' | 'red' | null): void {
    this.blueScoreText.setText(String(this.blueScore));
    this.redScoreText.setText(String(this.redScore));

    const targetText =
      scoringTeam === 'red'
        ? this.redScoreText
        : scoringTeam === 'blue'
          ? this.blueScoreText
          : null;
    if (targetText) {
      targetText.setScale(1.45);
      this.tweens.add({
        targets: targetText,
        scale: 1,
        duration: 300,
        ease: 'Back.easeOut'
      });
    }
  }

  private formatMatchTime(ms: number): string {
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const mm = String(minutes).padStart(2, '0');
    const ss = String(seconds).padStart(2, '0');
    return `${mm}:${ss}`;
  }

  private updateTimerHud(): void {
    this.timerText.setText(this.formatMatchTime(this.remainingTimeMs));
    if (this.remainingTimeMs <= 10_000) {
      this.timerText.setColor('#dc2626');
    } else if (this.remainingTimeMs <= 30_000) {
      this.timerText.setColor('#d97706');
    } else {
      this.timerText.setColor('#0f172a');
    }
  }

  /**
   * Evalúa si el contacto entre cualquiera de los dos jugadores y el balón es frontal (conducción)
   * o si debe ejecutarse una intercepción/rebote físico.
   */
  private shouldBouncePhysically(targetPlayer: Player): boolean {
    if (this.ball.shouldIgnoreCollisionWith(targetPlayer)) {
      return false;
    }

    // Si el otro jugador lleva el balón o si es un disparo en trayectoria, siempre es intercepción física
    if (
      (this.ball.owner !== null && this.ball.owner !== targetPlayer) ||
      this.ball.isShotInFlight
    ) {
      return true;
    }

    const angleToBall = Math.atan2(
      this.ball.y - targetPlayer.y,
      this.ball.x - targetPlayer.x
    );
    const angleDiff = Math.abs(
      Phaser.Math.Angle.Wrap(angleToBall - targetPlayer.getFacingAngle())
    );

    const frontConeAngle = targetPlayer.getControlConeRad();
    if (angleDiff <= frontConeAngle && this.ball.canBeCapturedBy(targetPlayer)) {
      this.ball.attachTo(targetPlayer);
      return false;
    }

    return true;
  }

  private handlePhysicalBounce(targetPlayer: Player): void {
    if (this.isLocalGuest()) return;

    // Caso 1: El otro jugador llevaba el balón -> Mecánica de Placaje / Carga física (Defensa vs Ataque)
    if (this.ball.owner !== null && this.ball.owner !== targetPlayer) {
      this.resolveTackleInteraction(targetPlayer, this.ball.owner);
      return;
    }

    // Caso 2: El jugador está en la trayectoria de un disparo o balón libre -> Física específica de rebote por intercepción
    this.executeInterceptionRebound(targetPlayer);
  }

  /**
   * Mecánica de Placajes / Cargas físicas basada en los atributos RPG:
   * 1. Detección: El jugador sin balón (tackler) colisiona contra el portador (carrier).
   * 2. Influencia RPG: Defensa del embestidor vs Ataque del portador.
   * 3. Éxito: El defensor roba el balón (desacople hacia adelante) y aplica knockback + stun al atacante.
   * 4. Fallido: El atacante resiste con el balón y el defensor rebota hacia atrás con desequilibrio.
   * 5. Cooldown: Protección anti-spam mediante temporizador de enfriamiento e inmunidad.
   */
  private resolveTackleInteraction(tackler: Player, carrier: Player): void {
    if (!tackler.canTackle() || carrier.isTackleImmune()) {
      return;
    }

    tackler.triggerTackleCooldown(1100);
    carrier.triggerTackleImmunity(350);

    const impactAngle = Math.atan2(carrier.y - tackler.y, carrier.x - tackler.x);
    const dirX = Math.cos(impactAngle);
    const dirY = Math.sin(impactAngle);

    const statDef = tackler.stats.defense; // 10..50
    const statAtk = carrier.stats.attack;  // 10..50
    const diff = statDef - statAtk;        // -40..+40

    // Probabilidad base 50% con influencia proporcional de Defensa vs Ataque (15%..85%)
    const successProb = Phaser.Math.Clamp(0.50 + diff * 0.02, 0.15, 0.85);
    const roll = Math.random();
    const isSuccess = roll <= successProb;

    // Registrar evento autoritativo para sincronización WebRTC
    const tacklerPeerId = this.findPeerIdByPlayer(tackler);
    const carrierPeerId = this.findPeerIdByPlayer(carrier);

    this.lastTackleSync = {
      seq: ++this.tackleEventSeq,
      tacklerPeerId,
      carrierPeerId,
      isSuccess,
      x: carrier.x,
      y: carrier.y
    };

    if (isSuccess) {
      // === CASO ÉXITO (Defensa gana o empata) ===
      const defNorm = (statDef - 10) / 40;
      const rollSpeed = Phaser.Math.Linear(260, 440, defNorm);
      const rollVx = dirX * rollSpeed + (Math.random() - 0.5) * 50;
      const rollVy = dirY * rollSpeed + (Math.random() - 0.5) * 50;

      const spawnX = Phaser.Math.Clamp(
        carrier.x + dirX * 26,
        this.pitch.bounds.left + 12,
        this.pitch.bounds.right - 12
      );
      const spawnY = Phaser.Math.Clamp(
        carrier.y + dirY * 26,
        this.pitch.bounds.top + 12,
        this.pitch.bounds.bottom - 12
      );

      this.ball.setPosition(spawnX, spawnY);
      this.ball.body.reset(spawnX, spawnY);
      this.ball.triggerHaxballInterception(rollVx, rollVy, 0, 350);

      const knockback = Phaser.Math.Linear(180, 320, defNorm);
      carrier.body.velocity.x += dirX * knockback;
      carrier.body.velocity.y += dirY * knockback;
      carrier.applyStun(380, 0xef4444);

      this.cameras.main.shake(80, 0.005);
      this.showFloatingCombatText(carrier.x, carrier.y - 32, '¡PLACAJE!', '#ef4444');
      if (this.cache.audio.exists('ui_click')) {
        this.sound.play('ui_click', { volume: 0.65 });
      }
    } else {
      // === CASO FALLIDO (Ataque gana / resiste la carga) ===
      const atkNorm = (statAtk - 10) / 40;
      const recoil = Phaser.Math.Linear(160, 280, atkNorm);
      tackler.body.velocity.x -= dirX * recoil;
      tackler.body.velocity.y -= dirY * recoil;
      tackler.applyStun(220, 0xfacc15);

      this.showFloatingCombatText(carrier.x, carrier.y - 32, '¡RESISTIDO!', '#4ade80');
      if (this.cache.audio.exists('ui_tap')) {
        this.sound.play('ui_tap', { volume: 0.5 });
      }
    }
  }

  private showFloatingCombatText(x: number, y: number, text: string, color: string): void {
    const label = this.add
      .text(x, y, text, {
        fontFamily: 'KenneyFuture, sans-serif',
        fontSize: '13px',
        fontStyle: 'bold',
        color,
        stroke: '#0f172a',
        strokeThickness: 3
      })
      .setOrigin(0.5)
      .setDepth(150);

    this.tweens.add({
      targets: label,
      y: y - 26,
      alpha: 0,
      duration: 600,
      ease: 'Power2',
      onComplete: () => {
        label.destroy();
      }
    });
  }

  private findPeerIdByPlayer(player: Player): string {
    for (const ctrl of this.controllers) {
      if (ctrl.player === player) return ctrl.peerId;
    }
    return '';
  }

  private handleRemoteTackleFeedback(tackle: TackleSyncEvent): void {
    const tacklerCtrl = this.controllersByPeerId.get(tackle.tacklerPeerId);
    const carrierCtrl = this.controllersByPeerId.get(tackle.carrierPeerId);

    if (tackle.isSuccess) {
      if (carrierCtrl) {
        carrierCtrl.player.applyStun(380, 0xef4444);
      }
      this.cameras.main.shake(80, 0.005);
      this.showFloatingCombatText(tackle.x, tackle.y - 32, '¡PLACAJE!', '#ef4444');
      if (this.cache.audio.exists('ui_click')) {
        this.sound.play('ui_click', { volume: 0.65 });
      }
    } else {
      if (tacklerCtrl) {
        tacklerCtrl.player.applyStun(220, 0xfacc15);
      }
      this.showFloatingCombatText(tackle.x, tackle.y - 32, '¡RESISTIDO!', '#4ade80');
      if (this.cache.audio.exists('ui_tap')) {
        this.sound.play('ui_tap', { volume: 0.5 });
      }
    }
  }

  /**
   * Física específica de rebote vectorial cuando un jugador intercepta la trayectoria de un disparo o balón libre.
   */
  private executeInterceptionRebound(blocker: Player): void {
    const normalAngle = Math.atan2(this.ball.y - blocker.y, this.ball.x - blocker.x);
    const nx = Math.cos(normalAngle);
    const ny = Math.sin(normalAngle);

    // Separar el balón al borde exterior del radio de colisión (14 + 9 = 23 -> 26px)
    const minSeparation = 26;
    const sepX = Phaser.Math.Clamp(
      blocker.x + nx * minSeparation,
      this.pitch.bounds.left + 10,
      this.pitch.bounds.right - 10
    );
    const sepY = Phaser.Math.Clamp(
      blocker.y + ny * minSeparation,
      this.pitch.bounds.top + 10,
      this.pitch.bounds.bottom - 10
    );
    this.ball.setPosition(sepX, sepY);
    this.ball.body.reset(sepX, sepY);

    // Reflexión especular del vector velocidad del disparo respecto a la normal del cuerpo del interceptor
    const inVx = this.ball.body.velocity.x - blocker.body.velocity.x;
    const inVy = this.ball.body.velocity.y - blocker.body.velocity.y;
    const incomingSpeed = Math.hypot(inVx, inVy);
    const dot = inVx * nx + inVy * ny;

    let refVx: number;
    let refVy: number;
    if (dot < 0) {
      refVx = inVx - 2 * dot * nx;
      refVy = inVy - 2 * dot * ny;
    } else {
      refVx = nx * Math.max(160, incomingSpeed);
      refVy = ny * Math.max(160, incomingSpeed);
    }

    const refAngle = Math.atan2(refVy, refVx);
    const restitution = 0.72 * Phaser.Math.Linear(1, blocker.getDefenseImpactMultiplier(), 0.45);
    const reboundSpeed = Math.max(175, incomingSpeed * restitution);

    const reboundVx = blocker.body.velocity.x * 0.45 + Math.cos(refAngle) * reboundSpeed;
    const reboundVy = blocker.body.velocity.y * 0.45 + Math.sin(refAngle) * reboundSpeed;
    const reboundVz = this.ball.z > 4 ? Math.max(35, this.ball.vz * 0.4) : 0;

    this.ball.triggerHaxballInterception(reboundVx, reboundVy, reboundVz, 300);
  }

  /**
   * Detecta continuamente si algún jugador está en la trayectoria de un disparo rápido (segmento prev -> actual)
   * para garantizar que jamás lo atraviese y ejecute siempre la física de rebote por intercepción.
   */
  private checkShotTrajectoryInterception(): void {
    if (this.ball.owner !== null) return;
    if (!this.ball.isShotInFlight) return;

    const x1 = this.ball.getPrevX();
    const y1 = this.ball.getPrevY();
    const x2 = this.ball.x;
    const y2 = this.ball.y;

    const segDx = x2 - x1;
    const segDy = y2 - y1;
    const segLenSq = segDx * segDx + segDy * segDy;
    const interceptRadius = 23; // Radio jugador (14) + radio balón (9)

    for (const ctrl of this.controllers) {
      const candidate = ctrl.player;
      if (this.ball.shouldIgnoreCollisionWith(candidate)) continue;

      let closestX = x2;
      let closestY = y2;
      if (segLenSq > 0.0001) {
        const t = Phaser.Math.Clamp(
          ((candidate.x - x1) * segDx + (candidate.y - y1) * segDy) / segLenSq,
          0,
          1
        );
        closestX = x1 + t * segDx;
        closestY = y1 + t * segDy;
      }

      const dist = Phaser.Math.Distance.Between(candidate.x, candidate.y, closestX, closestY);
      if (dist <= interceptRadius) {
        this.ball.x = closestX;
        this.ball.y = closestY;
        this.executeInterceptionRebound(candidate);
        return;
      }
    }
  }

  /**
   * Choque cuerpo a cuerpo entre dos jugadores gobernado por su atributo Defensa (masa, empuje y resistencia al retroceso).
   * Si quien lleva el balón supera ampliamente en Defensa/Técnica al rival, aguanta la embestida; de lo contrario, pierde el balón al estilo HaxBall.
   */
  private handlePlayersBodyClash(pA: Player, pB: Player): void {
    if (this.isLocalGuest()) return;

    const angleAToB = Math.atan2(pB.y - pA.y, pB.x - pA.x);
    const nx = Math.cos(angleAToB);
    const ny = Math.sin(angleAToB);

    const pushA = Phaser.Math.Clamp(
      98 * (pB.getDefenseImpactMultiplier() / pA.getKnockbackResistance()),
      22,
      360
    );
    const pushB = Phaser.Math.Clamp(
      98 * (pA.getDefenseImpactMultiplier() / pB.getKnockbackResistance()),
      22,
      360
    );

    pA.body.velocity.x -= nx * pushA;
    pA.body.velocity.y -= ny * pushA;
    pB.body.velocity.x += nx * pushB;
    pB.body.velocity.y += ny * pushB;

    if (this.ball.owner === pA || this.ball.owner === pB) {
      const carrier = this.ball.owner;
      const tackler = carrier === pA ? pB : pA;

      this.resolveTackleInteraction(tackler, carrier);
    }
  }

  /**
   * Permite que cada jugador controle el balón dentro de su radio de alcance frontal y velocidad máxima de recepción según su Técnica
   */
  private checkTechniqueTouchControl(targetPlayer: Player): void {
    if (this.ball.owner || !this.ball.canBeCapturedBy(targetPlayer)) return;

    const dist = Phaser.Math.Distance.Between(
      targetPlayer.x,
      targetPlayer.y,
      this.ball.x,
      this.ball.y
    );

    const techNorm = Phaser.Math.Clamp((targetPlayer.stats.technique - 10) / 40, 0, 1);
    const controlReach = Math.min(targetPlayer.getTouchRadius() * 0.78, 46);
    const maxControllableBallSpeed = Phaser.Math.Linear(270, 560, techNorm);

    if (dist <= controlReach && this.ball.body.velocity.length() < maxControllableBallSpeed) {
      const angleToBall = Math.atan2(
        this.ball.y - targetPlayer.y,
        this.ball.x - targetPlayer.x
      );
      const angleDiff = Math.abs(
        Phaser.Math.Angle.Wrap(angleToBall - targetPlayer.getFacingAngle())
      );
      if (angleDiff <= targetPlayer.getControlConeRad()) {
        this.ball.attachTo(targetPlayer);
      }
    }
  }

  update(_time: number, delta: number): void {
    this.lastHostTickTime = performance.now();

    if (this.isLocalGuest()) {
      this.stepClientInputAndRender(delta);
    } else {
      this.stepAuthoritativeHost(delta);
    }

    if (this.isMobile) {
      if (this.cameraMode === 'accion') {
        this.updateMobileCameraFollow();
      }
      this.renderVirtualStick();
    } else {
      this.stickGraphics.clear();
    }

    this.updateFsmHud();
  }

  /**
   * 1. MODO CLIENTE (Invitados 2..8):
   *    - Captura teclas locales (WASD / Flechas + Pase/Tiro) y las envía en tiempo real al Host por WebRTC Data Channel.
   *    - Interpola suavemente las posiciones autoritativas recibidas del Host para todos los jugadores (hasta 4v4) y el Balón.
   */
  private stepClientInputAndRender(delta: number): void {
    const localCtrl = this.getLocalController();
    if (!localCtrl) return;

    if (!this.matchFsm.isInState('FULL_TIME')) {
      if (localCtrl.player.isStunned()) {
        localCtrl.analogVector.set(0, 0);
        localCtrl.activeMoveRequest = null;
        peerManager.sendGuestInput({
          peerId: localCtrl.peerId,
          up: false,
          down: false,
          left: false,
          right: false,
          vx: 0,
          vy: 0,
          moveRequest: null,
          seq: ++this.inputSeq
        });
      } else {
        this.computeControllerInput(localCtrl, delta, true);
        this.pollControllerMoveRequest(localCtrl, delta);

        const isUp = Boolean(localCtrl.moveKeys?.up.some((k) => k.isDown));
        const isDown = Boolean(localCtrl.moveKeys?.down.some((k) => k.isDown));
        const isLeft = Boolean(localCtrl.moveKeys?.left.some((k) => k.isDown));
        const isRight = Boolean(localCtrl.moveKeys?.right.some((k) => k.isDown));

        peerManager.sendGuestInput({
          peerId: localCtrl.peerId,
          up: isUp,
          down: isDown,
          left: isLeft,
          right: isRight,
          vx: localCtrl.analogVector.x,
          vy: localCtrl.analogVector.y,
          moveRequest: localCtrl.activeMoveRequest
            ? { ...localCtrl.activeMoveRequest }
            : null,
          seq: ++this.inputSeq
        });
      }
    } else {
      localCtrl.analogVector.set(0, 0);
      localCtrl.activeMoveRequest = null;
    }

    // Interpolación suave de todos los jugadores en cancha y el balón hacia el estado autoritativo del Host
    if (this.latestHostSync) {
      const lerpFactor = Math.min(1, (delta / 1000) * 24);
      for (const ctrl of this.controllers) {
        const pSync = this.latestHostSync.players[ctrl.peerId];
        if (pSync) {
          ctrl.player.syncRemoteVisuals(pSync, delta, lerpFactor);
        }
      }

      this.ball.syncRemoteVisuals(this.latestHostSync.ball, delta, lerpFactor);

      const ownerId = this.latestHostSync.ball.ownerPeerId;
      this.ball.owner = ownerId
        ? (this.controllersByPeerId.get(ownerId)?.player ?? null)
        : null;
    }
  }

  /**
   * 2. MODO HOST AUTORITATIVO (Jugador 1):
   *    - Procesa inputs locales del Host e inputs remotos recibidos de los Clientes (de 2 hasta 8 jugadores: 1v1, 2v1, 3v2, 4v4).
   *    - Simula el mundo físico completo y emite el paquete MATCH_SYNC hacia todos los Clientes en cada tick.
   */
  private stepAuthoritativeHost(delta: number): void {
    this.matchFsm.update(delta);
    const localCtrl = this.getLocalController();

    if (!this.matchFsm.isInState('FULL_TIME')) {
      for (const ctrl of this.controllers) {
        if (ctrl === localCtrl) {
          this.computeControllerInput(ctrl, delta, true);
          this.pollControllerMoveRequest(ctrl, delta);
        } else {
          const remoteInput = this.guestInputsByPeerId.get(ctrl.peerId);
          if (remoteInput) {
            this.applyGuestInputToController(ctrl, remoteInput, delta);
          } else {
            ctrl.analogVector.set(0, 0);
            ctrl.activeMoveRequest = null;
          }
        }
        this.checkTechniqueTouchControl(ctrl.player);
      }
    } else {
      for (const ctrl of this.controllers) {
        ctrl.analogVector.set(0, 0);
        ctrl.activeMoveRequest = null;
      }
    }

    // Actualizar las Máquinas de Estados y físicas autoritativas de todos los jugadores y del Balón
    for (const ctrl of this.controllers) {
      ctrl.player.updatePlayer(
        ctrl.analogVector,
        this.ball,
        ctrl.activeMoveRequest,
        delta
      );
    }

    this.checkShotTrajectoryInterception();
    this.ball.updateBall(delta);

    if (this.ball.enteredGoalThroughFront !== null && this.matchFsm.isInState('PLAYING')) {
      this.onGoalSensorTriggered(this.ball.enteredGoalThroughFront);
    }

    // Emitir estado autoritativo (Host -> Clientes)
    if (peerManager.isOnlineSession && peerManager.isHost) {
      const playersSync: Record<string, AuthoritativePlayerSync> = {};
      let ownerPeerId: string | null = null;

      for (const ctrl of this.controllers) {
        const p = ctrl.player;
        const pPower = p.getPowerBarState();
        playersSync[ctrl.peerId] = {
          x: p.x,
          y: p.y,
          vx: p.body.velocity.x,
          vy: p.body.velocity.y,
          angle: p.getFacingAngle(),
          state: p.fsm.getStateName() ?? 'IDLE',
          powerRatio: pPower.ratio,
          powerLabel: pPower.label,
          isStunned: p.isStunned(),
          stunColor: p.getStunColor()
        };
        if (this.ball.owner === p) {
          ownerPeerId = ctrl.peerId;
        }
      }

      peerManager.sendMatchSync({
        players: playersSync,
        ball: {
          x: this.ball.x,
          y: this.ball.y,
          vx: this.ball.body.velocity.x,
          vy: this.ball.body.velocity.y,
          z: this.ball.z,
          vz: this.ball.vz,
          isAirborne: this.ball.isAirborne,
          state: this.ball.fsm.getStateName() ?? 'FREE_GROUND',
          ownerPeerId
        },
        blueScore: this.blueScore,
        redScore: this.redScore,
        remainingTimeMs: this.remainingTimeMs,
        matchState: (this.matchFsm.getStateName() ?? 'PLAYING') as MatchStateName,
        lastGoalTeam: this.lastGoalScoringTeam,
        lastTackle: this.lastTackleSync
      });
    }
  }

  private applyGuestInputToController(
    ctrl: PlayerControllerState,
    input: RemoteInputPayload,
    delta: number
  ): void {
    let kx = 0;
    let ky = 0;
    if (input.left) kx -= 1;
    if (input.right) kx += 1;
    if (input.up) ky -= 1;
    if (input.down) ky += 1;

    if (kx !== 0 || ky !== 0) {
      const targetVec = new Phaser.Math.Vector2(kx, ky).normalize();
      const smoothFactor = Math.min(1, (delta / 1000) * 18);
      ctrl.smoothVector.lerp(targetVec, smoothFactor);
      ctrl.analogVector.copy(ctrl.smoothVector);
      if (ctrl.analogVector.length() > 1) {
        ctrl.analogVector.normalize();
      }
    } else if (Math.hypot(input.vx, input.vy) > 0.02) {
      ctrl.analogVector.set(input.vx, input.vy);
      ctrl.smoothVector.copy(ctrl.analogVector);
    } else {
      ctrl.smoothVector.set(0, 0);
      ctrl.analogVector.set(0, 0);
    }

    ctrl.activeMoveRequest = input.moveRequest
      ? { ...input.moveRequest }
      : null;
  }

  private pollControllerMoveRequest(ctrl: PlayerControllerState, delta: number): void {
    if (ctrl.bufferedMove) {
      ctrl.bufferedMove.timerMs -= delta;
      if (ctrl.bufferedMove.timerMs <= 0) {
        ctrl.bufferedMove = null;
      }
    }

    let newlyPressed: MoveBinding | null = null;
    let currentlyHeld: MoveBinding | null = null;

    for (const binding of ctrl.bindings) {
      const isDownNow = binding.keys.some((k) => k.isDown) || binding.isTouchDown;
      if (isDownNow && !binding.wasDown) {
        newlyPressed = binding;
      }
      if (isDownNow && !currentlyHeld) {
        currentlyHeld = binding;
      }
      binding.wasDown = isDownNow;
    }

    if (newlyPressed) {
      ctrl.bufferedMove = {
        type: newlyPressed.type,
        label: newlyPressed.label,
        timerMs: 220
      };
    }

    if (currentlyHeld) {
      ctrl.activeMoveRequest = {
        type: currentlyHeld.type,
        label: currentlyHeld.label,
        isHolding: true
      };
    } else if (ctrl.bufferedMove) {
      ctrl.activeMoveRequest = {
        type: ctrl.bufferedMove.type,
        label: ctrl.bufferedMove.label,
        isHolding: false
      };
      if (ctrl.player.fsm.isInState('KICKING')) {
        ctrl.bufferedMove = null;
      }
    } else {
      ctrl.activeMoveRequest = null;
    }
  }

  private computeControllerInput(
    ctrl: PlayerControllerState,
    delta: number,
    allowPointerStick: boolean
  ): void {
    ctrl.analogVector.set(0, 0);

    if (this.isMobile && allowPointerStick && this.isPointerDown) {
      const dx = this.stickCurrent.x - this.stickOrigin.x;
      const dy = this.stickCurrent.y - this.stickOrigin.y;
      const dist = Math.hypot(dx, dy);

      if (dist > 4) {
        const clampedMagnitude = Phaser.Math.Clamp(dist / this.stickMaxRadius, 0, 1);
        const angle = Math.atan2(dy, dx);
        ctrl.analogVector.set(
          Math.cos(angle) * clampedMagnitude,
          Math.sin(angle) * clampedMagnitude
        );
        return;
      }
    }

    let kx = 0;
    let ky = 0;

    if (ctrl.moveKeys?.left.some((k) => k.isDown)) kx -= 1;
    if (ctrl.moveKeys?.right.some((k) => k.isDown)) kx += 1;
    if (ctrl.moveKeys?.up.some((k) => k.isDown)) ky -= 1;
    if (ctrl.moveKeys?.down.some((k) => k.isDown)) ky += 1;

    const targetVec = new Phaser.Math.Vector2(kx, ky);
    if (targetVec.lengthSq() > 0) {
      targetVec.normalize();
    }

    const smoothFactor = Math.min(1, (delta / 1000) * 14);
    ctrl.smoothVector.lerp(targetVec, smoothFactor);

    if (ctrl.smoothVector.length() > 0.03) {
      ctrl.analogVector.copy(ctrl.smoothVector);
      if (ctrl.analogVector.length() > 1) {
        ctrl.analogVector.normalize();
      }
    } else {
      ctrl.smoothVector.set(0, 0);
    }
  }

  private updateMobileCameraFollow(): void {
    const localPlayer = this.getLocalController()?.player;
    if (!localPlayer) return;

    const targetX = Phaser.Math.Linear(localPlayer.x, this.ball.x, 0.45);
    const targetY = Phaser.Math.Linear(localPlayer.y, this.ball.y, 0.45);

    const b = this.pitch.bounds;
    const clampedX = Phaser.Math.Clamp(targetX, b.left + 160, b.right - 160);
    const clampedY = Phaser.Math.Clamp(targetY, b.top + 100, b.bottom - 100);

    this.camTarget.x = Phaser.Math.Linear(this.camTarget.x, clampedX, 0.08);
    this.camTarget.y = Phaser.Math.Linear(this.camTarget.y, clampedY, 0.08);
    this.cameras.main.centerOn(this.camTarget.x, this.camTarget.y);
  }

  private checkIsMobileDevice(): boolean {
    if (typeof window === 'undefined') return false;
    const ua = navigator.userAgent || '';
    const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
    const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    return isMobileUA || (hasTouch && !this.sys.game.device.os.desktop);
  }

  private updateFsmHud(): void {
    const mState = this.matchFsm.getStateName() ?? 'NONE';
    const localPlayer = this.getLocalController()?.player ?? this.controllers[0]?.player;
    if (!localPlayer) return;

    const pState = localPlayer.fsm.getStateName() ?? 'NONE';
    const bState = this.ball.fsm.getStateName() ?? 'NONE';
    const s = localPlayer.stats;
    const blueCount = this.controllers.filter((c) => c.player.team === 'blue').length;
    const redCount = this.controllers.filter((c) => c.player.team === 'red').length;

    this.fsmStatusText.setText(
      `Formato: [${blueCount}v${redCount}]  |  Partido: [${mState}]  |  ${localPlayer.playerName}: [${pState}]  |  Balón: [${bState}]  •  STATS (${s.speed}/${s.shoot}/${s.defense}/${s.technique}/${s.attack})`
    );
  }

  private renderVirtualStick(): void {
    this.stickGraphics.clear();
    if (!this.isMobile) return;

    if (!this.isPointerDown) {
      // Base táctil de reposo translúcida en la esquina inferior izquierda
      const defX = this.stickDefaultPos.x;
      const defY = this.stickDefaultPos.y;
      this.stickGraphics.fillStyle(0x0f172a, 0.28);
      this.stickGraphics.fillCircle(defX, defY, this.stickMaxRadius);
      this.stickGraphics.lineStyle(2, 0xffffff, 0.35);
      this.stickGraphics.strokeCircle(defX, defY, this.stickMaxRadius);
      this.stickGraphics.fillStyle(0xffffff, 0.22);
      this.stickGraphics.fillCircle(defX, defY, 18);
      return;
    }

    const dx = this.stickCurrent.x - this.stickOrigin.x;
    const dy = this.stickCurrent.y - this.stickOrigin.y;
    const dist = Math.min(Math.hypot(dx, dy), this.stickMaxRadius);
    const angle = Math.atan2(dy, dx);

    const knobX = this.stickOrigin.x + Math.cos(angle) * dist;
    const knobY = this.stickOrigin.y + Math.sin(angle) * dist;

    this.stickGraphics.fillStyle(0x0f172a, 0.45);
    this.stickGraphics.fillCircle(this.stickOrigin.x, this.stickOrigin.y, this.stickMaxRadius);
    this.stickGraphics.lineStyle(2.5, 0xffffff, 0.7);
    this.stickGraphics.strokeCircle(this.stickOrigin.x, this.stickOrigin.y, this.stickMaxRadius);

    this.stickGraphics.lineStyle(2, 0xfacc15, 0.85);
    this.stickGraphics.lineBetween(this.stickOrigin.x, this.stickOrigin.y, knobX, knobY);

    this.stickGraphics.fillStyle(0xfacc15, 0.95);
    this.stickGraphics.fillCircle(knobX, knobY, 22);
    this.stickGraphics.lineStyle(2, 0xffffff, 0.95);
    this.stickGraphics.strokeCircle(knobX, knobY, 22);
  }
}
