// The sound on Program, as the app plays it on the simulator: the clip on DSK 2 and the music go through
// one fader and one level meter to the laptop's speakers (RG, Oct 29, 2026). On the real TC1 (Phase 5) the
// fader will set the switcher's audio levels instead.

let path: { audio: AudioContext; fader: GainNode; meter: AnalyserNode } | null = null;

/** The sound path, made the first time it's needed. */
export function programSound() {
  if (!path) {
    const audio = new AudioContext();
    const fader = audio.createGain();
    const meter = audio.createAnalyser();
    meter.fftSize = 1024;
    fader.connect(meter).connect(audio.destination);
    // The laptop's sound takes over a second to wake for the first clip, which held that clip back. A
    // silent sound kept playing keeps it awake.
    const silent = audio.createGain();
    silent.gain.value = 0;
    const silence = audio.createOscillator();
    silence.connect(silent).connect(audio.destination);
    silence.start();
    path = { audio, fader, meter };
  }
  return path;
}

/** Sends a playing clip's or the music's sound through the fader and meter; returns how to let it go. */
export function connectSound(media: HTMLMediaElement): () => void {
  const { audio, fader } = programSound();
  const source = audio.createMediaElementSource(media);
  source.connect(fader);
  return () => source.disconnect();
}

/** The fader, from 0 (silent) to 2 (twice as loud, +6 dB). */
export function setFader(level: number): void {
  programSound().fader.gain.value = level;
}

/** How loud Program's sound is right now, after the fader, in dB (-60 when quiet, 0 at the top). */
export function soundLevel(): number {
  const { meter } = programSound();
  const samples = new Float32Array(meter.fftSize);
  meter.getFloatTimeDomainData(samples);
  let peak = 0;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  return peak > 0 ? Math.max(-60, 20 * Math.log10(peak)) : -60;
}
