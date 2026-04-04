import { Injectable } from '@angular/core';
import { supabase } from '../core/supabase.client';

@Injectable({
  providedIn: 'root'
})
export class CancionService {

  /**
   * Obtiene todas las canciones registradas.
   */
  async obtenerCanciones() {
    const { data, error } = await supabase
      .from('tbl_cancion')
      .select('*')
      .order('id', { ascending: true });

    if (error) {
      throw error;
    }

    return data;
  }

  /**
   * Obtiene una canción por su id.
   */
  async obtenerCancionPorId(id: number) {
    const { data, error } = await supabase
      .from('tbl_cancion')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      throw error;
    }

    return data;
  }
}
/** Se hacen las consultas en la base de datos */