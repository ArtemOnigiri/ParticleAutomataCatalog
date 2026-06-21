import {
  For,
  Show,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import { render } from "solid-js/web";
import type { MoleculeSnapshot } from "./catalog";
import type { Camera } from "./renderer";
import { renderParticles } from "./renderer";
import type { ParticleIndex, ParticleStore } from "./preview-simulation";
import {
  createMoleculePreviewSimulation,
  moveParticle,
  shakeParticles,
} from "./preview-simulation";
import "./styles.css";

const defaultCatalogFile = `${import.meta.env.BASE_URL}molecules.json`;
const moleculePreviewPaddingScale = 1.35;
const moleculePreviewMinZoom = 0.2;
const moleculePreviewMaxZoom = 8;
const moleculePreviewShakeStrength = 8;

type MoleculeGroup = {
  particleCount: number;
  molecules: MoleculeSnapshot[];
};

type CatalogLoadResult = {
  molecules: MoleculeSnapshot[];
  skippedCount: number;
};

const App = () => {
  const [molecules, setMolecules] = createSignal<MoleculeSnapshot[]>([]);

  const applyCatalog = (value: unknown) => {
    const result = parseMoleculeCatalog(value);

    setMolecules(result.molecules);
  };

  onMount(() => {
    void loadCatalogFromUrl(defaultCatalogFile, applyCatalog).catch((error) => {
      console.error(getErrorMessage(error));
    });
  });

  return (
    <main class="catalog-page">
      <section class="molecule-list" aria-label="Molecules">
        <Show
          when={molecules().length > 0}
          fallback={
            <div class="catalog-empty">
              The catalog is empty. Add molecules to{" "}
              <code>public/molecules.json</code>.
            </div>
          }
        >
          <For each={groupMoleculesByParticleCount(molecules())}>
            {(group) => (
              <section class="molecule-group">
                <h3 class="molecule-group__title">{group.particleCount}</h3>
                <div class="molecule-grid">
                  <For each={group.molecules}>
                    {(molecule) => <MoleculeTile molecule={molecule} />}
                  </For>
                </div>
              </section>
            )}
          </For>
        </Show>
      </section>
    </main>
  );
};

const MoleculeTile = (props: { molecule: MoleculeSnapshot }) => {
  let tile: HTMLDivElement | undefined;
  const nodes = () => props.molecule.nodes;
  const links = () => props.molecule.links;
  const [isPreviewVisible, setIsPreviewVisible] = createSignal(false);
  const [shakeVersion, setShakeVersion] = createSignal(0);

  onMount(() => {
    if (tile === undefined) {
      return;
    }

    if (window.IntersectionObserver === undefined) {
      setIsPreviewVisible(true);
      return;
    }

    const observer = new IntersectionObserver(([entry]) => {
      setIsPreviewVisible(entry?.isIntersecting ?? false);
    });

    observer.observe(tile);

    onCleanup(() => {
      observer.disconnect();
    });
  });

  const shakeMolecule = (event: MouseEvent) => {
    event.preventDefault();
    setShakeVersion((version) => version + 1);
  };

  return (
    <div ref={tile} class="molecule-tile" onContextMenu={shakeMolecule}>
      <Show
        when={isPreviewVisible()}
        fallback={
          <div
            class="molecule-tile__preview molecule-tile__preview--idle"
            aria-hidden="true"
          />
        }
      >
        <MoleculePreviewCanvas
          molecule={props.molecule}
          shakeVersion={shakeVersion()}
        />
      </Show>
      <div class="molecule-tile__meta">
        {nodes().length} / {links().length}
      </div>
    </div>
  );
};

const MoleculePreviewCanvas = (props: {
  molecule: MoleculeSnapshot;
  shakeVersion: number;
}) => {
  let canvas: HTMLCanvasElement | undefined;
  let simulation:
    | ReturnType<typeof createMoleculePreviewSimulation>
    | undefined;

  createEffect(() => {
    if (props.shakeVersion === 0 || simulation === undefined) {
      return;
    }

    shakeParticles(simulation.particles, moleculePreviewShakeStrength);
  });

  onMount(() => {
    if (canvas === undefined) {
      return;
    }

    const context = canvas.getContext("2d");

    if (context === null) {
      return;
    }

    const nextSimulation = createMoleculePreviewSimulation(props.molecule);

    simulation = nextSimulation;
    let previousTimestamp = 0;
    let pixelRatio = 0;
    let width = 0;
    let height = 0;
    let previewZoom = moleculePreviewMaxZoom;
    let previewCamera = getMoleculePreviewCamera(
      nextSimulation.particles,
      160,
      160,
      previewZoom,
    );
    let animationFrameId = 0;
    let draggedParticle:
      | {
          particle: ParticleIndex;
          pointerId: number;
          offsetX: number;
          offsetY: number;
          targetX: number;
          targetY: number;
        }
      | undefined;

    const resizeCanvas = () => {
      const bounds = canvas.getBoundingClientRect();
      const nextPixelRatio = window.devicePixelRatio || 1;

      if (
        bounds.width === width &&
        bounds.height === height &&
        nextPixelRatio === pixelRatio
      ) {
        return;
      }

      width = bounds.width;
      height = bounds.height;
      pixelRatio = nextPixelRatio;
      canvas.width = Math.floor(width * pixelRatio);
      canvas.height = Math.floor(height * pixelRatio);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    };

    const animate = (timestamp: number) => {
      const deltaSeconds =
        previousTimestamp === 0 ? 0 : (timestamp - previousTimestamp) / 1000;

      previousTimestamp = timestamp;
      resizeCanvas();
      nextSimulation.update(deltaSeconds);

      if (draggedParticle !== undefined) {
        moveParticle(nextSimulation.particles, draggedParticle.particle, {
          x: draggedParticle.targetX,
          y: draggedParticle.targetY,
        });
      } else {
        previewZoom = Math.min(
          previewZoom,
          getMoleculePreviewZoom(nextSimulation.particles, width, height),
        );
        previewCamera = getMoleculePreviewCamera(
          nextSimulation.particles,
          width,
          height,
          previewZoom,
        );
      }

      renderParticles(
        context,
        nextSimulation.particles,
        nextSimulation.links,
        previewCamera,
        width,
        height,
        {
          gridColor: "rgba(231, 237, 242, 0.12)",
          gridSize: 20,
        },
      );

      animationFrameId = window.requestAnimationFrame(animate);
    };

    const getPointerWorldPosition = (event: PointerEvent) => {
      const bounds = canvas.getBoundingClientRect();
      const x = event.clientX - bounds.left;
      const y = event.clientY - bounds.top;

      return {
        x: previewCamera.x + x / previewCamera.zoom,
        y: previewCamera.y + y / previewCamera.zoom,
      };
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) {
        return;
      }

      resizeCanvas();

      const pointerPosition = getPointerWorldPosition(event);
      const particle = findParticleAtPosition(
        nextSimulation.particles,
        pointerPosition,
        previewCamera.zoom,
      );

      if (particle === undefined) {
        return;
      }

      event.preventDefault();
      draggedParticle = {
        particle,
        pointerId: event.pointerId,
        offsetX: nextSimulation.particles.x[particle] - pointerPosition.x,
        offsetY: nextSimulation.particles.y[particle] - pointerPosition.y,
        targetX: nextSimulation.particles.x[particle],
        targetY: nextSimulation.particles.y[particle],
      };
      canvas.setPointerCapture(event.pointerId);
      canvas.classList.add("molecule-tile__preview--dragging");
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (
        draggedParticle === undefined ||
        draggedParticle.pointerId !== event.pointerId
      ) {
        return;
      }

      event.preventDefault();

      const pointerPosition = getPointerWorldPosition(event);

      draggedParticle.targetX = pointerPosition.x + draggedParticle.offsetX;
      draggedParticle.targetY = pointerPosition.y + draggedParticle.offsetY;
      moveParticle(nextSimulation.particles, draggedParticle.particle, {
        x: draggedParticle.targetX,
        y: draggedParticle.targetY,
      });
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (
        draggedParticle === undefined ||
        draggedParticle.pointerId !== event.pointerId
      ) {
        return;
      }

      moveParticle(nextSimulation.particles, draggedParticle.particle, {
        x: draggedParticle.targetX,
        y: draggedParticle.targetY,
      });
      draggedParticle = undefined;

      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }

      canvas.classList.remove("molecule-tile__preview--dragging");
    };

    resizeCanvas();
    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerup", handlePointerUp);
    canvas.addEventListener("pointercancel", handlePointerUp);
    animationFrameId = window.requestAnimationFrame(animate);

    onCleanup(() => {
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerup", handlePointerUp);
      canvas.removeEventListener("pointercancel", handlePointerUp);
      window.cancelAnimationFrame(animationFrameId);
    });
  });

  return (
    <canvas ref={canvas} class="molecule-tile__preview" aria-hidden="true" />
  );
};

const groupMoleculesByParticleCount = (
  molecules: ReadonlyArray<MoleculeSnapshot>,
): MoleculeGroup[] => {
  const groupsByParticleCount = new Map<number, MoleculeSnapshot[]>();

  for (const molecule of molecules) {
    const particleCount = molecule.nodes.length;
    const group = groupsByParticleCount.get(particleCount);

    if (group === undefined) {
      groupsByParticleCount.set(particleCount, [molecule]);
    } else {
      group.push(molecule);
    }
  }

  return Array.from(groupsByParticleCount.entries())
    .sort(([a], [b]) => a - b)
    .map(([particleCount, groupMolecules]) => ({
      particleCount,
      molecules: groupMolecules,
    }));
};

const getMoleculePreviewCamera = (
  particles: ParticleStore,
  width: number,
  height: number,
  zoom: number,
): Camera => {
  const center = getParticleCenterOfMass(particles);
  const viewportWidth = Math.max(width, 1);
  const viewportHeight = Math.max(height, 1);

  return {
    x: center.x - viewportWidth / (zoom * 2),
    y: center.y - viewportHeight / (zoom * 2),
    zoom,
  };
};

const getMoleculePreviewZoom = (
  particles: ParticleStore,
  width: number,
  height: number,
) => {
  const center = getParticleCenterOfMass(particles);
  const viewportWidth = Math.max(width, 1);
  const viewportHeight = Math.max(height, 1);
  const bounds = getCenteredParticleBounds(particles, center);

  return clamp(
    Math.min(
      viewportWidth / Math.max(bounds.width * moleculePreviewPaddingScale, 1),
      viewportHeight / Math.max(bounds.height * moleculePreviewPaddingScale, 1),
    ),
    moleculePreviewMinZoom,
    moleculePreviewMaxZoom,
  );
};

const findParticleAtPosition = (
  particles: ParticleStore,
  position: { x: number; y: number },
  zoom: number,
) => {
  let closestParticle: ParticleIndex | undefined;
  let closestDistanceSquared = Infinity;

  for (let particle = 0; particle < particles.count; particle += 1) {
    const hitRadius = Math.max(particles.radius, 10 / zoom);
    const dx = particles.x[particle] - position.x;
    const dy = particles.y[particle] - position.y;
    const distanceSquared = dx * dx + dy * dy;

    if (
      distanceSquared <= hitRadius * hitRadius &&
      distanceSquared < closestDistanceSquared
    ) {
      closestParticle = particle;
      closestDistanceSquared = distanceSquared;
    }
  }

  return closestParticle;
};

const getParticleCenterOfMass = (particles: ParticleStore) => {
  if (particles.count === 0) {
    return {
      x: 0,
      y: 0,
    };
  }

  let x = 0;
  let y = 0;

  for (let particle = 0; particle < particles.count; particle += 1) {
    x += particles.x[particle];
    y += particles.y[particle];
  }

  return {
    x: x / particles.count,
    y: y / particles.count,
  };
};

const getCenteredParticleBounds = (
  particles: ParticleStore,
  center: { x: number; y: number },
) => {
  let width = 1;
  let height = 1;

  for (let particle = 0; particle < particles.count; particle += 1) {
    width = Math.max(
      width,
      (Math.abs(particles.x[particle] - center.x) + particles.radius) * 2,
    );
    height = Math.max(
      height,
      (Math.abs(particles.y[particle] - center.y) + particles.radius) * 2,
    );
  }

  return {
    width,
    height,
  };
};

const loadCatalogFromUrl = async (
  url: string,
  applyCatalog: (value: unknown) => void,
) => {
  const response = await fetch(url, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`Failed to load ${url} (${response.status}).`);
  }

  applyCatalog(await response.json());
};

const parseMoleculeCatalog = (value: unknown): CatalogLoadResult => {
  if (!Array.isArray(value)) {
    throw new Error("The catalog JSON must contain an array of molecules.");
  }

  const molecules: MoleculeSnapshot[] = [];
  const moleculeKeys = new Set<string>();
  let skippedCount = 0;

  for (const candidate of value) {
    if (!isMoleculeSnapshot(candidate) || moleculeKeys.has(candidate.key)) {
      skippedCount += 1;
      continue;
    }

    moleculeKeys.add(candidate.key);
    molecules.push(candidate);
  }

  return { molecules, skippedCount };
};

const getErrorMessage = (error: unknown) => {
  if (error instanceof SyntaxError) {
    return "Failed to parse JSON: check the file syntax.";
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Failed to load the catalog.";
};

const isMoleculeSnapshot = (value: unknown): value is MoleculeSnapshot => {
  if (!isRecord(value) || typeof value.key !== "string") {
    return false;
  }

  if (!Array.isArray(value.nodes) || !Array.isArray(value.links)) {
    return false;
  }

  const nodes = value.nodes;
  const links = value.links;

  return (
    nodes.every(isMoleculeNode) &&
    links.every((link) => isMoleculeLink(link, nodes.length))
  );
};

const isMoleculeNode = (
  value: unknown,
): value is MoleculeSnapshot["nodes"][number] => {
  return (
    isRecord(value) &&
    typeof value.color === "string" &&
    isFiniteNumber(value.kindIndex) &&
    isFiniteNumber(value.radius) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y)
  );
};

const isMoleculeLink = (
  value: unknown,
  nodeCount: number,
): value is MoleculeSnapshot["links"][number] => {
  if (!isRecord(value)) {
    return false;
  }

  const a = value.a;
  const b = value.b;

  return (
    Number.isInteger(a) &&
    Number.isInteger(b) &&
    typeof a === "number" &&
    typeof b === "number" &&
    a >= 0 &&
    b >= 0 &&
    a < nodeCount &&
    b < nodeCount
  );
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const isFiniteNumber = (value: unknown): value is number => {
  return typeof value === "number" && Number.isFinite(value);
};

const clamp = (value: number, min: number, max: number) => {
  return Math.min(Math.max(value, min), max);
};

const root = document.getElementById("root");

if (root === null) {
  throw new Error("Root element was not found.");
}

render(() => <App />, root);
