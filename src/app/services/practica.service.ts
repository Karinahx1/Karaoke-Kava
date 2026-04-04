import { Injectable } from '@angular/core';
import { supabase } from '../core/supabase.client';

@Injectable({
  providedIn: 'root'
})
export class PracticaService {

  /**
   * Crea una nueva práctica en la base de datos.
   *
   * Aquí guardamos:
   * - qué usuario cantó
   * - qué canción cantó
   * - el estado de la práctica
   * - la URL del audio grabado
   *
   * El puntaje, feedback y transcripción quedan en null por ahora,
   * porque todavía no estamos ejecutando la evaluación automática.
   */
  async crearPractica(data: {
    id_usuario: number;
    id_cancion: number;
    id_estado: number;
    url_audio_usuario: string;
  }) {
    const { data: result, error } = await supabase
      .from('tbl_practica')
      .insert([
        {
          id_usuario: data.id_usuario,
          id_cancion: data.id_cancion,
          id_estado: data.id_estado,
          url_audio_usuario: data.url_audio_usuario,
          puntaje: null,
          feedback: null,
          transcripcion: null
        }
      ])
      .select()
      .single();

    if (error) {
      throw error;
    }

    return result;
  }

    /**
   * Actualiza una práctica ya creada con el resultado de evaluación.
   *
   * Aquí guardaremos:
   * - puntaje
   * - feedback
   * - transcripción
   * - estado final de la práctica
   */
  async actualizarResultadoPractica(
    idPractica: number,
    data: {
      puntaje: number;
      feedback: string;
      transcripcion: string;
      id_estado: number;
    }
  ) {
    const { data: result, error } = await supabase
      .from('tbl_practica')
      .update({
        puntaje: data.puntaje,
        feedback: data.feedback,
        transcripcion: data.transcripcion,
        id_estado: data.id_estado
      })
      .eq('id', idPractica)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return result;
  }

}