import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

/**
 * Guardia de ruta funcional para proteger rutas restringidas a usuarios autenticados.
 * En particular, se utiliza para proteger el Menú Principal.
 */
export const authGuard: CanActivateFn = async (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  // Si la URL contiene el access_token del hash (retorno directo de Google OAuth),
  // permitimos el acceso para que el SDK de Supabase procese y establezca la sesión en el cliente.
  if (
    window.location.hash.includes('access_token=') ||
    window.location.href.includes('access_token=')
  ) {
    return true;
  }

  try {
    // Intentamos obtener la sesión activa de Supabase
    const session = await authService.obtenerSesion();
    
    // Si la sesión existe en el localStorage o es devuelta por el cliente, permitimos la navegación
    if (session) {
      return true;
    }
  } catch (error) {
    console.error('Error en guardia de autenticación:', error);
  }

  // Si no hay sesión válida, redirigimos al usuario al inicio de sesión
  router.navigate(['/login']);
  return false;
};
