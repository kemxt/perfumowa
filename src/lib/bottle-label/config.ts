import defaults from './defaults.json';

/**
 * Kalibracja etykiety względem zdjęcia flakonu. Wszystkie pozycje są
 * znormalizowane do wymiarów zdjęcia (0–1), więc nie zależą od rozmiaru na ekranie.
 * Wartości per produkt trzymamy w products.json → labelConfig (nadpisują domyślne).
 */
export interface LabelConfig {
  /** Górna krawędź etykiety (0 = góra zdjęcia, 1 = dół). */
  CYL_TOP: number;
  /** Dolna krawędź etykiety. */
  CYL_BOT: number;
  /** Średnica walca jako ułamek szerokości zdjęcia. */
  CYL_WIDTH: number;
  /** Środek walca w poziomie (0.5 = środek zdjęcia). */
  CYL_X: number;
  /** Głębokość krzywizny: 0 = płaska płaszczyzna, 1 = pełny walec, <1 = flakon owalny. */
  CURV: number;
  /** Pochylenie walca w stopniach (widok lekko z góry → „uśmiech” krawędzi). */
  TILT: number;
  /** Widoczny łuk w stopniach (180 = przednia połowa). */
  ARC: number;
  /** Przerwa między końcami etykiety jako ułamek obwodu. */
  GAP: number;
  /** Pozycja SpotLight w jednostkach sceny (wysokość zdjęcia = 1). Ujemne X = z lewej. */
  LIGHT_X: number;
  LIGHT_Y: number;
  LIGHT_Z: number;
  /** Natężenie SpotLight. */
  LIGHT_INT: number;
  /** Natężenie AmbientLight. */
  AMBIENT: number;
  /** Chropowatość papieru (MeshStandardMaterial.roughness). */
  ROUGHNESS: number;
  /** Jasność pasa odblasku na szkle. */
  GLINT_INT: number;
  /** Szerokość pasa odblasku (ułamek obwodu). */
  GLINT_WIDTH: number;
  /** Prędkość odblasku względem etykiety (kierunek przeciwny). */
  GLINT_SPEED: number;
  /** Pozycja odblasku w spoczynku (ułamek obwodu, 0 = środek). */
  GLINT_POS: number;
  /** O ile odblask wystaje ponad/pod etykietę (ułamek wysokości zdjęcia). */
  GLINT_PAD: number;
}

export const DEFAULT_LABEL_CONFIG: Readonly<LabelConfig> = Object.freeze({ ...defaults });

export function resolveLabelConfig(partial: Partial<LabelConfig> = {}): LabelConfig {
  return { ...DEFAULT_LABEL_CONFIG, ...partial };
}

/** Zakresy suwaków w panelu debug: [min, max, step]. */
export const LABEL_CONFIG_RANGES: Record<keyof LabelConfig, [number, number, number]> = {
  CYL_TOP: [0, 1, 0.001],
  CYL_BOT: [0, 1, 0.001],
  CYL_WIDTH: [0.05, 1, 0.001],
  CYL_X: [0, 1, 0.001],
  CURV: [0, 1.5, 0.01],
  TILT: [-15, 15, 0.1],
  ARC: [30, 200, 1],
  GAP: [0, 0.6, 0.005],
  LIGHT_X: [-6, 6, 0.05],
  LIGHT_Y: [-6, 6, 0.05],
  LIGHT_Z: [0.5, 8, 0.05],
  LIGHT_INT: [0, 8, 0.05],
  AMBIENT: [0, 5, 0.05],
  ROUGHNESS: [0, 1, 0.01],
  GLINT_INT: [0, 2, 0.01],
  GLINT_WIDTH: [0.003, 0.2, 0.001],
  GLINT_SPEED: [0, 3, 0.05],
  GLINT_POS: [-0.5, 0.5, 0.005],
  GLINT_PAD: [0, 0.3, 0.005],
};
