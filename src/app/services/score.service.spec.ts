import { TestBed } from '@angular/core/testing';
import { ScoreService } from './score.service';

describe('ScoreService', () => {
  let service: ScoreService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ScoreService);
  });

  it('debería crearse correctamente', () => {
    expect(service).toBeTruthy();
  });

  describe('hzANota', () => {
    it('convierte 440 Hz a A4', () => {
      expect(service.hzANota(440)).toBe('A4');
    });

    it('convierte 261.63 Hz a C4', () => {
      expect(service.hzANota(261.63)).toBe('C4');
    });

    it('convierte 880 Hz a A5', () => {
      expect(service.hzANota(880)).toBe('A5');
    });

    it('retorna -- para frecuencia cero o negativa', () => {
      expect(service.hzANota(0)).toBe('--');
      expect(service.hzANota(-1)).toBe('--');
    });
  });

  describe('calcularPuntajeLetra', () => {
    it('retorna 100 cuando la transcripción y la letra son idénticas', () => {
      expect(service.calcularPuntajeLetra('hola mundo', 'hola mundo')).toBe(100);
    });

    it('retorna 0 cuando la transcripción está vacía', () => {
      expect(service.calcularPuntajeLetra('', 'hola mundo')).toBe(0);
    });

    it('retorna 0 cuando la letra está vacía', () => {
      expect(service.calcularPuntajeLetra('hola mundo', '')).toBe(0);
    });

    it('retorna un puntaje parcial cuando hay diferencias', () => {
      const puntaje = service.calcularPuntajeLetra('hola mundo', 'hola el mundo');
      expect(puntaje).toBeGreaterThan(0);
      expect(puntaje).toBeLessThan(100);
    });

    it('ignora diferencias de mayúsculas y puntuación', () => {
      expect(service.calcularPuntajeLetra('Hola, Mundo!', 'hola mundo')).toBe(100);
    });

    it('retorna un valor entre 0 y 100', () => {
      const puntaje = service.calcularPuntajeLetra('texto completamente diferente', 'abc def ghi');
      expect(puntaje).toBeGreaterThanOrEqual(0);
      expect(puntaje).toBeLessThanOrEqual(100);
    });
  });

  describe('calcularEtiqueta', () => {
    it('retorna "Perfect!" para puntaje >= 90', () => {
      expect(service.calcularEtiqueta(90)).toBe('Perfect!');
      expect(service.calcularEtiqueta(100)).toBe('Perfect!');
      expect(service.calcularEtiqueta(95)).toBe('Perfect!');
    });

    it('retorna "Great!" para puntaje entre 70 y 89', () => {
      expect(service.calcularEtiqueta(70)).toBe('Great!');
      expect(service.calcularEtiqueta(89)).toBe('Great!');
      expect(service.calcularEtiqueta(80)).toBe('Great!');
    });

    it('retorna "Good" para puntaje entre 50 y 69', () => {
      expect(service.calcularEtiqueta(50)).toBe('Good');
      expect(service.calcularEtiqueta(69)).toBe('Good');
      expect(service.calcularEtiqueta(60)).toBe('Good');
    });

    it('retorna "Keep practicing" para puntaje menor a 50', () => {
      expect(service.calcularEtiqueta(49)).toBe('Keep practicing');
      expect(service.calcularEtiqueta(0)).toBe('Keep practicing');
      expect(service.calcularEtiqueta(25)).toBe('Keep practicing');
    });
  });
});
