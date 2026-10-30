// The sound on Program, as the app plays it on the simulator: the clip on DSK 2 and the music each go
// through their own fader and level meter to the laptop's speakers (RG, Oct 29, 2026). On the real TC1
// (Phase 5) the faders will set DDR 2's and the Sound player's audio levels on the switcher instead.

export type Channel = 'clip' | 'music';

let path: { audio: AudioContext; channels: Record<Channel, { fader: GainNode; meter: AnalyserNode }> } | null = null;

/** The sound paths, made the first time they're needed. */
export function programSound() {
  if (!path) {
    const audio = new AudioContext();
    const channel = () => {
      const fader = audio.createGain();
      const meter = audio.createAnalyser();
      meter.fftSize = 1024;
      fader.connect(meter).connect(audio.destination);
      return { fader, meter };
    };
    // The laptop's sound takes over a second to wake for the first clip, which held that clip back. A
    // silent sound kept playing keeps it awake.
    const silent = audio.createGain();
    silent.gain.value = 0;
    const silence = audio.createOscillator();
    silence.connect(silent).connect(audio.destination);
    silence.start();
    path = { audio, channels: { clip: channel(), music: channel() } };
  }
  return path;
}

/** Sends a playing clip's or the music's sound through its channel's fader and meter; returns how to let it go. */
export function connectSound(media: HTMLMediaElement, channel: Channel): () => void {
  const { audio, channels } = programSound();
  const source = audio.createMediaElementSource(media);
  source.connect(channels[channel].fader);
  return () => source.disconnect();
}

/** A channel's fader, from 0 (silent) to 2 (twice as loud, +6 dB). */
export function setFader(channel: Channel, level: number): void {
  programSound().channels[channel].fader.gain.value = level;
}

/** How loud a channel is right now, after its fader, in dB (-60 when quiet, 0 at the top). */
export function soundLevel(channel: Channel): number {
  const { meter } = programSound().channels[channel];
  const samples = new Float32Array(meter.fftSize);
  meter.getFloatTimeDomainData(samples);
  let peak = 0;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  return peak > 0 ? Math.max(-60, 20 * Math.log10(peak)) : -60;
}
