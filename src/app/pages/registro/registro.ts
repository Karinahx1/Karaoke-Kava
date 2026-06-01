import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';
import { supabase } from '../../core/supabase.client';

@Component({
  selector: 'app-registro',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './registro.html',
  styleUrl: './registro.css'
})
export class RegistroPage {
  nombre = '';
  apellido = '';
  email = '';
  numDocumento = '';
  cargando = false;
  errorEmail = '';

  // Debe existir un registro con id = 1 en tbl_genero_persona.
  idGenero = 1;

  constructor(
    private router: Router,
    private authService: AuthService,
    private toastService: ToastService
  ) {}

  async registrarse() {
    try {
      this.errorEmail = '';

      // Validar campos obligatorios
      if (!this.nombre.trim() || !this.apellido.trim() || !this.numDocumento.trim() || !this.email.trim()) {
        this.toastService.warning('Por favor, completa todos los campos del formulario.');
        return;
      }

      // Validar formato de email
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(this.email.trim())) {
        this.errorEmail = 'Por favor, ingresa un correo electrónico válido.';
        return;
      }

      this.cargando = true;

      // Verificar si el correo ya está registrado en tbl_usuario
      const { data: usuarioExistente, error: errorBusqueda } = await supabase
        .from('tbl_usuario')
        .select('id, email')
        .eq('email', this.email.trim().toLowerCase())
        .maybeSingle();

      if (errorBusqueda) {
        console.error('Error al verificar el correo:', errorBusqueda);
        this.cargando = false;
        this.toastService.error('Ocurrió un error al validar el correo. Intenta de nuevo.');
        return;
      }

      if (usuarioExistente) {
        this.errorEmail = 'Este correo ya está registrado. Por favor, inicia sesión.';
        this.toastService.error('Ya existe una cuenta asociada a este correo. Por favor, inicia sesión.');
        this.cargando = false;
        return;
      }

      // Guardar temporalmente los datos del perfil en localStorage
      const tempProfile = {
        nombre: this.nombre.trim(),
        apellido: this.apellido.trim(),
        email: this.email.trim().toLowerCase(),
        numDocumento: this.numDocumento.trim(),
        idGenero: this.idGenero
      };

      localStorage.setItem('temp_registro_perfil', JSON.stringify(tempProfile));
      console.log('Datos de perfil guardados en localStorage:', tempProfile);

      // Redirigir al inicio de sesión con Google
      await this.authService.loginConGoogle();

    } catch (error: any) {
      console.error('Error al iniciar el registro con Google:', error);
      this.toastService.error('Error al registrar: ' + error.message);
      this.cargando = false;
    }
  }

  irLogin() {
    this.router.navigate(['/login']);
  }

  volverInicio() {
    this.router.navigate(['/']);
  }
}