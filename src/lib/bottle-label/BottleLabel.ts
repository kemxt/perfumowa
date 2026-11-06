import {
  AdditiveBlending,
  AmbientLight,
  BufferGeometry,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OrthographicCamera,
  Scene,
  ShaderMaterial,
  SpotLight,
  WebGLRenderer,
  type Texture,
} from 'three';
import { resolveLabelConfig, type LabelConfig } from './config';
import { buildCurvedPlane } from './geometry';
import { GLINT_FRAGMENT, GLINT_VERTEX, LABEL_MAP_FRAGMENT, LABEL_UNIFORMS_GLSL } from './shaders';
import { loadLabelTexture } from './texture';

export interface BottleLabelOptions {
  /** Kontener (position: relative) z <img> flakonu. Canvas zostanie dodany jako jego dziecko. */
  container: HTMLElement;
  image: HTMLImageElement;
  /** Plik etykiety (SVG/PNG) – rozwinięty obwód flakonu minus GAP. */
  labelSrc: string;
  config?: Partial<LabelConfig>;
}

/**
 * Hybryda 2D + 3D: flakon to zwykły <img>, a nad nim leży canvas, w którym Three.js
 * renderuje wyłącznie etykietę na wycinku walca (OrthographicCamera dopasowana do zdjęcia)
 * oraz pas odblasku na szkle. Obrót to przesunięcie UV w shaderze – geometria stoi w miejscu.
 *
 * Render odbywa się tylko po zmianie offsetu, rozmiaru, konfiguracji lub tekstury.
 */
export class BottleLabel {
  readonly canvas: HTMLCanvasElement;
  /** Rozwiązuje się po pierwszym renderze z teksturą (lub po błędzie ładowania). */
  readonly ready: Promise<void>;

  private readonly cfg: LabelConfig;
  private readonly container: HTMLElement;
  private readonly image: HTMLImageElement;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0.1, 50);
  private readonly group = new Group();
  private readonly labelMaterial: MeshStandardMaterial;
  private readonly glintMaterial: ShaderMaterial;
  private readonly wireMaterial: MeshBasicMaterial;
  private readonly labelMesh: Mesh;
  private readonly glintMesh: Mesh;
  private readonly wireMesh: Mesh;
  private readonly ambient = new AmbientLight(0xffffff, 1);
  private readonly spot = new SpotLight(0xffffff, 1, 0, Math.PI / 5, 0.6, 0);
  private readonly labelUniforms = {
    uOffset: { value: 0 },
    uGap: { value: 0 },
    uArc: { value: 0.5 },
  };
  private readonly glintUniforms = {
    uOffset: { value: 0 },
    uArc: { value: 0.5 },
    uIntensity: { value: 0 },
    uWidth: { value: 0.03 },
    uSpeed: { value: 1 },
    uPos: { value: 0 },
    uPad: { value: 0 },
  };
  private readonly resizeObserver: ResizeObserver;
  private texture: Texture | null = null;
  private imageAspect = 0;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private offset = 0;
  private frame = 0;
  private disposed = false;

  constructor({ container, image, labelSrc, config }: BottleLabelOptions) {
    this.container = container;
    this.image = image;
    this.cfg = resolveLabelConfig(config);

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'bottle__label';
    this.canvas.setAttribute('aria-hidden', 'true');
    container.appendChild(this.canvas);

    this.renderer = new WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: true,
      premultipliedAlpha: true,
      powerPreference: 'low-power',
    });
    this.renderer.setClearColor(0x000000, 0);

    this.camera.position.set(0, 0, 10);

    this.labelMaterial = new MeshStandardMaterial({ metalness: 0, transparent: true });
    this.labelMaterial.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.labelUniforms);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${LABEL_UNIFORMS_GLSL}`)
        .replace('#include <map_fragment>', LABEL_MAP_FRAGMENT);
    };
    this.labelMaterial.customProgramCacheKey = () => 'bottle-label';

    this.glintMaterial = new ShaderMaterial({
      uniforms: this.glintUniforms,
      vertexShader: GLINT_VERTEX,
      fragmentShader: GLINT_FRAGMENT,
      transparent: true,
      blending: AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });

    this.wireMaterial = new MeshBasicMaterial({ color: 0xff2d55, wireframe: true, transparent: true, opacity: 0.6, depthTest: false });

    this.labelMesh = new Mesh(new BufferGeometry(), this.labelMaterial);
    this.labelMesh.visible = false; // do czasu załadowania tekstury
    this.glintMesh = new Mesh(new BufferGeometry(), this.glintMaterial);
    this.glintMesh.renderOrder = 1;
    this.wireMesh = new Mesh(new BufferGeometry(), this.wireMaterial);
    this.wireMesh.renderOrder = 2;
    this.wireMesh.visible = false;

    this.group.add(this.labelMesh, this.glintMesh, this.wireMesh);
    this.scene.add(this.group, this.ambient, this.spot, this.spot.target);

    this.canvas.addEventListener('webglcontextrestored', this.onContextRestored);
    this.resizeObserver = new ResizeObserver(() => this.measure());
    this.resizeObserver.observe(container);

    this.ready = this.init(labelSrc);
  }

  // -------------------------------------------------------------------------
  // API

  get config(): Readonly<LabelConfig> {
    return { ...this.cfg };
  }

  get currentOffset(): number {
    return this.offset;
  }

  /** Surowe przesunięcie etykiety w obrotach (1 = pełny obrót). */
  setOffset(offset: number): void {
    if (offset === this.offset) return;
    this.offset = offset;
    this.labelUniforms.uOffset.value = offset;
    this.glintUniforms.uOffset.value = offset;
    this.invalidate();
  }

  /** Postęp 0–1 (np. ze ScrollTrigger) → obrót o `turns` pełnych obrotów. */
  setSpin(progress: number, turns = 1): void {
    this.setOffset(progress * turns);
  }

  updateConfig(partial: Partial<LabelConfig>): void {
    Object.assign(this.cfg, partial);
    this.rebuild();
  }

  /** Narzędzia kalibracji (panel ?debug). */
  setDebugView({ wireframe, label, glint }: { wireframe?: boolean; label?: boolean; glint?: boolean }): void {
    if (wireframe !== undefined) this.wireMesh.visible = wireframe;
    if (label !== undefined) this.labelMesh.visible = label && !!this.texture;
    if (glint !== undefined) this.glintMesh.visible = glint;
    this.invalidate();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    for (const mesh of [this.labelMesh, this.glintMesh, this.wireMesh]) mesh.geometry.dispose();
    this.labelMaterial.dispose();
    this.glintMaterial.dispose();
    this.wireMaterial.dispose();
    this.texture?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
    this.container.classList.remove('is-label-ready');
  }

  // -------------------------------------------------------------------------
  // Wewnętrzne

  private async init(labelSrc: string): Promise<void> {
    try {
      await this.image.decode();
    } catch {
      // Zdjęcie się nie załadowało – proporcje weźmiemy z kontenera.
    }
    if (this.disposed) return;
    const { naturalWidth: w, naturalHeight: h } = this.image;
    this.imageAspect = w && h ? w / h : 0;
    this.measure();
    this.updateCamera();
    this.rebuild();

    try {
      const caps = this.renderer.capabilities;
      const texture = await loadLabelTexture(labelSrc, { maxSize: caps.maxTextureSize, anisotropy: caps.getMaxAnisotropy() });
      if (this.disposed) {
        texture.dispose();
        return;
      }
      this.texture = texture;
      this.labelMaterial.map = texture;
      this.labelMaterial.needsUpdate = true;
      this.labelMesh.visible = true;
      this.renderNow();
      this.container.classList.add('is-label-ready');
    } catch (error) {
      console.warn(`[BottleLabel] nie udało się wczytać etykiety ${labelSrc}`, error);
    }
  }

  private measure(): void {
    if (this.disposed) return;
    // Rozmiar layoutu (bez transformacji CSS) – skalowanie w animacjach nie wymusza renderu.
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (!width || !height) return;
    if (width === this.width && height === this.height && dpr === this.dpr) return;
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, false);
    this.updateCamera();
    this.invalidate();
  }

  private updateCamera(): void {
    if (!this.width || !this.height) return;
    const elementAspect = this.width / this.height;
    const imageAspect = this.imageAspect || elementAspect;
    // Zdjęcie wpisane w kontener jak object-fit: contain; wysokość zdjęcia = 1 jednostka sceny.
    const halfH = 0.5 * Math.max(1, imageAspect / elementAspect);
    const halfW = halfH * elementAspect;
    Object.assign(this.camera, { left: -halfW, right: halfW, top: halfH, bottom: -halfH });
    this.camera.updateProjectionMatrix();
  }

  private rebuild(): void {
    if (this.disposed) return;
    const c = this.cfg;
    const aspect = this.imageAspect || (this.width && this.height ? this.width / this.height : 2 / 3);
    const radius = (c.CYL_WIDTH * aspect) / 2;
    const height = Math.max(0.001, c.CYL_BOT - c.CYL_TOP);
    const glintHeight = height + 2 * c.GLINT_PAD;
    const arc = MathUtils.degToRad(c.ARC);

    this.setGeometry(this.labelMesh, buildCurvedPlane({ radius, height, arc, curv: c.CURV }));
    this.setGeometry(this.glintMesh, buildCurvedPlane({ radius: radius * 1.002, height: glintHeight, arc, curv: c.CURV, segmentsY: 1 }));
    this.setGeometry(this.wireMesh, buildCurvedPlane({ radius, height, arc, curv: c.CURV, segmentsX: 24, segmentsY: 6 }));

    this.group.position.set((c.CYL_X - 0.5) * aspect, 0.5 - (c.CYL_TOP + c.CYL_BOT) / 2, 0);
    this.group.rotation.x = MathUtils.degToRad(c.TILT);

    this.labelUniforms.uGap.value = c.GAP;
    this.labelUniforms.uArc.value = c.ARC / 360;
    this.labelMaterial.roughness = c.ROUGHNESS;

    this.ambient.intensity = c.AMBIENT;
    this.spot.intensity = c.LIGHT_INT;
    this.spot.position.set(c.LIGHT_X, c.LIGHT_Y, c.LIGHT_Z).add(this.group.position);
    this.spot.target.position.copy(this.group.position);

    const g = this.glintUniforms;
    g.uArc.value = c.ARC / 360;
    g.uIntensity.value = c.GLINT_INT;
    g.uWidth.value = c.GLINT_WIDTH;
    g.uSpeed.value = c.GLINT_SPEED;
    g.uPos.value = c.GLINT_POS;
    g.uPad.value = c.GLINT_PAD / glintHeight;

    this.invalidate();
  }

  private setGeometry(mesh: Mesh, geometry: BufferGeometry): void {
    mesh.geometry.dispose();
    mesh.geometry = geometry;
  }

  private invalidate(): void {
    if (this.disposed || this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.renderNow();
    });
  }

  private renderNow(): void {
    if (this.disposed || !this.width || !this.height) return;
    this.renderer.render(this.scene, this.camera);
  }

  private readonly onContextRestored = () => this.invalidate();
}
