let annotations = [];
let listeners = [];

export function getAnnotations() {
  return [...annotations];
}

export function getAnnotationsForPage(page) {
  return annotations.filter((a) => a.page === page);
}

export function addAnnotation(annotation) {
  const ann = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    ...annotation,
  };
  annotations.push(ann);
  notify();
  return ann;
}

export function removeAnnotation(id) {
  annotations = annotations.filter((a) => a.id !== id);
  notify();
}

export function updateAnnotation(id, updates) {
  const idx = annotations.findIndex((a) => a.id === id);
  if (idx !== -1) {
    annotations[idx] = { ...annotations[idx], ...updates };
    notify();
  }
}

export function clearAnnotations() {
  annotations = [];
  notify();
}

export function onAnnotationsChange(callback) {
  listeners.push(callback);
  return () => {
    listeners = listeners.filter((l) => l !== callback);
  };
}

function notify() {
  for (const listener of listeners) {
    listener(getAnnotations());
  }
}

export function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return { r: 1, g: 1, b: 0 };
  return {
    r: parseInt(result[1], 16) / 255,
    g: parseInt(result[2], 16) / 255,
    b: parseInt(result[3], 16) / 255,
  };
}
