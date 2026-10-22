/** Notifiche sul telefono (web push): solo per il titolare, attivabili da Impostazioni → Backup. */
import * as api from './api';

export type StatoPush = 'non_supportate' | 'da_installare' | 'bloccate' | 'attive' | 'spente' | 'non_pronte';

const iOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const installata = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

async function iscrizione() {
  const reg = await navigator.serviceWorker?.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

export async function statoPush(): Promise<StatoPush> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return iOS() && !installata() ? 'da_installare' : 'non_supportate';
  }
  if (Notification.permission === 'denied') return 'bloccate';
  return (await iscrizione()) ? 'attive' : 'spente';
}

const b64url = (b: string) => {
  const s = atob((b + '='.repeat((4 - (b.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};
const nomeDispositivo = () => {
  const ua = navigator.userAgent;
  return /iphone/i.test(ua) ? 'iPhone' : /ipad/i.test(ua) ? 'iPad' : /android/i.test(ua) ? 'Android' : /mac/i.test(ua) ? 'Mac' : /windows/i.test(ua) ? 'Windows' : 'Computer';
};

/** Chiede il permesso (va chiamata dal tocco di un bottone) e registra il dispositivo. */
export async function attivaPush(): Promise<StatoPush> {
  const chiave = await api.chiavePushPubblica();
  if (!chiave) return 'non_pronte';
  if ((await Notification.requestPermission()) !== 'granted') return 'bloccate';
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64url(chiave) });
  const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await api.salvaIscrizionePush(j.endpoint, j.keys.p256dh, j.keys.auth, nomeDispositivo());
  return 'attive';
}

export async function disattivaPush(): Promise<StatoPush> {
  const sub = await iscrizione();
  if (sub) { await api.togliIscrizionePush(sub.endpoint).catch(() => {}); await sub.unsubscribe(); }
  return 'spente';
}
