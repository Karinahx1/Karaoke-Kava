import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class EvaluacionService {
  private apiUrl = `${environment.apiUrl}/evaluaciones/practica`;

  constructor(private http: HttpClient) {}

  async evaluarPractica(data: {
    idPractica: number;
    transcripcion: string;
    duracionAudio: number;
    rmsPromedio: number;
    porcentajeSilencio: number;
    porcentajeActividad: number;
    porcentajeClipping?: number;
  }) {
    const response: any = await firstValueFrom(
      this.http.post(this.apiUrl, data)
    );

    return response.data;
  }
}