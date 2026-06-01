import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { supabase } from '../../core/supabase.client';

@Component({
  selector: 'app-menu',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './menu.html',
  styleUrl: './menu.css'
})
export class MenuPage implements OnInit {
  // Señales de Angular para control reactivo de la vista
  usuario = signal<any>(null);
  nivelUsuario = signal<number | null>(null);
  nombreNivel = signal<string | null>(null);
  idRolUsuario = signal<number | null>(null);
  cargando = signal(true);
  mostrarModalLogout = signal(false);

  constructor(
    private authService: AuthService,
    private router: Router
  ) {}

  async ngOnInit() {
    try {
      // 1. Obtener la sesión y usuario actual de Supabase Auth
      let authUser = await this.authService.obtenerUsuarioActual();

      // Si el usuario acaba de ser redirigido y el token aún se está procesando
      // en el fragmento hash, esperamos un breve momento
      if (!authUser && window.location.hash.includes('access_token')) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        authUser = await this.authService.obtenerUsuarioActual();
      }

      if (!authUser) {
        // Redirigir a login si no se encuentra sesión activa
        this.router.navigate(['/login']);
        return;
      }

      this.usuario.set(authUser);

      // 2. Consultar el perfil del usuario en la base de datos (tbl_usuario)
      await this.cargarPerfilUsuario(authUser);

    } catch (error) {
      console.error('Error al inicializar el menú principal:', error);
      this.router.navigate(['/login']);
    } finally {
      this.cargando.set(false);
    }
  }

  /**
   * Carga el registro del usuario desde la tabla tbl_usuario en Supabase.
   * Si no existe, realiza un registro automático (típico para usuarios de Google Auth de primera vez).
   */
  async cargarPerfilUsuario(authUser: any) {
    try {
      // 1. Intentar buscar por auth_uid
      let { data: dbUser, error } = await supabase
        .from('tbl_usuario')
        .select('*')
        .eq('auth_uid', authUser.id)
        .maybeSingle();

      if (error) {
        console.error('Error al consultar perfil en tbl_usuario por auth_uid:', error);
      }

      // 2. Si no se encuentra, intentar buscar por email para enlazar cuentas preexistentes
      if (!dbUser && authUser.email) {
        const { data: dbUserByEmail, error: emailError } = await supabase
          .from('tbl_usuario')
          .select('*')
          .eq('email', authUser.email)
          .maybeSingle();

        if (emailError) {
          console.error('Error al consultar perfil por email:', emailError);
        } else if (dbUserByEmail) {
          // Enlazar el auth_uid del usuario autenticado con Google al registro preexistente
          const { data: updatedUser, error: updateError } = await supabase
            .from('tbl_usuario')
            .update({ auth_uid: authUser.id })
            .eq('id', dbUserByEmail.id)
            .select()
            .single();

          if (updateError) {
            console.error('Error al enlazar auth_uid:', updateError);
            dbUser = dbUserByEmail; // Fallback al registro existente sin actualizar
          } else {
            console.log('Cuenta enlazada exitosamente por email:', updatedUser);
            dbUser = updatedUser;
          }
        }
      }

      // 3. Si no existe ningún registro, lo creamos (usando datos del registro híbrido o por defecto)
      if (!dbUser) {
        let tempProfile: any = null;
        try {
          const stored = localStorage.getItem('temp_registro_perfil');
          if (stored) {
            tempProfile = JSON.parse(stored);
            localStorage.removeItem('temp_registro_perfil');
            console.log('Datos de registro temporal recuperados de localStorage:', tempProfile);
          }
        } catch (e) {
          console.error('Error al leer temp_registro_perfil de localStorage:', e);
        }

        const metadata = authUser.user_metadata || {};
        const nombreCompleto = metadata.full_name || metadata.name || 'Usuario';
        
        // Dividimos nombre y apellido del perfil de Google
        const partesNombre = nombreCompleto.split(' ');
        const nombreDefault = partesNombre[0] || 'Usuario';
        const apellidoDefault = partesNombre.slice(1).join(' ') || 'Google';

        const { data: nuevoUsuario, error: insertError } = await supabase
          .from('tbl_usuario')
          .insert({
            nombre: tempProfile?.nombre || nombreDefault,
            apellido: tempProfile?.apellido || apellidoDefault,
            // Priorizar el email ingresado en el formulario (ya validado), con fallback al de Google
            email: tempProfile?.email || authUser.email,
            auth_uid: authUser.id,
            id_tipo_documento: 1,
            num_documento: tempProfile?.numDocumento || ('GoogleUser-' + authUser.id.substring(0, 8)),
            id_genero_persona: tempProfile?.idGenero ? Number(tempProfile.idGenero) : 1,
            id_estado: 1,
            id_rol: 1,       // Todos los usuarios nuevos son Jugadores por defecto
            id_nivel: null   // Sin nivel hasta completar la primera práctica
          })
          .select()
          .single();

        if (insertError) {
          console.error('Error al registrar automáticamente el perfil:', insertError);
        } else if (nuevoUsuario) {
          console.log('Perfil registrado con éxito:', nuevoUsuario);
          dbUser = nuevoUsuario;
        }
      }

      // 4. Asignar los estados reactivos una vez obtenido el dbUser
      if (dbUser) {
        // id_rol viene exclusivamente de la base de datos — sin valores por defecto
        this.idRolUsuario.set(dbUser.id_rol ?? null);
        this.nivelUsuario.set(dbUser.id_nivel ?? null);

        // Consultar el nombre del nivel a partir de id_nivel consultando tbl_nivel
        if (dbUser.id_nivel) {
          const { data: niveles, error: levelError } = await supabase
            .from('tbl_nivel')
            .select('*');

          if (levelError) {
            console.error('Error al consultar tbl_nivel:', levelError);
            this.nombreNivel.set(null);
          } else if (niveles) {
            // Buscamos el nivel coincidente tolerando si la clave es id o id_nivel
            const nivelCoincidente = niveles.find(
              (n: any) => n.id === dbUser.id_nivel || n.id_nivel === dbUser.id_nivel
            );
            if (nivelCoincidente) {
              this.nombreNivel.set(nivelCoincidente.nombre);
            } else {
              this.nombreNivel.set(null);
            }
          }
        } else {
          this.nombreNivel.set(null);
        }
      }
    } catch (err) {
      console.error('Error crítico al gestionar el perfil del usuario:', err);
    }
  }

  // Métodos de navegación
  irPractica() {
    this.router.navigate(['/practica']);
  }

  irCombates() {
    this.router.navigate(['/combates']);
  }

  irComunidad() {
    this.router.navigate(['/comunidad']);
  }

  irAdmin() {
    this.router.navigate(['/admin']);
  }

  /**
   * Abre el modal de confirmación antes de cerrar sesión.
   */
  pedirConfirmacionLogout() {
    this.mostrarModalLogout.set(true);
  }

  cancelarLogout() {
    this.mostrarModalLogout.set(false);
  }

  /**
   * Cierra la sesión activa del usuario y limpia el estado local de Supabase
   */
  async confirmarCerrarSesion() {
    this.mostrarModalLogout.set(false);
    try {
      this.cargando.set(true);
      await this.authService.cerrarSesion();
      this.router.navigate(['/']);
    } catch (error) {
      console.error('Error al cerrar la sesión:', error);
      this.cargando.set(false);
    }
  }
}
