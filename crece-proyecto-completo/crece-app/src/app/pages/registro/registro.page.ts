import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { IonicModule, ToastController } from '@ionic/angular';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-registro',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, IonicModule, RouterLink],
  templateUrl: './registro.page.html',
  styleUrl: './registro.page.scss'
})
export class RegistroPage {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private router = inject(Router);
  private toast = inject(ToastController);

  cargando = signal(false);

  formulario = this.fb.nonNullable.group({
    nombre_completo: ['', [Validators.required, Validators.minLength(3)]],
    email: ['', [Validators.required, Validators.email]],
    telefono: [''],
    password: ['', [Validators.required, Validators.minLength(6)]],
    rol: ['cliente' as 'cliente' | 'negocio', Validators.required]
  });

  async registrar() {
    if (this.formulario.invalid) {
      this.formulario.markAllAsTouched();
      return;
    }

    this.cargando.set(true);
    this.auth.registrar(this.formulario.getRawValue()).subscribe({
      next: async (respuesta) => {
        this.cargando.set(false);
        const destino = respuesta.usuario.rol === 'negocio' ? '/tabs/mi-negocio' : '/tabs/inicio';
        const aviso = await this.toast.create({
          message: '¡Cuenta creada correctamente!',
          duration: 2000,
          color: 'success'
        });
        await aviso.present();
        this.router.navigateByUrl(destino, { replaceUrl: true });
      },
      error: async (error) => {
        this.cargando.set(false);
        const aviso = await this.toast.create({
          message: error?.error?.mensaje || 'No fue posible crear la cuenta',
          duration: 2500,
          color: 'danger'
        });
        await aviso.present();
      }
    });
  }
}
