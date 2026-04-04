import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StorageService } from '../../services/storage.service';
import { PracticaService } from '../../services/practica.service';
import { EvaluacionService } from '../../services/evaluacion.service';
import { OnInit } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { CancionService } from '../../services/cancion.service';


// Declaramos la API de reconocimiento de voz del navegador.
// Esto permite usar webkitSpeechRecognition en TypeScript.
declare var webkitSpeechRecognition: any;

@Component({
  selector: 'app-practica',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './practica.page.html',
  styleUrl: './practica.page.css'
})
export class PracticaPage implements OnInit{

  /**
   * Tiempo en el que comienza la grabación.
   * Lo usamos para calcular cuántos segundos duró la interpretación.
   */
  tiempoInicioGrabacion = 0;

  /**
   * Duración total del audio en segundos.
   * Esta métrica la enviaremos a la Edge Function
   * para ayudar a evaluar qué tan completa fue la interpretación.
   */
  duracionAudio = signal(0);

  /**
   * Grabador de audio del navegador.
   */
  mediaRecorder!: MediaRecorder;

  /**
   * Reconocimiento de voz del navegador.
   * Se usa para obtener una transcripción real sin pagar API.
   */
  recognition: any;

  /**
   * Fragmentos del audio que se van capturando mientras se graba.
   */
  audioChunks: Blob[] = [];

  /**
   * Estado reactivo del componente.
   */
  audioBlob = signal<Blob | null>(null);
  grabando = signal(false);
  audioUrl = signal<string | null>(null);
  practicaCreada = signal<any | null>(null);
  practicaEvaluada = signal<any | null>(null);
  /**
 * Lista de canciones disponibles
 */
  canciones = signal<any[]>([]);

/**
 * Canción seleccionada actualmente
 */
  cancionSeleccionada = signal<any | null>(null);

/**
 * URL segura para mostrar el video en un iframe
 */
  videoUrl = signal<SafeResourceUrl | null>(null);

  /**
   * Aquí guardamos la transcripción obtenida por reconocimiento de voz.
   */
  transcripcionVoz = signal<string>('');

  /**
   * IDs temporales para pruebas.
   * Más adelante estos valores deberán venir:
   * - del usuario autenticado
   * - de la canción seleccionada
   * - de los estados reales consultados en base de datos
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
  private sanitizer: DomSanitizer
  ) {}

  /**
 * Cuando la pantalla carga, consultamos todas las canciones
 * y seleccionamos la primera por defecto.
 */
async ngOnInit() {
  try {
    const listaCanciones = await this.cancionService.obtenerCanciones();
    this.canciones.set(listaCanciones ?? []);

    // Si existe al menos una canción, seleccionamos la primera automáticamente
    if (this.canciones().length > 0) {
      await this.seleccionarCancion(this.canciones()[0].id);
    }

  } catch (error) {
    console.error('Error al cargar canciones:', error);
  }
}

/**
 * Carga una canción específica y prepara su video.
 */
async seleccionarCancion(idCancion: number) {
  try {
    const cancion = await this.cancionService.obtenerCancionPorId(idCancion);

    this.cancionSeleccionada.set(cancion);
    this.idCancionPrueba = cancion.id;

    /**
     * En tu base el link de YouTube está en url_audio.
     * Lo convertimos a formato embed para poder mostrarlo en iframe.
     */
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
 * Convierte diferentes formatos de URL de YouTube
 * a formato embed para poder mostrarlos dentro de un iframe.
 *
 * Ejemplos:
 * - https://youtu.be/SrxAV2du67M
 * - https://www.youtube.com/watch?v=SrxAV2du67M
 * - https://www.youtube.com/embed/SrxAV2du67M
 */
convertirYoutubeAEmbed(url: string): string | null {
  if (!url) return null;

  // Caso 1: ya viene en formato embed
  if (url.includes('youtube.com/embed/')) {
    return url;
  }

  // Caso 2: formato corto youtu.be
  if (url.includes('youtu.be/')) {
    const partes = url.split('youtu.be/');
    const idVideo = partes[1]?.split('?')[0];
    return idVideo ? `https://www.youtube.com/embed/${idVideo}` : null;
  }

  // Caso 3: formato clásico watch?v=
  if (url.includes('watch?v=')) {
    const partes = url.split('watch?v=');
    const idVideo = partes[1]?.split('&')[0];
    return idVideo ? `https://www.youtube.com/embed/${idVideo}` : null;
  }

  // Si no reconocemos el formato, devolvemos null
  return null;
 }
  /**
   * Inicia el reconocimiento de voz del navegador.
   *
   * Esto NO reemplaza la grabación del audio.
   * Solamente intenta convertir la voz detectada en texto.
   */
  iniciarReconocimiento() {
    this.recognition = new webkitSpeechRecognition();

    // Idioma de reconocimiento
    this.recognition.lang = 'es-ES';

    // Queremos que siga escuchando mientras el usuario canta
    this.recognition.continuous = true;

    // No usamos resultados parciales "inestables"
    this.recognition.interimResults = false;

    // Cada vez que el navegador reconoce voz, la acumulamos
    this.recognition.onresult = (event: any) => {
      let textoAcumulado = this.transcripcionVoz();

      for (let i = event.resultIndex; i < event.results.length; i++) {
        textoAcumulado += ' ' + event.results[i][0].transcript;
      }

      this.transcripcionVoz.set(textoAcumulado.trim());
      console.log('Transcripción parcial/real:', this.transcripcionVoz());
    };

    // Si falla el reconocimiento, mostramos aviso en consola
    this.recognition.onerror = (event: any) => {
      console.warn('Error en reconocimiento de voz:', event.error);
    };

    this.recognition.start();
  }

  /**
   * Detiene el reconocimiento de voz.
   */
  detenerReconocimiento() {
    if (this.recognition) {
      this.recognition.stop();
    }
  }

  /**
   * Inicia la grabación del micrófono y también el reconocimiento de voz.
   */
  async iniciarGrabacion() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    this.mediaRecorder = new MediaRecorder(stream);
    this.audioChunks = [];

    // Reiniciamos estados para una nueva práctica
    this.transcripcionVoz.set('');
    this.duracionAudio.set(0);
    this.audioBlob.set(null);
    this.audioUrl.set(null);
    this.practicaCreada.set(null);
    this.practicaEvaluada.set(null);

    // Guardamos el tiempo exacto en que empezó la grabación
    this.tiempoInicioGrabacion = Date.now();

    // Empezamos reconocimiento de voz
    this.iniciarReconocimiento();

    // Capturamos fragmentos del audio
    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        this.audioChunks.push(event.data);
      }
    };

    // Cuando termina la grabación
    this.mediaRecorder.onstop = async () => {
      // Construimos el audio final
      const blobFinal = new Blob(this.audioChunks, { type: 'audio/webm' });
      this.audioBlob.set(blobFinal);

      // Calculamos duración del audio en segundos
      const tiempoFinGrabacion = Date.now();
      const duracionSegundos = Math.round(
        (tiempoFinGrabacion - this.tiempoInicioGrabacion) / 1000
      );
      this.duracionAudio.set(duracionSegundos);

      console.log('Audio grabado:', this.audioBlob());
      console.log('Duración del audio:', this.duracionAudio());
      console.log('Transcripción capturada:', this.transcripcionVoz());

      // Después de grabar, subimos el audio
      await this.subirAudioGrabado();
    };

    this.mediaRecorder.start();
    this.grabando.set(true);
  }

  /**
   * Detiene la grabación y el reconocimiento de voz.
   */
  detenerGrabacion() {
    if (this.mediaRecorder && this.grabando()) {
      this.mediaRecorder.stop();
      this.grabando.set(false);
      this.detenerReconocimiento();
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

      // Nombre único del archivo
      const fileName = `practica-${Date.now()}.webm`;

      // Convertimos el Blob a File
      const file = new File([this.audioBlob()!], fileName, {
        type: 'audio/webm'
      });

      // Ruta interna dentro del bucket
      const filePath = `audios/${fileName}`;

      // Subimos el archivo
      const publicUrl = await this.storageService.subirAudio(file, filePath);

      this.audioUrl.set(publicUrl);
      console.log('Audio subido correctamente:', publicUrl);

      // Luego creamos la práctica en BD
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

      // Después de crearla, la evaluamos
      await this.evaluarPractica();

    } catch (error) {
      console.error('Error al crear la práctica:', error);
    }
  }

  /**
   * Llama a la Edge Function para evaluar la práctica.
   *
   * Enviamos:
   * - id de la práctica
   * - transcripción capturada por el navegador
   * - duración del audio en segundos
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
        duracionAudio: this.duracionAudio()
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
}