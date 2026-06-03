import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

type CancionInput = {
  titulo: string;
  duracion: number;
  letra: string;
  url_audio: string;
  nombresArtistas: string[];
  nombresGeneros: string[];
};

@Injectable({
  providedIn: 'root'
})
export class AdminCancionService {

  private apiUrl = `${environment.apiUrl}/canciones`;

  constructor(private http: HttpClient) {}

  async obtenerCanciones() {
    const response: any = await firstValueFrom(
      this.http.get(`${this.apiUrl}/admin/listado`)
    );

    return response.data;
  }

  async crearCancion(cancion: CancionInput) {
    const response: any = await firstValueFrom(
      this.http.post(this.apiUrl, cancion)
    );

    return response.data;
  }

  async actualizarCancion(id: number, cancion: CancionInput) {
    const response: any = await firstValueFrom(
      this.http.put(`${this.apiUrl}/${id}`, cancion)
    );

    return response.data;
  }

  async toggleActiva(id: number, activa: boolean) {
    const response: any = await firstValueFrom(
      this.http.patch(`${this.apiUrl}/${id}/activa`, { activa })
    );
    return response.data;
  }

  async eliminarCancion(id: number) {
    const response: any = await firstValueFrom(
      this.http.delete(`${this.apiUrl}/${id}`)
    );

    return response.data;
  }
}