import { Component, OnInit, OnDestroy, signal, ViewChild, ElementRef } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { StorageService } from '../../services/storage.service';
import { EvaluacionService } from '../../services/evaluacion.service';
import { CancionService } from '../../services/cancion.service';
import { ESTADO_COMBATE, ESTADO_RONDA } from '../../constants/estados';

declare var webkitSpeechRecognition: any;

import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { CombateService } from '../../services/combate.service';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';
import { supabase } from '../../core/supabase.client';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-combates',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './combates.page.html',
  styleUrl: './combates.page.css'
})
export class CombatesPage implements OnInit, OnDestroy {
  // Constantes de estados disponibles para el template
  ESTADO_COMBATE = ESTADO_COMBATE;
  ESTADO_RONDA = ESTADO_RONDA;

  // === VARIABLES ARENA ===
  intervaloPolling: any;
  rondaActiva = signal<any>(null);
  turnoActual = signal<any>(null); // El turno del usuario activo
  oponenteYaCanto = signal(false); // Para mostrar si el oponente ya termin
  
  canciones = signal<any[]>([]);
  cancionSeleccionada = signal<any>(null);
  videoUrl = signal<SafeResourceUrl | null>(null);

  // === GRABACION ===
  tiempoInicioGrabacion = 0;
  duracionAudio = signal(0);
  mediaRecorder!: MediaRecorder;
  recognition: any;
  private recognitionActiva = false;
  private reconocimientoTerminado: Promise<void> = Promise.resolve();
  private mimeTypeGrabacion = 'audio/webm';
  audioChunks: Blob[] = [];
  grabando = signal(false);
  transcripcionVoz = signal<string>('');
  
  audioContext!: AudioContext;
  analyser!: AnalyserNode;
  sourceNode!: MediaStreamAudioSourceNode;
  datosTiempo!: Float32Array<ArrayBuffer>;
  animationFrameId = 0;
  
  muestrasAnalizadas = 0;
  muestrasConActividad = 0;
  muestrasEnSilencio = 0;
  muestrasSaturadas = 0;
  sumaRms = 0;
  rmsPromedio = signal(0);
  porcentajeSilencio = signal(0);
  porcentajeActividad = signal(0);
  porcentajeClipping = signal(0);

  @ViewChild('visualizadorArena') canvasRef?: ElementRef<HTMLCanvasElement>;

  usuario = signal<any>(null);
  cargando = signal(true);

  // Vistas
  vistaActual = signal<'lista' | 'buscando' | 'arena' | 'mi_resultado_turno' | 'resultado_ronda' | 'victoria_final'>('lista');

  // Resultado personal del turno que acabo de cantar
  miResultadoTurno = signal<{ puntaje: number; feedback: string } | null>(null);

  // Timeout de inactividad del oponente
  private tiempoFinMiTurno: number | null = null;   // timestamp cuando terminé de cantar
  minutosEsperando = signal(0);                      // minutos transcurridos esperando
  mostrarReclamarVictoria = signal(false);           // después de 10 min sin respuesta
  readonly MINUTOS_TIMEOUT = 10;

  misCombates = signal<any[]>([]);
  combateActivo = signal<any>(null);
  
  // Para las transiciones visuales
  rondasVistas = new Set<string>(); // IDs de rondas cuyo resultado ya se mostró
  rondaResultadoActiva = signal<any>(null); // La ronda de la que estamos mostrando resultados
  cuentaRegresiva = signal<number | null>(null);

  // Invitaciones que YO RECIBÍ (soy jugador2, estado PENDIENTE)
  invitacionesPendientes = signal<any[]>([]);

  // Invitaciones que YO ENVIÉ (soy jugador1, estado PENDIENTE)
  invitacionesEnviadas = signal<any[]>([]);

  // Indicador de invitaciones nuevas (para el badge visual)
  hayInvitacionNueva = signal(false);

  // Polling de la pantalla lista (para detectar invitaciones sin recargar)
  intervaloPollingLista: any;

  // Polling para la pantalla "Buscando rival"
  intervaloPollingBusqueda: any;

  // Autocompletado: término de búsqueda, resultados, seleccionado
  busquedaInvitado = '';
  resultadosBusqueda = signal<any[]>([]);
  mostrarDropdown = signal(false);
  usuarioSeleccionado = signal<any>(null);

  private busquedaSubject = new Subject<string>();

  constructor(
    private combateService: CombateService,
    private authService: AuthService,
    private toastService: ToastService,
    private router: Router,
    private sanitizer: DomSanitizer,
    private storageService: StorageService,
    private evaluacionService: EvaluacionService,
    private cancionService: CancionService
  ) {}

  
  ngOnDestroy() {
    if (this.intervaloPolling) clearInterval(this.intervaloPolling);
    if (this.intervaloPollingBusqueda) clearInterval(this.intervaloPollingBusqueda);
    if (this.intervaloPollingLista) clearInterval(this.intervaloPollingLista);
    this.detenerReconocimiento();
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
  }

  async ngOnInit() {
    try {
      const authUser = await this.authService.obtenerUsuarioActual();
      if (!authUser) {
        this.router.navigate(['/login']);
        return;
      }

      const { data: dbUser } = await supabase
        .from('tbl_usuario')
        .select('*')
        .eq('auth_uid', authUser.id)
        .single();

      this.usuario.set(dbUser);

      // Configurar debounce para la búsqueda de usuarios
      this.busquedaSubject.pipe(
        debounceTime(300),
        distinctUntilChanged()
      ).subscribe(query => this.ejecutarBusquedaUsuarios(query));

      await this.cargarMisCombates();
      this.iniciarPollingLista();
    } catch (err) {
      console.error(err);
      this.toastService.error('Error al cargar el perfil. Intenta de nuevo.');
    } finally {
      this.cargando.set(false);
    }
  }

  // Polling silencioso cada 6s en la vista lista para detectar invitaciones nuevas
  private iniciarPollingLista() {
    if (this.intervaloPollingLista) clearInterval(this.intervaloPollingLista);
    this.intervaloPollingLista = setInterval(async () => {
      if (this.vistaActual() !== 'lista') return; // Solo activo en la lista
      const prevCount = this.invitacionesPendientes().length;
      await this.cargarMisCombates();
      const newCount = this.invitacionesPendientes().length;
      // Si llegaron invitaciones nuevas, activar badge y toast
      if (newCount > prevCount) {
        this.hayInvitacionNueva.set(true);
        this.toastService.info(`🔔 ¡Tienes ${newCount - prevCount} nueva(s) invitación(es) de combate!`);
      }
    }, 6000);
  }

  async cargarMisCombates() {
    if (!this.usuario()) return;
    try {
      const res = await this.combateService.obtenerMisCombates(this.usuario().id);
      if (res.ok) {
        const todos = res.data ?? [];
        const miId = this.usuario().id;

        // 1. Invitaciones que YO RECIBÍ (soy jugador2, esperando mi respuesta)
        const recibidas = todos.filter(
          (c: any) => c.id_estado === ESTADO_COMBATE.PENDIENTE && c.id_usuario_jugador2 == miId
        );
        this.invitacionesPendientes.set(recibidas);

        // 2. Invitaciones que YO ENVIÉ (soy jugador1, esperando respuesta del otro)
        const enviadas = todos.filter(
          (c: any) => c.id_estado === ESTADO_COMBATE.PENDIENTE && c.id_usuario_jugador1 == miId
        );
        this.invitacionesEnviadas.set(enviadas);

        // 3. El resto: combates en curso, finalizados, matchmaking
        const resto = todos.filter(
          (c: any) => c.id_estado !== ESTADO_COMBATE.PENDIENTE
        );
        this.misCombates.set(resto);
      } else {
        this.toastService.error('No se pudieron cargar tus combates.');
      }
    } catch (err) {
      console.error('Error cargando combates', err);
    }
  }

  async cancelarBusqueda() {
    const combate = this.combateActivo();
    if (!combate) {
      this.vistaActual.set('lista');
      return;
    }
    this.cargando.set(true);
    try {
      await this.combateService.cancelarBusqueda(combate.id);
    } catch (err) {
      console.error('Error al cancelar búsqueda', err);
    } finally {
      if (this.intervaloPollingBusqueda) clearInterval(this.intervaloPollingBusqueda);
      this.combateActivo.set(null);
      this.cargando.set(false);
      this.vistaActual.set('lista');
    }
  }

  async buscarOponenteAutomatico() {
    this.cargando.set(true);
    try {
      // Si el usuario no tiene nivel asignado aún (null), se envía null para que
      // el backend lo trate como nivel 1 (Principiante), igual que los demás sin nivel
      const nivel = this.usuario()?.id_nivel ?? null;
      
      const res = await this.combateService.buscarOponente(this.usuario().id, nivel);
      if (res.ok) {
        if (res.data.status === 'match_found') {
          // Emparejó al instante: entrar directamente a la Arena
          await this.entrarArena(res.data.combate.id);
          this.toastService.success('¡Oponente encontrado! ¡Que comience la batalla!');
        } else {
          // Quedó en espera: mostrar pantalla buscando y hacer polling cada 4s
          this.combateActivo.set(res.data.combate);
          this.vistaActual.set('buscando');
          this.toastService.info('Buscando rival de tu nivel... espera un momento.');

          // Polling: revisar si alguien aceptó el matchmaking
          if (this.intervaloPollingBusqueda) clearInterval(this.intervaloPollingBusqueda);
          this.intervaloPollingBusqueda = setInterval(async () => {
            const detRes = await this.combateService.obtenerDetalleCombate(this.combateActivo().id);
            // Un rival se unió cuando jugador2 deja de ser null
            // (ambos estados "esperando" y "en curso" usan el mismo id_estado,
            // así que comparar el estado no sirve — hay que mirar si jugador2 ya existe)
            if (detRes.ok && detRes.data?.id_usuario_jugador2 != null) {
              clearInterval(this.intervaloPollingBusqueda);
              this.toastService.success('¡Se encontró un rival! Entrando a la arena...');
              await this.entrarArena(detRes.data.id);
            }
          }, 4000);
        }
      } else {
        this.toastService.error('No fue posible encontrar un rival con un nivel similar. Intenta invitar a un amigo.');
      }
    } catch (err) {
      console.error(err);
      this.toastService.error('No se pudo conectar con el servidor para buscar oponente.');
    } finally {
      this.cargando.set(false);
    }
  }

  // --- Autocompletado ---
  onBusquedaInput(event: Event) {
    const valor = (event.target as HTMLInputElement).value;
    this.busquedaInvitado = valor;
    this.usuarioSeleccionado.set(null); // limpiar selección previa
    if (valor.length >= 2) {
      this.busquedaSubject.next(valor);
    } else {
      this.resultadosBusqueda.set([]);
      this.mostrarDropdown.set(false);
    }
  }

  private async ejecutarBusquedaUsuarios(query: string) {
    try {
      const res = await this.combateService.buscarUsuarios(query, this.usuario().id);
      if (res.ok && res.data?.length > 0) {
        this.resultadosBusqueda.set(res.data);
        this.mostrarDropdown.set(true);
      } else {
        this.resultadosBusqueda.set([]);
        this.mostrarDropdown.set(false);
      }
    } catch {
      this.resultadosBusqueda.set([]);
    }
  }

  seleccionarUsuario(user: any) {
    this.usuarioSeleccionado.set(user);
    this.busquedaInvitado = `${user.nombre} ${user.apellido}`;
    this.mostrarDropdown.set(false);
    this.resultadosBusqueda.set([]);
  }

  cerrarDropdown() {
    // pequeño delay para que el click en una opción alcance a procesarse
    setTimeout(() => this.mostrarDropdown.set(false), 150);
  }

  async invitarJugador() {
    if (!this.usuarioSeleccionado()) {
      this.toastService.warning('Selecciona un jugador de la lista antes de invitar.');
      return;
    }

    this.cargando.set(true);
    try {
      const res = await this.combateService.invitarUsuario(
        this.usuario().id,
        this.usuarioSeleccionado().id
      );
      if (res.ok) {
        this.toastService.success(`¡Invitación enviada a ${this.usuarioSeleccionado().nombre}!`);
        this.busquedaInvitado = '';
        this.usuarioSeleccionado.set(null);
        await this.cargarMisCombates();
      } else {
        this.toastService.error('No se pudo enviar la invitación. Intenta de nuevo.');
      }
    } catch (err) {
      console.error(err);
      this.toastService.error('Error de conexión al enviar la invitación.');
    } finally {
      this.cargando.set(false);
    }
  }

  verInvitaciones() {
    this.hayInvitacionNueva.set(false); // Limpiar el badge al ver las invitaciones
  }

  async aceptarInvitacion(idCombate: string) {
    this.cargando.set(true);
    try {
      const res = await this.combateService.aceptarCombate(idCombate);
      if (res.ok) {
        this.toastService.success('¡Combate aceptado! Entrando a la arena...');
        // Entrar directamente a la arena sin paso intermedio
        await this.entrarArena(idCombate);
      } else {
        this.toastService.error('No se pudo aceptar el combate. Intenta de nuevo.');
      }
    } catch (err) {
      console.error(err);
      this.toastService.error('Error al aceptar el combate.');
    } finally {
      this.cargando.set(false);
    }
  }

  async cancelarInvitacion(idCombate: string) {
    this.cargando.set(true);
    try {
      // Reutilizamos el mismo endpoint de rechazar — elimina el registro PENDIENTE
      const res = await this.combateService.rechazarCombate(idCombate);
      if (res.ok) {
        this.toastService.info('Invitación cancelada.');
        await this.cargarMisCombates();
      } else {
        this.toastService.error('No se pudo cancelar la invitación.');
      }
    } catch (err) {
      console.error(err);
      this.toastService.error('Error al cancelar la invitación.');
    } finally {
      this.cargando.set(false);
    }
  }

  async rechazarInvitacion(idCombate: string) {
    this.cargando.set(true);
    try {
      const res = await this.combateService.rechazarCombate(idCombate);
      if (res.ok) {
        this.toastService.info('Invitación rechazada.');
        await this.cargarMisCombates();
      } else {
        this.toastService.error('No se pudo rechazar la invitación.');
      }
    } catch (err) {
      console.error(err);
      this.toastService.error('Error al rechazar la invitación.');
    } finally {
      this.cargando.set(false);
    }
  }

  async entrarArena(idCombate: string) {
    this.cargando.set(true);
    
    // Limpiar completamente el estado anterior
    this.rondaResultadoActiva.set(null);
    this.rondasVistas.clear();
    this.rondaActiva.set(null);
    this.videoUrl.set(null);
    this.turnoActual.set(null);
    this.grabando.set(false);
    this.miResultadoTurno.set(null);
    this.tiempoFinMiTurno = null;
    this.minutosEsperando.set(0);
    this.mostrarReclamarVictoria.set(false);
    
    try {
      const res = await this.combateService.obtenerDetalleCombate(idCombate);
      if (res.ok) {
        this.combateActivo.set(res.data);
        this.vistaActual.set('arena');
        this.evaluarEstadoArena();

        // Cargar catálogo de canciones
        const catalogo = await this.cancionService.obtenerCanciones();
        this.canciones.set(catalogo || []);

        // Iniciar polling cada 5 segundos
        if (this.intervaloPolling) clearInterval(this.intervaloPolling);
        this.intervaloPolling = setInterval(() => this.actualizarArena(), 5000);
      } else {
        this.toastService.error('No se pudo cargar la información del combate.');
      }
    } catch (err) {
      console.error(err);
      this.toastService.error('Error al entrar a la arena.');
    } finally {
      this.cargando.set(false);
    }
  }

  async actualizarArena() {
    if (!this.combateActivo()) return;
    try {
      const res = await this.combateService.obtenerDetalleCombate(this.combateActivo().id);
      if (res.ok) {
        this.combateActivo.set(res.data);
        this.evaluarEstadoArena();
        this.verificarTimeoutOponente();
      }
    } catch (e) {
      console.error('Error en polling', e);
    }
  }

  private verificarTimeoutOponente() {
    // Solo aplica cuando yo ya canté y el oponente no ha respondido
    if (!this.tiempoFinMiTurno) return;
    if (this.oponenteYaCanto()) {
      // El oponente ya cantó — limpiar el contador
      this.tiempoFinMiTurno = null;
      this.minutosEsperando.set(0);
      this.mostrarReclamarVictoria.set(false);
      return;
    }

    const minutos = Math.floor((Date.now() - this.tiempoFinMiTurno) / 60000);
    this.minutosEsperando.set(minutos);

    if (minutos >= this.MINUTOS_TIMEOUT) {
      this.mostrarReclamarVictoria.set(true);
    }
  }

  evaluarEstadoArena() {
    const combate = this.combateActivo();
    if (!combate) return;

    const rondas = combate.rondas || [];

    // Rondas cerradas que aún no le mostramos al usuario
    // CRÍTICO: usar ESTADO_RONDA.CERRADA (14), no el número 2 (código viejo)
    const rondasCerradas = rondas.filter((r: any) => r.id_estado === ESTADO_RONDA.CERRADA);
    const rondasPendientesDeVer = rondasCerradas.filter(
      (r: any) => !this.rondasVistas.has(r.id.toString())
    );

    // Si estamos en 'mi_resultado_turno', solo avanzamos si la ronda cerró o el combate terminó
    if (this.vistaActual() === 'mi_resultado_turno') {
      // Combate terminado por abandono o fin normal → ir a victoria final
      if (combate.id_estado === ESTADO_COMBATE.FINALIZADO) {
        if (this.intervaloPolling) clearInterval(this.intervaloPolling);
        this.vistaActual.set('victoria_final');
        return;
      }
      // Ronda cerrada (ambos cantaron) → mostrar resultado de ronda
      if (rondasPendientesDeVer.length > 0) {
        this.rondaResultadoActiva.set(rondasPendientesDeVer[0]);
        this.vistaActual.set('resultado_ronda');
      }
      return; // No saltar a 'arena' mientras el usuario ve su resultado personal
    }

    // Mostrar resultado de ronda que aún no se vio (antes de chequear fin de combate)
    if (rondasPendientesDeVer.length > 0) {
      this.rondaResultadoActiva.set(rondasPendientesDeVer[0]);
      this.vistaActual.set('resultado_ronda');
      return;
    }

    // Si todas las rondas se mostraron y el combate terminó → victoria final
    if (combate.id_estado === ESTADO_COMBATE.FINALIZADO) {
      if (this.intervaloPolling) clearInterval(this.intervaloPolling);
      this.vistaActual.set('victoria_final');
      return;
    }

    // Si llegamos aquí, mostramos la arena normal
    this.vistaActual.set('arena');

    // Buscar SOLO rondas en estado pendiente
    // Si no hay ninguna, rondaActiva es null → el HTML mostrará
    // el selector de canción para la siguiente ronda o «esperando».
    const rondaActual = rondas.find((r: any) => r.id_estado === ESTADO_RONDA.PENDIENTE) ?? null;

    this.rondaActiva.set(rondaActual);

    // Configurar video SOLO si la ronda activa tiene canción asignada
    if (rondaActual?.cancion?.url_audio) {
      // Cargamos el video SIN autoplay: el usuario lo verá en pausa hasta que pulse "Iniciar mi turno"
      const urlEmbed = this.convertirYoutubeAEmbed(rondaActual.cancion.url_audio, false);
      if (urlEmbed && !this.videoUrl()) {
        // Solo setear si no hay una URL ya cargada (evita reiniciar el iframe)
        this.videoUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(urlEmbed));
      }
      this.cancionSeleccionada.set(rondaActual.cancion);
    } else {
      this.cancionSeleccionada.set(null);
      this.videoUrl.set(null);
    }

    // Verificar si el usuario ya tiene turno en la ronda activa
    if (rondaActual) {
      const turnos = rondaActual.turnos || [];
      const miTurno = turnos.find((t: any) => t.id_usuario == this.usuario().id);
      this.turnoActual.set(miTurno || null);

      const turnoOponente = turnos.find((t: any) => t.id_usuario != this.usuario().id);
      this.oponenteYaCanto.set(!!turnoOponente);
    } else {
      this.turnoActual.set(null);
      this.oponenteYaCanto.set(false);
    }
  }

  async avanzarSiguienteRonda() {
    const rondaRes = this.rondaResultadoActiva();
    if (rondaRes) {
      this.rondasVistas.add(rondaRes.id.toString());
    }

    const rondasAntes = this.combateActivo()?.rondas?.length ?? 0;

    this.rondaResultadoActiva.set(null);
    this.rondaActiva.set(null);
    this.videoUrl.set(null);
    this.turnoActual.set(null);
    this.oponenteYaCanto.set(false);
    this.miResultadoTurno.set(null);
    this.tiempoFinMiTurno = null;
    this.minutosEsperando.set(0);
    this.mostrarReclamarVictoria.set(false);

    await this.actualizarArena();

    // Si después de actualizar aparece una ronda 3, notificar que hay desempate
    const rondasDespues = this.combateActivo()?.rondas?.length ?? 0;
    if (rondasDespues > rondasAntes && rondasDespues === 3) {
      this.toastService.info('¡Empate! 🤝 El sistema eligió una canción sorpresa para la ronda de desempate 🎲');
    }
  }

  convertirYoutubeAEmbed(url: string, autoplay = false): string | null {
    if (!url) return null;
    const params = autoplay ? '?autoplay=1&rel=0' : '?autoplay=0&rel=0';
    if (url.includes('youtube.com/embed/')) {
      return url.split('?')[0] + params;
    }
    if (url.includes('youtu.be/')) {
      const id = url.split('youtu.be/')[1]?.split('?')[0];
      return id ? `https://www.youtube.com/embed/${id}${params}` : null;
    }
    if (url.includes('watch?v=')) {
      const id = url.split('watch?v=')[1]?.split('&')[0];
      return id ? `https://www.youtube.com/embed/${id}${params}` : null;
    }
    return null;
  }

  async crearRondaNueva(idCancion: number) {
    if (!this.combateActivo()) return;
    this.cargando.set(true);
    try {
      const numRonda = (this.combateActivo().rondas?.length || 0) + 1;
      const res = await this.combateService.crearRonda(
        this.combateActivo().id,
        numRonda,
        idCancion.toString(),
        this.usuario().id.toString()
      );
      if (res.ok) {
        this.toastService.success('¡Ronda iniciada! Prepara tu voz.');
        await this.actualizarArena();
      } else {
        this.toastService.error('Error al iniciar la ronda.');
      }
    } catch (e) {
      console.error(e);
      this.toastService.error('Error al iniciar la ronda.');
    } finally {
      this.cargando.set(false);
    }
  }

  // === PIPELINE DE AUDIO ===

  iniciarReconocimiento() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      console.warn('SpeechRecognition no disponible en este navegador.');
      return;
    }

    const letraActual = this.cancionSeleccionada()?.letra?.toLowerCase() || '';
    const palabrasIngles = [' the ', ' you ', ' and ', ' to ', ' i '];
    const esIngles = palabrasIngles.some(p => letraActual.includes(p));

    const rec = new SR();
    rec.lang = esIngles ? 'en-US' : 'es-ES';
    rec.continuous = true;
    rec.interimResults = false;

    rec.onresult = (event: any) => {
      let texto = this.transcripcionVoz();
      for (let i = event.resultIndex; i < event.results.length; i++) {
        texto += ' ' + event.results[i][0].transcript;
      }
      this.transcripcionVoz.set(texto.trim());
    };

    rec.onerror = (event: any) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      if (event.error === 'audio-capture') {
        console.error('SpeechRecognition: micrófono en uso por otra API. Transcripción no disponible.');
        return;
      }
      console.warn('Error en reconocimiento de voz:', event.error);
    };

    rec.onend = () => {
      if (this.recognitionActiva && !this.esMobile()) {
        try { rec.start(); } catch { /* ya iniciando */ }
      }
    };

    this.recognitionActiva = true;
    rec.start();
    this.recognition = rec;
  }

  detenerReconocimiento() {
    this.recognitionActiva = false;

    if (!this.recognition) {
      this.reconocimientoTerminado = Promise.resolve();
      return;
    }

    const rec = this.recognition;
    this.recognition = null;

    // Devuelve una Promise que se resuelve cuando recognition.onend dispara,
    // garantizando que el último onresult ya fue procesado antes de leer transcripcionVoz()
    this.reconocimientoTerminado = new Promise<void>((resolve) => {
      rec.onend = () => resolve();
      setTimeout(resolve, 800); // fallback por si onend nunca llega
      try { rec.stop(); } catch { resolve(); }
    });
  }

  analisisActivo = false;

  iniciarAnalisis() {
    // Iniciar cuenta regresiva de 3 segundos
    let contador = 3;
    this.cuentaRegresiva.set(contador);
    const intervalId = setInterval(() => {
      contador--;
      if (contador > 0) {
        this.cuentaRegresiva.set(contador);
      } else {
        clearInterval(intervalId);
        this.cuentaRegresiva.set(null);
        this.comenzarGrabacionReal();
      }
    }, 1000);
  }

  private comenzarGrabacionReal() {
    // Reiniciar métricas
    this.muestrasAnalizadas = 0;
    this.muestrasConActividad = 0;
    this.muestrasEnSilencio = 0;
    this.muestrasSaturadas = 0;
    this.sumaRms = 0;
    this.transcripcionVoz.set('');
    this.audioChunks = [];
    this.reconocimientoTerminado = Promise.resolve();

    const audioConstraints: MediaTrackConstraints | boolean = this.esMobile()
      ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      : { echoCancellation: true, noiseSuppression: true };

    navigator.mediaDevices.getUserMedia({ audio: audioConstraints })
      .then(stream => {
        // Detectar MIME type real soportado
        const candidatos = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
        this.mimeTypeGrabacion = candidatos.find(t => MediaRecorder.isTypeSupported(t)) ?? 'audio/webm';

        if (!this.esMobile()) {
          this.audioContext = new AudioContext();
          this.analyser = this.audioContext.createAnalyser();
          this.analyser.fftSize = 2048;
          this.datosTiempo = new Float32Array(this.analyser.fftSize);
          this.sourceNode = this.audioContext.createMediaStreamSource(stream);
          this.sourceNode.connect(this.analyser);
        }

        this.mediaRecorder = new MediaRecorder(stream, { mimeType: this.mimeTypeGrabacion });
        this.mediaRecorder.ondataavailable = (e: BlobEvent) => {
          if (e.data.size > 0) this.audioChunks.push(e.data);
        };

        // Cuando el MediaRecorder termina, esperar al reconocimiento y luego evaluar
        this.mediaRecorder.onstop = async () => {
          const finalBlob = new Blob(this.audioChunks, { type: this.mimeTypeGrabacion });

          if (this.esMobile()) {
            await this.analizarAudioOffline(finalBlob);
          }

          // Esperar a que recognition.onend haya disparado y entregado resultados finales
          await this.reconocimientoTerminado;

          await this.procesarTurnoArena(finalBlob);
        };

        this.mediaRecorder.start(1000);

        this.grabando.set(true);
        this.tiempoInicioGrabacion = Date.now();

        if (!this.esMobile()) {
          this.analisisActivo = true;
          this.procesarAudio();
        }

        this.iniciarReconocimiento();

        // Recargar el iframe CON autoplay: el video arranca cuando el usuario inicia su turno
        if (this.cancionSeleccionada()?.url_audio) {
          const urlEmbed = this.convertirYoutubeAEmbed(this.cancionSeleccionada().url_audio, true);
          if (urlEmbed) this.videoUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(urlEmbed));
        }
      })
      .catch(err => {
        console.error('Error mic:', err);
        this.toastService.error('Debes permitir acceso al micrófono.');
      });
  }

  procesarAudio() {
    if (!this.analisisActivo) return;
    this.analyser.getFloatTimeDomainData(this.datosTiempo);

    let sumaCuadrados = 0;
    let haySaturacion = false;
    for (let i = 0; i < this.datosTiempo.length; i++) {
      const valor = this.datosTiempo[i];
      sumaCuadrados += valor * valor;
      if (Math.abs(valor) >= 0.99) haySaturacion = true;
    }
    const rms = Math.sqrt(sumaCuadrados / this.datosTiempo.length);

    this.sumaRms += rms;
    this.muestrasAnalizadas++;
    if (haySaturacion) this.muestrasSaturadas++;
    if (rms < 0.01) this.muestrasEnSilencio++;
    else this.muestrasConActividad++;

    this.dibujarOnda(haySaturacion);
    this.animationFrameId = requestAnimationFrame(() => this.procesarAudio());
  }

  dibujarOnda(saturacion: boolean) {
    if (!this.canvasRef) return;
    const canvas = this.canvasRef.nativeElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const width = canvas.width;
    const height = canvas.height;
    ctx.fillStyle = 'rgba(26, 26, 46, 0.25)';
    ctx.fillRect(0, 0, width, height);
    ctx.lineWidth = 3;
    ctx.strokeStyle = saturacion ? '#e94560' : '#00d2ff';
    ctx.beginPath();
    const sliceWidth = width / this.datosTiempo.length;
    let x = 0;
    for (let i = 0; i < this.datosTiempo.length; i++) {
      const v = this.datosTiempo[i] * 5.0;
      const y = (v * height / 2) + height / 2;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      x += sliceWidth;
    }
    ctx.lineTo(width, height / 2);
    ctx.stroke();
  }

  detenerGrabacion() {
    // Detener análisis en tiempo real (escritorio)
    this.analisisActivo = false;
    cancelAnimationFrame(this.animationFrameId);

    // Calcular métricas de escritorio antes de cerrar el contexto
    const duracion = (Date.now() - this.tiempoInicioGrabacion) / 1000;
    this.duracionAudio.set(duracion);

    if (!this.esMobile()) {
      this.rmsPromedio.set(this.muestrasAnalizadas > 0 ? this.sumaRms / this.muestrasAnalizadas : 0);
      this.porcentajeSilencio.set(this.muestrasAnalizadas > 0 ? (this.muestrasEnSilencio / this.muestrasAnalizadas) * 100 : 0);
      this.porcentajeActividad.set(this.muestrasAnalizadas > 0 ? (this.muestrasConActividad / this.muestrasAnalizadas) * 100 : 0);
      this.porcentajeClipping.set(this.muestrasAnalizadas > 0 ? (this.muestrasSaturadas / this.muestrasAnalizadas) * 100 : 0);
    }

    if (this.sourceNode) {
      this.sourceNode.mediaStream.getTracks().forEach((t: MediaStreamTrack) => t.stop());
    }
    if (this.audioContext) this.audioContext.close();

    // Detener reconocimiento — crea reconocimientoTerminado Promise
    this.detenerReconocimiento();

    this.grabando.set(false);

    // Detener grabador: el flujo continúa en mediaRecorder.onstop (definido en comenzarGrabacionReal)
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
  }

  async procesarTurnoArena(blob: Blob) {
    this.cargando.set(true);
    try {
      // 1. Subir audio a Supabase Storage
      const nombreArchivo = `combate_${this.usuario().id}_${Date.now()}.webm`;
      const urlAudio = await this.storageService.subirAudio(blob as File, nombreArchivo);

      // 2. Crear práctica temporal en BD para que el evaluador pueda encontrar la canción
      const apiUrl = environment.apiUrl;
      const resPractica = await fetch(`${apiUrl}/practicas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id_usuario: this.usuario().id,
          id_cancion: this.cancionSeleccionada().id,
          id_estado: 3,
          url_audio_usuario: urlAudio
        })
      });
      const practicaBD = await resPractica.json();

      // 3. Evaluar con IA (mismo pipeline de prácticas)
      const evalRes = await fetch(`${apiUrl}/evaluaciones/practica`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idPractica: practicaBD.data.id,
          transcripcion: this.transcripcionVoz(),
          duracionAudio: this.duracionAudio(),
          rmsPromedio: this.rmsPromedio(),
          porcentajeSilencio: this.porcentajeSilencio(),
          porcentajeActividad: this.porcentajeActividad(),
          porcentajeClipping: this.porcentajeClipping()
        })
      });
      const dataEval = await evalRes.json();
      const resultado = dataEval.data;

      // 4. Registrar el turno en el combate
      const resTurno = await this.combateService.registrarTurno(
        this.rondaActiva().id,
        this.usuario().id,
        resultado.puntaje,
        urlAudio,
        resultado.feedback,
        resultado.transcripcion || this.transcripcionVoz()
      );

      if (resTurno.ok) {
        // Guardar resultado personal y mostrar pantalla de feedback inmediato
        this.miResultadoTurno.set({
          puntaje: resultado.puntaje,
          feedback: resultado.feedback
        });
        this.vistaActual.set('mi_resultado_turno');
        // Iniciar contador de espera del oponente (para timeout)
        this.tiempoFinMiTurno = Date.now();
      }

      // Actualizar arena en background — si el oponente ya cantó, la ronda se cerrará
      // y evaluarEstadoArena transitará a 'resultado_ronda' automáticamente
      await this.actualizarArena();
    } catch (e) {
      console.error('Error procesando turno arena:', e);
      this.toastService.error('Error al procesar tu turno. Intenta de nuevo.');
    } finally {
      this.cargando.set(false);
    }
  }

  getPuntajeJugador(ronda: any, idJugador: any): number | string {
    const turno = ronda?.turnos?.find((t: any) => t.id_usuario == idJugador);
    return turno?.puntaje ?? '—';
  }

  getResultadoRonda(ronda: any): string {
    const miId = this.usuario()?.id;
    if (ronda.id_usuario_ganador == miId) return 'Victoria';
    if (ronda.id_usuario_ganador) return 'Derrota';
    // Sin ganador: verificar si fue empate real o abandono
    const turnos = ronda.turnos ?? [];
    return turnos.length < 2 ? 'Abandono' : 'Empate';
  }

  getFeedbackJugador(ronda: any, idJugador: any): string {
    const turno = ronda?.turnos?.find((t: any) => t.id_usuario == idJugador);
    return turno?.feedback ?? '';
  }

  // Marcador acumulado de rondas cerradas (yo vs oponente)
  getMarcador(): { yo: number; oponente: number } {
    const rondas = this.combateActivo()?.rondas ?? [];
    const miId = this.usuario()?.id;
    let yo = 0, oponente = 0;
    for (const r of rondas) {
      if (r.id_estado !== ESTADO_RONDA.CERRADA) continue;
      if (r.id_usuario_ganador == miId) yo++;
      else if (r.id_usuario_ganador != null) oponente++;
    }
    return { yo, oponente };
  }

  private esMobile(): boolean {
    if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)) {
      return true;
    }
    return navigator.maxTouchPoints > 1 && /Macintosh/i.test(navigator.userAgent);
  }

  private async analizarAudioOffline(blob: Blob): Promise<void> {
    if (blob.size === 0) {
      this.usarMetricasEstimadas();
      return;
    }
    try {
      const arrayBuffer = await blob.arrayBuffer();
      const ctx = new AudioContext();
      let audioBuffer: AudioBuffer;
      try {
        audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      } catch {
        ctx.close();
        this.usarMetricasEstimadas();
        return;
      }
      ctx.close();

      const datos = audioBuffer.getChannelData(0);
      const n = datos.length;
      const tamanoVentana = Math.floor(audioBuffer.sampleRate * 0.02);
      const numVentanas = Math.floor(n / tamanoVentana);

      let sumaCuadrados = 0;
      let ventanasConActividad = 0;
      let ventanasEnSilencio = 0;
      let ventanasSaturadas = 0;

      for (let v = 0; v < numVentanas; v++) {
        const inicio = v * tamanoVentana;
        let sumaVentana = 0;
        let saturada = false;
        for (let i = inicio; i < inicio + tamanoVentana; i++) {
          const muestra = datos[i];
          sumaVentana += muestra * muestra;
          sumaCuadrados += muestra * muestra;
          if (Math.abs(muestra) >= 0.99) saturada = true;
        }
        const rmsVentana = Math.sqrt(sumaVentana / tamanoVentana);
        if (rmsVentana < 0.02) ventanasEnSilencio++; else ventanasConActividad++;
        if (saturada) ventanasSaturadas++;
      }

      const rmsGlobal = n > 0 ? Math.sqrt(sumaCuadrados / n) : 0;
      this.rmsPromedio.set(Number(rmsGlobal.toFixed(4)));
      this.porcentajeSilencio.set(Number(((ventanasEnSilencio / numVentanas) * 100).toFixed(2)));
      this.porcentajeActividad.set(Number(((ventanasConActividad / numVentanas) * 100).toFixed(2)));
      this.porcentajeClipping.set(Number(((ventanasSaturadas / numVentanas) * 100).toFixed(2)));
    } catch {
      this.usarMetricasEstimadas();
    }
  }

  private usarMetricasEstimadas(): void {
    const duracion = this.duracionAudio();
    if (duracion <= 0) return;
    this.rmsPromedio.set(0.07);
    this.porcentajeActividad.set(60);
    this.porcentajeSilencio.set(40);
    this.porcentajeClipping.set(0);
  }

  async abandonarCombate() {
    const confirmar = confirm(
      '¿Seguro que quieres abandonar este combate?\n\n' +
      'Tu oponente ganará automáticamente y quedará registrado en el historial.'
    );
    if (!confirmar) return;

    try {
      const res = await this.combateService.abandonarCombate(
        this.combateActivo().id,
        this.usuario().id.toString()
      );
      if (res.ok) {
        this.toastService.info('Abandonaste el combate. Tu oponente gana esta batalla.');
        if (this.intervaloPolling) clearInterval(this.intervaloPolling);
        await this.actualizarArena(); // Refresca para mostrar victoria_final
      }
    } catch (err) {
      console.error(err);
      this.toastService.error('No se pudo registrar el abandono. Intenta de nuevo.');
    }
  }

  async reclamarVictoriaPorAbandono() {
    const confirmar = confirm(
      `Tu oponente lleva más de ${this.MINUTOS_TIMEOUT} minutos sin cantar.\n\n` +
      '¿Quieres reclamar la victoria por abandono?'
    );
    if (!confirmar) return;

    try {
      // El "abandonador" es el oponente — determinamos su ID
      const miId = this.usuario().id;
      const combate = this.combateActivo();
      const idOponente = combate.id_usuario_jugador1 == miId
        ? combate.id_usuario_jugador2
        : combate.id_usuario_jugador1;

      const res = await this.combateService.abandonarCombate(
        combate.id,
        idOponente.toString()
      );
      if (res.ok) {
        this.toastService.success('¡Victoria reclamada! Tu oponente abandonó el combate.');
        if (this.intervaloPolling) clearInterval(this.intervaloPolling);
        await this.actualizarArena();
      }
    } catch (err) {
      console.error(err);
      this.toastService.error('No se pudo reclamar la victoria. Intenta de nuevo.');
    }
  }

  volverAlMenu() {
    this.router.navigate(['/auth/callback']);
  }
}

