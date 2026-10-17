import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { IonicModule, ToastController } from '@ionic/angular';
import * as L from 'leaflet';
import { Categoria, EstadoPedido, Negocio, Pedido, Resena } from '../../core/models';
import { NegociosService } from '../../core/services/negocios.service';
import { PedidosService } from '../../core/services/pedidos.service';
import { ResenasService } from '../../core/services/resenas.service';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-mi-negocio',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, IonicModule],
  templateUrl: './mi-negocio.page.html',
  styleUrl: './mi-negocio.page.scss'
})
export class MiNegocioPage implements OnInit, AfterViewInit, OnDestroy {
  private fb = inject(FormBuilder);
  private negociosService = inject(NegociosService);
  private toast = inject(ToastController);
  private pedidosService = inject(PedidosService);
  private router = inject(Router);
  private resenasService = inject(ResenasService);
  private http = inject(HttpClient);
  @ViewChild('ubicacionMapa') private ubicacionMapa?: ElementRef<HTMLDivElement>;
  private mapaUbicacion: L.Map | null = null;
  private marcadorUbicacion: L.Marker | null = null;

  categorias = signal<Categoria[]>([]);
  negociosDisponibles = signal<Negocio[]>([]);
  negocio = signal<Negocio | null>(null);
  resenas = signal<Resena[]>([]);
  pedidos = signal<Pedido[]>([]);
  vistaPedidos = signal<'activos' | 'historial'>('activos');
  errorCargaPedidos = signal('');
  pedidosActivos = computed(() => this.pedidos().filter(
    (pedido) => pedido.estado !== 'cancelado' && pedido.estado !== 'entregado'
  ));
  pedidosHistorial = computed(() => this.pedidos().filter(
    (pedido) => pedido.estado === 'cancelado' || pedido.estado === 'entregado'
  ));
  pedidosVisibles = computed(() => this.vistaPedidos() === 'activos'
    ? this.pedidosActivos()
    : this.pedidosHistorial());
  guardando = signal(false);
  cargandoNegocio = signal(true);
  errorCargaNegocio = signal('');
  private temporizador?: ReturnType<typeof setInterval>;

  formulario = this.fb.nonNullable.group({
    nombre_negocio: ['', [Validators.required, Validators.minLength(3)]],
    categoria_id: [null as number | null],
    descripcion: [''],
    direccion: [''],
    telefono_negocio: [''],
    email_negocio: [''],
    horario_atencion: [''],
    logo_url: [''],
    latitud: [null as number | null],
    longitud: [null as number | null],
    formalizado: [false]
  });

  ngOnInit() {
    this.negociosService.categorias().subscribe({
      next: (lista) => this.categorias.set(lista),
      error: (error) => this.mostrarErrorCarga(error, 'No fue posible cargar las categorías')
    });
    this.negociosService.misNegocios().subscribe((lista) => {
      this.cargandoNegocio.set(false);
      this.errorCargaNegocio.set('');
      this.negociosDisponibles.set(lista);
      if (lista.length) {
        this.seleccionarNegocio(lista[0].id);
      }
    }, (error) => {
      this.cargandoNegocio.set(false);
      this.errorCargaNegocio.set(error?.error?.mensaje || 'No fue posible cargar tu empresa. Verifica tu conexión e inicia sesión nuevamente.');
    });
    this.temporizador = setInterval(() => this.actualizarResenas(), 30000);
  }

  ngAfterViewInit() {
    setTimeout(() => this.inicializarMapaUbicacion(), 0);
  }

  ionViewDidEnter() {
    setTimeout(() => {
      this.mapaUbicacion?.invalidateSize();
      this.actualizarMarcadorUbicacion(true);
    }, 100);
  }

  ngOnDestroy() {
    if (this.temporizador) clearInterval(this.temporizador);
    this.mapaUbicacion?.remove();
  }

  seleccionarNegocio(negocioId: number) {
    const seleccionado = this.negociosDisponibles().find((negocio) => negocio.id === negocioId);
    if (!seleccionado) return;

    this.negocio.set(seleccionado);
    this.formulario.patchValue(seleccionado as never);
    this.actualizarMarcadorUbicacion(true);
    this.resenas.set([]);
    this.pedidos.set([]);
    this.cargarResenas(seleccionado.id);
    this.cargarPedidos(seleccionado.id);
  }

  private actualizarResenas() {
    const negocioActual = this.negocio();
    if (negocioActual) {
      this.cargarResenas(negocioActual.id);
      this.cargarPedidos(negocioActual.id);
    }
  }

  private cargarResenas(negocioId: number) {
    this.resenasService.listarPorNegocio(negocioId).subscribe({
      next: (lista) => this.resenas.set(lista),
      error: (error) => this.mostrarErrorCarga(error, 'No fue posible cargar las reseñas')
    });
  }

  private async mostrarErrorCarga(error: { error?: { mensaje?: string } }, mensaje: string) {
    const aviso = await this.toast.create({
      message: error?.error?.mensaje || mensaje,
      duration: 2500,
      color: 'danger'
    });
    await aviso.present();
  }

  cargarPedidos(negocioId = this.negocio()?.id) {
    if (!negocioId) return;
    this.pedidosService.listar(negocioId).subscribe({
      next: (lista) => {
        this.pedidos.set(lista);
        this.errorCargaPedidos.set('');
      },
      error: (error) => this.errorCargaPedidos.set(
        error?.error?.mensaje || 'No fue posible cargar los pedidos. Verifica tu conexión e inténtalo de nuevo.'
      )
    });
  }

  estadosSiguientes(estado: EstadoPedido): EstadoPedido[] {
    const transiciones: Record<EstadoPedido, EstadoPedido[]> = {
      pendiente: ['confirmado', 'cancelado'],
      confirmado: ['preparando', 'cancelado'],
      preparando: ['listo', 'cancelado'],
      listo: ['entregado'],
      entregado: [],
      cancelado: []
    };
    return transiciones[estado];
  }

  etiquetaEstadoPedido(estado: EstadoPedido): string {
    const etiquetas: Record<EstadoPedido, string> = {
      pendiente: 'Pendiente',
      confirmado: 'Confirmado',
      preparando: 'En preparación',
      listo: 'Listo',
      entregado: 'Entregado',
      cancelado: 'Cancelado'
    };
    return etiquetas[estado];
  }

  etiquetaMetodoPago(metodo: Pedido['metodo_pago']): string {
    const etiquetas: Record<Pedido['metodo_pago'], string> = {
      efectivo: 'Efectivo',
      transferencia: 'Transferencia',
      tarjeta: 'Tarjeta',
      otro: 'Otro'
    };
    return etiquetas[metodo];
  }

  cambiarVistaPedidos(vista: string | number | null | undefined) {
    this.vistaPedidos.set(vista === 'historial' ? 'historial' : 'activos');
  }

  async cambiarEstadoPedido(pedido: Pedido, estado: EstadoPedido) {
    if (estado === pedido.estado) return;
    this.pedidosService.cambiarEstado(pedido.id, estado).subscribe({
      next: async () => {
        this.cargarPedidos(pedido.negocio_id);
        const aviso = await this.toast.create({
          message: `Pedido actualizado: ${this.etiquetaEstadoPedido(estado)}`,
          duration: 1800,
          color: 'success'
        });
        await aviso.present();
      },
      error: async (error) => {
        const aviso = await this.toast.create({
          message: error?.error?.mensaje || 'No fue posible actualizar el pedido',
          duration: 2500,
          color: 'danger'
        });
        await aviso.present();
      }
    });
  }

  async seleccionarLogo(evento: Event) {
    const input = evento.target as HTMLInputElement;
    const archivo = input.files?.[0];
    if (!archivo) return;

    try {
      const datos = new FormData();
      datos.append('file', archivo, archivo.name);
      const carga = await this.http.post<{ url: string }>(`${environment.apiUrl}/upload`, datos).toPromise();
      if (!carga?.url) throw new Error('No se recibió la URL del logo');
      this.formulario.patchValue({ logo_url: carga.url });
    } catch {
      const aviso = await this.toast.create({
        message: 'No fue posible subir el logo. Verifica la conexión con el servidor.',
        duration: 2500,
        color: 'danger'
      });
      await aviso.present();
    } finally {
      input.value = '';
    }
  }

  private inicializarMapaUbicacion() {
    const elemento = this.ubicacionMapa?.nativeElement;
    if (!elemento || this.mapaUbicacion) return;

    const coordenadas = this.obtenerCoordenadasFormulario();
    const centro: [number, number] = coordenadas ?? [2.9273, -75.2819];
    this.mapaUbicacion = L.map(elemento).setView(centro, coordenadas ? 16 : 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(this.mapaUbicacion);
    this.mapaUbicacion.on('click', (evento: L.LeafletMouseEvent) => {
      this.establecerUbicacion(evento.latlng.lat, evento.latlng.lng, false);
    });
    this.actualizarMarcadorUbicacion();
    setTimeout(() => this.mapaUbicacion?.invalidateSize(), 100);
  }

  private establecerUbicacion(latitud: number, longitud: number, centrar: boolean) {
    this.formulario.patchValue({ latitud, longitud });
    this.actualizarMarcadorUbicacion(centrar);
  }

  private obtenerCoordenadasFormulario(): [number, number] | null {
    const { latitud, longitud } = this.formulario.getRawValue();
    if (latitud === null || longitud === null) return null;

    const lat = Number(latitud);
    const lng = Number(longitud);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)
      || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return null;
    }

    return [lat, lng];
  }

  private actualizarMarcadorUbicacion(centrar = false) {
    const coordenadas = this.obtenerCoordenadasFormulario();
    if (!this.mapaUbicacion) return;
    if (!coordenadas) {
      this.marcadorUbicacion?.remove();
      this.marcadorUbicacion = null;
      return;
    }

    if (!this.marcadorUbicacion) {
      const icono = L.divIcon({
        className: '',
        html: '<div style="width:26px;height:26px;background:#d84315;border:3px solid #fff;border-radius:50% 50% 50% 0;box-shadow:0 2px 8px rgba(0,0,0,.35);transform:rotate(-45deg)"></div>',
        iconSize: [32, 32],
        iconAnchor: [16, 30]
      });
      this.marcadorUbicacion = L.marker(coordenadas, { icon: icono, draggable: true })
        .addTo(this.mapaUbicacion)
        .bindPopup('Ubicación de tu negocio');
      this.marcadorUbicacion.on('dragend', () => {
        const posicion = this.marcadorUbicacion?.getLatLng();
        if (posicion) {
          this.formulario.patchValue({ latitud: posicion.lat, longitud: posicion.lng });
        }
      });
    } else {
      this.marcadorUbicacion.setLatLng(coordenadas);
    }

    if (centrar) this.mapaUbicacion.setView(coordenadas, 16);
  }

  guardar() {
    if (this.formulario.invalid) {
      this.formulario.markAllAsTouched();
      return;
    }

    this.guardando.set(true);
    const datos = this.formulario.getRawValue();
    const existente = this.negocio();

    const peticion = existente
      ? this.negociosService.actualizar(existente.id, datos as never)
      : this.negociosService.crear(datos as never);

    peticion.subscribe({
      next: async () => {
        this.guardando.set(false);
        const aviso = await this.toast.create({
          message: existente ? 'Perfil actualizado' : 'Negocio registrado',
          duration: 2000,
          color: 'success'
        });
        await aviso.present();
        this.negociosService.misNegocios().subscribe((lista) => {
          if (lista.length) this.negocio.set(lista[0]);
        });
      },
      error: async (error) => {
        this.guardando.set(false);
        const aviso = await this.toast.create({
          message: error?.error?.mensaje || 'No fue posible guardar',
          duration: 2500,
          color: 'danger'
        });
        await aviso.present();
      }
    });
  }

  irACatalogo() {
    this.router.navigate(['/catalogo', this.negocio()!.id]);
  }

  irAFacturacion() {
    this.router.navigate(['/facturacion', this.negocio()!.id]);
  }

  estrellas(calificacion: number): string {
    return '★'.repeat(calificacion) + '☆'.repeat(5 - calificacion);
  }

  imagenUrl(url: string | null | undefined): string {
    if (!url) return '';
    if (url.includes('/uploads/')) {
      return new URL(url, window.location.origin).pathname;
    }
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url.replace(/^https?:\/\/localhost(?::\d+)?/, window.location.origin);
    }
    return `${window.location.origin}${url.startsWith('/') ? url : `/${url}`}`;
  }
}
