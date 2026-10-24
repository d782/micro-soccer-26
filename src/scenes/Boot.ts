import Phaser from 'phaser';

export class Boot extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload(): void {
    // Load minimal assets for preloader if needed
  }

  create(): void {
    this.scene.start('Preloader');
  }
}
