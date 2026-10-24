// Cached shared AudioContext for reliable playback across gestures
let sharedAudioCtx = null;

function getAudioContext() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
      sharedAudioCtx = new AudioCtx();
    }
    if (sharedAudioCtx.state === 'suspended') {
      sharedAudioCtx.resume().catch(() => {});
    }
    return sharedAudioCtx;
  } catch {
    return null;
  }
}

// Unlock audio on initial user interaction anywhere on the window
if (typeof window !== 'undefined') {
  const unlockAudio = () => {
    getAudioContext();
    window.removeEventListener('click', unlockAudio);
    window.removeEventListener('keydown', unlockAudio);
    window.removeEventListener('touchstart', unlockAudio);
  };
  window.addEventListener('click', unlockAudio, { passive: true });
  window.addEventListener('keydown', unlockAudio, { passive: true });
  window.addEventListener('touchstart', unlockAudio, { passive: true });
}

/**
 * Medical Audio Chime synthesizer using Web Audio API
 * Plays a soft, harmonious two-tone medical notification (D5 -> A5)
 */
export function playMedicalChime() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const t = ctx.currentTime;

    // First tone (587.33 Hz - D5)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, t);
    gain1.gain.setValueAtTime(0.2, t);
    gain1.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(t);
    osc1.stop(t + 0.38);

    // Second tone (880.00 Hz - A5)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(880.0, t + 0.2);
    gain2.gain.setValueAtTime(0.25, t + 0.2);
    gain2.gain.exponentialRampToValueAtTime(0.001, t + 0.75);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(t + 0.2);
    osc2.stop(t + 0.75);
  } catch (e) {
    console.warn('Audio chime playback error:', e);
  }
}

/**
 * Triggers browser system notification if permitted
 */
export async function triggerBrowserNotification(title, body) {
  playMedicalChime();

  if (typeof window === 'undefined' || !('Notification' in window)) return;

  try {
    if (Notification.permission === 'granted') {
      // Prefer ServiceWorker showNotification if available (standard on Android/mobile Chrome)
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        try {
          const reg = await navigator.serviceWorker.ready;
          if (reg && reg.showNotification) {
            reg.showNotification(title, {
              body,
              icon: 'https://cdn-icons-png.flaticon.com/512/2966/2966327.png',
              badge: 'https://cdn-icons-png.flaticon.com/512/2966/2966327.png'
            });
            return;
          }
        } catch {}
      }

      new Notification(title, {
        body,
        icon: 'https://cdn-icons-png.flaticon.com/512/2966/2966327.png'
      });
    } else if (Notification.permission === 'default') {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        new Notification(title, {
          body,
          icon: 'https://cdn-icons-png.flaticon.com/512/2966/2966327.png'
        });
      }
    }
  } catch (err) {
    console.warn('Browser notification failed:', err);
  }
}
