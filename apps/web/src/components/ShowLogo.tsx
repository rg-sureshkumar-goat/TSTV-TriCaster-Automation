// Each show's small logo (RG, Oct 29, 2026), so shows are easy to tell apart. The browser shrinks the
// picture to 128 pixels at most before it's saved, so it stays tiny. A show without a logo shows its
// initials instead.
import { useRef, useState } from 'react';

const MAX_PIXELS = 128;

/** Shrinks a picture file to a small PNG (or WebP, if that's much smaller), as a data: URL. */
export async function shrinkLogo(file: File): Promise<string> {
  const image = await createImageBitmap(file).catch(() => {
    throw new Error('That file isn’t a picture this browser can open. Try a PNG or JPEG.');
  });
  const scale = Math.min(1, MAX_PIXELS / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
  image.close();
  const png = canvas.toDataURL('image/png');
  if (png.length < 60_000) return png;
  const webp = canvas.toDataURL('image/webp', 0.9);
  return webp.startsWith('data:image/webp') && webp.length < png.length ? webp : png;
}

export function ShowLogo({ name, logo, size = 32 }: { name: string; logo: string | null; size?: number }) {
  const style = { width: size, height: size };
  if (logo) return <img className="show-logo" src={logo} alt="" style={style} />;
  const initials = name
    .split(/\s+/)
    .filter((w) => /^[A-Za-z0-9]/.test(w))
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <span className="show-logo initials" style={{ ...style, fontSize: size * 0.38 }} aria-hidden="true">
      {initials || '•'}
    </span>
  );
}

/** Picks, previews and removes a show's logo. */
export function LogoPicker({ name, value, onChange }: { name: string; value: string | null; onChange: (logo: string | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    try {
      setError(null);
      onChange(await shrinkLogo(file));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (input.current) input.current.value = '';
    }
  };
  return (
    <div className="logo-picker">
      <ShowLogo name={name || 'Show'} logo={value} size={40} />
      <button type="button" onClick={() => input.current?.click()}>
        {value ? 'Change logo' : 'Add a logo'}
      </button>
      {value && (
        <button type="button" className="link-button" onClick={() => onChange(null)}>
          Remove logo
        </button>
      )}
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" hidden aria-label="Logo picture" onChange={(e) => pick(e.target.files?.[0])} />
      {error && <span className="error small">{error}</span>}
    </div>
  );
}
