import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
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
  password = '';
  numDocumento = '';

  // Por ahora dejamos género por defecto.
  // Debe existir un registro con id = 1 en tbl_genero_persona.
  idGenero = 1;

  constructor(private router: Router) {}

  async registrarse() {
    try {
      // 1. Crear usuario en Supabase Auth
      const { data, error } = await supabase.auth.signUp({
        email: this.email,
        password: this.password
      });

      if (error) throw error;

      const authUid = data.user?.id;

      if (!authUid) {
        throw new Error('No se pudo obtener el ID del usuario autenticado.');
      }

      // 2. Guardar también en tbl_usuario
      const { error: insertError } = await supabase
        .from('tbl_usuario')
        .insert({
          nombre: this.nombre,
          apellido: this.apellido,
          email: this.email,
          auth_uid: authUid,
          id_tipo_documento: 1,
          num_documento: this.numDocumento,
          id_genero_persona: this.idGenero,
          id_estado: 1,
          id_rol: 1
        });

      if (insertError) throw insertError;

      alert('Usuario registrado correctamente. Ahora puedes iniciar sesión.');
      this.router.navigate(['/login']);

    } catch (error: any) {
      console.error('Error al registrar:', error);
      alert('Error al registrar: ' + error.message);
    }
  }

  irLogin() {
    this.router.navigate(['/login']);
  }

  volverInicio() {
    this.router.navigate(['/']);
  }
}