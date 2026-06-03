import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';

export interface UsuarioLeaderboard {
  id: string;
  nombre: string;
  nivel: string;
  puntajePromedio: number;
  totalPracticas: number;
}

export interface CombateFeed {
  id: string;
  fecha: string;
  tipo: 'combate' | 'practica';
  mensaje: string;
  jugador1Inicial: string;
  jugador2Inicial: string;
  puntaje?: number;
  estado: string;
}

export interface CancionTop {
  id: number;
  titulo: string;
  artista: string;
  vecesCantada: number;
}

export interface HistorialItem {
  fecha: string;
  puntaje: number;
  cancionTitulo: string;
}

export interface PerfilEstadisticas {
  id: string;
  nombre: string;
  nivel: string;
  cancionFavorita: string | null;
  estadisticas: {
    totalPracticas: number;
    puntajePromedio: number;
    mejorPuntaje: number;
    combatesJugados: number;
    combatesGanados: number;
    winRate: number;
  };
  historialReciente: HistorialItem[];
}

@Injectable({
  providedIn: 'root'
})
export class ComunidadService {
  private apiUrl = `${environment.apiUrl}/comunidad`;

  constructor(private http: HttpClient) {}

  getLeaderboard() {
    return this.http.get<{ ok: boolean, data: UsuarioLeaderboard[] }>(`${this.apiUrl}/leaderboard`);
  }

  getFeed() {
    return this.http.get<{ ok: boolean, data: CombateFeed[] }>(`${this.apiUrl}/feed`);
  }

  getTopCanciones() {
    return this.http.get<{ ok: boolean, data: CancionTop[] }>(`${this.apiUrl}/top-canciones`);
  }

  getPerfil(id: string) {
    return this.http.get<{ ok: boolean, data: PerfilEstadisticas }>(`${this.apiUrl}/perfil/${id}`);
  }
}
