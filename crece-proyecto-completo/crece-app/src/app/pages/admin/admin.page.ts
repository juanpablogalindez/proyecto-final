import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ToastController } from '@ionic/angular';
import { Negocio } from '../../core/models';
import { NegociosService } from '../../core/services/negocios.service';

interface NegocioPendiente extends Negocio {
  propietario: string;
  email_propietario: string;
  fecha_creacion: string;
}

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [CommonModule, IonicModule],
  template: `
    <ion-header>
      <ion-toolbar color="primary">
        <ion-title>Verificar negocios</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <p>Revisa los negocios registrados y verifica los que cumplan los requisitos.</p>
      <ion-note color="danger" *ngIf="error()">{{ error() }}</ion-note>

      <div class="ion-text-center ion-padding" *ngIf="cargando()">
        <ion-spinner name="crescent"></ion-spinner>
      </div>

      <ion-card *ngFor="let negocio of pendientes()">
        <img *ngIf="negocio.logo_url" [src]="negocio.logo_url" [alt]="negocio.nombre_negocio" />
        <ion-card-header>
          <ion-card-title>{{ negocio.nombre_negocio }}</ion-card-title>
          <ion-card-subtitle>Registrado {{ negocio.fecha_creacion | date:'mediumDate' }}</ion-card-subtitle>
        </ion-card-header>
        <ion-card-content>
          <p>{{ negocio.descripcion || 'Sin descripción' }}</p>
          <p *ngIf="negocio.direccion">Dirección: {{ negocio.direccion }}</p>
          <p>Propietario: {{ negocio.propietario }}</p>
          <p>Correo: {{ negocio.email_propietario }}</p>
          <p *ngIf="negocio.telefono_negocio">Teléfono: {{ negocio.telefono_negocio }}</p>
          <ion-button expand="block" [disabled]="verificandoId() === negocio.id"
                      (click)="verificar(negocio)">
            <ion-spinner slot="start" name="crescent" *ngIf="verificandoId() === negocio.id"></ion-spinner>
            <ion-icon slot="start" name="shield-checkmark-outline"
                      *ngIf="verificandoId() !== negocio.id"></ion-icon>
            Verificar negocio
          </ion-button>
        </ion-card-content>
      </ion-card>

      <ion-card *ngIf="!cargando() && !error() && pendientes().length === 0">
        <ion-card-content class="ion-text-center">
          No hay negocios pendientes de verificación.
        </ion-card-content>
      </ion-card>
    </ion-content>
  `
})
export class AdminPage implements OnInit {
  private negociosService = inject(NegociosService);
  private toast = inject(ToastController);

  pendientes = signal<NegocioPendiente[]>([]);
  cargando = signal(true);
  error = signal('');
  verificandoId = signal<number | null>(null);

  ngOnInit() {
    this.cargarPendientes();
  }

  verificar(negocio: NegocioPendiente) {
    this.verificandoId.set(negocio.id);
    this.error.set('');
    this.negociosService.verificar(negocio.id).subscribe({
      next: async (respuesta) => {
        this.pendientes.update((lista) => lista.filter((item) => item.id !== negocio.id));
        this.verificandoId.set(null);
        const aviso = await this.toast.create({
          message: respuesta.mensaje,
          duration: 2500,
          color: 'success'
        });
        await aviso.present();
      },
      error: (error) => {
        this.verificandoId.set(null);
        this.error.set(error?.error?.mensaje || 'No fue posible verificar el negocio.');
      }
    });
  }

  private cargarPendientes() {
    this.negociosService.pendientesVerificacion().subscribe({
      next: (lista) => {
        this.pendientes.set(lista);
        this.cargando.set(false);
        this.error.set('');
      },
      error: (error) => {
        this.cargando.set(false);
        this.error.set(error?.error?.mensaje || 'No fue posible cargar los negocios pendientes.');
      }
    });
  }
}
