import { Component } from '@angular/core';
import { Router } from '@angular/router';

/**
 * Página inicial de la aplicación.
 *
 * Esta pantalla funciona como entrada principal:
 * - permite ir a iniciar sesión
 * - permite ir a registrarse
 *
 * Todavía no valida usuarios.
 * Solo redirige a las rutas correspondientes.
 */
@Component({
  selector: 'app-inicio',
  standalone: true,
  imports: [],
  templateUrl: './inicio.html',
  styleUrl: './inicio.css'
})
export class InicioPage {

  constructor(private router: Router) {}

  /**
   * Redirige a la página de inicio de sesión.
   */
  irLogin() {
    this.router.navigate(['/login']);
  }

  /**
   * Redirige a la página de registro.
   */
  irRegistro() {
    this.router.navigate(['/registro']);
  }
}