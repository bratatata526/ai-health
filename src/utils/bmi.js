function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export function normalizeBodyMetrics({ heightCm, weightKg }) {
  const normalizedHeight = toNumber(heightCm);
  const normalizedWeight = toNumber(weightKg);

  return {
    heightCm:
      normalizedHeight !== null && normalizedHeight >= 50 && normalizedHeight <= 250
        ? Number(normalizedHeight.toFixed(1))
        : null,
    weightKg:
      normalizedWeight !== null && normalizedWeight >= 20 && normalizedWeight <= 300
        ? Number(normalizedWeight.toFixed(1))
        : null,
  };
}

export function computeBmi(heightCm, weightKg) {
  const normalized = normalizeBodyMetrics({ heightCm, weightKg });
  if (normalized.heightCm === null || normalized.weightKg === null) {
    return null;
  }

  const heightM = normalized.heightCm / 100;
  const rawBmi = normalized.weightKg / (heightM * heightM);
  if (!Number.isFinite(rawBmi) || rawBmi <= 0) return null;

  return {
    value: Number(rawBmi.toFixed(1)),
  };
}

