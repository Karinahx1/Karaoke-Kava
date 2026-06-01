import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';

export type ResultadoFinal = {
  finalScore: number;
  pitchScore: number;
  lyricsScore: number;
  label: string;
};

@Injectable({
  providedIn: 'root'
})
export class ScoreService {

  private readonly baseUrl = environment.apiUrl;

  async actualizarPuntaje(data: {
    songId: number;
    userId: number;
    pitchScore: number;
    lyricsScore: number;
    timestamp: number;
  }): Promise<void> {
    await this.fetchConReintento(`${this.baseUrl}/api/score/update`, data);
  }

  async finalizarPuntaje(data: {
    songId: number;
    userId: number;
    finalPitchScore: number;
    finalLyricsScore: number;
  }): Promise<ResultadoFinal | null> {
    return this.fetchConReintento(`${this.baseUrl}/api/score/finalize`, data);
  }

  calcularPuntajeLetra(transcripcion: string, letra: string): number {
    const normalizar = (s: string) =>
      s.toLowerCase()
        .replace(/[^\w\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    const a = normalizar(transcripcion);
    const b = normalizar(letra);

    if (!a || !b) return 0;

    const dist = this.levenshtein(a, b);
    return Math.max(0, Math.round((1 - dist / Math.max(a.length, b.length)) * 100));
  }

  hzANota(freq: number): string {
    if (freq <= 0) return '--';
    const midiNum = Math.round(12 * Math.log2(freq / 440) + 69);
    const notas = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const nota = notas[((midiNum % 12) + 12) % 12];
    const octava = Math.floor(midiNum / 12) - 1;
    return `${nota}${octava}`;
  }

  calcularEtiqueta(puntaje: number): string {
    if (puntaje >= 75) return 'Perfect!';
    if (puntaje >= 55) return 'Great!';
    if (puntaje >= 35) return 'Good';
    return 'Keep practicing';
  }

  private levenshtein(a: string, b: string): number {
    const m = a.length;
    const n = b.length;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    const curr = new Array(n + 1);

    for (let i = 1; i <= m; i++) {
      curr[0] = i;
      for (let j = 1; j <= n; j++) {
        curr[j] =
          a[i - 1] === b[j - 1]
            ? prev[j - 1]
            : 1 + Math.min(prev[j], curr[j - 1], prev[j - 1]);
      }
      prev = [...curr];
    }

    return prev[n];
  }

  private async fetchConReintento(url: string, body: object, intentos = 2): Promise<any> {
    for (let i = 0; i < intentos; i++) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const json = await response.json();
        return json.data ?? json;
      } catch {
        if (i === intentos - 1) return null;
      }
    }
  }
}
