const PRESETS = Object.freeze({
  "30x20": { width: 30, height: 20 },
  "40x25": { width: 40, height: 25 },
  "50x30": { width: 50, height: 30 },
  "60x40": { width: 60, height: 40 },
  "70x40": { width: 70, height: 40 },
  "80x50": { width: 80, height: 50 },
  "100x50": { width: 100, height: 50 },
  "100x75": { width: 100, height: 75 },
  "100x100": { width: 100, height: 100 }
});

export function getBarcodeLabelSize({ preset = "50x30", width, height } = {}) {
  if (preset !== "custom") return PRESETS[preset] || null;
  const w = Number(width), h = Number(height);
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 15 || w > 150 || h < 10 || h > 100) return null;
  return { width: w, height: h };
}
