import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ToastController } from '@ionic/angular';
import { DecisionVerificacion, DetalleVerificacion, Negocio, RequisitoVerificacion, ResultadoVerificacion } from '../../core/models';
import { NegociosService } from '../../core/services/negocios.service';

interface NegocioPendiente extends Negocio {
  propietario: string;
  email_propietario: string;
  fecha_creacion: string;
}

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule],
  template: `
    <ion-header>
      <ion-toolbar color="primary">
        <ion-title>Verificar negocios</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <p>Revisa cada requisito antes de tomar una decisión sobre el negocio.</p>
      <ion-note color="danger" *ngIf="error()">{{ error() }}</ion-note>
      <div class="ion-text-center ion-padding" *ngIf="cargando()">
        <ion-spinner name="crescent"></ion-spinner>
      </div>

      <ion-card *ngFor="let negocio of pendientes()">
        <img *ngIf="negocio.logo_url" [src]="negocio.logo_url" [alt]="negocio.nombre_negocio" />
        <ion-card-header>
          <ion-card-title>{{ negocio.nombre_negocio }}</ion-card-title>
          <ion-card-subtitle>{{ etiquetaEstado(negocio.verificacion_estado) }}</ion-card-subtitle>
        </ion-card-header>
        <ion-card-content>
          <p>{{ negocio.descripcion || 'Sin descripción' }}</p>
          <p>Propietario: {{ negocio.propietario }}</p>
          <p>Correo: {{ negocio.email_propietario }}</p>
          <p *ngIf="negocio.telefono_negocio">Teléfono: {{ negocio.telefono_negocio }}</p>
          <ion-note color="warning" *ngIf="negocio.verificacion_observaciones">
            Correcciones: {{ negocio.verificacion_observaciones }}
          </ion-note>
          <ion-button expand="block" (click)="abrirRevision(negocio)">
            <ion-icon slot="start" name="shield-checkmark-outline"></ion-icon>
            Revisar negocio
          </ion-button>
        </ion-card-content>
      </ion-card>

      <ion-card *ngIf="!cargando() && !error() && pendientes().length === 0">
        <ion-card-content class="ion-text-center">No hay negocios pendientes de verificación.</ion-card-content>
      </ion-card>

      <ion-modal [isOpen]="modalAbierto()" (didDismiss)="cerrarRevision()">
        <ng-template>
          <ion-header>
            <ion-toolbar color="primary">
              <ion-title>Evaluación del negocio</ion-title>
              <ion-buttons slot="end">
                <ion-button (click)="cerrarRevision()" aria-label="Cerrar revisión">
                  <ion-icon name="close-outline"></ion-icon>
                </ion-button>
              </ion-buttons>
            </ion-toolbar>
          </ion-header>
          <ion-content class="ion-padding" *ngIf="detalle() as info">
            <ion-card>
              <ion-card-header>
                <ion-card-title>{{ info.negocio.nombre_negocio }}</ion-card-title>
                <ion-card-subtitle>{{ info.negocio.categoria_nombre || 'Sin categoría' }}</ion-card-subtitle>
              </ion-card-header>
              <ion-card-content>
                <p><strong>Propietario:</strong> {{ info.negocio.propietario }}</p>
                <p><strong>Correo:</strong> {{ info.negocio.email_propietario }}</p>
                <p><strong>Teléfono:</strong> {{ info.negocio.telefono_propietario || info.negocio.telefono_negocio || 'No registrado' }}</p>
                <p><strong>Descripción:</strong> {{ info.negocio.descripcion || 'No registrada' }}</p>
                <p><strong>Ubicación:</strong> {{ info.negocio.direccion || 'No registrada' }}</p>
                <p *ngIf="info.negocio.latitud && info.negocio.longitud">
                  Coordenadas: {{ info.negocio.latitud }}, {{ info.negocio.longitud }}
                </p>
                <img *ngIf="info.negocio.logo_url" [src]="info.negocio.logo_url"
                     [alt]="'Fotografía de ' + info.negocio.nombre_negocio" />
              </ion-card-content>
            </ion-card>

            <h2>Lista de verificación</h2>
            <ion-card *ngFor="let requisito of requisitos()">
              <ion-card-content>
                <strong>{{ requisito.nombre }}</strong>
                <ion-badge color="medium" *ngIf="requisito.obligatorio">Obligatorio</ion-badge>
                <ion-select label="Resultado" labelPlacement="stacked" [(ngModel)]="requisito.resultado">
                  <ion-select-option value="cumple">Cumple</ion-select-option>
                  <ion-select-option value="no_cumple">No cumple</ion-select-option>
                  <ion-select-option value="no_verificable">No verificable</ion-select-option>
                </ion-select>
                <ion-textarea label="Observaciones" labelPlacement="stacked"
                              [(ngModel)]="requisito.observacion" rows="2"></ion-textarea>
              </ion-card-content>
            </ion-card>

            <ion-item>
              <ion-textarea label="Observaciones generales" labelPlacement="stacked"
                            [(ngModel)]="observaciones" rows="3"></ion-textarea>
            </ion-item>

            <ion-card *ngIf="info.historial.length">
              <ion-card-header><ion-card-title>Historial de revisiones</ion-card-title></ion-card-header>
              <ion-card-content>
                <ion-item *ngFor="let revision of info.historial">
                  <ion-label class="ion-text-wrap">
                    <strong>{{ etiquetaEstado(revision.decision) }}</strong>
                    <p>{{ revision.administrador }} · {{ revision.fecha_creacion | date:'medium' }}</p>
                    <p>{{ revision.observaciones || 'Sin observaciones generales' }}</p>
                  </ion-label>
                </ion-item>
              </ion-card-content>
            </ion-card>
          </ion-content>
          <ion-footer class="ion-padding" *ngIf="detalle()">
            <ion-button expand="block" fill="outline" color="warning"
                        [disabled]="guardando()" (click)="guardarDecision('requiere_correcciones')">
              Solicitar correcciones
            </ion-button>
            <ion-button expand="block" color="danger"
                        [disabled]="guardando()" (click)="guardarDecision('rechazado')">
              Rechazar negocio
            </ion-button>
            <ion-button expand="block" color="success"
                        [disabled]="guardando() || !puedeVerificar()" (click)="guardarDecision('verificado')">
              Verificar negocio
            </ion-button>
          </ion-footer>
        </ng-template>
      </ion-modal>
    </ion-content>
  `
})
export class AdminPage implements OnInit {
  private negociosService = inject(NegociosService);
  private toast = inject(ToastController);

  pendientes = signal<NegocioPendiente[]>([]);
  detalle = signal<DetalleVerificacion | null>(null);
  requisitos = signal<RequisitoVerificacion[]>([]);
  cargando = signal(true);
  guardando = signal(false);
  modalAbierto = signal(false);
  error = signal('');
  private negocioSeleccionado: number | null = null;
  observaciones = '';

  ngOnInit() {
    this.cargarPendientes();
  }

  etiquetaEstado(estado?: string | null) {
    return ({
      pendiente: 'Pendiente',
      en_revision: 'En revisión',
      requiere_correcciones: 'Requiere correcciones',
      verificado: 'Verificado',
      rechazado: 'Rechazado'
    } as Record<string, string>)[estado || ''] || 'Pendiente';
  }

  abrirRevision(negocio: NegocioPendiente) {
    this.negocioSeleccionado = negocio.id;
    this.observaciones = '';
    this.negociosService.detalleVerificacion(negocio.id).subscribe({
      next: (detalle) => {
        this.detalle.set(detalle);
        this.requisitos.set(detalle.requisitos.map((item) => ({ ...item, resultado: undefined, observacion: '' })));
        this.modalAbierto.set(true);
      },
      error: (error) => this.error.set(error?.error?.mensaje || 'No fue posible cargar la evaluación.')
    });
  }

  cerrarRevision() {
    this.modalAbierto.set(false);
    this.detalle.set(null);
    this.requisitos.set([]);
    this.negocioSeleccionado = null;
  }

  puedeVerificar() {
    return this.requisitos().every((item) => item.resultado === 'cumple');
  }

  async guardarDecision(decision: DecisionVerificacion) {
    if (!this.negocioSeleccionado) return;
    if (decision === 'verificado' && !this.puedeVerificar()) {
      this.error.set('Todos los requisitos deben estar en “Cumple” para verificar.');
      return;
    }
    this.guardando.set(true);
    this.error.set('');
    this.negociosService.revisarVerificacion(
      this.negocioSeleccionado,
      decision,
      this.requisitos().map((item) => ({
        requisito_id: item.id,
        resultado: item.resultado as ResultadoVerificacion,
        observacion: item.observacion
      })),
      this.observaciones
    ).subscribe({
      next: async (respuesta) => {
        this.guardando.set(false);
        this.cerrarRevision();
        this.cargarPendientes();
        const aviso = await this.toast.create({ message: respuesta.mensaje, duration: 2500, color: 'success' });
        await aviso.present();
      },
      error: (error) => {
        this.guardando.set(false);
        this.error.set(error?.error?.mensaje || 'No fue posible guardar la revisión.');
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
