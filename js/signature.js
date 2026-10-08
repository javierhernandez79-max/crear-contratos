// Panel de firma con el dedo, mouse o stylus.
export function createSignaturePad(canvas) {
  const ctx = canvas.getContext('2d');
  let drawing = false;
  let dirty = false;
  let last = null;

  const resize = () => {
    const ratio = window.devicePixelRatio || 1;
    const { width, height } = canvas.getBoundingClientRect();
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111827';
    dirty = false;
  };

  const point = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    drawing = true;
    last = point(e);
    ctx.beginPath();
    ctx.arc(last.x, last.y, 1.1, 0, Math.PI * 2);
    ctx.fillStyle = '#111827';
    ctx.fill();
    dirty = true;
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    const p = point(e);
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.quadraticCurveTo(last.x, last.y, (last.x + p.x) / 2, (last.y + p.y) / 2);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last = p;
  });
  const end = () => { drawing = false; };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  requestAnimationFrame(resize);

  return {
    clear: () => { ctx.clearRect(0, 0, canvas.width, canvas.height); dirty = false; },
    isEmpty: () => !dirty,
    toDataURL: () => trimmed(canvas),
  };
}

// Recorta el espacio en blanco para que la firma quede bien proporcionada en el PDF.
function trimmed(canvas) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  let minX = width, minY = height, maxX = 0, maxY = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 0) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX <= minX || maxY <= minY) return canvas.toDataURL('image/png');
  // Mantener proporción 60:22 del recuadro de firma del PDF
  const pad = 8;
  let w = maxX - minX + pad * 2;
  let h = maxY - minY + pad * 2;
  const target = 60 / 22;
  if (w / h > target) h = w / target; else w = h * target;
  const out = document.createElement('canvas');
  out.width = Math.round(w);
  out.height = Math.round(h);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  out.getContext('2d').drawImage(canvas, cx - w / 2, cy - h / 2, w, h, 0, 0, w, h);
  return out.toDataURL('image/png');
}
