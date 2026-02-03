
/**
 * Modern browsers aggressively throttle JavaScript timers and network requests
 * in background tabs (e.g., when the user switches windows).
 * 
 * To prevent this, we use two methods:
 * 1. "Silent Audio" hack: Browsers treat tabs playing audio as "Active Media Sessions" and give them priority.
 * 2. Screen Wake Lock API: Prevents the device from sleeping and signals activity.
 */

let audioContext: AudioContext | null = null;
let oscillator: OscillatorNode | null = null;
let wakeLock: WakeLockSentinel | null = null;

export const enableHighPerformanceMode = async () => {
  // Method 1: Screen Wake Lock
  if ('wakeLock' in navigator) {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      console.log("Screen Wake Lock active.");
    } catch (err) {
      console.warn(`Wake Lock request failed: ${err}`);
    }
  }

  // Method 2: Silent Audio
  try {
    if (!audioContext) {
      // Create context
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      audioContext = new AudioContext();
    }

    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }

    // If already playing, do nothing
    if (oscillator) return;

    // Create a silent oscillator
    oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    // Mute it completely
    gainNode.gain.setValueAtTime(0, audioContext.currentTime);

    // Connect: Oscillator -> Gain -> Destination
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    // Start
    oscillator.start();
    console.log("High Performance Mode Enabled (Background Throttling Disabled)");
  } catch (e) {
    console.warn("Could not enable High Performance Mode (Audio Context blocked).", e);
  }
};

export const disableHighPerformanceMode = () => {
  // Disable Audio
  try {
    if (oscillator) {
      oscillator.stop();
      oscillator.disconnect();
      oscillator = null;
    }
    if (audioContext) {
      audioContext.close();
      audioContext = null;
    }
  } catch (e) {
    console.error("Error disabling Audio High Performance Mode", e);
  }

  // Disable Wake Lock
  if (wakeLock) {
    wakeLock.release()
      .then(() => {
        wakeLock = null;
        console.log("Screen Wake Lock released.");
      })
      .catch(e => console.error("Error releasing wake lock", e));
  }
  
  console.log("High Performance Mode Disabled");
};
