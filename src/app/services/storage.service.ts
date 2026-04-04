// Este servicio se encargará de subir archivos a Supabase Storage

import { Injectable } from '@angular/core';
import { supabase } from '../core/supabase.client';

@Injectable({
  providedIn: 'root'
})
export class StorageService {

  /**
   * Sube un archivo de audio al bucket "audios-practica"
   *
   * @param file Archivo que vamos a subir
   * @param filePath Ruta/nombre con el que se guardará dentro del bucket
   * @returns URL pública del archivo subido
   */
  async subirAudio(file: File, filePath: string): Promise<string> {
    // Subimos el archivo al bucket ya creado en Supabase
    const { error } = await supabase.storage
      .from('audios-practica')
      .upload(filePath, file, {
        upsert: true
      });

    // Si hay error, lo lanzamos para poder verlo en consola
    if (error) {
      throw error;
    }

    // Obtenemos la URL pública del archivo
    const { data } = supabase.storage
      .from('audios-practica')
      .getPublicUrl(filePath);

    return data.publicUrl;
  }
}