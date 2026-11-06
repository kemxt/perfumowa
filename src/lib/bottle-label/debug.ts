import type { BottleLabel } from './BottleLabel';
import { DEFAULT_LABEL_CONFIG, LABEL_CONFIG_RANGES, type LabelConfig } from './config';

export function isDebugMode(): boolean {
  return new URLSearchParams(window.location.search).has('debug');
}

const GROUPS: [string, (keyof LabelConfig)[]][] = [
  ['Geometria', ['CYL_TOP', 'CYL_BOT', 'CYL_WIDTH', 'CYL_X', 'CURV', 'TILT', 'ARC', 'GAP']],
  ['Światło', ['LIGHT_X', 'LIGHT_Y', 'LIGHT_Z', 'LIGHT_INT', 'AMBIENT', 'ROUGHNESS']],
  ['Odblask', ['GLINT_INT', 'GLINT_WIDTH', 'GLINT_SPEED', 'GLINT_POS', 'GLINT_PAD']],
];

function serialize(config: LabelConfig): string {
  const rounded = Object.fromEntries(Object.entries(config).map(([k, v]) => [k, Math.round(v * 10000) / 10000]));
  return JSON.stringify(rounded, null, 2);
}

/**
 * Panel kalibracji etykiety (lil-gui, ładowany dynamicznie tylko w trybie ?debug).
 * „Kopiuj labelConfig” kopiuje gotowy obiekt do wklejenia w products.json.
 * Zwraca funkcję sprzątającą.
 */
export async function attachLabelDebug(label: BottleLabel, title: string): Promise<() => void> {
  const { default: GUI } = await import('lil-gui');
  const params: LabelConfig = { ...label.config };
  const initial = { ...params };

  const gui = new GUI({ title: `Etykieta · ${title}` });
  gui.domElement.classList.add('label-debug');
  gui.domElement.setAttribute('data-lenis-prevent', '');

  const apply = () => label.updateConfig(params);
  for (const [name, keys] of GROUPS) {
    const folder = gui.addFolder(name);
    for (const key of keys) {
      const [min, max, step] = LABEL_CONFIG_RANGES[key];
      folder.add(params, key, min, max, step).onChange(apply);
    }
  }

  let raf = 0;
  let last = 0;
  const view = {
    get offset() {
      return Math.round(label.currentOffset * 1000) / 1000;
    },
    set offset(value: number) {
      label.setOffset(value);
    },
    autoRotate: false,
    wireframe: false,
    label: true,
    glint: true,
  };
  const spin = (time: number) => {
    const dt = last ? (time - last) / 1000 : 0;
    last = time;
    label.setOffset(label.currentOffset + dt * 0.12);
    raf = requestAnimationFrame(spin);
  };

  const preview = gui.addFolder('Podgląd');
  preview.add(view, 'offset', -1, 2, 0.001).name('obrót (offset)').listen();
  preview.add(view, 'autoRotate').name('auto-obrót').onChange((on: boolean) => {
    cancelAnimationFrame(raf);
    last = 0;
    if (on) raf = requestAnimationFrame(spin);
  });
  preview.add(view, 'wireframe').name('siatka').onChange((v: boolean) => label.setDebugView({ wireframe: v }));
  preview.add(view, 'label').name('etykieta').onChange((v: boolean) => label.setDebugView({ label: v }));
  preview.add(view, 'glint').name('odblask').onChange((v: boolean) => label.setDebugView({ glint: v }));

  const refresh = () => gui.controllersRecursive().forEach((c) => c.updateDisplay());
  const actions = {
    copy: async () => {
      const json = serialize(params);
      console.info(`[labelConfig] ${title}\n${json}`);
      try {
        await navigator.clipboard.writeText(json);
        copyButton.name('Skopiowano ✓');
      } catch {
        window.prompt('Skopiuj labelConfig:', json.replace(/\s+/g, ' '));
      }
      window.setTimeout(() => copyButton.name('Kopiuj labelConfig (JSON)'), 1600);
    },
    reset: () => {
      Object.assign(params, initial);
      refresh();
      apply();
    },
    defaults: () => {
      Object.assign(params, DEFAULT_LABEL_CONFIG);
      refresh();
      apply();
    },
  };
  const copyButton = gui.add(actions, 'copy').name('Kopiuj labelConfig (JSON)');
  gui.add(actions, 'reset').name('Przywróć z products.json');
  gui.add(actions, 'defaults').name('Wartości domyślne');

  return () => {
    cancelAnimationFrame(raf);
    gui.destroy();
  };
}
