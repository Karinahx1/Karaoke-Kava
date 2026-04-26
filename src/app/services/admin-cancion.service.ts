import { Injectable } from '@angular/core';
import { supabase } from '../core/supabase.client';

@Injectable({
  providedIn: 'root'
})
export class AdminCancionService {

  async obtenerCanciones() {
    const { data: canciones, error } = await supabase
      .from('tbl_cancion')
      .select('*')
      .order('id', { ascending: true });

    if (error) throw error;

    const cancionesConRelaciones = await Promise.all(
      (canciones ?? []).map(async (cancion: any) => {
        const { data: artistas } = await supabase
          .from('tbl_artista_x_cancion')
          .select('tbl_artista(id, nombre)')
          .eq('id_cancion', cancion.id);

        const { data: generos } = await supabase
          .from('tbl_genero_musical_x_cancion')
          .select('tbl_genero_musical(id, nombre)')
          .eq('id_cancion', cancion.id);

        return {
          ...cancion,
          artistas: artistas?.map((item: any) => item.tbl_artista?.nombre).filter(Boolean) ?? [],
          generos: generos?.map((item: any) => item.tbl_genero_musical?.nombre).filter(Boolean) ?? []
        };
      })
    );

    return cancionesConRelaciones;
  }

  async crearCancion(cancion: {
    titulo: string;
    duracion: number;
    letra: string;
    url_audio: string;
    nombresArtistas: string[];
    nombresGeneros: string[];
  }) {
    const { data: cancionCreada, error: errorCancion } = await supabase
      .from('tbl_cancion')
      .insert({
        titulo: cancion.titulo,
        duracion: cancion.duracion,
        letra: cancion.letra,
        url_audio: cancion.url_audio,
        
      })
      .select()
      .single();

    if (errorCancion) throw errorCancion;

    await this.guardarRelaciones(cancionCreada.id, cancion.nombresArtistas, cancion.nombresGeneros);

    return cancionCreada;
  }

  async actualizarCancion(
    id: number,
    cancion: {
      titulo: string;
      duracion: number;
      letra: string;
      url_audio: string;
      nombresArtistas: string[];
      nombresGeneros: string[];
    }
  ) {
    const { data: cancionActualizada, error } = await supabase
      .from('tbl_cancion')
      .update({
        titulo: cancion.titulo,
        duracion: cancion.duracion,
        letra: cancion.letra,
        url_audio: cancion.url_audio,
        
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    await supabase.from('tbl_artista_x_cancion').delete().eq('id_cancion', id);
    await supabase.from('tbl_genero_musical_x_cancion').delete().eq('id_cancion', id);

    await this.guardarRelaciones(id, cancion.nombresArtistas, cancion.nombresGeneros);

    return cancionActualizada;
  }

  async eliminarCancion(id: number) {
    await supabase.from('tbl_artista_x_cancion').delete().eq('id_cancion', id);
    await supabase.from('tbl_genero_musical_x_cancion').delete().eq('id_cancion', id);

    const { error } = await supabase
      .from('tbl_cancion')
      .delete()
      .eq('id', id);

    if (error) throw error;
  }

  private async guardarRelaciones(
    idCancion: number,
    nombresArtistas: string[],
    nombresGeneros: string[]
  ) {
    for (const nombreArtista of nombresArtistas) {
      let { data: artista } = await supabase
        .from('tbl_artista')
        .select('*')
        .eq('nombre', nombreArtista)
        .maybeSingle();

      if (!artista) {
        const { data: nuevoArtista, error } = await supabase
          .from('tbl_artista')
          .insert({ nombre: nombreArtista })
          .select()
          .single();

        if (error) throw error;
        artista = nuevoArtista;
      }

      const { error: errorRelacion } = await supabase
        .from('tbl_artista_x_cancion')
        .insert({
          id_artista: artista.id,
          id_cancion: idCancion
        });

      if (errorRelacion) throw errorRelacion;
    }

    for (const nombreGenero of nombresGeneros) {
      let { data: genero } = await supabase
        .from('tbl_genero_musical')
        .select('*')
        .eq('nombre', nombreGenero)
        .maybeSingle();

      if (!genero) {
        const { data: nuevoGenero, error } = await supabase
          .from('tbl_genero_musical')
          .insert({ nombre: nombreGenero })
          .select()
          .single();

        if (error) throw error;
        genero = nuevoGenero;
      }

      const { error: errorRelacion } = await supabase
        .from('tbl_genero_musical_x_cancion')
        .insert({
          id_cancion: idCancion,
          id_genero_musical: genero.id
        });

      if (errorRelacion) throw errorRelacion;
    }
  }
}