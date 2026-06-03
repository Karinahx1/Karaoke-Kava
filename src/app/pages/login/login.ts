import { Component } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './login.html',
  styleUrl: './login.css'
})
export class LoginPage {
  cargando = false;

  constructor(
    private router: Router,
    private authService: AuthService
  ) {}

  async loginGoogle() {
    try {
      this.cargando = true;
      localStorage.setItem('intencion_auth', 'login');
      await this.authService.loginConGoogle();
    } catch (error: any) {
      console.error('Error al iniciar sesión con Google:', error);
      alert('Error al iniciar sesión con Google: ' + error.message);
      this.cargando = false;
    }
  }

  volverInicio() {
    this.router.navigate(['/']);
  }
}