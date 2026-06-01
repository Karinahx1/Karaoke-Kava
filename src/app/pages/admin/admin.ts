import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AdminCancionService } from '../../services/admin-cancion.service';
import { AuthService } from '../../services/auth.service';
import { supabase } from '../../core/supabase.client';

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin.html',
  styleUrl: './admin.css'
})
export class AdminPage implements OnInit {
  canciones = signal<any[]>([]);

  vistaActual = signal<'crear' | 'listar'>('listar');
  editando = signal(false);
  modalAbierto = signal(false);
  mostrarModalLogout = signal(false);
  idEditando = signal<number | null>(null);

  titulo = '';
  nombreArtista = '';
  nombreGenero = '';
  duracion: number | null = null;
  letra = '';
  urlAudio = '';

  constructor(
    private adminCancionService: AdminCancionService,
    private router: Router,
    private authService: AuthService
  ) {}

  async ngOnInit() {
    try {
      const authUser = await this.authService.obtenerUsuarioActual();
      if (!authUser) {
        this.router.navigate(['/login']);
        return;
      }

      // Validar rol del usuario en la base de datos
      const { data: dbUser, error } = await supabase
        .from('tbl_usuario')
        .select('id_rol')
        .eq('auth_uid', authUser.id)
        .maybeSingle();

      if (error || !dbUser || dbUser.id_rol !== 2) {
        console.warn('Acceso denegado: Se requiere rol de administrador.');
        this.router.navigate(['/auth/callback']); // Redirigir al menú principal protegido
        return;
      }

      await this.cargarCanciones();
    } catch (e) {
      console.error('Error al validar acceso de administrador:', e);
      this.router.navigate(['/auth/callback']);
    }
  }

  cambiarVista(vista: 'crear' | 'listar') {
    this.vistaActual.set(vista);
  }

  async cargarCanciones() {
    try {
      const data = await this.adminCancionService.obtenerCanciones();
      this.canciones.set(data ?? []);
    } catch (error) {
      console.error('Error al cargar canciones:', error);
      alert('Error al cargar canciones.');
    }
  }

  separarPorComas(texto: string): string[] {
    return texto
      .split(',')
      .map(valor => valor.trim())
      .filter(valor => valor.length > 0);
  }

  async guardarCancion() {
    try {
      const artistas = this.separarPorComas(this.nombreArtista);
      const generos = this.separarPorComas(this.nombreGenero);

      if (!this.titulo || artistas.length === 0 || generos.length === 0 || !this.duracion || !this.urlAudio) {
        alert('Completa título, artista(s), género(s), duración y URL.');
        return;
      }

      const cancion = {
        titulo: this.titulo,
        duracion: Number(this.duracion),
        letra: this.letra,
        url_audio: this.urlAudio,
        nombresArtistas: artistas,
        nombresGeneros: generos
      };

      if (this.editando() && this.idEditando()) {
        await this.adminCancionService.actualizarCancion(this.idEditando()!, cancion);
        alert('Canción actualizada correctamente.');
      } else {
        await this.adminCancionService.crearCancion(cancion);
        alert('Canción creada correctamente.');
        this.vistaActual.set('listar');
      }

      this.limpiarFormulario();
      await this.cargarCanciones();

    } catch (error: any) {
      console.error('Error al guardar canción:', error);
      alert('Error al guardar canción: ' + error.message);
    }
  }

  editarCancion(cancion: any) {
    this.editando.set(true);
    this.modalAbierto.set(true);
    this.idEditando.set(cancion.id);

    this.titulo = cancion.titulo;
    this.nombreArtista = cancion.artistas?.join(', ') ?? '';
    this.nombreGenero = cancion.generos?.join(', ') ?? '';
    this.duracion = cancion.duracion;
    this.letra = cancion.letra ?? '';
    this.urlAudio = cancion.url_audio ?? '';
  }

  async eliminarCancion(id: number) {
    const confirmar = confirm('¿Seguro que deseas eliminar esta canción?');
    if (!confirmar) return;

    try {
      await this.adminCancionService.eliminarCancion(id);
      alert('Canción eliminada correctamente.');
      await this.cargarCanciones();
    } catch (error: any) {
      console.error('Error al eliminar canción:', error);
      alert('Error al eliminar canción: ' + error.message);
    }
  }

  limpiarFormulario() {
    this.editando.set(false);
    this.modalAbierto.set(false);
    this.idEditando.set(null);

    this.titulo = '';
    this.nombreArtista = '';
    this.nombreGenero = '';
    this.duracion = null;
    this.letra = '';
    this.urlAudio = '';
  }

  pedirConfirmacionLogout() {
    this.mostrarModalLogout.set(true);
  }

  cancelarLogout() {
    this.mostrarModalLogout.set(false);
  }

  async confirmarCerrarSesion() {
    this.mostrarModalLogout.set(false);
    const { error } = await supabase.auth.signOut();

    if (error) {
      console.error('Error al cerrar sesión:', error);
      alert('Error al cerrar sesión.');
      return;
    }

    this.router.navigate(['/login']);
  }
}