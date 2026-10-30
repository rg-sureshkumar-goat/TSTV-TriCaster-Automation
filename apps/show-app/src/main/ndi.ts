// NDI, the network video the TC1 already uses (Phase 5, decided Oct 30, 2026): the show app sends its
// graphics and music to the TC1's input 4 over the cable, and receives the TC1's camera and program feeds.
// It calls the free NDI runtime through koffi, so nothing is compiled. The runtime comes with NDI Tools
// (Mac and Windows), or the NDI runtime installer. Tested at the studio on Oct 30, 2026: docs/TC1-FINDINGS.md.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import koffi from 'koffi';

/** Where the NDI runtime can be, in order. */
function runtimeCandidates(): string[] {
  if (process.platform === 'win32') {
    const dirs = [process.env.NDI_RUNTIME_DIR_V6, process.env.NDI_RUNTIME_DIR_V5, 'C:\\Program Files\\NDI\\NDI 6 Runtime\\v6', 'C:\\Program Files\\NDI\\NDI 5 Runtime\\v5'];
    return dirs.filter((d): d is string => !!d).map((d) => path.join(d, 'Processing.NDI.Lib.x64.dll'));
  }
  const tools = ['NDI Scan Converter', 'NDI Video Monitor', 'NDI Test Patterns', 'NDI Virtual Input', 'NDI Discovery'];
  return [
    '/usr/local/lib/libndi.dylib',
    '/Library/NDI SDK for Apple/lib/macOS/libndi.dylib',
    '/Library/NDI 6 SDK/lib/macOS/libndi.dylib',
    ...tools.flatMap((app) => [`/Applications/${app}.app/Contents/Frameworks/libndi.dylib`, `/Applications/${app}.app/Contents/Frameworks/libndi_advanced.dylib`]),
  ];
}

export function findRuntime(): string | null {
  return runtimeCandidates().find((file) => existsSync(file)) ?? null;
}

/**
 * The laptop's addresses on cables like the TC1's: self-assigned ones (169.254.x.x). There can be more than
 * one (another adapter or a phone gets one too), so NDI is allowed on all of them, never on Wi-Fi.
 */
export function cableAddresses(): string[] {
  return Object.values(os.networkInterfaces())
    .flatMap((addresses) => addresses ?? [])
    .filter((a) => a.family === 'IPv4' && a.address.startsWith('169.254.'))
    .map((a) => a.address);
}

/**
 * Keeps NDI on the cable: NDI reads its settings from NDI_CONFIG_DIR, and this one allows only the cables'
 * addresses, so nothing is sent or announced on campus Wi-Fi. Call before NDI starts.
 */
export function keepNdiOnCable(folder: string, addresses: string[]): void {
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, 'ndi-config.v1.json'), JSON.stringify({ ndi: { adapters: { allowed: addresses } } }, null, 1));
  process.env.NDI_CONFIG_DIR = folder;
}

export const FOURCC_BGRA = fourcc('BGRA');
export const FOURCC_UYVY = fourcc('UYVY');

function fourcc(s: string): number {
  return s.charCodeAt(0) | (s.charCodeAt(1) << 8) | (s.charCodeAt(2) << 16) | (s.charCodeAt(3) << 24);
}

/** NDI's "no timecode": NDI fills it in. */
export const NDI_TIMECODE = 0x7fffffffffffffffn;

/** NDI receive bandwidths and colour formats (Processing.NDI.Recv.h). */
export const BANDWIDTH = { lowest: 0, highest: 100 } as const;
export const COLOR = { BGRX_BGRA: 0, fastest: 100 } as const;
export const FRAME = { none: 0, video: 1, audio: 2, metadata: 3, error: 4 } as const;

/** The NDI runtime's functions this app uses (NDI 5 and 6 share them). */
export function loadNdi(file = findRuntime()) {
  if (!file) {
    throw new Error('NDI isn’t installed on this laptop. Install NDI Tools (free, from ndi.video/tools), then open the show app again.');
  }
  const lib = koffi.load(file);
  const Source = koffi.struct({ p_ndi_name: 'const char *', p_url_address: 'const char *' });
  const SendCreate = koffi.struct({ p_ndi_name: 'const char *', p_groups: 'const char *', clock_video: 'bool', clock_audio: 'bool' });
  const FindCreate = koffi.struct({ show_local_sources: 'bool', p_groups: 'const char *', p_extra_ips: 'const char *' });
  const Video = koffi.struct({
    xres: 'int',
    yres: 'int',
    FourCC: 'uint32_t',
    frame_rate_N: 'int',
    frame_rate_D: 'int',
    picture_aspect_ratio: 'float',
    frame_format_type: 'int',
    timecode: 'int64_t',
    p_data: 'void *',
    line_stride_in_bytes: 'int',
    p_metadata: 'const char *',
    timestamp: 'int64_t',
  });
  const Audio = koffi.struct({ sample_rate: 'int', no_channels: 'int', no_samples: 'int', timecode: 'int64_t', p_data: 'void *', channel_stride_in_bytes: 'int', p_metadata: 'const char *', timestamp: 'int64_t' });
  const AudioInterleaved = koffi.struct({ sample_rate: 'int', no_channels: 'int', no_samples: 'int', timecode: 'int64_t', p_data: 'void *' });
  const RecvCreate = koffi.struct({ source_to_connect_to: Source, color_format: 'int', bandwidth: 'int', allow_video_fields: 'bool', p_ndi_recv_name: 'const char *' });
  const ptr = (t: unknown) => koffi.pointer(t as never);
  const ndi = {
    koffi,
    Source,
    Video,
    Audio,
    initialize: lib.func('NDIlib_initialize', 'bool', []),
    sendCreate: lib.func('NDIlib_send_create', 'void *', [ptr(SendCreate)]),
    sendDestroy: lib.func('NDIlib_send_destroy', 'void', ['void *']),
    sendVideo: lib.func('NDIlib_send_send_video_v2', 'void', ['void *', ptr(Video)]),
    sendAudioInterleaved: lib.func('NDIlib_util_send_send_audio_interleaved_32f', 'void', ['void *', ptr(AudioInterleaved)]),
    sendConnections: lib.func('NDIlib_send_get_no_connections', 'int', ['void *', 'uint32_t']),
    findCreate: lib.func('NDIlib_find_create_v2', 'void *', [ptr(FindCreate)]),
    findDestroy: lib.func('NDIlib_find_destroy', 'void', ['void *']),
    findWait: lib.func('NDIlib_find_wait_for_sources', 'bool', ['void *', 'uint32_t']),
    findSources: lib.func('NDIlib_find_get_current_sources', ptr(Source), ['void *', koffi.out(koffi.pointer('uint32_t'))]),
    recvCreate: lib.func('NDIlib_recv_create_v3', 'void *', [ptr(RecvCreate)]),
    recvDestroy: lib.func('NDIlib_recv_destroy', 'void', ['void *']),
    // Frames are read into raw buffers (see videoBuffer), so nothing but the few numbers needed is copied.
    recvCapture: lib.func('NDIlib_recv_capture_v2', 'int', ['void *', 'void *', 'void *', 'void *', 'uint32_t']),
    recvFreeVideo: lib.func('NDIlib_recv_free_video_v2', 'void', ['void *', 'void *']),
    recvFreeAudio: lib.func('NDIlib_recv_free_audio_v2', 'void', ['void *', 'void *']),
  };
  if (!ndi.initialize()) throw new Error('NDI couldn’t start on this laptop (its processor may be too old for NDI).');
  return ndi;
}

export type Ndi = ReturnType<typeof loadNdi>;

const byteArrays = new Map<number, unknown>();

/**
 * A copy of `length` bytes from NDI's memory. (koffi can also point straight at it, but Electron forbids
 * that and stops the whole app: found at the studio, Oct 30, 2026.)
 */
export function copyBytes(ndi: Ndi, pointer: unknown, length: number): Buffer {
  let type = byteArrays.get(length);
  if (!type) {
    type = ndi.koffi.array('uint8_t', length, 'Typed');
    byteArrays.set(length, type);
  }
  const bytes = ndi.koffi.decode(pointer as never, type as never) as Uint8Array;
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** NDI's sound (one block per channel, with spare room after each) as floats, the first `channels` channels interleaved. */
export function copySound(ndi: Ndi, a: { p_data: unknown; no_samples: number; no_channels: number; channel_stride_in_bytes: number }, channels = 2): Float32Array {
  const bytes = copyBytes(ndi, a.p_data, a.channel_stride_in_bytes * a.no_channels);
  const all = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  const per = a.channel_stride_in_bytes / 4;
  const out = new Float32Array(a.no_samples * channels);
  for (let i = 0; i < a.no_samples; i++) for (let c = 0; c < channels; c++) out[i * channels + c] = all[Math.min(c, a.no_channels - 1) * per + i];
  return out;
}

/** A buffer NDI fills with a video frame's details, and how to read them. */
export function videoBuffer(ndi: Ndi) {
  const buffer = Buffer.alloc(ndi.koffi.sizeof(ndi.Video));
  return { buffer, read: () => ndi.koffi.decode(buffer, ndi.Video) as { xres: number; yres: number; FourCC: number; frame_rate_N: number; frame_rate_D: number; p_data: unknown; line_stride_in_bytes: number } };
}

export function audioBuffer(ndi: Ndi) {
  const buffer = Buffer.alloc(ndi.koffi.sizeof(ndi.Audio));
  return { buffer, read: () => ndi.koffi.decode(buffer, ndi.Audio) as { sample_rate: number; no_channels: number; no_samples: number; p_data: unknown; channel_stride_in_bytes: number } };
}

/** The NDI sources on the network right now, by name, with their addresses. */
export function listSources(ndi: Ndi, finder: unknown): { p_ndi_name: string; p_url_address: string }[] {
  const count = [0];
  const list = ndi.findSources(finder, count);
  return list && count[0] ? (ndi.koffi.decode(list, ndi.koffi.array(ndi.Source, count[0])) as { p_ndi_name: string; p_url_address: string }[]) : [];
}
