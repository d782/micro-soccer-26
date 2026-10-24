import Phaser from 'phaser';
import Peer, { DataConnection } from 'peerjs';
import { PlayerStats, DEFAULT_PLAYER_STATS, PendingMoveRequest } from '../objects/Player';

export const MIN_ROOM_PLAYERS = 2;
export const MAX_ROOM_PLAYERS = 8;
export const MAX_PLAYERS_PER_TEAM = 4;

export interface LobbyPlayerProfile {
  peerId: string;
  name: string;
  team: 'blue' | 'red';
  stats: PlayerStats;
  isHost: boolean;
  isReady: boolean;
}

export interface RemoteInputPayload {
  peerId: string;
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  vx: number;
  vy: number;
  moveRequest: PendingMoveRequest | null;
  seq: number;
}

export interface AuthoritativePlayerSync {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  state: string;
  powerRatio: number;
  powerLabel: string;
}

export interface AuthoritativeBallSync {
  x: number;
  y: number;
  vx: number;
  vy: number;
  z: number;
  vz: number;
  isAirborne: boolean;
  state: string;
  ownerPeerId: string | null;
}

export interface MatchSyncPayload {
  players: Record<string, AuthoritativePlayerSync>;
  ball: AuthoritativeBallSync;
  blueScore: number;
  redScore: number;
  remainingTimeMs: number;
  matchState: 'PLAYING' | 'GOAL_CELEBRATION' | 'FULL_TIME';
  lastGoalTeam: 'blue' | 'red' | null;
}

export type NetworkMessage =
  | { type: 'HELLO_JOIN'; peerId: string }
  | { type: 'PLAYER_PROFILE'; profile: LobbyPlayerProfile }
  | { type: 'ROOM_STATE'; roomCode: string; players: LobbyPlayerProfile[] }
  | { type: 'START_MATCH'; players: LobbyPlayerProfile[] }
  | { type: 'GUEST_INPUT'; input: RemoteInputPayload }
  | { type: 'MATCH_SYNC'; sync: MatchSyncPayload };

const PEER_PREFIX = 'ss26-room-';

class PeerNetworkManager extends Phaser.Events.EventEmitter {
  private peer: Peer | null = null;
  private connections: Map<string, DataConnection> = new Map();
  private fallbackChannel: BroadcastChannel | null = null;

  public isHost = false;
  public roomCode = '';
  public localPeerId = '';
  public isOnlineSession = false;

  private players: Map<string, LobbyPlayerProfile> = new Map();

  private generateRoomCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 5; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  public disconnect(): void {
    this.connections.forEach((conn) => conn.close());
    this.connections.clear();
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
    if (this.fallbackChannel) {
      this.fallbackChannel.close();
      this.fallbackChannel = null;
    }
    this.players.clear();
    this.isHost = false;
    this.roomCode = '';
    this.localPeerId = '';
    this.isOnlineSession = false;
  }

  /**
   * 1. CREAR SALA (Host): Genera código único e inicializa el nodo Host en PeerJS
   */
  public createRoom(): Promise<string> {
    this.disconnect();
    this.isHost = true;
    this.isOnlineSession = true;
    this.roomCode = this.generateRoomCode();
    const fullPeerId = `${PEER_PREFIX}${this.roomCode}`;
    this.localPeerId = fullPeerId;

    // Registrar al Host inicialmente en estado "Configurando..." (isReady: false)
    this.players.set(this.localPeerId, {
      peerId: this.localPeerId,
      name: 'HOST',
      team: 'blue',
      stats: { ...DEFAULT_PLAYER_STATS },
      isHost: true,
      isReady: false
    });

    this.setupFallbackChannel(this.roomCode);

    return new Promise((resolve) => {
      let resolved = false;
      const finish = () => {
        if (!resolved) {
          resolved = true;
          resolve(this.roomCode);
        }
      };

      try {
        this.peer = new Peer(fullPeerId);

        this.peer.on('open', (id) => {
          this.localPeerId = id;
          finish();
        });

        this.peer.on('connection', (conn) => {
          this.registerConnection(conn);
        });

        this.peer.on('error', (err) => {
          console.warn('[PeerJS Host] Aviso de red (usando canal híbrido):', err.type);
          finish();
        });

        // Timeout de seguridad para no bloquear la UI si el broker público tarda
        setTimeout(finish, 1800);
      } catch {
        finish();
      }
    });
  }

  /**
   * 2. UNIRSE A SALA (Cliente): Conecta al peerId del Host a partir del código de 5 caracteres
   */
  public joinRoom(inputCode: string): Promise<void> {
    this.disconnect();
    const cleanCode = inputCode.trim().toUpperCase();
    this.isHost = false;
    this.isOnlineSession = true;
    this.roomCode = cleanCode;
    const guestUniqueId = `ss26-guest-${cleanCode}-${Math.random().toString(36).substring(2, 8)}`;
    this.localPeerId = guestUniqueId;

    // Registrar el perfil provisional del invitado con ID único y estable
    this.players.set(this.localPeerId, {
      peerId: this.localPeerId,
      name: 'INVITADO',
      team: 'red',
      stats: { ...DEFAULT_PLAYER_STATS },
      isHost: false,
      isReady: false
    });

    this.setupFallbackChannel(cleanCode);

    return new Promise((resolve, reject) => {
      let settled = false;
      const succeed = () => {
        if (!settled) {
          settled = true;
          this.sendMessage({ type: 'HELLO_JOIN', peerId: this.localPeerId });
          resolve();
        }
      };

      try {
        this.peer = new Peer(guestUniqueId);

        this.peer.on('open', (myId) => {
          this.localPeerId = myId;
          const hostPeerId = `${PEER_PREFIX}${cleanCode}`;
          const conn = this.peer!.connect(hostPeerId, {
            reliable: true,
            serialization: 'json'
          });
          this.registerConnection(conn, succeed);
        });

        this.peer.on('error', (err) => {
          console.warn('[PeerJS Guest] Aviso:', err.type);
          if (!settled) {
            settled = true;
            reject(new Error('No se pudo encontrar la sala ' + cleanCode));
          }
        });

        // Si en la misma máquina responde por BroadcastChannel o abre en 3.5s
        setTimeout(() => {
          if (!settled && this.players.size >= 2) {
            succeed();
          } else if (!settled) {
            settled = true;
            reject(new Error('Tiempo de espera agotado para la sala ' + cleanCode));
          }
        }, 3500);
      } catch (e) {
        if (!settled) {
          settled = true;
          reject(e);
        }
      }
    });
  }

  private registerConnection(conn: DataConnection, onOpenCallback?: () => void): void {
    conn.on('open', () => {
      this.connections.set(conn.peer, conn);
      if (onOpenCallback) {
        onOpenCallback();
      }
      if (this.isHost) {
        this.broadcastRoomState();
      } else {
        // Garantizar que por el Data Channel recién abierto se envíe el saludo y perfil del Cliente
        conn.send({ type: 'HELLO_JOIN', peerId: this.localPeerId });
        const localProfile = this.players.get(this.localPeerId);
        if (localProfile) {
          conn.send({ type: 'PLAYER_PROFILE', profile: localProfile });
        }
      }
    });

    conn.on('data', (raw) => {
      this.handleIncomingMessage(raw as NetworkMessage);
    });

    conn.on('close', () => {
      this.connections.delete(conn.peer);
      if (this.isHost) {
        this.players.delete(conn.peer);
        this.broadcastRoomState();
      }
      this.emit('players-updated', this.getPlayersList());
    });
  }

  private setupFallbackChannel(code: string): void {
    if (typeof BroadcastChannel === 'undefined') return;
    this.fallbackChannel = new BroadcastChannel(`ss26_lobby_${code}`);
    this.fallbackChannel.onmessage = (ev) => {
      this.handleIncomingMessage(ev.data as NetworkMessage);
    };
  }

  private sendMessage(msg: NetworkMessage): void {
    let sentOverWebRTC = false;
    this.connections.forEach((conn) => {
      if (conn.open) {
        conn.send(msg);
        sentOverWebRTC = true;
      }
    });
    // Si aún no hay DataChannel WebRTC abierto (o en test local sin broker), usar BroadcastChannel sin duplicar paquetes
    if (!sentOverWebRTC && this.fallbackChannel) {
      this.fallbackChannel.postMessage(msg);
    }
  }

  private resolveAvailableTeam(preferredTeam: 'blue' | 'red', excludePeerId?: string): 'blue' | 'red' {
    let blueCount = 0;
    let redCount = 0;
    for (const p of this.players.values()) {
      if (p.peerId === excludePeerId) continue;
      if (p.team === 'blue') blueCount++;
      else redCount++;
    }

    // Si hay un equipo vacío (0 jugadores) y ya hay al menos 1 jugador en el otro, priorizar que ambos equipos tengan al menos 1
    if (preferredTeam === 'blue' && blueCount < MAX_PLAYERS_PER_TEAM) {
      return 'blue';
    }
    if (preferredTeam === 'red' && redCount < MAX_PLAYERS_PER_TEAM) {
      return 'red';
    }
    return blueCount <= redCount ? 'blue' : 'red';
  }

  private handleIncomingMessage(msg: NetworkMessage): void {
    if (!msg || !msg.type) return;

    switch (msg.type) {
      case 'HELLO_JOIN': {
        if (this.isHost) {
          if (
            !this.players.has(msg.peerId) &&
            this.players.size < MAX_ROOM_PLAYERS
          ) {
            const nextNum = this.players.size + 1;
            const autoTeam =
              this.getTeamPlayers('blue').length <= this.getTeamPlayers('red').length
                ? 'blue'
                : 'red';
            this.players.set(msg.peerId, {
              peerId: msg.peerId,
              name: `JUGADOR ${nextNum}`,
              team: this.resolveAvailableTeam(autoTeam, msg.peerId),
              stats: { ...DEFAULT_PLAYER_STATS },
              isHost: false,
              isReady: false
            });
          }
          this.broadcastRoomState();
          this.emit('players-updated', this.getPlayersList());
        }
        break;
      }

      case 'PLAYER_PROFILE': {
        if (
          !this.players.has(msg.profile.peerId) &&
          this.players.size >= MAX_ROOM_PLAYERS
        ) {
          break;
        }
        const profileToSave: LobbyPlayerProfile = {
          ...msg.profile,
          team: this.isHost
            ? this.resolveAvailableTeam(msg.profile.team, msg.profile.peerId)
            : msg.profile.team
        };
        this.players.set(profileToSave.peerId, profileToSave);
        if (this.isHost) {
          this.broadcastRoomState();
        }
        this.emit('players-updated', this.getPlayersList());
        break;
      }

      case 'ROOM_STATE': {
        if (!this.isHost) {
          const localProfile = this.players.get(this.localPeerId);
          this.players.clear();
          for (const p of msg.players) {
            this.players.set(p.peerId, p);
          }
          if (localProfile && !this.players.has(this.localPeerId)) {
            this.players.set(this.localPeerId, localProfile);
          }
          this.emit('players-updated', this.getPlayersList());
        }
        break;
      }

      case 'START_MATCH': {
        this.emit('match-start', msg.players);
        break;
      }

      case 'GUEST_INPUT': {
        if (this.isHost) {
          this.emit('guest-input', msg.input);
        }
        break;
      }

      case 'MATCH_SYNC': {
        if (!this.isHost) {
          this.emit('match-sync', msg.sync);
        }
        break;
      }
    }
  }

  public sendGuestInput(input: RemoteInputPayload): void {
    if (this.isHost) return;
    this.sendMessage({ type: 'GUEST_INPUT', input });
  }

  public sendMatchSync(sync: MatchSyncPayload): void {
    if (!this.isHost) return;
    this.sendMessage({ type: 'MATCH_SYNC', sync });
  }

  public broadcastRoomState(): void {
    if (!this.isHost) return;
    const list = this.getPlayersList();
    this.sendMessage({
      type: 'ROOM_STATE',
      roomCode: this.roomCode,
      players: list
    });
    this.emit('players-updated', list);
  }

  /**
   * 3. GUARDAR Y ENVIAR IDENTIDAD + SKILLS AL OTRO JUGADOR POR WEBRTC
   */
  public submitPlayerProfile(name: string, team: 'blue' | 'red', stats: PlayerStats): void {
    if (!this.localPeerId) {
      this.localPeerId = 'local-player-1';
    }
    const validTeam = this.isHost
      ? this.resolveAvailableTeam(team, this.localPeerId)
      : team;
    const profile: LobbyPlayerProfile = {
      peerId: this.localPeerId,
      name: name.trim() || (this.isHost ? 'JUGADOR 1' : `JUGADOR ${this.players.size}`),
      team: validTeam,
      stats: { ...stats },
      isHost: this.isHost,
      isReady: true
    };

    this.players.set(this.localPeerId, profile);
    this.sendMessage({ type: 'PLAYER_PROFILE', profile });

    if (this.isHost) {
      this.broadcastRoomState();
    } else {
      this.emit('players-updated', this.getPlayersList());
    }
  }

  /**
   * Permite cambiar de equipo (AZUL <-> ROJO) a un jugador en la sala respetando el máximo de 4 por equipo
   */
  public togglePlayerTeam(peerId: string): boolean {
    const target = this.players.get(peerId);
    if (!target) return false;

    const desiredTeam: 'blue' | 'red' = target.team === 'blue' ? 'red' : 'blue';
    const currentInDesired = this.getTeamPlayers(desiredTeam).length;
    if (currentInDesired >= MAX_PLAYERS_PER_TEAM) {
      return false;
    }

    target.team = desiredTeam;
    this.players.set(peerId, target);

    if (this.isHost) {
      this.broadcastRoomState();
    } else if (peerId === this.localPeerId) {
      this.sendMessage({ type: 'PLAYER_PROFILE', profile: target });
      this.emit('players-updated', this.getPlayersList());
    }
    return true;
  }

  public getPlayersList(): LobbyPlayerProfile[] {
    return Array.from(this.players.values()).sort((a, b) => {
      if (a.isHost === b.isHost) return 0;
      return a.isHost ? -1 : 1;
    });
  }

  public getTeamPlayers(team: 'blue' | 'red'): LobbyPlayerProfile[] {
    return this.getPlayersList().filter((p) => p.team === team);
  }

  /**
   * Valida que haya un mínimo de 2 jugadores (y máximo 8 = 4 vs 4),
   * con al menos 1 jugador en cada equipo (soporta 1v1, 2v1, 2v2, 3v2, 3v3, 4v3, 4v4)
   * y todos en estado LISTO.
   */
  public canStartMatch(): boolean {
    const list = this.getPlayersList();
    if (list.length < MIN_ROOM_PLAYERS || list.length > MAX_ROOM_PLAYERS) {
      return false;
    }
    const blueCount = list.filter((p) => p.team === 'blue').length;
    const redCount = list.filter((p) => p.team === 'red').length;
    const teamsValid =
      blueCount >= 1 &&
      redCount >= 1 &&
      blueCount <= MAX_PLAYERS_PER_TEAM &&
      redCount <= MAX_PLAYERS_PER_TEAM;

    return teamsValid && list.every((p) => p.isReady);
  }

  public requestStartMatchFromHost(): void {
    if (!this.isHost || !this.canStartMatch()) return;
    const list = this.getPlayersList();
    this.sendMessage({
      type: 'START_MATCH',
      players: list
    });
    this.emit('match-start', list);
  }
}

export const peerManager = new PeerNetworkManager();
