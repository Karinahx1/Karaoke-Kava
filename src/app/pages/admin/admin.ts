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

  // Errores inline por campo
  errores: Record<string, string> = {};

  private readonly regexYoutube = /(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)[\w\-]{11}/;

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

  private validarCancion(): boolean {
    this.errores = {};
    let valido = true;

    // Título
    const titulo = this.titulo.trim();
    if (!titulo) {
      this.errores['titulo'] = 'El título es obligatorio.';
      valido = false;
    } else if (titulo.length > 100) {
      this.errores['titulo'] = 'El título no puede superar los 100 caracteres.';
      valido = false;
    }

    // Artista(s): puede ser uno o varios separados por coma — cada parte debe ser no vacía
    const artistas = this.separarPorComas(this.nombreArtista);
    if (!this.nombreArtista.trim()) {
      this.errores['artista'] = 'Ingresa al menos un artista.';
      valido = false;
    } else if (artistas.length === 0) {
      this.errores['artista'] = 'Ingresa nombres de artista válidos (sin comas vacías).';
      valido = false;
    }

    // Género(s): igual que artistas
    const generos = this.separarPorComas(this.nombreGenero);
    if (!this.nombreGenero.trim()) {
      this.errores['genero'] = 'Ingresa al menos un género.';
      valido = false;
    } else if (generos.length === 0) {
      this.errores['genero'] = 'Ingresa nombres de género válidos (sin comas vacías).';
      valido = false;
    }

    // Duración
    const dur = Number(this.duracion);
    if (!this.duracion && this.duracion !== 0) {
      this.errores['duracion'] = 'La duración es obligatoria.';
      valido = false;
    } else if (!Number.isInteger(dur) || dur <= 0) {
      this.errores['duracion'] = 'La duración debe ser un número entero mayor que 0.';
      valido = false;
    } else if (dur > 99999) {
      this.errores['duracion'] = 'La duración ingresada parece demasiado larga.';
      valido = false;
    }

    // URL de YouTube
    const url = this.urlAudio.trim();
    if (!url) {
      this.errores['urlAudio'] = 'La URL de YouTube es obligatoria.';
      valido = false;
    } else if (!this.regexYoutube.test(url)) {
      this.errores['urlAudio'] = 'Ingresa una URL válida de YouTube (youtube.com o youtu.be).';
      valido = false;
    }

    return valido;
  }

  async guardarCancion() {
    if (!this.validarCancion()) return;

    try {
      const artistas = this.separarPorComas(this.nombreArtista);
      const generos  = this.separarPorComas(this.nombreGenero);

      const cancion = {
        titulo:          this.titulo.trim(),
        duracion:        Number(this.duracion),
        letra:           this.letra,
        url_audio:       this.urlAudio.trim(),
        nombresArtistas: artistas,
        nombresGeneros:  generos
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
    // Limpiar errores de cualquier validación previa antes de abrir el modal
    this.errores = {};

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

  async toggleActiva(cancion: any) {
    const nuevaActiva = !cancion.activa;
    const accion = nuevaActiva ? 'activar' : 'desactivar';
    const confirmar = confirm(
      `¿Seguro que deseas ${accion} "${cancion.titulo}"?\n\n` +
      (nuevaActiva
        ? 'La canción volverá a aparecer en el catálogo para todos los usuarios.'
        : 'La canción desaparecerá del catálogo pero su historial se conservará.')
    );
    if (!confirmar) return;

    try {
      await this.adminCancionService.toggleActiva(cancion.id, nuevaActiva);
      await this.cargarCanciones();
    } catch (error: any) {
      console.error('Error al cambiar estado de la canción:', error);
      alert('Error al cambiar estado: ' + error.message);
    }
  }

  async eliminarCancion(cancion: any) {
    const confirmar = confirm(
      `¿Seguro que deseas ELIMINAR permanentemente "${cancion.titulo}"?\n\n` +
      'Esta acción no se puede deshacer.\n' +
      'Solo funciona si la canción nunca fue usada en prácticas o combates.'
    );
    if (!confirmar) return;

    try {
      await this.adminCancionService.eliminarCancion(cancion.id);
      alert('Canción eliminada correctamente.');
      await this.cargarCanciones();
    } catch (error: any) {
      console.error('Error al eliminar canción:', error);
      alert('⚠️ No se puede eliminar esta canción\n\n' + error.message + '\n\nPuedes usar el botón "Desactivar" para ocultarla del catálogo sin perder ningún historial.');
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
    this.errores = {};
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