import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ComunidadService, UsuarioLeaderboard, CombateFeed, CancionTop, PerfilEstadisticas } from '../../services/comunidad.service';
import { AuthService } from '../../services/auth.service';

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

  constructor(
    private router: Router,
    private comunidadService: ComunidadService,
    private authService: AuthService
  ) {}

  async ngOnInit() {
    try {
      const user = await this.authService.obtenerUsuarioActual();
      if (!user) {
        this.router.navigate(['/login']);
        return;
      }
      this.usuarioActualId.set(user.id);
      await this.cargarLeaderboard();
    } catch (err) {
      console.error('Error inicializando comunidad:', err);
    }
  }

  async setTab(tab: 'leaderboard' | 'feed' | 'top-canciones' | 'mi-perfil' | 'perfil-publico') {
    this.activeTab.set(tab);
    this.error.set(null);
    this.cargando.set(true);

    try {
      switch (tab) {
        case 'leaderboard':
          await this.cargarLeaderboard();
          break;
        case 'feed':
          await this.cargarFeed();
          break;
        case 'top-canciones':
          await this.cargarTopCanciones();
          break;
        case 'mi-perfil':
          await this.cargarMiPerfil();
          break;
      }
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

  desafiarUsuario(idOponente: string) {
    // Navegar a la pantalla de combates con el oponente preseleccionado
    // En un futuro se podría pasar por state o query param
    this.router.navigate(['/combates']);
  }

  volverAlMenu() {
    this.router.navigate(['/auth/callback']);
  }
}
