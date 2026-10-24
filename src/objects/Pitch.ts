import Phaser from 'phaser';

export interface PitchConfig {
  x: number;
  y: number;
  width: number;
  height: number;
  stripeWidth?: number;
  goalWidth?: number;
  goalDepth?: number;
}

export class Pitch {
  private scene: Phaser.Scene;
  public readonly bounds: Phaser.Geom.Rectangle;
  public readonly leftGoalBounds: Phaser.Geom.Rectangle;
  public readonly rightGoalBounds: Phaser.Geom.Rectangle;
  public readonly leftPenaltyBox: Phaser.Geom.Rectangle;
  public readonly rightPenaltyBox: Phaser.Geom.Rectangle;
  public readonly leftGoalArea: Phaser.Geom.Rectangle;
  public readonly rightGoalArea: Phaser.Geom.Rectangle;
  public readonly centerSpot: Phaser.Math.Vector2;
  public readonly leftPenaltySpot: Phaser.Math.Vector2;
  public readonly rightPenaltySpot: Phaser.Math.Vector2;
  public readonly centerRadius: number = 76;

  // Grupos físicos estáticos para bandas, redes de las porterías, postes, travesaños y sensores internos de gol
  public wallsGroup!: Phaser.Physics.Arcade.StaticGroup;
  public netsGroup!: Phaser.Physics.Arcade.StaticGroup;
  public postsGroup!: Phaser.Physics.Arcade.StaticGroup;
  public crossbarsGroup!: Phaser.Physics.Arcade.StaticGroup;
  public leftGoalSensorZone!: Phaser.GameObjects.Zone;
  public rightGoalSensorZone!: Phaser.GameObjects.Zone;

  private stripeWidth: number;
  private goalWidth: number;
  private goalDepth: number;

  constructor(scene: Phaser.Scene, config: PitchConfig) {
    this.scene = scene;
    this.stripeWidth = config.stripeWidth ?? 64;
    this.goalWidth = config.goalWidth ?? 140;
    this.goalDepth = config.goalDepth ?? 42;

    this.bounds = new Phaser.Geom.Rectangle(config.x, config.y, config.width, config.height);

    const centerY = this.bounds.centerY;

    // Porterías (ubicadas por fuera de la línea de meta)
    this.leftGoalBounds = new Phaser.Geom.Rectangle(
      this.bounds.left - this.goalDepth,
      centerY - this.goalWidth / 2,
      this.goalDepth,
      this.goalWidth
    );

    this.rightGoalBounds = new Phaser.Geom.Rectangle(
      this.bounds.right,
      centerY - this.goalWidth / 2,
      this.goalDepth,
      this.goalWidth
    );

    // Áreas grandes (Área penal para 5v5)
    const penaltyWidth = 170;
    const penaltyHeight = 330;
    this.leftPenaltyBox = new Phaser.Geom.Rectangle(
      this.bounds.left,
      centerY - penaltyHeight / 2,
      penaltyWidth,
      penaltyHeight
    );
    this.rightPenaltyBox = new Phaser.Geom.Rectangle(
      this.bounds.right - penaltyWidth,
      centerY - penaltyHeight / 2,
      penaltyWidth,
      penaltyHeight
    );

    // Áreas chicas (Área del portero)
    const goalAreaWidth = 68;
    const goalAreaHeight = 200;
    this.leftGoalArea = new Phaser.Geom.Rectangle(
      this.bounds.left,
      centerY - goalAreaHeight / 2,
      goalAreaWidth,
      goalAreaHeight
    );
    this.rightGoalArea = new Phaser.Geom.Rectangle(
      this.bounds.right - goalAreaWidth,
      centerY - goalAreaHeight / 2,
      goalAreaWidth,
      goalAreaHeight
    );

    // Puntos de saque y penal
    this.centerSpot = new Phaser.Math.Vector2(this.bounds.centerX, centerY);
    this.leftPenaltySpot = new Phaser.Math.Vector2(this.bounds.left + 118, centerY);
    this.rightPenaltySpot = new Phaser.Math.Vector2(this.bounds.right - 118, centerY);

    this.createPhysicsColliders();
  }

  /**
   * Crea los colisionadores estáticos de cada portería (Local y Visitante) y de la cancha con 3 componentes independientes:
   * 1. POSTES: 4 cuerpos circulares estáticos con alta restitución (0.85).
   * 2. CUBIERTA Y RED: 3 paredes estáticas independientes por arco (Pared Posterior, Pared Lateral Norte y Pared Lateral Sur) con grosor anti-tunneling.
   * 3. SENSOR DE GOL INTERNO: Sensor posicionado exclusivamente dentro del cajón de cada portería, detrás de la línea de gol.
   */
  private createPhysicsColliders(): void {
    this.wallsGroup = this.scene.physics.add.staticGroup();
    this.netsGroup = this.scene.physics.add.staticGroup();
    this.postsGroup = this.scene.physics.add.staticGroup();
    this.crossbarsGroup = this.scene.physics.add.staticGroup();

    const { left, right, top, bottom, width } = this.bounds;
    const goalTop = this.leftGoalBounds.top;
    const goalBottom = this.leftGoalBounds.bottom;
    const wallThickness = 36; // Grosor reforzado para evitar tunneling a altas velocidades

    // 1. Bandas superior e inferior de la cancha
    this.addStaticRect(
      this.wallsGroup,
      left - this.goalDepth - wallThickness,
      top - wallThickness,
      width + (this.goalDepth + wallThickness) * 2,
      wallThickness
    );
    this.addStaticRect(
      this.wallsGroup,
      left - this.goalDepth - wallThickness,
      bottom,
      width + (this.goalDepth + wallThickness) * 2,
      wallThickness
    );

    // 2. Líneas de fondo izquierda y derecha (dejando abierta únicamente la boca frontal entre goalTop y goalBottom)
    const topSegmentHeight = goalTop - top;
    const bottomSegmentHeight = bottom - goalBottom;

    this.addStaticRect(this.wallsGroup, left - wallThickness, top, wallThickness, topSegmentHeight);
    this.addStaticRect(this.wallsGroup, left - wallThickness, goalBottom, wallThickness, bottomSegmentHeight);

    this.addStaticRect(this.wallsGroup, right, top, wallThickness, topSegmentHeight);
    this.addStaticRect(this.wallsGroup, right, goalBottom, wallThickness, bottomSegmentHeight);

    // 3. CUBIERTA Y RED — Portería Izquierda (Local): 3 paredes independientes (Norte, Sur y Posterior)
    const netThickness = 32; // Grosor >= 10px (32px) para bloquear cualquier intento de entrada lateral o salida por velocidad
    // Pared Lateral Norte (Superior)
    this.addStaticRect(
      this.netsGroup,
      this.leftGoalBounds.left - netThickness,
      goalTop - netThickness,
      this.goalDepth + netThickness,
      netThickness
    );
    // Pared Lateral Sur (Inferior)
    this.addStaticRect(
      this.netsGroup,
      this.leftGoalBounds.left - netThickness,
      goalBottom,
      this.goalDepth + netThickness,
      netThickness
    );
    // Pared Posterior (Fondo de red)
    this.addStaticRect(
      this.netsGroup,
      this.leftGoalBounds.left - netThickness,
      goalTop,
      netThickness,
      this.goalWidth
    );

    // 4. CUBIERTA Y RED — Portería Derecha (Visitante): 3 paredes independientes (Norte, Sur y Posterior)
    // Pared Lateral Norte (Superior)
    this.addStaticRect(
      this.netsGroup,
      right,
      goalTop - netThickness,
      this.goalDepth + netThickness,
      netThickness
    );
    // Pared Lateral Sur (Inferior)
    this.addStaticRect(
      this.netsGroup,
      right,
      goalBottom,
      this.goalDepth + netThickness,
      netThickness
    );
    // Pared Posterior (Fondo de red)
    this.addStaticRect(
      this.netsGroup,
      this.rightGoalBounds.right,
      goalTop,
      netThickness,
      this.goalWidth
    );

    // 5. POSTES Y TRAVESAÑOS: 4 cuerpos circulares estáticos para los postes + 2 travesaños físicos sobre la línea de gol
    const postRadius = 6;
    this.addStaticPost(left, goalTop, postRadius);
    this.addStaticPost(left, goalBottom, postRadius);
    this.addStaticPost(right, goalTop, postRadius);
    this.addStaticPost(right, goalBottom, postRadius);

    // Travesaños físicos (actúan como barrera sólida cuando ball.isAirborne === true en pases largos)
    const crossbarThickness = 14;
    this.addStaticRect(
      this.crossbarsGroup,
      left - crossbarThickness,
      goalTop,
      crossbarThickness,
      this.goalWidth
    );
    this.addStaticRect(
      this.crossbarsGroup,
      right,
      goalTop,
      crossbarThickness,
      this.goalWidth
    );

    // 6. SENSORES DE GOL INTERNOS: Posicionados exclusivamente dentro del cajón detrás de la línea de meta
    const sensorInset = 8; // Margen interior detrás de la línea de gol y separado de las paredes de la red
    const sensorWidth = Math.max(12, this.goalDepth - sensorInset * 1.5);
    const sensorHeight = this.goalWidth - sensorInset * 2;

    this.leftGoalSensorZone = this.createGoalSensor(
      this.leftGoalBounds.left + 4,
      goalTop + sensorInset,
      sensorWidth,
      sensorHeight
    );

    this.rightGoalSensorZone = this.createGoalSensor(
      right + sensorInset,
      goalTop + sensorInset,
      sensorWidth,
      sensorHeight
    );
  }

  private createGoalSensor(
    x: number,
    y: number,
    width: number,
    height: number
  ): Phaser.GameObjects.Zone {
    const sensor = this.scene.add.zone(x + width / 2, y + height / 2, width, height);
    this.scene.physics.add.existing(sensor, true);
    return sensor;
  }

  private addStaticRect(
    group: Phaser.Physics.Arcade.StaticGroup,
    x: number,
    y: number,
    width: number,
    height: number
  ): void {
    const zone = this.scene.add.zone(x + width / 2, y + height / 2, width, height);
    this.scene.physics.add.existing(zone, true);
    group.add(zone);
  }

  private addStaticPost(x: number, y: number, radius: number): void {
    const zone = this.scene.add.zone(x, y, radius * 2, radius * 2);
    this.scene.physics.add.existing(zone, true);
    const body = zone.body as Phaser.Physics.Arcade.StaticBody;
    body.setCircle(radius);
    this.postsGroup.add(zone);
  }

  /**
   * Verifica si las coordenadas (x, y) del balón han cruzado completamente la línea de gol.
   */
  public checkGoalScored(ballX: number, ballY: number, ballRadius: number = 9): 'left' | 'right' | null {
    const inGoalMouthY =
      ballY >= this.leftGoalBounds.top + 2 && ballY <= this.leftGoalBounds.bottom - 2;

    if (!inGoalMouthY) return null;

    if (ballX + ballRadius < this.bounds.left && ballX >= this.leftGoalBounds.left - 4) {
      return 'left';
    }
    if (ballX - ballRadius > this.bounds.right && ballX <= this.rightGoalBounds.right + 4) {
      return 'right';
    }
    return null;
  }

  public render(): void {
    const graphics = this.scene.add.graphics();
    const { left, right, top, bottom, width, height, centerX, centerY } = this.bounds;

    // 1. Exterior de la cancha (césped perimetral)
    const camWidth = this.scene.scale.width;
    const camHeight = this.scene.scale.height;
    graphics.fillStyle(0x14a84b, 1);
    graphics.fillRect(0, 0, camWidth, camHeight);

    // Franjas de césped en toda la superficie (estilo Kenney Sample1)
    const totalStripes = Math.ceil(camWidth / this.stripeWidth);
    for (let i = 0; i < totalStripes; i++) {
      const isLight = i % 2 === 0;
      graphics.fillStyle(isLight ? 0x1dd161 : 0x17c056, 1);
      graphics.fillRect(i * this.stripeWidth, 0, this.stripeWidth, camHeight);
    }

    // Sombra sutil exterior fuera de las líneas de banda para resaltar el campo activo
    graphics.fillStyle(0x000000, 0.08);
    graphics.fillRect(0, 0, camWidth, top);
    graphics.fillRect(0, bottom, camWidth, camHeight - bottom);
    graphics.fillRect(0, top, left, height);
    graphics.fillRect(right, top, camWidth - right, height);

    // 2. Líneas blancas principales de la cancha
    const lineWidth = 3;
    graphics.lineStyle(lineWidth, 0xffffff, 0.95);

    // Contorno perimetral (líneas de banda y de meta)
    graphics.strokeRect(left, top, width, height);

    // Línea central
    graphics.lineBetween(centerX, top, centerX, bottom);

    // Círculo central y punto de saque inicial
    graphics.strokeCircle(centerX, centerY, this.centerRadius);
    graphics.fillStyle(0xffffff, 0.95);
    graphics.fillCircle(centerX, centerY, 4.5);

    // 3. Áreas penales (izquierda y derecha)
    graphics.strokeRect(
      this.leftPenaltyBox.x,
      this.leftPenaltyBox.y,
      this.leftPenaltyBox.width,
      this.leftPenaltyBox.height
    );
    graphics.strokeRect(
      this.rightPenaltyBox.x,
      this.rightPenaltyBox.y,
      this.rightPenaltyBox.width,
      this.rightPenaltyBox.height
    );

    // Áreas de meta / portero (izquierda y derecha)
    graphics.strokeRect(
      this.leftGoalArea.x,
      this.leftGoalArea.y,
      this.leftGoalArea.width,
      this.leftGoalArea.height
    );
    graphics.strokeRect(
      this.rightGoalArea.x,
      this.rightGoalArea.y,
      this.rightGoalArea.width,
      this.rightGoalArea.height
    );

    // Puntos de penal
    graphics.fillCircle(this.leftPenaltySpot.x, this.leftPenaltySpot.y, 4);
    graphics.fillCircle(this.rightPenaltySpot.x, this.rightPenaltySpot.y, 4);

    // Semicírculos (medialunas) del área penal
    const penaltyArcRadius = 68;
    const dx = this.leftPenaltyBox.right - this.leftPenaltySpot.x;
    const arcAngle = Math.acos(dx / penaltyArcRadius);

    graphics.beginPath();
    graphics.arc(
      this.leftPenaltySpot.x,
      this.leftPenaltySpot.y,
      penaltyArcRadius,
      -arcAngle,
      arcAngle,
      false
    );
    graphics.strokePath();

    graphics.beginPath();
    graphics.arc(
      this.rightPenaltySpot.x,
      this.rightPenaltySpot.y,
      penaltyArcRadius,
      Math.PI - arcAngle,
      Math.PI + arcAngle,
      false
    );
    graphics.strokePath();

    // 4. Tiros de esquina (4 córners)
    const cornerRadius = 18;
    graphics.beginPath();
    graphics.arc(left, top, cornerRadius, 0, Math.PI / 2, false);
    graphics.strokePath();

    graphics.beginPath();
    graphics.arc(left, bottom, cornerRadius, -Math.PI / 2, 0, false);
    graphics.strokePath();

    graphics.beginPath();
    graphics.arc(right, top, cornerRadius, Math.PI / 2, Math.PI, false);
    graphics.strokePath();

    graphics.beginPath();
    graphics.arc(right, bottom, cornerRadius, Math.PI, (3 * Math.PI) / 2, false);
    graphics.strokePath();

    // 5. Porterías con red cuadriculada (en una capa superior para que la red cubra el balón al entrar)
    const goalGraphics = this.scene.add.graphics().setDepth(15);
    this.drawGoal(goalGraphics, this.leftGoalBounds, 'left');
    this.drawGoal(goalGraphics, this.rightGoalBounds, 'right');
  }

  private drawGoal(
    graphics: Phaser.GameObjects.Graphics,
    goalRect: Phaser.Geom.Rectangle,
    side: 'left' | 'right'
  ): void {
    const { x, y, width, height } = goalRect;

    // Fondo translúcido de la portería
    graphics.fillStyle(0xffffff, 0.22);
    graphics.fillRect(x, y, width, height);

    // Patrón de red cuadriculada (se dibuja por encima del balón para dar efecto de estar dentro de la red)
    const meshSize = 6;
    graphics.lineStyle(1, 0xe5e7eb, 0.55);
    for (let gx = x + meshSize; gx < x + width; gx += meshSize) {
      graphics.lineBetween(gx, y, gx, y + height);
    }
    for (let gy = y + meshSize; gy < y + height; gy += meshSize) {
      graphics.lineBetween(x, gy, x + width, gy);
    }

    // Postes y travesaño metálicos/blancos
    graphics.lineStyle(4, 0xd1d5db, 1);
    if (side === 'left') {
      graphics.strokeRect(x, y, width, height);
      graphics.lineStyle(3, 0xffffff, 1);
      graphics.lineBetween(x + width, y, x, y);
      graphics.lineBetween(x, y, x, y + height);
      graphics.lineBetween(x, y + height, x + width, y + height);
      graphics.fillStyle(0xffffff, 1);
      graphics.fillCircle(x + width, y, 4.5);
      graphics.fillCircle(x + width, y + height, 4.5);
    } else {
      graphics.strokeRect(x, y, width, height);
      graphics.lineStyle(3, 0xffffff, 1);
      graphics.lineBetween(x, y, x + width, y);
      graphics.lineBetween(x + width, y, x + width, y + height);
      graphics.lineBetween(x + width, y + height, x, y + height);
      graphics.fillStyle(0xffffff, 1);
      graphics.fillCircle(x, y, 4.5);
      graphics.fillCircle(x, y + height, 4.5);
    }
  }
}
