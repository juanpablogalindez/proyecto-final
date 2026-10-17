import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { IonicModule, ToastController } from '@ionic/angular';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, IonicModule, RouterLink],
  templateUrl: './login.page.html'
})
export class LoginPage {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private router = inject(Router);
  private toast = inject(ToastController);

  cargando = signal(false);

  formulario = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]]
  });

  async ingresar() {
    if (this.formulario.invalid) {
      this.formulario.markAllAsTouched();
      return;
    }

    this.cargando.set(true);
    const { email, password } = this.formulario.getRawValue();

    this.auth.login(email, password).subscribe({
      next: () => {
        this.cargando.set(false);
        this.router.navigateByUrl('/tabs/inicio', { replaceUrl: true });
      },
      error: async (error) => {
        this.cargando.set(false);
        const mensaje = error?.error?.mensaje || 'No fue posible iniciar sesión';
        const aviso = await this.toast.create({ message: mensaje, duration: 2500, color: 'danger' });
        await aviso.present();
      }
    });
  }
}
