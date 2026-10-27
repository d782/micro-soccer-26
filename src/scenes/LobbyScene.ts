import Phaser from 'phaser';
import {
  peerManager,
  LobbyPlayerProfile,
  MIN_ROOM_PLAYERS,
  MAX_ROOM_PLAYERS,
  MAX_PLAYERS_PER_TEAM
} from '../network/PeerManager';

export class LobbyScene extends Phaser.Scene {
  private isTransitioning = false;
  private playersContainer!: Phaser.GameObjects.Container;
  private statusBannerText!: Phaser.GameObjects.Text;
  private startButtonContainer!: Phaser.GameObjects.Container;
  private startBtnBg!: Phaser.GameObjects.NineSlice;
  private startBtnLabel!: Phaser.GameObjects.Text;
  private roomCodeText!: Phaser.GameObjects.Text;
  private copyBtnBg!: Phaser.GameObjects.NineSlice;
  private copyBtnText!: Phaser.GameObjects.Text;
  private copyFeedbackTimer?: Phaser.Time.TimerEvent;

  constructor() {
    super('LobbyScene');
  }

  create(): void {
    this.isTransitioning = false;
    this.cameras.main.fadeIn(220, 15, 23, 42);

    const { width, height } = this.scale;

    // 1. Fondo de cancha con viñeta oscura
    const bg = this.add.graphics();
    const stripeWidth = 64;
    const totalStripes = Math.ceil(width / stripeWidth);
    for (let i = 0; i < totalStripes; i++) {
      bg.fillStyle(i % 2 === 0 ? 0x1dd161 : 0x17c056, 1);
      bg.fillRect(i * stripeWidth, 0, stripeWidth, height);
    }
    bg.fillStyle(0x0b1f13, 0.65);
    bg.fillRect(0, 0, width, height);

    // 2. Panel principal de la Sala de Espera (960 x 600)
    const panelW = 960;
    const panelH = 600;
    const panelX = width / 2;
    const panelY = height / 2;

    const shadow = this.add.graphics();
    shadow.fillStyle(0x000000, 0.42);
    shadow.fillRoundedRect(
      panelX - panelW / 2 + 6,
      panelY - panelH / 2 + 8,
      panelW,
      panelH,
      24
    );

    this.add
      .nineslice(panelX, panelY, 'ui_panel_blue', undefined, panelW, panelH, 28, 28, 28, 28)
      .setAlpha(0.98);

    // 3. Cabecera y Código de Sala destacado con opción de copiar
    this.add
      .text(panelX, 88, 'SALA DE ESPERA (LOBBY P2P)', {
        fontFamily: 'KenneyFuture, sans-serif',
        fontSize: '26px',
        fontStyle: 'bold',
        color: '#ffffff',
        stroke: '#0f172a',
        strokeThickness: 6
      })
      .setOrigin(0.5);

    this.createRoomCodeSection(panelX, 142);

    // 4. Contenedor dinámico de tarjetas de jugadores conectados
    this.playersContainer = this.add.container(0, 0);

    // 5. Indicador de estado de la sala
    this.statusBannerText = this.add
      .text(panelX, 515, '', {
        fontFamily: 'sans-serif',
        fontSize: '15px',
        fontStyle: 'bold',
        color: '#fef08a',
        stroke: '#0f172a',
        strokeThickness: 3
      })
      .setOrigin(0.5);

    // 6. Botón inferior: INICIAR PARTIDO
    const bottomY = 582;

    this.startButtonContainer = this.add.container(panelX, bottomY);
    this.startBtnBg = this.add.nineslice(
      0,
      0,
      'ui_btn_green_up',
      undefined,
      360,
      54,
      18,
      18,
      18,
      18
    );
    const playIcon = this.add.image(-138, -2, 'ui_icon_play').setScale(0.45);
    this.startBtnLabel = this.add
      .text(14, -2, 'ESPERANDO JUGADORES...', {
        fontFamily: 'sans-serif',
        fontSize: '17px',
        fontStyle: 'bold',
        color: '#ffffff',
        stroke: '#064e3b',
        strokeThickness: 4
      })
      .setOrigin(0.5);

    this.startButtonContainer.add([this.startBtnBg, playIcon, this.startBtnLabel]);
    this.startButtonContainer.setSize(360, 54);
    this.startButtonContainer.setInteractive({ useHandCursor: true });

    this.startButtonContainer.on('pointerup', () => {
      if (this.isTransitioning) return;
      if (peerManager.isHost && peerManager.canStartMatch()) {
        if (this.cache.audio.exists('ui_click')) {
          this.sound.play('ui_click', { volume: 0.75 });
        }
        peerManager.requestStartMatchFromHost();
      }
    });

    // Suscribirse a eventos de red de PeerManager
    const onPlayersUpdated = () => {
      if (!this.scene.isActive()) return;
      this.renderPlayerCards();
    };

    const onMatchStart = (players: LobbyPlayerProfile[]) => {
      if (!this.scene.isActive() || this.isTransitioning) return;
      this.launchMatchWithPlayers(players);
    };

    const onPlayerKicked = (reason: string) => {
      if (!this.scene.isActive() || this.isTransitioning) return;
      this.isTransitioning = true;
      this.statusBannerText.setText(reason || '¡HAS SIDO EXPULSADO DE LA SALA!');
      this.statusBannerText.setColor('#ef4444');
      if (this.cache.audio.exists('ui_tap')) {
        this.sound.play('ui_tap', { volume: 0.6 });
      }
      this.time.delayedCall(1600, () => {
        this.cameras.main.fadeOut(250, 15, 23, 42);
        this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
          this.scene.start('MenuScene');
        });
      });
    };

    peerManager.on('players-updated', onPlayersUpdated);
    peerManager.on('match-start', onMatchStart);
    peerManager.on('player-kicked', onPlayerKicked);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      peerManager.off('players-updated', onPlayersUpdated);
      peerManager.off('match-start', onMatchStart);
      peerManager.off('player-kicked', onPlayerKicked);
      if (this.copyFeedbackTimer) {
        this.copyFeedbackTimer.remove(false);
        this.copyFeedbackTimer = undefined;
      }
    });

    this.renderPlayerCards();
  }

  private renderPlayerCards(): void {
    this.playersContainer.removeAll(true);

    if (this.roomCodeText) {
      const codeDisplay = peerManager.roomCode || 'LOCAL';
      this.roomCodeText.setText(`CÓDIGO DE SALA:  ${codeDisplay}`);
    }

    const players = peerManager.getPlayersList();
    const bluePlayers = peerManager.getTeamPlayers('blue');
    const redPlayers = peerManager.getTeamPlayers('red');

    const leftColX = this.scale.width / 2 - 220;
    const rightColX = this.scale.width / 2 + 220;
    const headerY = 185;
    const startY = 232;
    const cardSpacing = 70;

    // Cabeceras de cada equipo (Máximo 4 por equipo: 1v1, 2v1, 3v2, hasta 4v4)
    const blueHeader = this.add
      .text(leftColX, headerY, `EQUIPO AZUL (${bluePlayers.length}/${MAX_PLAYERS_PER_TEAM})`, {
        fontFamily: 'KenneyFutureNarrow, sans-serif',
        fontSize: '16px',
        fontStyle: 'bold',
        color: '#bae6fd',
        stroke: '#0f172a',
        strokeThickness: 4
      })
      .setOrigin(0.5);

    const redHeader = this.add
      .text(rightColX, headerY, `EQUIPO ROJO (${redPlayers.length}/${MAX_PLAYERS_PER_TEAM})`, {
        fontFamily: 'KenneyFutureNarrow, sans-serif',
        fontSize: '16px',
        fontStyle: 'bold',
        color: '#fecaca',
        stroke: '#0f172a',
        strokeThickness: 4
      })
      .setOrigin(0.5);

    this.playersContainer.add([blueHeader, redHeader]);

    // Dibujar las 4 ranuras del Equipo Azul (izquierda) y las 4 ranuras del Equipo Rojo (derecha)
    for (let slot = 0; slot < MAX_PLAYERS_PER_TEAM; slot++) {
      const cardY = startY + slot * cardSpacing;
      this.drawTeamSlotCard(leftColX, cardY, 'blue', slot + 1, bluePlayers[slot]);
      this.drawTeamSlotCard(rightColX, cardY, 'red', slot + 1, redPlayers[slot]);
    }

    const connectedCount = players.length;
    const readyCount = players.filter((pl) => pl.isReady).length;
    const canStart = peerManager.canStartMatch();
    const matchupLabel = `${bluePlayers.length} vs ${redPlayers.length}`;

    if (connectedCount < MIN_ROOM_PLAYERS) {
      this.statusBannerText.setText(
        `Sala: ${connectedCount}/${MAX_ROOM_PLAYERS} (Mínimo ${MIN_ROOM_PLAYERS}, Máx 4v4)  •  Comparte el código [${peerManager.roomCode || 'LOCAL'}] para que se unan más jugadores`
      );
      this.statusBannerText.setColor('#fef08a');
    } else if (bluePlayers.length === 0 || redPlayers.length === 0) {
      this.statusBannerText.setText(
        `Formato actual: ${matchupLabel}  •  Debe haber al menos 1 jugador en cada equipo (haz clic en ⇄ en una tarjeta para cambiar de equipo)`
      );
      this.statusBannerText.setColor('#fbbf24');
    } else if (readyCount < connectedCount) {
      this.statusBannerText.setText(
        `Jugadores: ${connectedCount}/${MAX_ROOM_PLAYERS} (${matchupLabel})  •  Esperando a que todos estén listos (${readyCount}/${connectedCount})...`
      );
      this.statusBannerText.setColor('#38bdf8');
    } else {
      this.statusBannerText.setText(
        `¡Partido ${matchupLabel} LISTO (${connectedCount}/${MAX_ROOM_PLAYERS} jugadores)! ${peerManager.isHost ? 'Puedes esperar más jugadores (hasta 4v4) o INICIAR PARTIDO.' : 'Esperando al Host...'}`
      );
      this.statusBannerText.setColor('#4ade80');
    }

    if (peerManager.isHost) {
      if (canStart) {
        this.startBtnBg.setTexture('ui_btn_green_up');
        this.startBtnBg.clearTint();
        this.startBtnLabel.setText(`INICIAR ${matchupLabel} (${connectedCount}/${MAX_ROOM_PLAYERS})`);
        this.startButtonContainer.setAlpha(1);
      } else {
        this.startBtnBg.setTexture('ui_btn_green_down');
        this.startBtnBg.setTint(0x64748b);
        this.startBtnLabel.setText(
          connectedCount < MIN_ROOM_PLAYERS
            ? `MÍNIMO ${MIN_ROOM_PLAYERS} JUGADORES (${connectedCount}/${MAX_ROOM_PLAYERS})`
            : `EQUILIBRA EQUIPOS (${matchupLabel})`
        );
        this.startButtonContainer.setAlpha(0.75);
      }
    } else {
      this.startBtnBg.setTexture('ui_btn_green_down');
      this.startBtnBg.setTint(0x475569);
      this.startBtnLabel.setText(
        canStart
          ? `ESPERANDO AL HOST (${matchupLabel})`
          : `JUGADORES EN SALA (${connectedCount}/${MAX_ROOM_PLAYERS})`
      );
      this.startButtonContainer.setAlpha(0.8);
    }
  }

  private drawTeamSlotCard(
    colX: number,
    y: number,
    team: 'blue' | 'red',
    slotNumber: number,
    profile?: LobbyPlayerProfile
  ): void {
    const cardW = 415;
    const cardH = 60;

    const bg = this.add.graphics();
    bg.fillStyle(0x0f172a, profile ? 0.75 : 0.32);
    bg.fillRoundedRect(colX - cardW / 2, y - cardH / 2, cardW, cardH, 12);
    const borderColor = profile
      ? profile.isReady
        ? 0x4ade80
        : 0xfacc15
      : team === 'blue'
        ? 0x38bdf8
        : 0xf87171;
    bg.lineStyle(2, borderColor, profile ? 0.9 : 0.35);
    bg.strokeRoundedRect(colX - cardW / 2, y - cardH / 2, cardW, cardH, 12);
    this.playersContainer.add(bg);

    if (!profile) {
      const emptyTxt = this.add
        .text(
          colX,
          y,
          `Ranura ${team === 'blue' ? 'Azul' : 'Roja'} #${slotNumber} — Libre`,
          {
            fontFamily: 'sans-serif',
            fontSize: '13px',
            fontStyle: 'bold',
            color: '#64748b'
          }
        )
        .setOrigin(0.5);
      this.playersContainer.add(emptyTxt);
      return;
    }

    const teamPanelKey = profile.team === 'red' ? 'ui_panel_red' : 'ui_panel_blue';
    const teamBadge = this.add
      .nineslice(colX - 162, y, teamPanelKey, undefined, 68, 36, 10, 10, 10, 10)
      .setInteractive({ useHandCursor: true });

    const teamLabel = this.add
      .text(colX - 162, y, `${profile.team === 'red' ? 'ROJO' : 'AZUL'} ⇄`, {
        fontFamily: 'sans-serif',
        fontSize: '11px',
        fontStyle: 'bold',
        color: '#ffffff',
        stroke: '#0f172a',
        strokeThickness: 3
      })
      .setOrigin(0.5);

    // Permitir al Host o al propio jugador cambiar su equipo (ej. para armar 2v1, 3v2 o 4v4)
    teamBadge.on('pointerup', () => {
      if (peerManager.isHost || profile.peerId === peerManager.localPeerId) {
        if (this.cache.audio.exists('ui_tap')) {
          this.sound.play('ui_tap', { volume: 0.45 });
        }
        peerManager.togglePlayerTeam(profile.peerId);
      }
    });

    const roleTag = profile.isHost ? ' [HOST]' : '';
    const nameTxt = this.add
      .text(colX - 118, y - 10, `${profile.name}${roleTag}`, {
        fontFamily: 'sans-serif',
        fontSize: '14px',
        fontStyle: 'bold',
        color: '#ffffff',
        stroke: '#0f172a',
        strokeThickness: 3
      })
      .setOrigin(0, 0.5);

    const s = profile.stats;
    const statsTxt = this.add
      .text(
        colX - 118,
        y + 11,
        `V:${s.speed} D:${s.shoot} DF:${s.defense} T:${s.technique} A:${s.attack}`,
        {
          fontFamily: 'monospace',
          fontSize: '11px',
          fontStyle: 'bold',
          color: '#cbd5e1'
        }
      )
      .setOrigin(0, 0.5);

    const canKick = peerManager.isHost && !profile.isHost;
    const statusTxtX = canKick ? colX + 158 : colX + 195;

    const statusStr = profile.isReady ? '✓ LISTO' : '⏳...';
    const statusColor = profile.isReady ? '#4ade80' : '#facc15';
    const statusTxt = this.add
      .text(statusTxtX, y, statusStr, {
        fontFamily: 'sans-serif',
        fontSize: '13px',
        fontStyle: 'bold',
        color: statusColor,
        stroke: '#0f172a',
        strokeThickness: 3
      })
      .setOrigin(1, 0.5);

    this.playersContainer.add([teamBadge, teamLabel, nameTxt, statsTxt, statusTxt]);

    // Botón de expulsión exclusivo para el Host (estilo sobrio y tamaño fijo)
    if (canKick) {
      const kickBtnX = colX + 186;
      const kickBtn = this.add
        .nineslice(kickBtnX, y, 'ui_sq_red', undefined, 26, 26, 6, 6, 6, 6)
        .setInteractive({ useHandCursor: true });

      const kickIcon = this.add
        .text(kickBtnX, y, '✕', {
          fontFamily: 'sans-serif',
          fontSize: '13px',
          fontStyle: 'bold',
          color: '#ffffff',
          stroke: '#7f1d1d',
          strokeThickness: 2
        })
        .setOrigin(0.5);

      kickBtn.on('pointerover', () => {
        kickBtn.setAlpha(0.82);
      });

      kickBtn.on('pointerout', () => {
        kickBtn.setAlpha(1);
      });

      kickBtn.on('pointerdown', () => {
        kickBtn.setAlpha(0.65);
      });

      kickBtn.on('pointerup', () => {
        kickBtn.setAlpha(1);
        if (this.cache.audio.exists('ui_click')) {
          this.sound.play('ui_click', { volume: 0.65 });
        }
        const kickedName = profile.name;
        peerManager.kickPlayer(profile.peerId);
        this.statusBannerText.setText(`Jugador "${kickedName}" expulsado de la sala.`);
        this.statusBannerText.setColor('#f87171');
      });

      this.playersContainer.add([kickBtn, kickIcon]);
    }
  }

  private createRoomCodeSection(panelX: number, centerY: number): void {
    const codeDisplay = peerManager.roomCode || 'LOCAL';
    const totalW = 490;
    const boxW = 345;
    const btnW = 133;
    const boxX = panelX - totalW / 2 + boxW / 2;
    const btnX = panelX + totalW / 2 - btnW / 2;

    // Caja con el código de sala (hacer clic también copia el código)
    const codeBoxBg = this.add
      .nineslice(boxX, centerY, 'ui_panel_grey', undefined, boxW, 46, 16, 16, 16, 16)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    this.roomCodeText = this.add
      .text(boxX, centerY, `CÓDIGO DE SALA:  ${codeDisplay}`, {
        fontFamily: 'sans-serif',
        fontSize: '18px',
        fontStyle: 'bold',
        color: '#0f172a'
      })
      .setOrigin(0.5);

    codeBoxBg.on('pointerover', () => {
      codeBoxBg.setTint(0xf1f5f9);
    });

    codeBoxBg.on('pointerout', () => {
      codeBoxBg.clearTint();
    });

    codeBoxBg.on('pointerup', () => {
      this.copyRoomCode();
    });

    // Botón COPIAR
    this.copyBtnBg = this.add
      .nineslice(btnX, centerY, 'ui_sq_blue', undefined, btnW, 46, 12, 12, 12, 12)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    this.copyBtnText = this.add
      .text(btnX, centerY, 'COPIAR', {
        fontFamily: 'sans-serif',
        fontSize: '16px',
        fontStyle: 'bold',
        color: '#ffffff',
        stroke: '#0f172a',
        strokeThickness: 3
      })
      .setOrigin(0.5);

    this.copyBtnBg.on('pointerover', () => {
      this.copyBtnBg.setTint(0xbae6fd);
    });

    this.copyBtnBg.on('pointerout', () => {
      this.copyBtnBg.clearTint();
    });

    this.copyBtnBg.on('pointerdown', () => {
      this.copyBtnBg.setScale(0.96);
    });

    this.copyBtnBg.on('pointerup', () => {
      this.copyBtnBg.setScale(1);
      this.copyRoomCode();
    });
  }

  private copyRoomCode(): void {
    const code = peerManager.roomCode || 'LOCAL';
    if (!code) return;

    const onSuccess = () => {
      if (this.cache.audio.exists('ui_tap')) {
        this.sound.play('ui_tap', { volume: 0.5 });
      }
      this.triggerCopiedAnimation();
    };

    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard
        .writeText(code)
        .then(onSuccess)
        .catch(() => {
          this.fallbackCopy(code);
          onSuccess();
        });
    } else {
      this.fallbackCopy(code);
      onSuccess();
    }
  }

  private fallbackCopy(text: string): void {
    const el = document.createElement('textarea');
    el.value = text;
    el.setAttribute('readonly', '');
    el.style.position = 'absolute';
    el.style.left = '-9999px';
    document.body.appendChild(el);
    el.select();
    try {
      document.execCommand('copy');
    } catch (e) {
      console.warn('Fallback copy failed', e);
    }
    document.body.removeChild(el);
  }

  private triggerCopiedAnimation(): void {
    if (this.copyFeedbackTimer) {
      this.copyFeedbackTimer.remove(false);
      this.copyFeedbackTimer = undefined;
    }

    this.copyBtnBg.setTexture('ui_btn_green_up');
    this.copyBtnText.setText('¡COPIADO! ✓');

    this.tweens.add({
      targets: [this.copyBtnBg, this.copyBtnText],
      scaleX: 1.08,
      scaleY: 1.08,
      yoyo: true,
      duration: 120
    });

    this.copyFeedbackTimer = this.time.delayedCall(2000, () => {
      if (!this.scene.isActive()) return;
      this.copyBtnBg.setTexture('ui_sq_blue');
      this.copyBtnBg.clearTint();
      this.copyBtnText.setText('COPIAR');
    });
  }

  private launchMatchWithPlayers(players: LobbyPlayerProfile[]): void {
    this.isTransitioning = true;

    const p1 = players[0];
    const p2 = players[1] ?? players[0];

    this.cameras.main.fadeOut(260, 15, 23, 42);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.start('MainScene', {
        matchPlayers: players,
        playerStats: p1?.stats,
        player2Stats: p2?.stats,
        playerName: p1?.name,
        player2Name: p2?.name
      });
    });
  }
}
