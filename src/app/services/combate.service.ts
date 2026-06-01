import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class CombateService {
  private apiUrl = 'http://localhost:3000/api/combates';

  constructor() {}

  async buscarUsuarios(query: string, idExcluido: string) {
    const res = await fetch(`${this.apiUrl}/buscar-usuarios`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, idExcluido })
    });
    return res.json();
  }

  async invitarUsuario(idJugador1: string, idJugador2: string) {
    const res = await fetch(`${this.apiUrl}/invitar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idJugador1, idJugador2 })
    });
    return res.json();
  }

  async buscarOponente(idJugador1: string, idNivel: string) {
    const res = await fetch(`${this.apiUrl}/buscar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idJugador1, idNivel })
    });
    return res.json();
  }

  async aceptarCombate(idCombate: string) {
    const res = await fetch(`${this.apiUrl}/${idCombate}/aceptar`, {
      method: 'PUT'
    });
    return res.json();
  }

  async obtenerMisCombates(idUsuario: string) {
    const res = await fetch(`${this.apiUrl}/usuario/${idUsuario}`);
    return res.json();
  }

  async obtenerDetalleCombate(idCombate: string) {
    const res = await fetch(`${this.apiUrl}/${idCombate}`);
    return res.json();
  }

  async crearRonda(idCombate: string, numeroRonda: number, idCancion: string, idSelector: string) {
    const res = await fetch(`${this.apiUrl}/ronda`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idCombate, numeroRonda, idCancion, idSelector })
    });
    return res.json();
  }

  async registrarTurno(idRonda: string, idUsuario: string, puntaje: number, urlAudio: string, feedback: any, transcripcion: string) {
    const res = await fetch(`${this.apiUrl}/turno`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idRonda, idUsuario, puntaje, urlAudio, feedback, transcripcion })
    });
    return res.json();
  }
}
