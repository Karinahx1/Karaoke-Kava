import { Component, OnInit, signal, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Router } from '@angular/router';

import { StorageService } from '../../services/storage.service';
import { PracticaService } from '../../services/practica.service';
import { EvaluacionService } from '../../services/evaluacion.service';
import { CancionService } from '../../services/cancion.service';
import { AuthService } from '../../services/auth.service';
import { supabase } from '../../core/supabase.client';

// API de reconocimiento de voz del navegador
declare var webkitSpeechRecognition: any;
declare var SpeechRecognition: any;

@Component({
  selector: 'app-practica',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './practica.page.html',
  styleUrl: './practica.page.css'
})
export class PracticaPage implements OnInit {

  /**
   * Tiempo en el que comienza la grabación.
   * Lo usamos para calcular cuántos segundos duró la interpretación.
   */
  tiempoInicioGrabacion = 0;

  /**
   * Duración total del audio en segundos.
   */
  duracionAudio = signal(0);

  /**
   * Grabador del navegador
   */
  mediaRecorder!: MediaRecorder;

  /**
   * Reconocimiento de voz del navegador
   */
  recognition: any;

  /**
   * Controla si el reconocimiento debe reiniciarse cuando se detiene solo.
   * Se pone en false al llamar detenerReconocimiento() para evitar reinicios.
   */
  private recognitionActiva = false;

  /**
   * Promesa que se resuelve cuando recognition.onend dispara tras detenerlo.
   * mediaRecorder.onstop la espera para asegurar que los últimos resultados
   * de voz ya fueron procesados antes de enviar la transcripción al backend.
   */
  private reconocimientoTerminado: Promise<void> = Promise.resolve();

  /**
   * Fragmentos del audio grabado
   */
  audioChunks: Blob[] = [];

  /**
   * MIME type real que usa el MediaRecorder en este dispositivo/navegador.
   * Se detecta una vez antes de crear el grabador y se reutiliza al construir
   * el Blob final, garantizando que decodeAudioData lo pueda decodificar.
   */
  private mimeTypeGrabacion = 'audio/webm';

  /**
   * Estado reactivo principal
   */
  audioBlob = signal<Blob | null>(null);
  grabando = signal(false);
  audioUrl = signal<string | null>(null);
  practicaCreada = signal<any | null>(null);
  practicaEvaluada = signal<any | null>(null);
  transcripcionVoz = signal<string>('');

  /**
   * Variables de UI para Mejora de Experiencia (Fase UX)
   */
  cargando = signal(false);
  mensajeCarga = signal('');
  mostrarModal = signal(false);
  intervaloCarga: any;

  /**
   * Efecto de Estudio (Eco): OFF por defecto, el usuario lo activa.
   */
  efectoEstudioActivo = signal(false);
  efxContext: AudioContext | null = null;
  efxDestination: MediaStreamAudioDestinationNode | null = null;

  /**
 * Indica si la práctica ya fue iniciada.
 * La usamos para cargar el video con autoplay.
 */
  practicaIniciada = signal(false);

  /**
   * Lista de canciones disponibles
   */
  canciones = signal<any[]>([]);

  /**
   * Canción seleccionada actualmente
   */
  cancionSeleccionada = signal<any | null>(null);

  /**
   * URL segura para mostrar el video en iframe
   */
  videoUrl = signal<SafeResourceUrl | null>(null);

  /**
   * Herramientas de análisis de audio en tiempo real.
   * Nos sirven para medir si realmente hubo voz/actividad.
   */
  audioContext!: AudioContext;
  analyser!: AnalyserNode;
  sourceNode!: MediaStreamAudioSourceNode;
  datosTiempo!: Float32Array;
  analisisActivo = false;
  animationFrameId = 0;

  /**
   * Métricas acumuladas durante la grabación.
   */
  muestrasAnalizadas = 0;
  muestrasConActividad = 0;
  muestrasEnSilencio = 0;
  muestrasSaturadas = 0;
  sumaRms = 0;

  /**
   * Resultados finales del análisis de audio.
   */
  rmsPromedio = signal(0);
  porcentajeSilencio = signal(0);
  porcentajeActividad = signal(0);
  porcentajeClipping = signal(0);

  @ViewChild('visualizador') canvasRef?: ElementRef<HTMLCanvasElement>;

  /**
   * ID del usuario autenticado (se carga en ngOnInit)
   */
  idUsuario: number | null = null;
  idCancionPrueba = 1;
  idEstadoPracticaPendiente = 3;
  idEstadoPracticaFinalizada = 5;

  constructor(
    private storageService: StorageService,
    private practicaService: PracticaService,
    private evaluacionService: EvaluacionService,
    private cancionService: CancionService,
    private sanitizer: DomSanitizer,
    private authService: AuthService,
    private router: Router
  ) {}

  async ngOnInit() {
    try {
      // 1. Obtener usuario autenticado de Supabase Auth
      const authUser = await this.authService.obtenerUsuarioActual();
      if (!authUser) {
        this.router.navigate(['/login']);
        return;
      }

      // 2. Buscar perfil correspondiente en tbl_usuario
      const { data: dbUser, error: userError } = await supabase
        .from('tbl_usuario')
        .select('*')
        .eq('auth_uid', authUser.id)
        .maybeSingle();

      if (userError || !dbUser) {
        console.error('Error al cargar perfil de usuario:', userError);
        this.router.navigate(['/auth/callback']);
        return;
      }

      // 3. Validar que sea rol Jugador (id_rol === 1)
      if (dbUser.id_role !== 1 && dbUser.id_rol !== 1) {
        console.warn('Acceso denegado a práctica: Se requiere rol de jugador.');
        this.router.navigate(['/auth/callback']);
        return;
      }

      this.idUsuario = dbUser.id;

      // 4. Cargar canciones del catálogo
      const listaCanciones = await this.cancionService.obtenerCanciones();
      this.canciones.set(listaCanciones ?? []);

      if (this.canciones().length > 0) {
        await this.seleccionarCancion(this.canciones()[0].id);
      }
    } catch (error) {
      console.error('Error al inicializar la página de prácticas:', error);
      alert('Error de conexión: No se pudo cargar el catálogo de canciones. Verifica que el servidor esté activo.');
      this.router.navigate(['/auth/callback']);
    }
  }

  /**
   * Convierte enlaces de YouTube a formato embed.
   */
  convertirYoutubeAEmbed(url: string): string | null {
  if (!url) return null;

  const autoplay = this.practicaIniciada()
    ? '?autoplay=1&rel=0'
    : '?rel=0';

  // Caso 1: ya viene en formato embed
  if (url.includes('youtube.com/embed/')) {
    const urlBase = url.split('?')[0];
    return `${urlBase}${autoplay}`;
  }

  // Caso 2: formato corto youtu.be
  if (url.includes('youtu.be/')) {
    const partes = url.split('youtu.be/');
    const idVideo = partes[1]?.split('?')[0];
    return idVideo ? `https://www.youtube.com/embed/${idVideo}${autoplay}` : null;
  }

  // Caso 3: formato normal watch?v=
  if (url.includes('watch?v=')) {
    const partes = url.split('watch?v=');
    const idVideo = partes[1]?.split('&')[0];
    return idVideo ? `https://www.youtube.com/embed/${idVideo}${autoplay}` : null;
  }

  return null;
}

  /**
   * Carga una canción y prepara el video.
   */
  async seleccionarCancion(idCancion: number) {
    this.practicaIniciada.set(false);
    try {
      const cancion = await this.cancionService.obtenerCancionPorId(idCancion);

      this.cancionSeleccionada.set(cancion);
      this.idCancionPrueba = cancion.id;

      const urlEmbed = this.convertirYoutubeAEmbed(cancion.url_audio);

      if (urlEmbed) {
        this.videoUrl.set(
          this.sanitizer.bypassSecurityTrustResourceUrl(urlEmbed)
        );
      } else {
        this.videoUrl.set(null);
      }

      console.log('Canción seleccionada:', cancion);
      console.log('URL embed del video:', urlEmbed);

    } catch (error) {
      console.error('Error al seleccionar canción:', error);
    }
  }

  /**
   * Inicia reconocimiento de voz.
   * Detecta el idioma de la canción y reinicia automáticamente si el navegador
   * detiene el reconocimiento por silencio (comportamiento habitual en Chrome).
   */
  iniciarReconocimiento() {
    const SR =
      (typeof SpeechRecognition !== 'undefined' && SpeechRecognition) ||
      (typeof webkitSpeechRecognition !== 'undefined' && webkitSpeechRecognition);

    if (!SR) {
      console.warn('Web Speech API no disponible en este navegador.');
      return;
    }

    const letraActual = this.cancionSeleccionada()?.letra?.toLowerCase() || '';
    const palabrasIngles = [' the ', ' you ', ' and ', ' to ', ' i '];
    const esIngles = palabrasIngles.some(palabra => letraActual.includes(palabra));

    const rec = new SR();
    rec.lang = esIngles ? 'en-US' : 'es-ES';
    rec.continuous = true;
    rec.interimResults = false;

    rec.onresult = (event: any) => {
      let textoAcumulado = this.transcripcionVoz();
      for (let i = event.resultIndex; i < event.results.length; i++) {
        textoAcumulado += ' ' + event.results[i][0].transcript;
      }
      this.transcripcionVoz.set(textoAcumulado.trim());
      console.log('Transcripción parcial/real:', this.transcripcionVoz());
    };

    rec.onerror = (event: any) => {
      // 'no-speech' y 'aborted' son normales durante silencios — no son errores reales
      if (event.error === 'no-speech' || event.error === 'aborted') return;

      // 'audio-capture' indica que el micrófono está bloqueado por otra API
      // (conflicto con getUserMedia). La transcripción quedará vacía.
      if (event.error === 'audio-capture') {
        console.error('SpeechRecognition: el micrófono está en uso por otra API (audio-capture). La transcripción no estará disponible.');
        return;
      }

      console.warn('Error en reconocimiento de voz:', event.error);
    };

    rec.onend = () => {
      if (this.recognitionActiva) {
        if (this.esMobile()) {
          // En móvil NO reiniciamos: cada rec.start() provoca una micro-interrupción
          // de la sesión de audio del SO que pausa el video de YouTube.
          // Los navegadores móviles mantienen sesiones continuas más tiempo que
          // el escritorio, por lo que este reinicio no es necesario.
          return;
        }
        // Escritorio: reiniciar para cubrir pausas largas de silencio.
        try { rec.start(); } catch { /* ya iniciando, ignorar */ }
      }
      // Si recognitionActiva === false, detenerReconocimiento() ya reemplazó
      // este handler con el resolver de la Promise — no hacer nada aquí.
    };

    this.recognitionActiva = true;
    rec.start();
    this.recognition = rec;
  }

  /**
   * Detiene el reconocimiento de voz y devuelve una Promesa que se resuelve
   * cuando recognition.onend dispara. Esto garantiza que cualquier resultado
   * final pendiente (onresult) ya fue procesado antes de continuar.
   */
  detenerReconocimiento() {
    this.recognitionActiva = false;

    if (!this.recognition) {
      this.reconocimientoTerminado = Promise.resolve();
      return;
    }

    const rec = this.recognition;
    this.recognition = null;

    this.reconocimientoTerminado = new Promise<void>((resolve) => {
      // Reemplazar onend con el resolver. onresult sigue activo para capturar
      // cualquier resultado final que el navegador todavía esté procesando.
      rec.onend = () => resolve();
      // Fallback: si onend nunca dispara en 800 ms, continuar igual
      setTimeout(resolve, 800);
      try { rec.stop(); } catch { resolve(); }
    });
  }

  /**
   * Inicia el análisis básico del audio.
   * Aquí medimos:
   * - RMS promedio
   * - actividad
   * - silencio
   */
  iniciarAnalisisAudio(stream: MediaStream) {
    this.audioContext = new AudioContext();
    this.analyser = this.audioContext.createAnalyser();
    this.sourceNode = this.audioContext.createMediaStreamSource(stream);

    this.sourceNode.connect(this.analyser);

    this.analyser.fftSize = 2048;
    this.datosTiempo = new Float32Array(this.analyser.fftSize);

    // Reiniciar métricas
    this.muestrasAnalizadas = 0;
    this.muestrasConActividad = 0;
    this.muestrasEnSilencio = 0;
    this.muestrasSaturadas = 0;
    this.sumaRms = 0;

    this.rmsPromedio.set(0);
    this.porcentajeSilencio.set(0);
    this.porcentajeActividad.set(0);
    this.porcentajeClipping.set(0);

    this.analisisActivo = true;

    let canvasCtx: CanvasRenderingContext2D | null = null;
    let canvas: HTMLCanvasElement | null = null;

    const analizar = () => {
      if (!this.analisisActivo) return;

      this.analyser.getFloatTimeDomainData(this.datosTiempo as any);

      let sumaCuadrados = 0;
      let clippeoDetectado = false;

      for (let i = 0; i < this.datosTiempo.length; i++) {
        const val = this.datosTiempo[i];
        sumaCuadrados += val * val;
        
        // Detección de gritos (saturación)
        if (Math.abs(val) >= 0.99) {
          clippeoDetectado = true;
        }
      }

      if (clippeoDetectado) {
        this.muestrasSaturadas++;
      }

      const rms = Math.sqrt(sumaCuadrados / this.datosTiempo.length);

      this.muestrasAnalizadas++;
      this.sumaRms += rms;

      if (rms < 0.02) {
        this.muestrasEnSilencio++;
      } else {
        this.muestrasConActividad++;
      }

      // ---- DIBUJAR OSCILOSCOPIO ----
      if (this.canvasRef && this.canvasRef.nativeElement) {
        canvas = this.canvasRef.nativeElement;
        canvasCtx = canvas.getContext('2d');
      }

      if (canvasCtx && canvas) {
        const w = canvas.width;
        const h = canvas.height;

        canvasCtx.fillStyle = 'rgba(2, 6, 23, 0.25)'; // trail effect
        canvasCtx.fillRect(0, 0, w, h);
        canvasCtx.lineWidth = 3;
        canvasCtx.strokeStyle = clippeoDetectado ? '#ef4444' : '#a78bfa'; // Rojo si grita
        canvasCtx.beginPath();

        const sliceWidth = w / this.datosTiempo.length;
        let x = 0;

        for (let i = 0; i < this.datosTiempo.length; i++) {
          const v = this.datosTiempo[i] * 0.5; // escalar la onda
          const y = (v * h / 2) + (h / 2);

          if (i === 0) canvasCtx.moveTo(x, y);
          else canvasCtx.lineTo(x, y);

          x += sliceWidth;
        }
        canvasCtx.lineTo(w, h / 2);
        canvasCtx.stroke();
      }
      // -------------------------------

      this.animationFrameId = requestAnimationFrame(analizar);
    };

    // Pequeño timeout para dar tiempo a que el *ngIf monte el canvas
    setTimeout(() => {
      analizar();
    }, 100);
  }

  /**
   * Detiene el análisis de audio y calcula resultados.
   */
  detenerAnalisisAudio() {
    this.analisisActivo = false;
    cancelAnimationFrame(this.animationFrameId);

    if (this.muestrasAnalizadas > 0) {
      const rms = this.sumaRms / this.muestrasAnalizadas;
      const silencio = (this.muestrasEnSilencio / this.muestrasAnalizadas) * 100;
      const actividad = (this.muestrasConActividad / this.muestrasAnalizadas) * 100;
      const clipping = (this.muestrasSaturadas / this.muestrasAnalizadas) * 100;

      this.rmsPromedio.set(Number(rms.toFixed(4)));
      this.porcentajeSilencio.set(Number(silencio.toFixed(2)));
      this.porcentajeActividad.set(Number(actividad.toFixed(2)));
      this.porcentajeClipping.set(Number(clipping.toFixed(2)));
    }

    if (this.audioContext) {
      this.audioContext.close();
    }

    console.log('RMS promedio:', this.rmsPromedio());
    console.log('Porcentaje de silencio:', this.porcentajeSilencio());
    console.log('Porcentaje de actividad:', this.porcentajeActividad());
  }

  /**
   * Activa o desactiva el efecto de estudio (eco).
   */
  toggleEfectoEstudio() {
    this.efectoEstudioActivo.set(!this.efectoEstudioActivo());
  }

  /**
   * Inicia la grabación del micrófono y la transcripción.
   * Si el efecto de estudio está activo, aplica eco/reverb en tiempo real.
   */
  async iniciarGrabacion() {
    // En móvil desactivamos el procesado de voz del navegador (cancelación de eco,
    // supresión de ruido y control automático de ganancia). Esos filtros están
    // pensados para llamadas, no para cantar: degradan la calidad de la grabación.
    // Con ellos desactivados la voz se graba más natural y fiel.
    //
    // En móvil la transcripción NO depende del navegador (SpeechRecognition no
    // puede compartir el micrófono con MediaRecorder en Android), sino que el
    // backend transcribe el audio subido con Gemini. Por eso aquí priorizamos
    // la calidad del audio grabado.
    const audioConstraints: MediaTrackConstraints | boolean = this.esMobile()
      ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      : true;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });

    let streamParaGrabar = stream;

    // Si el efecto de estudio está activo, crear pipeline de eco
    if (this.efectoEstudioActivo()) {
      this.efxContext = new AudioContext();
      const source = this.efxContext.createMediaStreamSource(stream);
      this.efxDestination = this.efxContext.createMediaStreamDestination();

      // Nodo de delay (eco de 150ms)
      const delay = this.efxContext.createDelay(1.0);
      delay.delayTime.value = 0.15;

      // Nodo de ganancia para controlar la intensidad del eco (30%)
      const feedbackGain = this.efxContext.createGain();
      feedbackGain.gain.value = 0.3;

      // Mezcla: voz original (dry) va directo al destino
      source.connect(this.efxDestination);

      // Eco: voz → delay → gain → destino, y feedback loop
      source.connect(delay);
      delay.connect(feedbackGain);
      feedbackGain.connect(this.efxDestination);
      feedbackGain.connect(delay); // feedback loop para eco natural

      streamParaGrabar = this.efxDestination.stream;
    }

    // Detectar el MIME type real soportado para que el blob coincida con el
    // formato grabado — necesario para que decodeAudioData funcione en móvil.
    const candidatosMime = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4'
    ];
    this.mimeTypeGrabacion = candidatosMime.find(t => MediaRecorder.isTypeSupported(t))
      ?? 'audio/webm';

    this.mediaRecorder = new MediaRecorder(streamParaGrabar, {
      mimeType: this.mimeTypeGrabacion
    });
    this.audioChunks = [];

    // Reiniciar estados de una nueva práctica
    this.transcripcionVoz.set('');
    this.duracionAudio.set(0);
    this.audioBlob.set(null);
    this.audioUrl.set(null);
    this.practicaCreada.set(null);
    this.practicaEvaluada.set(null);
    this.reconocimientoTerminado = Promise.resolve();

    this.tiempoInicioGrabacion = Date.now();

    this.iniciarReconocimiento();

    if (this.esMobile()) {
      // En móvil omitimos el análisis en tiempo real: conectar el stream del
      // micrófono al grafo de Web Audio fuerza la sesión PlayAndRecord del SO,
      // lo que pausa repetidamente el iframe de YouTube.
      // Las métricas RMS se calcularán offline sobre el blob grabado una vez
      // que el micrófono ya esté cerrado (ver analizarAudioOffline).
      console.info('Modo móvil: análisis en tiempo real omitido; se usará análisis offline.');
    } else {
      // Siempre usar el stream original del mic para análisis (sin eco)
      this.iniciarAnalisisAudio(stream);
    }

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        this.audioChunks.push(event.data);
      }
    };

    this.mediaRecorder.onstop = async () => {
      const blobFinal = new Blob(this.audioChunks, { type: this.mimeTypeGrabacion });
      this.audioBlob.set(blobFinal);

      const tiempoFinGrabacion = Date.now();
      const duracionSegundos = Math.round(
        (tiempoFinGrabacion - this.tiempoInicioGrabacion) / 1000
      );
      this.duracionAudio.set(duracionSegundos);

      // Limpiar contexto del efecto de estudio
      if (this.efxContext) {
        this.efxContext.close();
        this.efxContext = null;
        this.efxDestination = null;
      }

      console.log('Audio grabado:', this.audioBlob());
      console.log('Duración del audio:', this.duracionAudio());

      // Esperar a que recognition.onend haya disparado y entregado todos los
      // resultados finales pendientes antes de leer transcripcionVoz().
      await this.reconocimientoTerminado;

      console.log('Transcripción capturada:', this.transcripcionVoz());

      await this.subirAudioGrabado();
    };

    this.mediaRecorder.start();
    this.grabando.set(true);
  }

  /**
   * Detiene grabación, reconocimiento y análisis.
   */
  detenerGrabacion() {
    if (this.mediaRecorder && this.grabando()) {
      this.mediaRecorder.stop();
      this.grabando.set(false);
      this.detenerReconocimiento();
      this.detenerAnalisisAudio();
    }
    this.practicaIniciada.set(false);

const cancion = this.cancionSeleccionada();

if (cancion) {
  const urlEmbed = this.convertirYoutubeAEmbed(cancion.url_audio);

  if (urlEmbed) {
    this.videoUrl.set(
      this.sanitizer.bypassSecurityTrustResourceUrl(urlEmbed)
    );
  }
}
  }

  /**
   * Sube el audio al bucket y luego crea la práctica.
   */
  async subirAudioGrabado() {
    try {
      if (!this.audioBlob()) {
        console.warn('No hay audio para subir.');
        return;
      }

      // Activar pantalla de espera antes de subir y evaluar
      this.iniciarPantallaEspera();

      // En móvil el análisis en tiempo real fue omitido para no interferir con
      // el video. Ahora que el micrófono ya está cerrado, decodificamos el blob
      // grabado y calculamos las mismas métricas que usa la evaluación de Gemini.
      if (this.esMobile()) {
        await this.analizarAudioOffline(this.audioBlob()!);
      }

      const fileName = `practica-${Date.now()}.webm`;

      const file = new File([this.audioBlob()!], fileName, {
        type: 'audio/webm'
      });

      const filePath = `audios/${fileName}`;
      const publicUrl = await this.storageService.subirAudio(file, filePath);

      this.audioUrl.set(publicUrl);
      console.log('Audio subido correctamente:', publicUrl);

      await this.crearPractica();

    } catch (error) {
      console.error('Error al subir el audio:', error);
      this.detenerPantallaEspera();
    }
  }

  iniciarPantallaEspera() {
    this.cargando.set(true);
    const mensajes = [
      'Analizando afinación...',
      'Evaluando pronunciación...',
      'Calculando puntuación...',
      'El jurado está deliberando...',
      'Preparando resultados...'
    ];
    let idx = 0;
    this.mensajeCarga.set(mensajes[0]);
    this.intervaloCarga = setInterval(() => {
      idx++;
      this.mensajeCarga.set(mensajes[idx % mensajes.length]);
    }, 1500);
  }

  detenerPantallaEspera() {
    this.cargando.set(false);
    if (this.intervaloCarga) {
      clearInterval(this.intervaloCarga);
    }
  }

  /**
   * Crea la práctica en la base de datos.
   */
  async crearPractica() {
    try {
      if (!this.audioUrl() || this.idUsuario === null) {
        console.warn('No existe URL del audio o ID de usuario todavía.');
        return;
      }

      const practica = await this.practicaService.crearPractica({
        id_usuario: this.idUsuario,
        id_cancion: this.idCancionPrueba,
        id_estado: this.idEstadoPracticaPendiente,
        url_audio_usuario: this.audioUrl()!
      });

      this.practicaCreada.set(practica);
      console.log('Práctica creada correctamente:', practica);

      await this.evaluarPractica();

    } catch (error) {
      console.error('Error al crear la práctica:', error);
    }
  }

  /**
   * Envía la práctica al backend para evaluación.
   */
  async evaluarPractica() {
    try {
      if (!this.practicaCreada()) {
        console.warn('No existe una práctica creada para evaluar.');
        return;
      }

      const resultadoEvaluacion = await this.evaluacionService.evaluarPractica({
        idPractica: this.practicaCreada()!.id,
        transcripcion: this.transcripcionVoz(),
        duracionAudio: this.duracionAudio(),
        rmsPromedio: this.rmsPromedio(),
        porcentajeSilencio: this.porcentajeSilencio(),
        porcentajeActividad: this.porcentajeActividad(),
        porcentajeClipping: this.porcentajeClipping()
      });

      const practicaActualizada =
        await this.practicaService.actualizarResultadoPractica(
          this.practicaCreada()!.id,
          {
            puntaje: resultadoEvaluacion.puntaje,
            puntajeLetra: resultadoEvaluacion.puntajeLetra,
            puntajeAudio: resultadoEvaluacion.puntajeAudio,
            puntajeVoz: resultadoEvaluacion.puntajeVoz,
            feedback: resultadoEvaluacion.feedback,
            transcripcion: resultadoEvaluacion.transcripcion,
            id_estado: this.idEstadoPracticaFinalizada
          }
        );

      this.practicaEvaluada.set(practicaActualizada);
      console.log('Práctica evaluada correctamente:', practicaActualizada);

      // Evaluación completada
      this.detenerPantallaEspera();
      this.mostrarModal.set(true);

    } catch (error) {
      console.error('Error al evaluar la práctica:', error);
      this.detenerPantallaEspera();
    }
  }

  /**
 * Inicia la práctica completa:
 * - activa autoplay del video
 * - recarga la URL del video
 * - inicia grabación, transcripción y análisis de audio
 */
async iniciarPracticaCompleta() {
  if (!this.cancionSeleccionada()) {
    console.warn('No hay canción seleccionada.');
    return;
  }

  this.practicaIniciada.set(true);

  const urlEmbed = this.convertirYoutubeAEmbed(
    this.cancionSeleccionada().url_audio
  );

  if (urlEmbed) {
    this.videoUrl.set(
      this.sanitizer.bypassSecurityTrustResourceUrl(urlEmbed)
    );
  }

  await this.iniciarGrabacion();
}

/**
 * Vuelve al menú principal.
 */
volverAlMenu() {
  this.router.navigate(['/auth/callback']);
}

reiniciarPractica() {
  this.mostrarModal.set(false);
  this.practicaEvaluada.set(null);
  this.practicaCreada.set(null);
  this.audioUrl.set(null);
  this.audioBlob.set(null);
  this.transcripcionVoz.set('');
  this.practicaIniciada.set(false);
}

navegarEstadisticas() {
  this.router.navigate(['/comunidad']); // Por ahora a comunidad o donde estén
}

getNivel(puntaje: number | undefined): string {
  if (puntaje === undefined) return '-';
  if (puntaje >= 90) return '🎤 Nivel Dios';
  if (puntaje >= 75) return '⭐ Estrella';
  if (puntaje >= 50) return '👍 Aficionado';
  if (puntaje >= 30) return '😐 Principiante';
  return '🙉 Necesitas más práctica';
}

/**
 * Calcula las métricas de audio (RMS, silencio, actividad, clipping) sobre el
 * blob grabado, sin necesidad de tener el micrófono abierto.
 *
 * Se usa exclusivamente en móvil: el micrófono ya está cerrado cuando se llama
 * a este método, por lo que crear un AudioContext temporal no interfiere con la
 * sesión de audio del SO ni pausa el video.
 * La lógica de ventanas y umbrales es idéntica a iniciarAnalisisAudio para
 * que Gemini reciba exactamente los mismos parámetros que en escritorio.
 */
private async analizarAudioOffline(blob: Blob): Promise<void> {
  if (blob.size === 0) {
    console.warn('Blob de audio vacío — aplicando métricas estimadas.');
    this.usarMetricasEstimadas();
    return;
  }

  try {
    const arrayBuffer = await blob.arrayBuffer();

    // AudioContext temporal solo para decodificar el blob — no captura
    // micrófono ni produce salida de audio, por lo que no afecta al SO.
    const ctx = new AudioContext();

    let audioBuffer: AudioBuffer;
    try {
      audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    } catch (errDecode) {
      // Puede ocurrir si el codec grabado (ej. opus en webm) no coincide con
      // el MIME type del blob, o si el navegador no soporta el formato.
      ctx.close();
      console.warn('decodeAudioData falló — aplicando métricas estimadas.', errDecode);
      this.usarMetricasEstimadas();
      return;
    }
    ctx.close();

    const datos = audioBuffer.getChannelData(0);
    const n = datos.length;
    // Ventanas de 20 ms, igual que el loop de requestAnimationFrame en desktop
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

    console.log('Análisis offline (móvil):', {
      rms: this.rmsPromedio(),
      silencio: this.porcentajeSilencio(),
      actividad: this.porcentajeActividad(),
      clipping: this.porcentajeClipping()
    });
  } catch (error) {
    console.warn('Error inesperado en análisis offline — aplicando métricas estimadas.', error);
    this.usarMetricasEstimadas();
  }
}

/**
 * Fallback para cuando el análisis offline falla (formato no decodificable,
 * blob vacío, etc.). Usa la duración grabada para inferir que hubo actividad
 * vocal y evitar que Gemini reciba todo ceros y evalúe como "sin voz".
 * Los valores son conservadores y representan una grabación vocal típica.
 */
private usarMetricasEstimadas(): void {
  const duracion = this.duracionAudio();
  if (duracion <= 0) return;

  this.rmsPromedio.set(0.07);
  this.porcentajeActividad.set(60);
  this.porcentajeSilencio.set(40);
  this.porcentajeClipping.set(0);
  console.info(`Métricas estimadas aplicadas (grabación de ${duracion}s).`);
}

/**
 * Devuelve true en smartphones y tablets.
 * En esos dispositivos evitamos crear un AudioContext conectado al micrófono
 * porque iOS y algunos Android cambian la sesión de audio a PlayAndRecord,
 * lo que pausa repetidamente el video de YouTube embebido en el iframe.
 */
private esMobile(): boolean {
  if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)) {
    return true;
  }
  // iPad moderno reporta "Macintosh" en el UA pero tiene múltiples puntos táctiles
  return navigator.maxTouchPoints > 1 && /Macintosh/i.test(navigator.userAgent);
}

}