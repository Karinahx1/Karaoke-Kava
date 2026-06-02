/**
 * Estados de Combate (categoría 4)
 */
export const ESTADO_COMBATE = {
  PENDIENTE: 9,      // Invitación pendiente
  EN_CURSO: 10,      // En progreso (matchmaking o jugando)
  FINALIZADO: 11     // Combate completado
};

/**
 * Estados de Ronda (categoría 5)
 */
export const ESTADO_RONDA = {
  PENDIENTE: 12,     // Ronda creada, esperando que ambos canten
  ACTIVA: 13,        // Ronda con canción asignada, jugadores cantando
  CERRADA: 14        // Ronda completada, ganador definido
};
