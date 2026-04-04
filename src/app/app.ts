// Importamos lo necesario desde Angular
import { Component, OnInit, signal } from '@angular/core';

import { RouterOutlet } from '@angular/router';

// CommonModule permite usar estructuras como @if, @for y otras utilidades comunes
import { CommonModule } from '@angular/common';

// Importamos el servicio que consulta canciones en Supabase
import { CancionService } from './services/cancion.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App implements OnInit {

  /**
   * Usamos signal para que Angular reaccione automáticamente
   * cuando cambie la lista de canciones.
   *
   * Antes teníamos:
   * canciones: any[] = [];
   *
   * Ahora usamos una signal, porque así la interfaz se actualiza
   * en cuanto llegue la respuesta desde Supabase.
   */
  canciones = signal<any[]>([]);

  constructor(private cancionService: CancionService) {}

  async ngOnInit() {
    try {
      // Pedimos las canciones al servicio
      const resultado = await this.cancionService.obtenerCanciones();

      // Actualizamos la signal con las canciones obtenidas
      this.canciones.set(resultado ?? []);

      // Verificamos en consola qué llegó
      console.log('Canciones:', this.canciones());

    } catch (error) {
      console.error('Error al obtener canciones:', error);
    }
  }
}

/**Este carga las paginas, sirve como router */