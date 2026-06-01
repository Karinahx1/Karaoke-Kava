import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class PracticaService {

  private apiUrl = `${environment.apiUrl}/practicas`;

  constructor(private http: HttpClient) {}

  async crearPractica(data: {
    id_usuario: number;
    id_cancion: number;
    id_estado: number;
    url_audio_usuario: string;
  }) {
    const response: any = await firstValueFrom(
      this.http.post(this.apiUrl, data)
    );

    return response.data;
  }

  async actualizarResultadoPractica(
    idPractica: number,
    data: {
      puntaje: number;
      puntajeLetra?: number;
      puntajeAudio?: number;
      puntajeVoz?: number;
      feedback: string;
      transcripcion: string;
      id_estado: number;
    }
  ) {
    const response: any = await firstValueFrom(
      this.http.patch(`${this.apiUrl}/${idPractica}/resultado`, data)
    );

    return response.data;
  }
}