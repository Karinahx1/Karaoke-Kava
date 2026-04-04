

import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class EvaluacionService {

  /**
   * URL de la Edge Function desplegada en Supabase
   */
  private url = 'https://huudymretpzgwfkzyrfb.supabase.co/functions/v1/evaluar-practica';

  /**
   * Llama a la función backend para evaluar una práctica.
   *
   * Enviamos:
   * - idPractica: para que la función consulte la práctica y la canción
   * - transcripcion: texto detectado por el navegador
   * - duracionAudio: duración total de la interpretación
   */
  async evaluarPractica(data: {
    idPractica: number;
    transcripcion: string;
    duracionAudio: number;
  }) {
    const response = await fetch(this.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': environment.supabaseKey
      },
      body: JSON.stringify(data)
    });

    if (!response.ok) {
      const textoError = await response.text();
      throw new Error(`Error en la evaluación: ${textoError}`);
    }

    return await response.json();
  }
}