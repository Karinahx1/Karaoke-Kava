import { Component, OnInit, OnDestroy, signal, ViewChild, ElementRef } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { StorageService } from '../../services/storage.service';
import { EvaluacionService } from '../../services/evaluacion.service';
import { CancionService } from '../../services/cancion.service';

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

  // Vistas: 'lista' | 'buscando' | 'arena' | 'resultado_ronda' | 'victoria_final'
  vistaActual = signal<'lista' | 'buscando' | 'arena' | 'resultado_ronda' | 'victoria_final'>('lista');

  misCombates = signal<any[]>([]);
  combateActivo = signal<any>(null);
  
  // Para las transiciones visuales
  rondasVistas = new Set<string>(); // IDs de rondas cuyo resultado ya se mostró
  rondaResultadoActiva = signal<any>(null); // La ronda de la que estamos mostrando resultados
  cuentaRegresiva = signal<number | null>(null);

  // Señal separada para invitaciones pendientes (id_estado === 1 y soy jugador2)
  invitacionesPendientes = signal<any[]>([]);

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
    } catch (err) {
      console.error(err);
      this.toastService.error('Error al cargar el perfil. Intenta de nuevo.');
    } finally {
      this.cargando.set(false);
    }
  }

  async cargarMisCombates() {
    if (!this.usuario()) return;
    try {
      const res = await this.combateService.obtenerMisCombates(this.usuario().id);
      if (res.ok) {
        const todos = res.data ?? [];
        
        // Separar invitaciones pendientes donde el usuario actual es el jugador2 invitado
        const misInvitaciones = todos.filter(
          (c: any) => c.id_estado === 1 && c.id_usuario_jugador2 == this.usuario().id
        );
        this.invitacionesPendientes.set(misInvitaciones);

        // El resto de combates va a misCombates
        const mios = todos.filter(
          (c: any) => !(c.id_estado === 1 && c.id_usuario_jugador2 == this.usuario().id)
        );
        this.misCombates.set(mios);
      } else {
        this.toastService.error('No se pudieron cargar tus combates.');
      }
    } catch (err) {
      console.error('Error cargando combates', err);
      this.toastService.error('Error de conexión al cargar combates.');
    }
  }

  async buscarOponenteAutomatico() {
    this.cargando.set(true);
    try {
      // Si el usuario no tiene nivel, usar un nivel por defecto (ej. 1) para permitir pruebas
      const nivel = this.usuario()?.id_nivel || 1;
      
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
            if (detRes.ok && detRes.data?.id_estado === 3) {
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
      }
    } catch (e) {
      console.error('Error en polling', e);
    }
  }

  evaluarEstadoArena() {
    const combate = this.combateActivo();
    if (!combate) return;

    // Si el combate terminó, detener polling y mostrar victoria
    if (combate.id_estado === 4) {
      if (this.intervaloPolling) clearInterval(this.intervaloPolling);
      this.vistaActual.set('victoria_final');
      return;
    }

    const rondas = combate.rondas || [];

    // Verificar si hay alguna ronda que acaba de terminar y no hemos visto
    const rondasCompletadas = rondas.filter((r: any) => r.id_estado === 2);
    for (const ronda of rondasCompletadas) {
      if (!this.rondasVistas.has(ronda.id.toString())) {
        this.rondaResultadoActiva.set(ronda);
        this.vistaActual.set('resultado_ronda');
        return;
      }
    }

    // Si llegamos aquí, mostramos la arena normal
    this.vistaActual.set('arena');

    // Buscar SOLO rondas en estado pendiente (id_estado === 1)
    // Si no hay ninguna, rondaActiva es null → el HTML mostrará
    // el selector de canción para la siguiente ronda o «esperando».
    const rondaActual = rondas.find((r: any) => r.id_estado === 1) ?? null;

    this.rondaActiva.set(rondaActual);

    // Configurar video SOLO si la ronda activa tiene canción asignada
    if (rondaActual?.cancion?.url_audio) {
      // Usamos la URL fija (sin autoplay dependiente de estado) para evitar reinicios
      const urlEmbed = this.convertirYoutubeAEmbed(rondaActual.cancion.url_audio);
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
    this.rondaResultadoActiva.set(null);
    this.rondaActiva.set(null);
    this.videoUrl.set(null);  // Limpiar video para que la próxima ronda lo cargue fresco
    this.turnoActual.set(null);
    this.oponenteYaCanto.set(false);
    // Pedir datos frescos del servidor antes de evaluar
    await this.actualizarArena();
  }

  convertirYoutubeAEmbed(url: string): string | null {
    // URL fija con autoplay y mute para que no cambie según el estado de grabación
    // Si cambiara, el iframe se destruiría y recrearía, reiniciando el video.
    const params = '?autoplay=1&mute=0&rel=0&enablejsapi=0';
    if (!url) return null;
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
    // Compatibilidad Chrome + Edge (webkit prefix opcional)
    const SpeechRecognitionAPI = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) {
      console.warn('SpeechRecognition no disponible en este navegador.');
      return;
    }
    this.recognition = new SpeechRecognitionAPI();
    const letraActual = this.cancionSeleccionada()?.letra?.toLowerCase() || '';
    const palabrasIngles = [' the ', ' you ', ' and ', ' to ', ' i '];
    const esIngles = palabrasIngles.some(p => letraActual.includes(p));
    this.recognition.lang = esIngles ? 'en-US' : 'es-ES';
    this.recognition.continuous = true;
    this.recognition.interimResults = false;
    this.recognition.onresult = (event: any) => {
      let texto = this.transcripcionVoz();
      for (let i = event.resultIndex; i < event.results.length; i++) {
        texto += ' ' + event.results[i][0].transcript;
      }
      this.transcripcionVoz.set(texto.trim());
    };
    this.recognition.onerror = (event: any) => console.warn('Speech error:', event.error);
    try { this.recognition.start(); } catch(e) { console.warn('No se pudo iniciar reconocimiento de voz', e); }
  }

  detenerReconocimiento() {
    if (this.recognition) {
      try { this.recognition.stop(); } catch (e) {}
    }
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

    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      .then(stream => {
        this.audioContext = new AudioContext();
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 2048;
        this.datosTiempo = new Float32Array(this.analyser.fftSize);

        this.sourceNode = this.audioContext.createMediaStreamSource(stream);
        this.sourceNode.connect(this.analyser);

        this.mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
        this.mediaRecorder.ondataavailable = (e: BlobEvent) => {
          if (e.data.size > 0) this.audioChunks.push(e.data);
        };
        this.mediaRecorder.start(1000);

        this.grabando.set(true);
        this.tiempoInicioGrabacion = Date.now();
        this.analisisActivo = true;

        this.iniciarReconocimiento();

        // Refrescar URL con autoplay
        if (this.cancionSeleccionada()?.url_audio) {
          const urlEmbed = this.convertirYoutubeAEmbed(this.cancionSeleccionada().url_audio);
          if (urlEmbed) this.videoUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(urlEmbed));
        }

        this.procesarAudio();
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

  async detenerGrabacion() {
    this.analisisActivo = false;
    cancelAnimationFrame(this.animationFrameId);
    this.detenerReconocimiento();

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
    this.grabando.set(false);

    if (this.sourceNode) {
      this.sourceNode.mediaStream.getTracks().forEach((t: MediaStreamTrack) => t.stop());
    }
    if (this.audioContext) this.audioContext.close();

    const duracion = (Date.now() - this.tiempoInicioGrabacion) / 1000;
    this.duracionAudio.set(duracion);
    this.rmsPromedio.set(this.muestrasAnalizadas > 0 ? this.sumaRms / this.muestrasAnalizadas : 0);
    this.porcentajeSilencio.set(this.muestrasAnalizadas > 0 ? (this.muestrasEnSilencio / this.muestrasAnalizadas) * 100 : 0);
    this.porcentajeActividad.set(this.muestrasAnalizadas > 0 ? (this.muestrasConActividad / this.muestrasAnalizadas) * 100 : 0);
    this.porcentajeClipping.set(this.muestrasAnalizadas > 0 ? (this.muestrasSaturadas / this.muestrasAnalizadas) * 100 : 0);

    // Esperar un momento para que el MediaRecorder termine de emitir los datos
    setTimeout(() => {
      const finalBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
      this.procesarTurnoArena(finalBlob);
    }, 600);
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
        this.toastService.success(`¡Turno completado! Puntaje: ${resultado.puntaje}`);
      }

      await this.actualizarArena();
    } catch (e) {
      console.error('Error procesando turno arena:', e);
      this.toastService.error('Error al procesar tu turno. Intenta de nuevo.');
    } finally {
      this.cargando.set(false);
    }
  }

  volverAlMenu() {
    this.router.navigate(['/auth/callback']);
  }
}

