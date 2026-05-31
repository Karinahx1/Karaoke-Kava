import { Routes } from '@angular/router';

import { InicioPage } from './pages/inicio/inicio';
import { PracticaPage } from './pages/practica/practica.page';
import { LoginPage } from './pages/login/login';
import { RegistroPage } from './pages/registro/registro';
import { AdminPage } from './pages/admin/admin';
import { MenuPage } from './pages/menu/menu';
import { authGuard } from './guards/auth.guard';

export const routes: Routes = [
  {
    path: '',
    component: InicioPage
  },
  { path: 'login', component: LoginPage },
  { path: 'registro', component: RegistroPage },
  {
    path: 'practica',
    component: PracticaPage
  },
  { path: 'admin', component: AdminPage },
  {
    path: 'auth/callback',
    component: MenuPage,
    canActivate: [authGuard]
  }
];