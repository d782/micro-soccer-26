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
  barGraphics: Phaser.GameObjects.Graphics;
  barX: number;
  barY: number;
  barWidth: number;
  barHeight: number;
  minus5Btn: Phaser.GameObjects.Image;
  minus1Btn: Phaser.GameObjects.Image;
  plus1Btn: Phaser.GameObjects.Image;
  plus5Btn: Phaser.GameObjects.Image;
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

    // Nota informativa de límites
    this.add
      .text(
        panelX,
        536,
        'Límites por atributo: mínimo 10  •  máximo 50  •  Asigna todos los puntos y presiona ¡LISTO! para ir a la Sala de Espera',
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
    rowBg.fillStyle(0x0f172a, 0.42);
    rowBg.fillRoundedRect(leftX, y - 26, rowWidth, 52, 12);

    this.add
      .text(leftX + 20, y - 9, cfg.label, {
        fontFamily: 'sans-serif',
        fontSize: '17px',
        fontStyle: 'bold',
        color: '#ffffff',
        stroke: '#0f172a',
        strokeThickness: 3
      })
      .setOrigin(0, 0.5);

    this.add
      .text(leftX + 20, y + 12, cfg.description, {
        fontFamily: 'sans-serif',
        fontSize: '13px',
        color: '#cbd5e1'
      })
      .setOrigin(0, 0.5);

    const barX = 495;
    const barY = y - 10;
    const barWidth = 265;
    const barHeight = 20;
    const barGraphics = this.add.graphics();

    const valueText = this.add
      .text(barX + barWidth + 48, y, '25', {
        fontFamily: 'sans-serif',
        fontSize: '21px',
        fontStyle: 'bold',
        color: '#fef08a',
        stroke: '#0f172a',
        strokeThickness: 4
      })
      .setOrigin(0.5);

    const btnBaseX = 885;
    const btnStep = 56;
    const minus5Btn = this.createAdjustButton(btnBaseX, y, '-5', 'ui_sq_red', () => {
      this.modifyStat(cfg.key, -5);
    });
    const minus1Btn = this.createAdjustButton(btnBaseX + btnStep, y, '-1', 'ui_sq_red', () => {
      this.modifyStat(cfg.key, -1);
    });
    const plus1Btn = this.createAdjustButton(btnBaseX + btnStep * 2, y, '+1', 'ui_sq_green', () => {
      this.modifyStat(cfg.key, 1);
    });
    const plus5Btn = this.createAdjustButton(btnBaseX + btnStep * 3, y, '+5', 'ui_sq_green', () => {
      this.modifyStat(cfg.key, 5);
    });

    this.rows.push({
      config: cfg,
      valueText,
      barGraphics,
      barX,
      barY,
      barWidth,
      barHeight,
      minus5Btn,
      minus1Btn,
      plus1Btn,
      plus5Btn
    });
  }

  private createAdjustButton(
    x: number,
    y: number,
    text: string,
    texture: string,
    onClick: () => void
  ): Phaser.GameObjects.Image {
    const btn = this.add
      .image(x, y, texture)
      .setDisplaySize(46, 40)
      .setInteractive({ useHandCursor: true });

    this.add
      .text(x, y - 1, text, {
        fontFamily: 'sans-serif',
        fontSize: '15px',
        fontStyle: 'bold',
        color: '#ffffff',
        stroke: '#0f172a',
        strokeThickness: 3
      })
      .setOrigin(0.5);

    btn.on('pointerdown', () => {
      if (this.isTransitioning) return;
      onClick();
    });

    return btn;
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
      this.sound.play('ui_tap', { volume: 0.45 });
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
      row.barGraphics.clear();
      row.barGraphics.fillStyle(0x0f172a, 0.88);
      row.barGraphics.fillRoundedRect(row.barX, row.barY, row.barWidth, row.barHeight, 6);

      const fillW = Math.max(8, row.barWidth * ratio);
      row.barGraphics.fillStyle(row.config.color, 1);
      row.barGraphics.fillRoundedRect(row.barX, row.barY, fillW, row.barHeight, 6);

      row.barGraphics.lineStyle(1.5, 0xffffff, 0.4);
      row.barGraphics.strokeRoundedRect(row.barX, row.barY, row.barWidth, row.barHeight, 6);

      const canSub = val > this.minStat;
      const canAdd = val < this.maxStat && remaining > 0;
      row.minus1Btn.setAlpha(canSub ? 1 : 0.35);
      row.minus5Btn.setAlpha(canSub ? 1 : 0.35);
      row.plus1Btn.setAlpha(canAdd ? 1 : 0.35);
      row.plus5Btn.setAlpha(canAdd ? 1 : 0.35);
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
