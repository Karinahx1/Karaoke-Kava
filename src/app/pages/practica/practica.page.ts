import { Component, OnInit, signal } from '@angular/core';
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
  transcripcionVoz = signal<string>('');
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
  sumaRms = 0;

  /**
   * Resultados finales del análisis de audio.
   */
  rmsPromedio = signal(0);
  porcentajeSilencio = signal(0);
  porcentajeActividad = signal(0);

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
   */
  iniciarReconocimiento() {
    this.recognition = new webkitSpeechRecognition();

    this.recognition.lang = 'es-ES';
    this.recognition.continuous = true;
    this.recognition.interimResults = false;

    this.recognition.onresult = (event: any) => {
      let textoAcumulado = this.transcripcionVoz();

      for (let i = event.resultIndex; i < event.results.length; i++) {
        textoAcumulado += ' ' + event.results[i][0].transcript;
      }

      this.transcripcionVoz.set(textoAcumulado.trim());
      console.log('Transcripción parcial/real:', this.transcripcionVoz());
    };

    this.recognition.onerror = (event: any) => {
      console.warn('Error en reconocimiento de voz:', event.error);
    };

    this.recognition.start();
  }

  /**
   * Detiene reconocimiento de voz.
   */
  detenerReconocimiento() {
    if (this.recognition) {
      this.recognition.stop();
    }
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
    this.sumaRms = 0;

    this.rmsPromedio.set(0);
    this.porcentajeSilencio.set(0);
    this.porcentajeActividad.set(0);

    this.analisisActivo = true;

    const analizar = () => {
      if (!this.analisisActivo) return;

      this.analyser.getFloatTimeDomainData(this.datosTiempo as any);

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

      this.animationFrameId = requestAnimationFrame(analizar);
    };

    analizar();
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

    // Reiniciar estados de una nueva práctica
    this.transcripcionVoz.set('');
    this.duracionAudio.set(0);
    this.audioBlob.set(null);
    this.audioUrl.set(null);
    this.practicaCreada.set(null);
    this.practicaEvaluada.set(null);

    this.tiempoInicioGrabacion = Date.now();

    this.iniciarReconocimiento();
    this.iniciarAnalisisAudio(stream);

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