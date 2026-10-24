import Phaser from 'phaser';
import { peerManager } from '../network/PeerManager';

export class MenuScene extends Phaser.Scene {
  private isTransitioning = false;
  private isJoinMode = false;
  private joinCode = '';
  private cursorBlink = true;

  private joinContainer!: Phaser.GameObjects.Container;
  private joinInputBox!: Phaser.GameObjects.Graphics;
  private joinCodeText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;

  constructor() {
    super('MenuScene');
  }

  create(): void {
    this.isTransitioning = false;
    this.isJoinMode = false;
    this.joinCode = '';
    this.cursorBlink = true;

    this.startMenuMusic();

    const { width, height } = this.scale;

    // 1. Fondo de cancha estilizada con franjas de césped y círculo central
    const bg = this.add.graphics();
    const stripeWidth = 64;
    const totalStripes = Math.ceil(width / stripeWidth);
    for (let i = 0; i < totalStripes; i++) {
      bg.fillStyle(i % 2 === 0 ? 0x1dd161 : 0x17c056, 1);
      bg.fillRect(i * stripeWidth, 0, stripeWidth, height);
    }

    bg.fillStyle(0x0b1f13, 0.5);
    bg.fillRect(0, 0, width, height);

    bg.lineStyle(4, 0xffffff, 0.22);
    bg.strokeRect(64, 60, width - 128, height - 120);
    bg.lineBetween(width / 2, 60, width / 2, height - 60);
    bg.strokeCircle(width / 2, height / 2, 110);

    // 2. Tarjeta central del Lobby de Red (NineSlice)
    const cardW = 640;
    const cardH = 560;
    const cardShadow = this.add.graphics();
    cardShadow.fillStyle(0x000000, 0.38);
    cardShadow.fillRoundedRect(width / 2 - cardW / 2 + 6, height / 2 - cardH / 2 + 8, cardW, cardH, 24);

    this.add
      .nineslice(width / 2, height / 2, 'ui_panel_blue', undefined, cardW, cardH, 28, 28, 28, 28)
      .setAlpha(0.97);

    // Estrellas decorativas superiores
    const starLeft = this.add.image(width / 2 - 70, height / 2 - 265, 'ui_star').setScale(0.55);
    this.add.image(width / 2, height / 2 - 280, 'ui_star').setScale(0.75);
    const starRight = this.add.image(width / 2 + 70, height / 2 - 265, 'ui_star').setScale(0.55);
    starLeft.setAngle(-12);
    starRight.setAngle(12);

    // 3. Título del juego e imagen de portada (backgrounds/Imagen pegada.png)
    this.add
      .text(width / 2, height / 2 - 205, 'MICRO SOCCER 26', {
        fontFamily: 'KenneyFuture, sans-serif',
        fontSize: '40px',
        fontStyle: 'bold',
        color: '#ffffff',
        stroke: '#0f172a',
        strokeThickness: 8
      })
      .setOrigin(0.5);

    this.add
      .text(width / 2, height / 2 - 162, 'ONLINE SOCCER MULTIPLAYER GAME', {
        fontFamily: 'sans-serif',
        fontSize: '16px',
        fontStyle: 'bold',
        color: '#fef08a',
        stroke: '#0f172a',
        strokeThickness: 4
      })
      .setOrigin(0.5);

    const bannerY = height / 2 - 58;
    const bannerW = 228;
    const bannerH = 166;

    const bannerFrame = this.add.graphics();
    bannerFrame.fillStyle(0x0f172a, 0.85);
    bannerFrame.fillRoundedRect(
      width / 2 - bannerW / 2 - 5,
      bannerY - bannerH / 2 - 5,
      bannerW + 10,
      bannerH + 10,
      12
    );
    bannerFrame.lineStyle(3, 0xfacc15, 0.95);
    bannerFrame.strokeRoundedRect(
      width / 2 - bannerW / 2 - 5,
      bannerY - bannerH / 2 - 5,
      bannerW + 10,
      bannerH + 10,
      12
    );

    const bannerImg = this.add
      .image(width / 2, bannerY, 'menu_banner')
      .setDisplaySize(bannerW, bannerH);

    const maskShape = this.make.graphics({});
    maskShape.fillStyle(0xffffff);
    maskShape.fillRoundedRect(
      width / 2 - bannerW / 2,
      bannerY - bannerH / 2,
      bannerW,
      bannerH,
      9
    );
    bannerImg.setMask(maskShape.createGeometryMask());

    // 4. Dos botones principales: "CREAR SALA" (Host) y "UNIRSE A SALA" (Join)
    this.createActionButton(
      width / 2 - 145,
      height / 2 + 78,
      250,
      56,
      'ui_btn_green_up',
      'CREAR SALA',
      '#064e3b',
      () => this.handleCreateRoom()
    );

    this.createActionButton(
      width / 2 + 145,
      height / 2 + 78,
      250,
      56,
      'ui_btn_yellow_up',
      'UNIRSE A SALA',
      '#713f12',
      () => this.toggleJoinInput(true)
    );

    // 5. Panel desplegable para ingresar el código del Host al pulsar "Unirse a Sala"
    this.createJoinInputSection(width / 2, height / 2 + 158);

    // 6. Texto de estado de conexión WebRTC/PeerJS
    this.statusText = this.add
      .text(width / 2, height / 2 + 232, 'Selecciona Crear Sala (Host) o Unirse con código', {
        fontFamily: 'sans-serif',
        fontSize: '14px',
        fontStyle: 'bold',
        color: '#e0f2fe',
        stroke: '#0f172a',
        strokeThickness: 3
      })
      .setOrigin(0.5);

    // Captura de teclado para escribir el código de sala
    if (this.input.keyboard) {
      this.input.keyboard.on('keydown', (event: KeyboardEvent) => {
        if (this.isTransitioning || !this.isJoinMode) return;

        if (event.key === 'Backspace') {
          this.joinCode = this.joinCode.slice(0, -1);
          this.renderJoinBox();
          return;
        }

        if (event.key === 'Enter' && this.joinCode.trim().length >= 3) {
          this.handleJoinRoom();
          return;
        }

        if (
          event.key.length === 1 &&
          /^[a-zA-Z0-9]$/.test(event.key) &&
          !event.ctrlKey &&
          !event.metaKey &&
          this.joinCode.length < 6
        ) {
          this.joinCode += event.key.toUpperCase();
          this.renderJoinBox();
        }
      });
    }

    this.time.addEvent({
      delay: 480,
      loop: true,
      callback: () => {
        this.cursorBlink = !this.cursorBlink;
        if (this.isJoinMode) {
          this.renderJoinBox();
        }
      }
    });
  }

  private createActionButton(
    x: number,
    y: number,
    w: number,
    h: number,
    texture: string,
    label: string,
    strokeColor: string,
    onClick: () => void
  ): Phaser.GameObjects.Container {
    const container = this.add.container(x, y);
    const bg = this.add.nineslice(0, 0, texture, undefined, w, h, 18, 18, 18, 18);
    const txt = this.add
      .text(0, -2, label, {
        fontFamily: 'sans-serif',
        fontSize: '18px',
        fontStyle: 'bold',
        color: '#ffffff',
        stroke: strokeColor,
        strokeThickness: 4
      })
      .setOrigin(0.5);

    container.add([bg, txt]);
    container.setSize(w, h);
    container.setInteractive({ useHandCursor: true });

    container.on('pointerover', () => {
      if (this.isTransitioning) return;
      bg.setTint(0xf8fafc);
      if (this.cache.audio.exists('ui_tap')) {
        this.sound.play('ui_tap', { volume: 0.35 });
      }
    });

    container.on('pointerout', () => {
      bg.clearTint();
    });

    container.on('pointerup', () => {
      if (this.isTransitioning) return;
      if (this.cache.audio.exists('ui_click')) {
        this.sound.play('ui_click', { volume: 0.65 });
      }
      onClick();
    });

    return container;
  }

  private createJoinInputSection(centerX: number, centerY: number): void {
    this.joinContainer = this.add.container(centerX, centerY);

    const label = this.add
      .text(-245, 0, 'CÓDIGO SALA:', {
        fontFamily: 'sans-serif',
        fontSize: '15px',
        fontStyle: 'bold',
        color: '#fef08a',
        stroke: '#0f172a',
        strokeThickness: 3
      })
      .setOrigin(0, 0.5);

    this.joinInputBox = this.add.graphics();
    this.joinCodeText = this.add
      .text(-35, 0, '', {
        fontFamily: 'monospace',
        fontSize: '21px',
        fontStyle: 'bold',
        color: '#ffffff'
      })
      .setOrigin(0.5);

    const connectBtn = this.add
      .nineslice(165, 0, 'ui_btn_green_up', undefined, 160, 44, 14, 14, 14, 14)
      .setInteractive({ useHandCursor: true });

    const connectTxt = this.add
      .text(165, -2, 'CONECTAR', {
        fontFamily: 'sans-serif',
        fontSize: '15px',
        fontStyle: 'bold',
        color: '#ffffff',
        stroke: '#064e3b',
        strokeThickness: 3
      })
      .setOrigin(0.5);

    connectBtn.on('pointerup', () => {
      this.handleJoinRoom();
    });

    this.joinContainer.add([label, this.joinInputBox, this.joinCodeText, connectBtn, connectTxt]);
    this.joinContainer.setVisible(false);
    this.renderJoinBox();
  }

  private toggleJoinInput(show: boolean): void {
    this.isJoinMode = show;
    this.joinContainer.setVisible(show);
    if (show) {
      this.statusText.setText('Escribe el código de 5 caracteres del Host y presiona CONECTAR');
      this.statusText.setColor('#fef08a');
      this.renderJoinBox();
    }
  }

  private renderJoinBox(): void {
    this.joinInputBox.clear();
    this.joinInputBox.fillStyle(0x0f172a, 0.9);
    this.joinInputBox.fillRoundedRect(-115, -22, 160, 44, 10);
    this.joinInputBox.lineStyle(2, 0xfacc15, 0.95);
    this.joinInputBox.strokeRoundedRect(-115, -22, 160, 44, 10);

    const cursor = this.cursorBlink ? '|' : '';
    this.joinCodeText.setText(`${this.joinCode}${cursor}`);
  }

  private async handleCreateRoom(): Promise<void> {
    if (this.isTransitioning) return;
    this.isTransitioning = true;

    this.statusText.setText('Generando código de sala e iniciando nodo Host WebRTC...');
    this.statusText.setColor('#38bdf8');

    const code = await peerManager.createRoom();
    this.statusText.setText(`¡Sala creada! Código: ${code}  •  Entrando a Configuración...`);

    this.cameras.main.fadeOut(240, 15, 23, 42);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.start('SkillScene');
    });
  }

  private async handleJoinRoom(): Promise<void> {
    if (this.isTransitioning) return;
    const clean = this.joinCode.trim().toUpperCase();
    if (clean.length < 3) {
      this.statusText.setText('Ingresa un código de sala válido (ej. K7M4P)');
      this.statusText.setColor('#f87171');
      return;
    }

    this.isTransitioning = true;
    this.statusText.setText(`Conectando a la sala ${clean} vía WebRTC...`);
    this.statusText.setColor('#38bdf8');

    try {
      await peerManager.joinRoom(clean);
      this.statusText.setText(`¡Conectado a la sala ${clean}! Entrando a Configuración...`);
      this.statusText.setColor('#4ade80');

      this.cameras.main.fadeOut(240, 15, 23, 42);
      this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
        this.scene.start('SkillScene');
      });
    } catch (err) {
      this.isTransitioning = false;
      const msg = err instanceof Error ? err.message : 'Error al conectar a la sala';
      this.statusText.setText(msg);
      this.statusText.setColor('#f87171');
    }
  }

  private startMenuMusic(): void {
    this.sound.pauseOnBlur = false;
    if (!this.cache.audio.exists('menu_music')) return;

    let music = this.sound.get('menu_music');
    if (!music) {
      music = this.sound.add('menu_music', { loop: true, volume: 0.55 });
    }

    const tryPlay = () => {
      if (!music.isPlaying && !this.scene.isActive('MainScene')) {
        music.play();
      }
    };

    if (!this.sound.locked) {
      tryPlay();
    } else {
      this.sound.once(Phaser.Sound.Events.UNLOCKED, tryPlay);
    }

    this.input.once('pointerdown', tryPlay);
    this.input.keyboard?.once('keydown', tryPlay);
  }
}
