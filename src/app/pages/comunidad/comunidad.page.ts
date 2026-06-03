import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ComunidadService, UsuarioLeaderboard, CombateFeed, CancionTop, PerfilEstadisticas } from '../../services/comunidad.service';
import { AuthService } from '../../services/auth.service';
import { CombateService } from '../../services/combate.service';
import { ToastService } from '../../services/toast.service';

@Component({
  selector: 'app-comunidad',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './comunidad.page.html',
  styleUrl: './comunidad.page.css'
})
export class ComunidadPage implements OnInit {
  activeTab = signal<'leaderboard' | 'feed' | 'top-canciones' | 'mi-perfil' | 'perfil-publico'>('leaderboard');
  
  cargando = signal(true);
  error = signal<string | null>(null);

  // Datos
  leaderboard = signal<UsuarioLeaderboard[]>([]);
  feed = signal<CombateFeed[]>([]);
  topCanciones = signal<CancionTop[]>([]);
  miPerfil = signal<PerfilEstadisticas | null>(null);
  perfilPublico = signal<PerfilEstadisticas | null>(null);

  usuarioActualId = signal<string | null>(null);
  miDbId = signal<string | null>(null); // ID en tbl_usuario (no el auth UID)
  enviandoDesafio = signal(false);
  private tabsCargadas = new Set<string>(); // Para no recargar datos ya cargados

  constructor(
    private router: Router,
    private comunidadService: ComunidadService,
    private authService: AuthService,
    private combateService: CombateService,
    private toastService: ToastService
  ) {}

  async ngOnInit() {
    try {
      const user = await this.authService.obtenerUsuarioActual();
      if (!user) {
        this.router.navigate(['/login']);
        return;
      }
      this.usuarioActualId.set(user.id);

      // Obtener el ID de BD del usuario actual (necesario para enviar invitaciones)
      const perfil = await this.authService.obtenerPerfilUsuario(user.id);
      if (perfil) this.miDbId.set(String(perfil.id));

      await this.cargarLeaderboard();
    } catch (err) {
      console.error('Error inicializando comunidad:', err);
    }
  }

  async setTab(tab: 'leaderboard' | 'feed' | 'top-canciones' | 'mi-perfil' | 'perfil-publico') {
    this.activeTab.set(tab);
    this.error.set(null);

    // Si ya cargamos este tab antes, no volvemos a pedir datos al servidor
    // (perfil-publico sí recarga porque depende del usuario que se seleccione)
    if (this.tabsCargadas.has(tab) && tab !== 'perfil-publico') return;

    this.cargando.set(true);
    try {
      switch (tab) {
        case 'leaderboard':   await this.cargarLeaderboard();   break;
        case 'feed':          await this.cargarFeed();          break;
        case 'top-canciones': await this.cargarTopCanciones();  break;
        case 'mi-perfil':     await this.cargarMiPerfil();      break;
      }
      this.tabsCargadas.add(tab);
    } catch (err) {
      this.error.set('Error al cargar la información.');
    } finally {
      this.cargando.set(false);
    }
  }

  async cargarLeaderboard() {
    this.cargando.set(true);
    this.comunidadService.getLeaderboard().subscribe({
      next: (res) => {
        if (res.ok) this.leaderboard.set(res.data);
        this.cargando.set(false);
      },
      error: (err) => {
        this.error.set('No se pudo cargar el Leaderboard.');
        this.cargando.set(false);
      }
    });
  }

  async cargarFeed() {
    this.comunidadService.getFeed().subscribe({
      next: (res) => {
        if (res.ok) this.feed.set(res.data);
      },
      error: (err) => {
        this.error.set('No se pudo cargar el feed.');
      }
    });
  }

  async cargarTopCanciones() {
    this.comunidadService.getTopCanciones().subscribe({
      next: (res) => {
        if (res.ok) this.topCanciones.set(res.data);
      },
      error: (err) => {
        this.error.set('No se pudieron cargar las canciones principales.');
      }
    });
  }

  async cargarMiPerfil() {
    try {
      const userDb = await this.authService.obtenerPerfilUsuario(this.usuarioActualId()!);
      if (!userDb) {
        this.error.set('No se encontró el perfil de usuario.');
        return;
      }
      const res = await firstValueFrom(this.comunidadService.getPerfil(userDb.id));
      if (res.ok) {
        this.miPerfil.set(res.data);
      } else {
        this.error.set('Error al cargar tus estadísticas.');
      }
    } catch (e) {
      this.error.set('Error al cargar tus estadísticas.');
    }
  }

  verPerfilPublico(idUsuario: string) {
    this.cargando.set(true);
    this.activeTab.set('perfil-publico');
    this.comunidadService.getPerfil(idUsuario).subscribe({
      next: (res) => {
        if (res.ok) this.perfilPublico.set(res.data);
        this.cargando.set(false);
      },
      error: (err) => {
        this.error.set('No se pudo cargar el perfil.');
        this.cargando.set(false);
      }
    });
  }

  async desafiarUsuario(idOponente: string) {
    const miId = this.miDbId();
    if (!miId) {
      this.toastService.error('No se pudo identificar tu usuario. Intenta de nuevo.');
      return;
    }
    if (miId === String(idOponente)) {
      this.toastService.warning('No puedes desafiarte a ti mismo.');
      return;
    }

    this.enviandoDesafio.set(true);
    try {
      const res = await this.combateService.invitarUsuario(miId, String(idOponente));
      if (res.ok) {
        this.toastService.success('¡Invitación enviada! Espera a que acepte el combate.');
        this.router.navigate(['/combates']);
      } else {
        this.toastService.error('No se pudo enviar la invitación. Intenta de nuevo.');
      }
    } catch (err) {
      console.error('Error al desafiar usuario:', err);
      this.toastService.error('Error de conexión al enviar el desafío.');
    } finally {
      this.enviandoDesafio.set(false);
    }
  }

  volverAlMenu() {
    this.router.navigate(['/auth/callback']);
  }

  // Devuelve "hace X minutos / horas / días" según la fecha recibida
  tiempoRelativo(fecha: string): string {
    if (!fecha) return '';
    const ahora = new Date();
    const entonces = new Date(fecha);
    const diffMs = ahora.getTime() - entonces.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffHoras = Math.floor(diffMin / 60);
    const diffDias = Math.floor(diffHoras / 24);

    if (diffMin < 1)   return 'Hace un momento';
    if (diffMin < 60)  return `Hace ${diffMin} minuto${diffMin > 1 ? 's' : ''}`;
    if (diffHoras < 24) return `Hace ${diffHoras} hora${diffHoras > 1 ? 's' : ''}`;
    if (diffDias < 7)  return `Hace ${diffDias} día${diffDias > 1 ? 's' : ''}`;
    return entonces.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  // Iniciales del nombre (ej. "Juan Pérez" → "JP")
  getIniciales(nombre: string): string {
    const partes = (nombre ?? '').trim().split(' ').filter(Boolean);
    if (partes.length >= 2) return (partes[0][0] + partes[1][0]).toUpperCase();
    return (nombre ?? '??').substring(0, 2).toUpperCase();
  }

  // Color de avatar determinístico según el nombre (siempre el mismo color para el mismo usuario)
  getColorAvatar(nombre: string): string {
    const colores = ['#7c3aed', '#2563eb', '#0891b2', '#059669', '#d97706', '#dc2626', '#c026d3'];
    let hash = 0;
    for (let i = 0; i < (nombre ?? '').length; i++) {
      hash = (nombre ?? '').charCodeAt(i) + ((hash << 5) - hash);
    }
    return colores[Math.abs(hash) % colores.length];
  }

  // Medalla según posición (1, 2, 3)
  getMedalla(posicion: number): string {
    return posicion === 1 ? '🥇' : posicion === 2 ? '🥈' : '🥉';
  }
}
