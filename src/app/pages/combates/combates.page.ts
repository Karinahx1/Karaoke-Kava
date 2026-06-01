import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { CombateService } from '../../services/combate.service';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';
import { supabase } from '../../core/supabase.client';

@Component({
  selector: 'app-combates',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './combates.page.html',
  styleUrl: './combates.page.css'
})
export class CombatesPage implements OnInit {
  usuario = signal<any>(null);
  cargando = signal(true);

  // Vistas: 'lista' | 'buscando' | 'arena'
  vistaActual = signal<'lista' | 'buscando' | 'arena'>('lista');

  misCombates = signal<any[]>([]);
  combateActivo = signal<any>(null);

  // Autocompletado: término de búsqueda, resultados, seleccionado
  busquedaInvitado = '';
  resultadosBusqueda = signal<any[]>([]);
  mostrarDropdown = signal(false);
  usuarioSeleccionado = signal<any>(null);

  private busquedaSubject = new Subject<string>();

  constructor(
    private combateService: CombateService,
    private authService: AuthService,
    private toastService: ToastService,
    private router: Router
  ) {}

  async ngOnInit() {
    try {
      const authUser = await this.authService.obtenerUsuarioActual();
      if (!authUser) {
        this.router.navigate(['/login']);
        return;
      }

      const { data: dbUser } = await supabase
        .from('tbl_usuario')
        .select('*')
        .eq('auth_uid', authUser.id)
        .single();

      this.usuario.set(dbUser);

      // Configurar debounce para la búsqueda de usuarios
      this.busquedaSubject.pipe(
        debounceTime(300),
        distinctUntilChanged()
      ).subscribe(query => this.ejecutarBusquedaUsuarios(query));

      await this.cargarMisCombates();
    } catch (err) {
      console.error(err);
      this.toastService.error('Error al cargar el perfil. Intenta de nuevo.');
    } finally {
      this.cargando.set(false);
    }
  }

  async cargarMisCombates() {
    if (!this.usuario()) return;
    try {
      const res = await this.combateService.obtenerMisCombates(this.usuario().id);
      if (res.ok) {
        this.misCombates.set(res.data ?? []);
      } else {
        this.toastService.error('No se pudieron cargar tus combates.');
      }
    } catch (err) {
      console.error('Error cargando combates', err);
      this.toastService.error('Error de conexión al cargar combates.');
    }
  }

  async buscarOponenteAutomatico() {
    // Verificar si el usuario tiene prácticas completadas (y por tanto nivel asignado)
    if (!this.usuario()?.id_nivel) {
      // Consultar directamente si existen prácticas finalizadas del usuario
      const { data: practicas } = await supabase
        .from('tbl_practica')
        .select('id')
        .eq('id_usuario', this.usuario().id)
        .eq('id_estado', 5)
        .limit(1);

      if (!practicas || practicas.length === 0) {
        this.toastService.info('🎤 Debes completar al menos una práctica para obtener tu Rango Vocal antes de combatir.');
        return;
      }

      // Tiene prácticas pero el nivel no se refleja aún — recargar usuario
      const { data: usuarioActualizado } = await supabase
        .from('tbl_usuario')
        .select('*')
        .eq('id', this.usuario().id)
        .single();
      if (usuarioActualizado) this.usuario.set(usuarioActualizado);

      if (!this.usuario()?.id_nivel) {
        this.toastService.info('🎤 Tu nivel está siendo calculado. Intenta de nuevo en un momento.');
        return;
      }
    }

    this.cargando.set(true);
    try {
      const res = await this.combateService.buscarOponente(this.usuario().id, this.usuario().id_nivel);
      if (res.ok) {
        if (res.data.status === 'match_found') {
          this.combateActivo.set(res.data.combate);
          this.vistaActual.set('arena');
          this.toastService.success('¡Oponente encontrado! ¡Que comience la batalla!');
        } else {
          this.combateActivo.set(res.data.combate);
          this.vistaActual.set('buscando');
          this.toastService.info('Buscando rival de tu nivel... espera un momento.');
        }
      } else {
        this.toastService.error('No fue posible encontrar un rival con un nivel similar. Intenta invitar a un amigo.');
      }
    } catch (err) {
      console.error(err);
      this.toastService.error('No se pudo conectar con el servidor para buscar oponente.');
    } finally {
      this.cargando.set(false);
    }
  }

  // --- Autocompletado ---
  onBusquedaInput(event: Event) {
    const valor = (event.target as HTMLInputElement).value;
    this.busquedaInvitado = valor;
    this.usuarioSeleccionado.set(null); // limpiar selección previa
    if (valor.length >= 2) {
      this.busquedaSubject.next(valor);
    } else {
      this.resultadosBusqueda.set([]);
      this.mostrarDropdown.set(false);
    }
  }

  private async ejecutarBusquedaUsuarios(query: string) {
    try {
      const res = await this.combateService.buscarUsuarios(query, this.usuario().id);
      if (res.ok && res.data?.length > 0) {
        this.resultadosBusqueda.set(res.data);
        this.mostrarDropdown.set(true);
      } else {
        this.resultadosBusqueda.set([]);
        this.mostrarDropdown.set(false);
      }
    } catch {
      this.resultadosBusqueda.set([]);
    }
  }

  seleccionarUsuario(user: any) {
    this.usuarioSeleccionado.set(user);
    this.busquedaInvitado = `${user.nombre} ${user.apellido}`;
    this.mostrarDropdown.set(false);
    this.resultadosBusqueda.set([]);
  }

  cerrarDropdown() {
    // pequeño delay para que el click en una opción alcance a procesarse
    setTimeout(() => this.mostrarDropdown.set(false), 150);
  }

  async invitarJugador() {
    if (!this.usuarioSeleccionado()) {
      this.toastService.warning('Selecciona un jugador de la lista antes de invitar.');
      return;
    }

    this.cargando.set(true);
    try {
      const res = await this.combateService.invitarUsuario(
        this.usuario().id,
        this.usuarioSeleccionado().id
      );
      if (res.ok) {
        this.toastService.success(`¡Invitación enviada a ${this.usuarioSeleccionado().nombre}!`);
        this.busquedaInvitado = '';
        this.usuarioSeleccionado.set(null);
        await this.cargarMisCombates();
      } else {
        this.toastService.error('No se pudo enviar la invitación. Intenta de nuevo.');
      }
    } catch (err) {
      console.error(err);
      this.toastService.error('Error de conexión al enviar la invitación.');
    } finally {
      this.cargando.set(false);
    }
  }

  async aceptarInvitacion(idCombate: string) {
    this.cargando.set(true);
    try {
      const res = await this.combateService.aceptarCombate(idCombate);
      if (res.ok) {
        this.toastService.success('¡Combate aceptado! Preparándose para la arena...');
        await this.entrarArena(idCombate);
      } else {
        this.toastService.error('No se pudo aceptar el combate. Intenta de nuevo.');
      }
    } catch (err) {
      console.error(err);
      this.toastService.error('Error al aceptar el combate.');
    } finally {
      this.cargando.set(false);
    }
  }

  async entrarArena(idCombate: string) {
    this.cargando.set(true);
    try {
      const res = await this.combateService.obtenerDetalleCombate(idCombate);
      if (res.ok) {
        this.combateActivo.set(res.data);
        this.vistaActual.set('arena');
      } else {
        this.toastService.error('No se pudo cargar la información del combate.');
      }
    } catch (err) {
      console.error(err);
      this.toastService.error('Error al entrar a la arena.');
    } finally {
      this.cargando.set(false);
    }
  }

  volverAlMenu() {
    this.router.navigate(['/auth/callback']);
  }
}
