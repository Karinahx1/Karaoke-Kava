import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

import { StorageService } from '../../services/storage.service';
import { PracticaService } from '../../services/practica.service';
import { EvaluacionService } from '../../services/evaluacion.service';
import { CancionService } from '../../services/cancion.service';
import { ScoreService, ResultadoFinal } from '../../services/score.service';

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
   * Fragmentos del audio grabado
   */
  audioChunks: Blob[] = [];

  /**
   * Estado reactivo principal
   */
  audioBlob = signal<Blob | null>(null);
  grabando = signal(false);
  audioUrl = signal<string | null>(null);
  practicaCreada = signal<any | null>(null);
  practicaEvaluada = signal<any | null>(null);

  /** Palabras finales confirmadas por el reconocimiento de voz */
  transcripcionVoz = signal<string>('');
  /** Texto parcial aún no confirmado (se muestra en tiempo real) */
  transcripcionInterim = signal<string>('');

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
  datosPitch!: Float32Array;
  analisisActivo = false;
  animationFrameId = 0;

  /**
   * Métricas acumuladas durante la grabación.
   */
  muestrasAnalizadas = 0;
  muestrasConActividad = 0;
  muestrasEnSilencio = 0;
  sumaRms = 0;

  /**
   * Resultados finales del análisis de audio.
   */
  rmsPromedio = signal(0);
  porcentajeSilencio = signal(0);
  porcentajeActividad = signal(0);

  // ── Pitch detection state ────────────────────────────────────────────────
  /** Frames donde se detectó audio con suficiente volumen */
  framesConAudio = 0;
  /** Frames donde el audio activo tenía un tono musical claro */
  framesConPitch = 0;
  /** Timestamp del último análisis de pitch (ms) */
  ultimoAnalisisPitch = 0;
  /** Nota musical actualmente detectada, ej: "A4" */
  notaDetectada = signal<string>('--');

  // ── Score state ──────────────────────────────────────────────────────────
  puntajePitch = signal(0);
  puntajeLetra = signal(0);
  resultadoFinal = signal<ResultadoFinal | null>(null);
  /** true si el navegador no soporta Web Speech API */
  speechSinSoporte = signal(false);
  intervaloScore: ReturnType<typeof setInterval> | null = null;

  /**
   * IDs temporales para pruebas
   */
  idUsuarioPrueba = 1;
  idCancionPrueba = 1;
  idEstadoPracticaPendiente = 3;
  idEstadoPracticaFinalizada = 5;

  constructor(
    private storageService: StorageService,
    private practicaService: PracticaService,
    private evaluacionService: EvaluacionService,
    private cancionService: CancionService,
    private scoreService: ScoreService,
    private sanitizer: DomSanitizer
  ) {}

  async ngOnInit() {
    try {
      const listaCanciones = await this.cancionService.obtenerCanciones();
      this.canciones.set(listaCanciones ?? []);

      if (this.canciones().length > 0) {
        await this.seleccionarCancion(this.canciones()[0].id);
      }
    } catch (error) {
      console.error('Error al cargar canciones:', error);
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

    if (url.includes('youtube.com/embed/')) {
      const urlBase = url.split('?')[0];
      return `${urlBase}${autoplay}`;
    }

    if (url.includes('youtu.be/')) {
      const partes = url.split('youtu.be/');
      const idVideo = partes[1]?.split('?')[0];
      return idVideo ? `https://www.youtube.com/embed/${idVideo}${autoplay}` : null;
    }

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
   * Inicia reconocimiento de voz con soporte para resultados interinos.
   * Si el navegador no soporta la API, muestra una advertencia no bloqueante.
   */
  iniciarReconocimiento() {
    const SR =
      (typeof SpeechRecognition !== 'undefined' && SpeechRecognition) ||
      (typeof webkitSpeechRecognition !== 'undefined' && webkitSpeechRecognition);

    if (!SR) {
      this.speechSinSoporte.set(true);
      console.warn('Web Speech API no disponible. El puntaje de letra será 0.');
      return;
    }

    // Build the instance locally so the onend closure references this exact object,
    // not whatever this.recognition points to when the event fires later.
    const rec = new SR();
    rec.lang = 'es-ES';
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (event: any) => {
      let textoFinal = this.transcripcionVoz();
      let textoInterim = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          textoFinal += ' ' + event.results[i][0].transcript;
        } else {
          textoInterim += event.results[i][0].transcript;
        }
      }

      this.transcripcionVoz.set(textoFinal.trim());
      this.transcripcionInterim.set(textoInterim);

      console.log('Transcripción parcial/real:', this.transcripcionVoz());
    };

    rec.onerror = (event: any) => {
      // 'no-speech' and 'aborted' fire regularly during silence — not real errors
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      console.warn('Error en reconocimiento de voz:', event.error);
    };

    // Browsers (especially Chrome) stop continuous recognition after silence.
    // Restart automatically as long as the practice is still running.
    rec.onend = () => {
      if (this.grabando()) {
        try { rec.start(); } catch { /* already starting, ignore */ }
      }
    };

    rec.start();
    this.recognition = rec;
  }

  /**
   * Detiene reconocimiento de voz.
   * Los handlers se anulan ANTES de llamar a stop() para que onend no
   * intente reiniciar la instancia y no queden callbacks activos que
   * contaminen la siguiente sesión.
   */
  detenerReconocimiento() {
    if (this.recognition) {
      this.recognition.onresult = null;
      this.recognition.onerror = null;
      this.recognition.onend = null;
      this.recognition.stop();
      this.recognition = null;
      this.transcripcionInterim.set('');
    }
  }

  /**
   * Inicia el análisis de audio: RMS, silencio/actividad, y detección de tono.
   */
  iniciarAnalisisAudio(stream: MediaStream) {
    this.audioContext = new AudioContext();
    this.analyser = this.audioContext.createAnalyser();
    this.sourceNode = this.audioContext.createMediaStreamSource(stream);

    this.sourceNode.connect(this.analyser);

    this.analyser.fftSize = 2048;
    this.datosTiempo = new Float32Array(this.analyser.fftSize);
    this.datosPitch = new Float32Array(this.analyser.fftSize);

    // Reiniciar métricas RMS
    this.muestrasAnalizadas = 0;
    this.muestrasConActividad = 0;
    this.muestrasEnSilencio = 0;
    this.sumaRms = 0;
    this.rmsPromedio.set(0);
    this.porcentajeSilencio.set(0);
    this.porcentajeActividad.set(0);

    // Reiniciar métricas de pitch
    this.framesConAudio = 0;
    this.framesConPitch = 0;
    this.ultimoAnalisisPitch = 0;
    this.notaDetectada.set('--');

    this.analisisActivo = true;

    const analizar = () => {
      if (!this.analisisActivo) return;

      this.analyser.getFloatTimeDomainData(this.datosTiempo as any);

      // RMS para métricas de actividad/silencio (lógica original)
      let sumaCuadrados = 0;
      for (let i = 0; i < this.datosTiempo.length; i++) {
        sumaCuadrados += this.datosTiempo[i] * this.datosTiempo[i];
      }
      const rms = Math.sqrt(sumaCuadrados / this.datosTiempo.length);

      this.muestrasAnalizadas++;
      this.sumaRms += rms;

      if (rms < 0.02) {
        this.muestrasEnSilencio++;
      } else {
        this.muestrasConActividad++;
      }

      // Detección de tono cada ~100ms para no saturar el hilo principal
      const ahora = performance.now();
      if (ahora - this.ultimoAnalisisPitch >= 100) {
        this.ultimoAnalisisPitch = ahora;
        this.analyser.getFloatTimeDomainData(this.datosPitch as any);
        this.procesarPitch(this.datosPitch);
      }

      this.animationFrameId = requestAnimationFrame(analizar);
    };

    analizar();
  }

  /**
   * Calcula el tono dominante en el frame actual y actualiza puntajePitch.
   * El puntaje mide qué porcentaje del audio activo tiene un tono musical claro:
   * un proxy de "qué tan afinado está cantando el usuario".
   */
  private procesarPitch(buffer: Float32Array) {
    const freq = this.detectarFrecuencia(buffer, this.audioContext.sampleRate);

    let rms = 0;
    for (let i = 0; i < buffer.length; i++) rms += buffer[i] * buffer[i];
    rms = Math.sqrt(rms / buffer.length);

    if (rms >= 0.01) {
      this.framesConAudio++;
      if (freq !== null) {
        this.framesConPitch++;
        this.notaDetectada.set(this.scoreService.hzANota(freq));
      } else {
        this.notaDetectada.set('--');
      }
    }

    const pitchScore = this.framesConAudio > 0
      ? Math.round((this.framesConPitch / this.framesConAudio) * 100)
      : 0;
    this.puntajePitch.set(pitchScore);
  }

  /**
   * Autocorrelation-based pitch detection (McLeod-style).
   * Returns the dominant frequency in Hz, or null if the signal has no clear pitch.
   * The clarity threshold (0.5) filters out noise and speech that isn't on pitch.
   */
  private detectarFrecuencia(buffer: Float32Array, sampleRate: number): number | null {
    const n = buffer.length;
    const half = n >> 1;

    let rms = 0;
    for (let i = 0; i < n; i++) rms += buffer[i] * buffer[i];
    rms = Math.sqrt(rms / n);
    if (rms < 0.01) return null;

    // Autocorrelación — O(n²/4) con n=2048 → ~500K ops, aceptable a 10 Hz
    const c = new Float32Array(half);
    for (let lag = 0; lag < half; lag++) {
      for (let j = 0; j < half; j++) {
        c[lag] += buffer[j] * buffer[j + lag];
      }
    }

    // Saltar la pendiente descendente inicial (pico en lag=0)
    let inicio = 0;
    while (inicio < half - 1 && c[inicio] > c[inicio + 1]) inicio++;

    // Buscar el máximo global tras ese primer valle
    let maxCorr = -Infinity;
    let maxLag = -1;
    for (let i = inicio; i < half; i++) {
      if (c[i] > maxCorr) {
        maxCorr = c[i];
        maxLag = i;
      }
    }

    // Descartar si la señal no tiene suficiente claridad tonal
    if (maxLag <= 0 || c[0] === 0 || maxCorr / c[0] < 0.5) return null;

    // Interpolación cuadrática para precisión sub-muestra
    if (maxLag > 0 && maxLag < half - 1) {
      const denom = 2 * c[maxLag] - c[maxLag + 1] - c[maxLag - 1];
      if (denom !== 0) {
        maxLag += (c[maxLag + 1] - c[maxLag - 1]) / (2 * denom);
      }
    }

    return sampleRate / maxLag;
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

      this.rmsPromedio.set(Number(rms.toFixed(4)));
      this.porcentajeSilencio.set(Number(silencio.toFixed(2)));
      this.porcentajeActividad.set(Number(actividad.toFixed(2)));
    }

    if (this.audioContext) {
      this.audioContext.close();
    }

    console.log('RMS promedio:', this.rmsPromedio());
    console.log('Porcentaje de silencio:', this.porcentajeSilencio());
    console.log('Porcentaje de actividad:', this.porcentajeActividad());
  }

  /**
   * Inicia la grabación del micrófono y la transcripción.
   */
  async iniciarGrabacion() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    this.mediaRecorder = new MediaRecorder(stream);
    this.audioChunks = [];

    // Reiniciar todos los estados de la práctica anterior
    this.transcripcionVoz.set('');
    this.transcripcionInterim.set('');
    this.duracionAudio.set(0);
    this.audioBlob.set(null);
    this.audioUrl.set(null);
    this.practicaCreada.set(null);
    this.practicaEvaluada.set(null);
    this.resultadoFinal.set(null);
    this.puntajePitch.set(0);
    this.puntajeLetra.set(0);
    this.speechSinSoporte.set(false);

    this.tiempoInicioGrabacion = Date.now();

    this.iniciarReconocimiento();
    this.iniciarAnalisisAudio(stream);

    // Enviar actualización de puntaje cada 5 segundos
    this.intervaloScore = setInterval(async () => {
      await this.scoreService.actualizarPuntaje({
        songId: this.idCancionPrueba,
        userId: this.idUsuarioPrueba,
        pitchScore: this.puntajePitch(),
        lyricsScore: this.puntajeLetra(),
        timestamp: Date.now()
      });
    }, 5000);

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        this.audioChunks.push(event.data);
      }
    };

    this.mediaRecorder.onstop = async () => {
      const blobFinal = new Blob(this.audioChunks, { type: 'audio/webm' });
      this.audioBlob.set(blobFinal);

      const tiempoFinGrabacion = Date.now();
      const duracionSegundos = Math.round(
        (tiempoFinGrabacion - this.tiempoInicioGrabacion) / 1000
      );
      this.duracionAudio.set(duracionSegundos);

      console.log('Audio grabado:', this.audioBlob());
      console.log('Duración del audio:', this.duracionAudio());
      console.log('Transcripción capturada:', this.transcripcionVoz());

      // Score runs first — independent of storage/DB availability
      await this.calcularYEnviarPuntajeFinal();

      // Upload and AI evaluation require Supabase storage + Edge Function
      await this.subirAudioGrabado();
    };

    this.mediaRecorder.start();
    this.grabando.set(true);
  }

  /**
   * Detiene grabación, reconocimiento, análisis e intervalo de score.
   */
  detenerGrabacion() {
    if (this.mediaRecorder && this.grabando()) {
      this.mediaRecorder.stop();
      this.grabando.set(false);
      this.detenerReconocimiento();
      this.detenerAnalisisAudio();
    }

    if (this.intervaloScore) {
      clearInterval(this.intervaloScore);
      this.intervaloScore = null;
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
    }
  }

  /**
   * Crea la práctica en la base de datos.
   */
  async crearPractica() {
    try {
      if (!this.audioUrl()) {
        console.warn('No existe URL del audio todavía.');
        return;
      }

      const practica = await this.practicaService.crearPractica({
        id_usuario: this.idUsuarioPrueba,
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
   * Independientemente del resultado, siempre calcula y persiste el puntaje de score.
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
        porcentajeActividad: this.porcentajeActividad()
      });

      const practicaActualizada =
        await this.practicaService.actualizarResultadoPractica(
          this.practicaCreada()!.id,
          {
            puntaje: resultadoEvaluacion.puntaje,
            feedback: resultadoEvaluacion.feedback,
            transcripcion: resultadoEvaluacion.transcripcion,
            id_estado: this.idEstadoPracticaFinalizada
          }
        );

      this.practicaEvaluada.set(practicaActualizada);
      console.log('Práctica evaluada correctamente:', practicaActualizada);

    } catch (error) {
      console.error('Error al evaluar la práctica:', error);
    }
  }

  /**
   * Calcula el puntaje de letra usando Levenshtein, luego llama al backend
   * para persistir y obtener el puntaje final consolidado.
   * Si el backend no está disponible, calcula el resultado localmente.
   */
  private async calcularYEnviarPuntajeFinal() {
    const cancion = this.cancionSeleccionada();
    const letra = cancion?.letra ?? '';
    const transcripcion = this.transcripcionVoz();

    // ── Pitch score: quality × √coverage ────────────────────────────────────
    // quality  = what % of frames where the user was singing had a clear pitch
    // coverage = what fraction of the total song duration was recorded (0–1)
    //
    // √coverage gives a gentler curve than raw coverage so rookies are not
    // unfairly penalised for short sessions:
    //   25 % of song → √0.25 = 0.50 multiplier  (raw would be 0.25)
    //   50 % of song → √0.50 ≈ 0.71 multiplier  (raw would be 0.50)
    //  100 % of song → √1.00 = 1.00 multiplier  (same either way)
    const pitchQuality = this.framesConAudio > 0
      ? (this.framesConPitch / this.framesConAudio) * 100
      : 0;

    const duracionEsperada = cancion?.duracion ?? 0;
    const coverage = duracionEsperada > 0
      ? Math.min(this.duracionAudio() / duracionEsperada, 1)
      : 1;

    const pitchScoreFinal = Math.min(
      Math.round(pitchQuality * Math.sqrt(coverage)),
      100
    );

    // Overwrite the signal so the result panel shows the normalised value
    this.puntajePitch.set(pitchScoreFinal);

    // ── Lyrics score ────────────────────────────────────────────────────────
    // Levenshtein against the full letra already penalises short performances:
    // singing 20 s of a 4-min song means a very small transcript vs. the full
    // text, so the edit distance is large and the score is proportionally low.
    const lyricsScore = this.scoreService.calcularPuntajeLetra(transcripcion, letra);
    this.puntajeLetra.set(lyricsScore);

    const resultado = await this.scoreService.finalizarPuntaje({
      songId: this.idCancionPrueba,
      userId: this.idUsuarioPrueba,
      finalPitchScore: pitchScoreFinal,
      finalLyricsScore: lyricsScore
    });

    if (resultado) {
      this.resultadoFinal.set(resultado);
    } else {
      // Fallback local si el backend no está disponible
      const finalScore =
        Math.round((pitchScoreFinal * 0.6 + lyricsScore * 0.4) * 100) / 100;
      this.resultadoFinal.set({
        finalScore,
        pitchScore: pitchScoreFinal,
        lyricsScore,
        label: this.scoreService.calcularEtiqueta(finalScore)
      });
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
}
