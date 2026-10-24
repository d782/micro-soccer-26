import Phaser from 'phaser';

export class Preloader extends Phaser.Scene {
  constructor() {
    super('Preloader');
  }

  preload(): void {
    const { width, height } = this.scale;

    const progressBox = this.add.graphics();
    const progressBar = this.add.graphics();
    progressBox.fillStyle(0x1f2937, 0.8);
    progressBox.fillRect(width / 2 - 160, height / 2 - 20, 320, 40);

    const loadingText = this.add
      .text(width / 2, height / 2 - 50, 'Cargando...', {
        fontFamily: 'KenneyFuture, sans-serif',
        fontSize: '20px',
        color: '#ffffff'
      })
      .setOrigin(0.5);

    this.load.on('progress', (value: number) => {
      progressBar.clear();
      progressBar.fillStyle(0x10b981, 1);
      progressBar.fillRect(width / 2 - 150, height / 2 - 10, 300 * value, 20);
    });

    this.load.on('complete', () => {
      progressBar.destroy();
      progressBox.destroy();
      loadingText.destroy();
    });

    // Precarga de assets del sports-pack
    this.load.image('ball', 'sports-pack/PNG/Equipment/ball_soccer1.png');
    this.load.image('player_blue_body', 'sports-pack/PNG/Blue/characterBlue (1).png');
    this.load.image('player_blue_arm', 'sports-pack/PNG/Blue/characterBlue (11).png');
    this.load.image('player_blue_foot', 'sports-pack/PNG/Blue/characterBlue (13).png');
    this.load.image('player_red_body', 'sports-pack/PNG/Red/characterRed (1).png');
    this.load.image('player_red_arm', 'sports-pack/PNG/Red/characterRed (11).png');
    this.load.image('player_red_foot', 'sports-pack/PNG/Red/characterRed (13).png');

    // Precarga de assets de la carpeta ui
    this.load.image('ui_btn_green_up', 'ui/PNG/Green/Double/button_rectangle_depth_gloss.png');
    this.load.image('ui_btn_green_down', 'ui/PNG/Green/Double/button_rectangle_flat.png');
    this.load.image('ui_btn_yellow_up', 'ui/PNG/Yellow/Double/button_rectangle_depth_gloss.png');
    this.load.image('ui_panel_blue', 'ui/PNG/Blue/Double/button_rectangle_depth_line.png');
    this.load.image('ui_panel_red', 'ui/PNG/Red/Double/button_rectangle_depth_line.png');
    this.load.image('ui_panel_grey', 'ui/PNG/Grey/Double/button_rectangle_depth_flat.png');
    this.load.image('ui_sq_blue', 'ui/PNG/Blue/Double/button_square_depth_gloss.png');
    this.load.image('ui_sq_red', 'ui/PNG/Red/Double/button_square_depth_gloss.png');
    this.load.image('ui_sq_green', 'ui/PNG/Green/Double/button_square_depth_gloss.png');
    this.load.image('ui_sq_grey', 'ui/PNG/Grey/Double/button_square_depth_flat.png');
    this.load.image('ui_icon_play', 'ui/PNG/Extra/Double/icon_play_light.png');
    this.load.image('ui_star', 'ui/PNG/Yellow/Double/star.png');

    // Imagen de portada del menú principal
    this.load.image('menu_banner', 'backgrounds/Imagen pegada.png');

    // Sonidos de UI, música del menú principal y efecto de gol
    this.load.audio('ui_click', 'ui/Sounds/click-a.ogg');
    this.load.audio('ui_tap', 'ui/Sounds/tap-a.ogg');
    this.load.audio('menu_music', 'sounds/menu.mp3');
    this.load.audio('goal_sfx', 'sounds/gol.mp3');
  }

  create(): void {
    this.scene.start('MenuScene');
  }
}
