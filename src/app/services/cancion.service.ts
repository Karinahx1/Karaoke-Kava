import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class CancionService {

  private apiUrl = `${environment.apiUrl}/canciones`;

  constructor(private http: HttpClient) {}

  async obtenerCanciones() {
    const response: any = await firstValueFrom(
      this.http.get(this.apiUrl)
    );

    return response.data;
  }

  async obtenerCancionPorId(id: number) {
    const response: any = await firstValueFrom(
      this.http.get(`${this.apiUrl}/${id}`)
    );

    return response.data;
  }
}