import { Component, OnInit } from '@angular/core';
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
export class RegistroPage implements OnInit {
  nombre = '';
  apellido = '';
  email = '';
  numDocumento = '';
  cargando = false;
  mensajeInfo = '';

  // Mensajes de error por campo
  errorNombre    = '';
  errorApellido  = '';
  errorDocumento = '';
  errorEmail     = '';

  // Debe existir un registro con id = 1 en tbl_genero_persona.
  idGenero = 1;

  // Solo letras (incluyendo tildes y ñ), espacios, guion y apóstrofe
  private readonly regexNombre   = /^[a-zA-ZáéíóúÁÉÍÓÚñÑüÜ\s'\-]+$/;
  // Solo dígitos
  private readonly regexDocumento = /^\d+$/;

  constructor(
    private router: Router,
    private authService: AuthService,
    private toastService: ToastService
  ) {}

  ngOnInit() {
    const motivo = localStorage.getItem('motivo_redireccion');
    if (motivo === 'no_registrado') {
      this.mensajeInfo = 'No encontramos una cuenta con este correo. Crea una para empezar a cantar 🎤';
      const correo = localStorage.getItem('email_no_registrado');
      if (correo) {
        this.email = correo; // pre-llenamos el correo de Google
      }
    }
    // Limpiamos para que el mensaje no reaparezca al recargar
    localStorage.removeItem('motivo_redireccion');
    localStorage.removeItem('email_no_registrado');
  }

  private validarFormulario(): boolean {
    let valido = true;

    // Limpiar errores previos
    this.errorNombre    = '';
    this.errorApellido  = '';
    this.errorDocumento = '';
    this.errorEmail     = '';

    // Nombre
    const nombre = this.nombre.trim();
    if (!nombre) {
      this.errorNombre = 'El nombre es obligatorio.';
      valido = false;
    } else if (nombre.length < 2) {
      this.errorNombre = 'El nombre debe tener al menos 2 caracteres.';
      valido = false;
    } else if (nombre.length > 50) {
      this.errorNombre = 'El nombre no puede superar los 50 caracteres.';
      valido = false;
    } else if (!this.regexNombre.test(nombre)) {
      this.errorNombre = 'El nombre solo puede contener letras y espacios.';
      valido = false;
    }

    // Apellido
    const apellido = this.apellido.trim();
    if (!apellido) {
      this.errorApellido = 'El apellido es obligatorio.';
      valido = false;
    } else if (apellido.length < 2) {
      this.errorApellido = 'El apellido debe tener al menos 2 caracteres.';
      valido = false;
    } else if (apellido.length > 50) {
      this.errorApellido = 'El apellido no puede superar los 50 caracteres.';
      valido = false;
    } else if (!this.regexNombre.test(apellido)) {
      this.errorApellido = 'El apellido solo puede contener letras y espacios.';
      valido = false;
    }

    // Número de documento
    const doc = this.numDocumento.trim();
    if (!doc) {
      this.errorDocumento = 'El número de documento es obligatorio.';
      valido = false;
    } else if (!this.regexDocumento.test(doc)) {
      this.errorDocumento = 'El documento solo puede contener dígitos.';
      valido = false;
    } else if (doc.length < 6) {
      this.errorDocumento = 'El documento debe tener al menos 6 dígitos.';
      valido = false;
    } else if (doc.length > 15) {
      this.errorDocumento = 'El documento no puede superar los 15 dígitos.';
      valido = false;
    }

    // Email
    const email = this.email.trim();
    if (!email) {
      this.errorEmail = 'El correo electrónico es obligatorio.';
      valido = false;
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.errorEmail = 'Por favor, ingresa un correo electrónico válido.';
      valido = false;
    }

    return valido;
  }

  async registrarse() {
    try {
      if (!this.validarFormulario()) return;

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
      localStorage.setItem('intencion_auth', 'registro');
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