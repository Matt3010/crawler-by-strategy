/**
 * Definisce il payload per una notifica.
 * Può contenere un messaggio di testo e un URL opzionale per un'immagine.
 */
export interface NotificationPayload {
  message: string;
  imageUrl?: string;
}
