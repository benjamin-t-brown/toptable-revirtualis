const MAX_EDGE = 4096;

export async function prepareUpload(file: File): Promise<{ blob: Blob; name: string; type: string }> {
  const fallback = { blob: file, name: file.name, type: file.type || 'application/octet-stream' };
  if (!file.type.startsWith('image/')) return fallback;
  try {
    const bitmap = await createImageBitmap(file);
    const edge = Math.max(bitmap.width, bitmap.height);
    if (edge <= MAX_EDGE) {
      bitmap.close();
      return fallback;
    }
    const scale = MAX_EDGE / edge;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      return fallback;
    }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((result) => resolve(result), 'image/jpeg', 0.9));
    if (!blob) return fallback;
    return { blob, name: file.name.replace(/\.\w+$/, '') + '.jpg', type: 'image/jpeg' };
  } catch {
    return fallback;
  }
}
