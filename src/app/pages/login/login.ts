import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { supabase } from '../../core/supabase.client';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './login.html',
  styleUrl: './login.css'
})
export class LoginPage {
  email = '';
  password = '';

  constructor(private router: Router) {}

  async iniciarSesion() {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: this.email,
        password: this.password
      });

      if (error) throw error;

      const authUid = data.user.id;

      const { data: usuario, error: perfilError } = await supabase
        .from('tbl_usuario')
        .select('*')
        .eq('auth_uid', authUid)
        .single();

      if (perfilError) {
        throw new Error('El usuario inició sesión, pero no existe en tbl_usuario.');
      }

      if (usuario.id_rol === 2) {
        this.router.navigate(['/admin']);
      } else {
        this.router.navigate(['/practica']);
      }

    } catch (error: any) {
      console.error('Error al iniciar sesión:', error);
      alert('Error al iniciar sesión: ' + error.message);
    }
  }

  irRegistro() {
    this.router.navigate(['/registro']);
  }

  volverInicio() {
    this.router.navigate(['/']);
  }
}