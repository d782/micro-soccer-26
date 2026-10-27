import Phaser from 'phaser';
import { PlayerStats } from '../objects/Player';
import { peerManager } from '../network/PeerManager';

interface StatRowConfig {
  key: keyof PlayerStats;
  label: string;
  description: string;
  color: number;
}

interface StatRowUI {
  config: StatRowConfig;
  valueText: Phaser.GameObjects.Text;
  valueBadge: Phaser.GameObjects.Graphics;
  trackGraphics: Phaser.GameObjects.Graphics;
  fillGraphics: Phaser.GameObjects.Graphics;
  knobContainer: Phaser.GameObjects.Container;
  knobGlow: Phaser.GameObjects.Graphics;
  knobBall: Phaser.GameObjects.Image;
  trackX: number;
  trackY: number;
  trackWidth: number;
  trackHeight: number;
  hitZone: Phaser.GameObjects.Zone;
}

export class SkillScene extends Phaser.Scene {
  // 125 puntos base (25 x 5) + 50 puntos restantes para repartir = 175 puntos totales
  private readonly totalBudget = 175;
  private readonly minStat = 10;
  private readonly maxStat = 50;

  private playerName = 'JUGADOR 1';
  private selectedTeam: 'blue' | 'red' = 'blue';
  private isNameInputFocused = true;
  private cursorBlinkVisible = true;

  private stats: PlayerStats = {
    speed: 25,
    shoot: 25,
    defense: 25,
    technique: 25,
    attack: 25
  };

  private rows: StatRowUI[] = [];
  private nameInputBox!: Phaser.GameObjects.Graphics;
  private nameValueText!: Phaser.GameObjects.Text;
  private teamBlueBtn!: Phaser.GameObjects.NineSlice;
  private teamRedBtn!: Phaser.GameObjects.NineSlice;
  private remainingText!: Phaser.GameObjects.Text;
  private startButtonContainer!: Phaser.GameObjects.Container;
  private startBtnBg!: Phaser.GameObjects.NineSlice;
  private startBtnIcon!: Phaser.GameObjects.Image;
  private startBtnLabel!: Phaser.GameObjects.Text;
  private isTransitioning = false;
  private activeDragRow: StatRowUI | null = null;
  private lastTapSoundTime = 0;

  private readonly statConfigs: StatRowConfig[] = [
    {
      key: 'speed',
      label: 'VELOCIDAD',
      description: 'Velocidad máxima de desplazamiento en cancha',
      color: 0x38bdf8
    },
    {
      key: 'shoot',
      label: 'DISPARO',
      description: 'Fuerza y potencia al patear el balón',
      color: 0xf97316
    },
    {
      key: 'defense',
      label: 'DEFENSA',
      description: 'Masa corporal y firmeza en los choques',
      color: 0x22c55e
    },
    {
      key: 'technique',
      label: 'TÉCNICA',
      description: 'Radio de alcance y control del balón',
      color: 0xa855f7
    },
    {
      key: 'attack',
      label: 'ATAQUE',
      description: 'Menor tiempo de enfriamiento entre patadas',
      color: 0xfacc15
    }
  ];

  constructor() {
    super('SkillScene');
  }

  create(): void {
    this.isTransitioning = false;
    this.rows = [];
    this.isNameInputFocused = true;
    this.cursorBlinkVisible = true;
    this.cameras.main.fadeIn(220, 15, 23, 42);

    const savedName = this.registry.get('playerName') as string | undefined;
    this.playerName = savedName ?? (peerManager.isHost || !peerManager.isOnlineSession ? 'JUGADOR 1' : 'JUGADOR 2');
    this.selectedTeam = peerManager.isOnlineSession && !peerManager.isHost ? 'red' : 'blue';

    this.stats = {
      speed: 25,
      shoot: 25,
      defense: 25,
      technique: 25,
      attack: 25
    };

    const { width, height } = this.scale;

    // 1. Fondo estilizado de cancha con viñeta oscura
    const bg = this.add.graphics();
    const stripeWidth = 64;
    const totalStripes = Math.ceil(width / stripeWidth);
    for (let i = 0; i < totalStripes; i++) {
      bg.fillStyle(i % 2 === 0 ? 0x1dd161 : 0x17c056, 1);
      bg.fillRect(i * stripeWidth, 0, stripeWidth, height);
    }
    bg.fillStyle(0x0b1f13, 0.65);
    bg.fillRect(0, 0, width, height);

    // 2. Panel principal NineSlice amplio (1040 x 660)
    const panelWidth = 1040;
    const panelHeight = 660;
    const panelX = width / 2;
    const panelY = height / 2;

    const shadow = this.add.graphics();
    shadow.fillStyle(0x000000, 0.42);
    shadow.fillRoundedRect(
      panelX - panelWidth / 2 + 6,
      panelY - panelHeight / 2 + 8,
      panelWidth,
      panelHeight,
      24
    );

    this.add
      .nineslice(panelX, panelY, 'ui_panel_blue', undefined, panelWidth, panelHeight, 28, 28, 28, 28)
      .setAlpha(0.98);

    // 3. Título principal + insignia de código de sala P2P
    const roomLabel = peerManager.roomCode ? `   •   SALA: ${peerManager.roomCode}` : '';
    this.add
      .text(panelX, 66, `IDENTIDAD Y ATRIBUTOS${roomLabel}`, {
        fontFamily: 'KenneyFuture, sans-serif',
        fontSize: '24px',
        fontStyle: 'bold',
        color: '#ffffff',
        stroke: '#0f172a',
        strokeThickness: 6
      })
      .setOrigin(0.5);

    // 4. Barra superior: Nombre + Selector de Equipo/Color + Contador de Puntos
    this.createIdentityAndPointsBar(126);

    // 5. Filas de los 5 atributos
    const startY = 198;
    const rowSpacing = 66;

    this.statConfigs.forEach((cfg, index) => {
      const rowY = startY + index * rowSpacing;
      this.createStatRow(cfg, rowY);
    });

    // Nota informativa de límites e interacción
    this.add
      .text(
        panelX,
        536,
        'Arrastra las barras con el mouse para asignar atributos (mínimo 10 • máximo 50) • Asigna todos los puntos para continuar',
        {
          fontFamily: 'sans-serif',
          fontSize: '14px',
          fontStyle: 'bold',
          color: '#e0f2fe'
        }
      )
      .setOrigin(0.5);

    // 6. Botones auxiliares de reparto rápido y botón principal ¡LISTO!
    const actionY = 604;

    this.createPresetButton(290, actionY, 'MÍNIMO (10 c/u)', () => {
      this.stats = { speed: 10, shoot: 10, defense: 10, technique: 10, attack: 10 };
      this.refreshUI();
    });

    this.createPresetButton(990, actionY, 'EQUILIBRADO (35 c/u)', () => {
      this.stats = { speed: 35, shoot: 35, defense: 35, technique: 35, attack: 35 };
      this.refreshUI();
    });

    this.startButtonContainer = this.add.container(panelX, actionY);
    this.startBtnBg = this.add.nineslice(
      0,
      0,
      'ui_btn_green_up',
      undefined,
      350,
      56,
      20,
      20,
      20,
      20
    );
    this.startBtnIcon = this.add.image(-132, -2, 'ui_icon_play').setScale(0.46);
    this.startBtnLabel = this.add
      .text(18, -2, '¡LISTO!', {
        fontFamily: 'sans-serif',
        fontSize: '19px',
        fontStyle: 'bold',
        color: '#ffffff',
        stroke: '#064e3b',
        strokeThickness: 4
      })
      .setOrigin(0.5);

    this.startButtonContainer.add([this.startBtnBg, this.startBtnIcon, this.startBtnLabel]);
    this.startButtonContainer.setSize(350, 56);
    this.startButtonContainer.setInteractive({ useHandCursor: true });

    this.startButtonContainer.on('pointerover', () => {
      if (this.isTransitioning || this.getRemainingPoints() !== 0) return;
      this.startBtnBg.setTint(0xeffef5);
      if (this.cache.audio.exists('ui_tap')) {
        this.sound.play('ui_tap', { volume: 0.35 });
      }
    });

    this.startButtonContainer.on('pointerout', () => {
      if (this.isTransitioning) return;
      this.startBtnBg.clearTint();
      if (this.getRemainingPoints() === 0) {
        this.startBtnBg.setTexture('ui_btn_green_up');
      }
    });

    this.startButtonContainer.on('pointerdown', () => {
      if (this.isTransitioning || this.getRemainingPoints() !== 0) return;
      this.startBtnBg.setTexture('ui_btn_green_down');
    });

    this.startButtonContainer.on('pointerup', () => {
      if (this.getRemainingPoints() === 0) {
        this.confirmProfileAndGoToLobby();
      }
    });

    // Control global de arrastre con el mouse sobre cualquier barra de skill
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (this.isTransitioning || !this.activeDragRow) return;
      this.updateStatFromPointerX(this.activeDragRow, pointer.x);
    });

    const stopDragging = () => {
      if (this.activeDragRow) {
        this.activeDragRow.knobContainer.setScale(1.0);
        this.activeDragRow.knobGlow.setAlpha(0.35);
        this.activeDragRow = null;
      }
    };

    this.input.on('pointerup', stopDragging);
    this.input.on('pointerupoutside', stopDragging);
    this.input.on('gameout', stopDragging);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.activeDragRow = null;
    });

    this.refreshUI();
  }

  private createIdentityAndPointsBar(centerY: number): void {
    // 1. Nombre del jugador (x = 165..520)
    this.add
      .text(165, centerY, 'NOMBRE:', {
        fontFamily: 'sans-serif',
        fontSize: '15px',
        fontStyle: 'bold',
        color: '#fef08a',
        stroke: '#0f172a',
        strokeThickness: 3
      })
      .setOrigin(0, 0.5);

    const boxX = 250;
    const boxY = centerY - 21;
    const boxWidth = 220;
    const boxHeight = 42;

    this.nameInputBox = this.add.graphics();

    const hitZone = this.add
      .zone(boxX + boxWidth / 2, centerY, boxWidth, boxHeight)
      .setInteractive({ useHandCursor: true });

    hitZone.on('pointerdown', () => {
      this.isNameInputFocused = true;
      if (!this.sys.game.device.os.desktop) {
        const entered = window.prompt('Ingresa el nombre de tu jugador:', this.playerName);
        if (entered !== null) {
          this.playerName = entered.trim().toUpperCase().slice(0, 14) || 'JUGADOR';
        }
      }
      this.renderNameInputBox(boxX, boxY, boxWidth, boxHeight);
    });

    this.nameValueText = this.add
      .text(boxX + 12, centerY, '', {
        fontFamily: 'sans-serif',
        fontSize: '16px',
        fontStyle: 'bold',
        color: '#ffffff'
      })
      .setOrigin(0, 0.5);

    this.time.addEvent({
      delay: 480,
      loop: true,
      callback: () => {
        this.cursorBlinkVisible = !this.cursorBlinkVisible;
        this.renderNameInputBox(boxX, boxY, boxWidth, boxHeight);
      }
    });

    if (this.input.keyboard) {
      this.input.keyboard.on('keydown', (event: KeyboardEvent) => {
        if (this.isTransitioning || !this.isNameInputFocused) return;

        if (event.key === 'Backspace') {
          this.playerName = this.playerName.slice(0, -1);
          this.renderNameInputBox(boxX, boxY, boxWidth, boxHeight);
          return;
        }

        if (event.key === 'Enter' && this.getRemainingPoints() === 0) {
          this.confirmProfileAndGoToLobby();
          return;
        }

        if (
          event.key.length === 1 &&
          !event.ctrlKey &&
          !event.metaKey &&
          this.playerName.length < 14
        ) {
          this.playerName += event.key.toUpperCase();
          this.renderNameInputBox(boxX, boxY, boxWidth, boxHeight);
        }
      });
    }

    this.renderNameInputBox(boxX, boxY, boxWidth, boxHeight);

    // 2. Selector de Equipo / Color (AZUL vs ROJO) en el centro (x = 490..740)
    this.add
      .text(490, centerY, 'EQUIPO:', {
        fontFamily: 'sans-serif',
        fontSize: '15px',
        fontStyle: 'bold',
        color: '#fef08a',
        stroke: '#0f172a',
        strokeThickness: 3
      })
      .setOrigin(0, 0.5);

    this.teamBlueBtn = this.add
      .nineslice(605, centerY, 'ui_panel_blue', undefined, 86, 40, 12, 12, 12, 12)
      .setInteractive({ useHandCursor: true });
    this.add
      .text(605, centerY, 'AZUL', {
        fontFamily: 'sans-serif',
        fontSize: '14px',
        fontStyle: 'bold',
        color: '#ffffff',
        stroke: '#0f172a',
        strokeThickness: 3
      })
      .setOrigin(0.5);

    this.teamRedBtn = this.add
      .nineslice(698, centerY, 'ui_panel_red', undefined, 86, 40, 12, 12, 12, 12)
      .setInteractive({ useHandCursor: true });
    this.add
      .text(698, centerY, 'ROJO', {
        fontFamily: 'sans-serif',
        fontSize: '14px',
        fontStyle: 'bold',
        color: '#ffffff',
        stroke: '#0f172a',
        strokeThickness: 3
      })
      .setOrigin(0.5);

    this.teamBlueBtn.on('pointerdown', () => {
      this.selectedTeam = 'blue';
      this.refreshTeamButtons();
    });
    this.teamRedBtn.on('pointerdown', () => {
      this.selectedTeam = 'red';
      this.refreshTeamButtons();
    });
    this.refreshTeamButtons();

    // 3. Panel de Puntos por Repartir a la derecha (x = 940, ancho 350px)
    const ptsPanelX = 940;
    this.add
      .nineslice(ptsPanelX, centerY, 'ui_panel_grey', undefined, 350, 44, 16, 16, 16, 16)
      .setOrigin(0.5);

    this.remainingText = this.add
      .text(ptsPanelX, centerY, '', {
        fontFamily: 'sans-serif',
        fontSize: '15px',
        fontStyle: 'bold',
        color: '#0f172a'
      })
      .setOrigin(0.5);
  }

  private refreshTeamButtons(): void {
    if (this.selectedTeam === 'blue') {
      this.teamBlueBtn.setAlpha(1);
      this.teamBlueBtn.setScale(1.05);
      this.teamRedBtn.setAlpha(0.45);
      this.teamRedBtn.setScale(0.95);
    } else {
      this.teamRedBtn.setAlpha(1);
      this.teamRedBtn.setScale(1.05);
      this.teamBlueBtn.setAlpha(0.45);
      this.teamBlueBtn.setScale(0.95);
    }
  }

  private renderNameInputBox(x: number, y: number, w: number, h: number): void {
    this.nameInputBox.clear();
    this.nameInputBox.fillStyle(0x0f172a, 0.85);
    this.nameInputBox.fillRoundedRect(x, y, w, h, 10);

    const borderColor = this.isNameInputFocused ? 0xfacc15 : 0x94a3b8;
    this.nameInputBox.lineStyle(2, borderColor, 0.95);
    this.nameInputBox.strokeRoundedRect(x, y, w, h, 10);

    const cursorChar = this.isNameInputFocused && this.cursorBlinkVisible ? '|' : '';
    const displayStr = this.playerName.length > 0 ? `${this.playerName}${cursorChar}` : cursorChar;
    this.nameValueText.setText(displayStr);
  }

  private createStatRow(cfg: StatRowConfig, y: number): void {
    const leftX = 175;
    const rowWidth = 930;

    const rowBg = this.add.graphics();
    rowBg.fillStyle(0x0f172a, 0.45);
    rowBg.fillRoundedRect(leftX, y - 26, rowWidth, 52, 12);
    rowBg.lineStyle(1.5, 0x1e293b, 0.6);
    rowBg.strokeRoundedRect(leftX, y - 26, rowWidth, 52, 12);

    this.add
      .text(leftX + 20, y - 9, cfg.label, {
        fontFamily: 'sans-serif',
        fontSize: '16px',
        fontStyle: 'bold',
        color: '#ffffff',
        stroke: '#0f172a',
        strokeThickness: 3
      })
      .setOrigin(0, 0.5);

    this.add
      .text(leftX + 20, y + 11, cfg.description, {
        fontFamily: 'sans-serif',
        fontSize: '12px',
        color: '#94a3b8'
      })
      .setOrigin(0, 0.5);

    const trackX = 475;
    const trackY = y - 9;
    const trackWidth = 495;
    const trackHeight = 18;

    const trackGraphics = this.add.graphics();
    const fillGraphics = this.add.graphics();

    // Placa numérica de valor a la derecha
    const badgeX = 1032;
    const badgeW = 76;
    const badgeH = 38;

    const valueBadge = this.add.graphics();
    valueBadge.fillStyle(0x090f1d, 0.85);
    valueBadge.fillRoundedRect(badgeX - badgeW / 2, y - badgeH / 2, badgeW, badgeH, 8);
    valueBadge.lineStyle(1.5, cfg.color, 0.75);
    valueBadge.strokeRoundedRect(badgeX - badgeW / 2, y - badgeH / 2, badgeW, badgeH, 8);

    const valueText = this.add
      .text(badgeX, y, '25', {
        fontFamily: 'sans-serif',
        fontSize: '19px',
        fontStyle: 'bold',
        color: '#fef08a',
        stroke: '#0f172a',
        strokeThickness: 3
      })
      .setOrigin(0.5);

    // Tirador (Knob) deslizable con icono de balón de fútbol
    const knobContainer = this.add.container(trackX, y);

    const knobGlow = this.add.graphics();
    knobGlow.fillStyle(cfg.color, 0.35);
    knobGlow.fillCircle(0, 0, 18);
    knobGlow.lineStyle(2, cfg.color, 0.85);
    knobGlow.strokeCircle(0, 0, 18);

    const knobBg = this.add.graphics();
    knobBg.fillStyle(0xffffff, 0.95);
    knobBg.fillCircle(0, 0, 14);
    knobBg.lineStyle(1.5, 0x0f172a, 0.75);
    knobBg.strokeCircle(0, 0, 14);

    const knobBall = this.add.image(0, 0, 'ball').setDisplaySize(24, 24);

    knobContainer.add([knobGlow, knobBg, knobBall]);

    // Zona interactiva amplia para hacer clic o arrastrar con el mouse
    const hitZone = this.add
      .zone(trackX + trackWidth / 2, y, trackWidth + 28, 48)
      .setInteractive({ useHandCursor: true });

    const rowUI: StatRowUI = {
      config: cfg,
      valueText,
      valueBadge,
      trackGraphics,
      fillGraphics,
      knobContainer,
      knobGlow,
      knobBall,
      trackX,
      trackY,
      trackWidth,
      trackHeight,
      hitZone
    };

    hitZone.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.isTransitioning) return;
      this.activeDragRow = rowUI;
      this.updateStatFromPointerX(rowUI, pointer.x);
      knobContainer.setScale(1.2);
      knobGlow.setAlpha(0.9);
    });

    hitZone.on('pointerover', () => {
      if (this.isTransitioning || this.activeDragRow) return;
      knobContainer.setScale(1.1);
      knobGlow.setAlpha(0.7);
    });

    hitZone.on('pointerout', () => {
      if (this.activeDragRow !== rowUI) {
        knobContainer.setScale(1.0);
        knobGlow.setAlpha(0.35);
      }
    });

    hitZone.on('wheel', (_pointer: Phaser.Input.Pointer, _deltaX: number, deltaY: number) => {
      if (this.isTransitioning) return;
      const delta = deltaY > 0 ? -1 : 1;
      this.modifyStat(cfg.key, delta);
    });

    this.rows.push(rowUI);
  }

  private updateStatFromPointerX(row: StatRowUI, pointerX: number): void {
    const sumOther = this.getUsedPoints() - this.stats[row.config.key];
    const maxPossible = Math.min(this.maxStat, this.totalBudget - sumOther);
    const minPossible = this.minStat;

    const ratio = Phaser.Math.Clamp((pointerX - row.trackX) / row.trackWidth, 0, 1);
    const rawVal = Math.round(this.minStat + ratio * (this.maxStat - this.minStat));
    const newVal = Phaser.Math.Clamp(rawVal, minPossible, maxPossible);

    if (newVal !== this.stats[row.config.key]) {
      this.stats[row.config.key] = newVal;
      const now = this.time.now;
      if (now - this.lastTapSoundTime > 50 && this.cache.audio.exists('ui_tap')) {
        this.sound.play('ui_tap', { volume: 0.35 });
        this.lastTapSoundTime = now;
      }
      this.refreshUI();
    }
  }

  private createPresetButton(x: number, y: number, label: string, onClick: () => void): void {
    const bg = this.add
      .nineslice(x, y, 'ui_panel_grey', undefined, 210, 44, 14, 14, 14, 14)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    this.add
      .text(x, y, label, {
        fontFamily: 'sans-serif',
        fontSize: '14px',
        fontStyle: 'bold',
        color: '#0f172a'
      })
      .setOrigin(0.5);

    bg.on('pointerdown', () => {
      if (this.isTransitioning) return;
      if (this.cache.audio.exists('ui_tap')) {
        this.sound.play('ui_tap', { volume: 0.5 });
      }
      onClick();
    });
  }

  private getUsedPoints(): number {
    return (
      this.stats.speed +
      this.stats.shoot +
      this.stats.defense +
      this.stats.technique +
      this.stats.attack
    );
  }

  private getRemainingPoints(): number {
    return this.totalBudget - this.getUsedPoints();
  }

  private modifyStat(key: keyof PlayerStats, delta: number): void {
    const current = this.stats[key];
    const remaining = this.getRemainingPoints();

    let actualDelta = delta;
    if (actualDelta > 0) {
      actualDelta = Math.min(actualDelta, this.maxStat - current, remaining);
    } else if (actualDelta < 0) {
      actualDelta = -Math.min(-actualDelta, current - this.minStat);
    }

    if (actualDelta === 0) return;

    this.stats[key] = current + actualDelta;
    if (this.cache.audio.exists('ui_tap')) {
      this.sound.play('ui_tap', { volume: 0.35 });
    }
    this.refreshUI();
  }

  private refreshUI(): void {
    const remaining = this.getRemainingPoints();
    const used = this.getUsedPoints();

    if (remaining === 0) {
      this.remainingText.setText(`PUNTOS RESTANTES: 0  (${used}/${this.totalBudget}) ✓`);
      this.remainingText.setColor('#15803d');
    } else {
      this.remainingText.setText(`PUNTOS RESTANTES: ${remaining}  (${used}/${this.totalBudget})`);
      this.remainingText.setColor('#b45309');
    }

    for (const row of this.rows) {
      const val = this.stats[row.config.key];
      row.valueText.setText(String(val));

      const ratio = (val - this.minStat) / (this.maxStat - this.minStat);
      const fillW = Math.max(0, row.trackWidth * ratio);

      // Track de fondo y muescas / marcas
      row.trackGraphics.clear();
      row.trackGraphics.fillStyle(0x0a1120, 0.95);
      row.trackGraphics.fillRoundedRect(
        row.trackX,
        row.trackY,
        row.trackWidth,
        row.trackHeight,
        row.trackHeight / 2
      );
      row.trackGraphics.lineStyle(1.5, 0x334155, 0.85);
      row.trackGraphics.strokeRoundedRect(
        row.trackX,
        row.trackY,
        row.trackWidth,
        row.trackHeight,
        row.trackHeight / 2
      );

      // Muescas de referencia en 20, 30 y 40
      row.trackGraphics.lineStyle(1, 0x475569, 0.65);
      for (let tickStat = 20; tickStat <= 40; tickStat += 10) {
        const tickRatio = (tickStat - this.minStat) / (this.maxStat - this.minStat);
        const tickX = row.trackX + tickRatio * row.trackWidth;
        row.trackGraphics.lineBetween(tickX, row.trackY + 3, tickX, row.trackY + row.trackHeight - 3);
      }

      // Relleno de la barra según el valor
      row.fillGraphics.clear();
      if (fillW > 0) {
        row.fillGraphics.fillStyle(row.config.color, 0.95);
        row.fillGraphics.fillRoundedRect(
          row.trackX,
          row.trackY,
          Math.max(row.trackHeight, fillW),
          row.trackHeight,
          row.trackHeight / 2
        );

        // Brillo superior sutil
        row.fillGraphics.fillStyle(0xffffff, 0.28);
        row.fillGraphics.fillRoundedRect(
          row.trackX + 2,
          row.trackY + 2,
          Math.max(0, Math.max(row.trackHeight, fillW) - 4),
          row.trackHeight / 2 - 2,
          3
        );
      }

      // Posición del knob y rotación de la pelota al desplazarse
      const knobX = row.trackX + fillW;
      row.knobContainer.setPosition(knobX, row.trackY + row.trackHeight / 2);
      row.knobBall.setRotation(ratio * Math.PI * 4);
    }

    if (remaining === 0) {
      this.startBtnBg.setTexture('ui_btn_green_up');
      this.startBtnBg.clearTint();
      this.startBtnLabel.setText('¡LISTO! (IR AL LOBBY)');
      this.startButtonContainer.setAlpha(1);
    } else {
      this.startBtnBg.setTexture('ui_btn_green_down');
      this.startBtnBg.setTint(0x64748b);
      this.startBtnLabel.setText(`ASIGNA ${remaining} PTS MÁS`);
      this.startButtonContainer.setAlpha(0.78);
    }
  }

  private confirmProfileAndGoToLobby(): void {
    if (this.isTransitioning || this.getRemainingPoints() !== 0) return;
    this.isTransitioning = true;

    const cleanName = this.playerName.trim() || 'JUGADOR 1';
    this.registry.set('playerStats', { ...this.stats });
    this.registry.set('playerName', cleanName);
    this.registry.set('playerTeam', this.selectedTeam);

    // Enviar perfil por WebRTC (PeerJS) al otro jugador y entrar a la Sala de Espera (LobbyScene)
    peerManager.submitPlayerProfile(cleanName, this.selectedTeam, this.stats);

    if (this.cache.audio.exists('ui_click')) {
      this.sound.play('ui_click', { volume: 0.75 });
    }

    this.cameras.main.fadeOut(240, 15, 23, 42);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.start('LobbyScene');
    });
  }
}
