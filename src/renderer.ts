import type { LinkStore, ParticleStore } from "./preview-simulation";

export type Camera = {
  x: number;
  y: number;
  zoom: number;
};

export type RenderOptions = {
  backgroundColor: string;
  gridColor: string;
  gridSize: number;
  linkColor: string;
};

const defaultRenderOptions: RenderOptions = {
  backgroundColor: "#14374b",
  gridColor: "rgba(231, 237, 242, 0)",
  gridSize: 0,
  linkColor: "rgba(255, 230, 0, 0.4)",
};

export const renderParticles = (
  context: CanvasRenderingContext2D,
  particles: ParticleStore,
  links: LinkStore,
  camera: Camera,
  width: number,
  height: number,
  options: Partial<RenderOptions> = {},
) => {
  const config = { ...defaultRenderOptions, ...options };

  context.fillStyle = config.backgroundColor;
  context.fillRect(0, 0, width, height);

  context.save();
  context.scale(camera.zoom, camera.zoom);
  context.translate(-camera.x, -camera.y);

  renderGrid(context, camera, width, height, config);

  const viewport = getCameraViewport(camera, width, height);

  renderParticleBatches(context, particles, viewport);
  renderLinkBatches(context, particles, links, config);

  context.restore();
};

type Viewport = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

const getCameraViewport = (
  camera: Camera,
  width: number,
  height: number,
): Viewport => {
  return {
    left: camera.x,
    right: camera.x + width / camera.zoom,
    top: camera.y,
    bottom: camera.y + height / camera.zoom,
  };
};

const renderParticleBatches = (
  context: CanvasRenderingContext2D,
  particles: ParticleStore,
  viewport: Viewport,
) => {
  let currentColor = "";
  let hasOpenPath = false;

  for (let particle = 0; particle < particles.count; particle += 1) {
    if (!isParticleVisible(particles, particle, viewport)) {
      continue;
    }

    const color = particles.colors[particle] ?? "#ffffff";

    if (color !== currentColor) {
      if (hasOpenPath) {
        context.fillStyle = currentColor;
        context.fill();
      }

      currentColor = color;
      hasOpenPath = true;
      context.beginPath();
    }

    context.moveTo(
      particles.x[particle] + particles.radius,
      particles.y[particle],
    );
    context.arc(
      particles.x[particle],
      particles.y[particle],
      particles.radius,
      0,
      Math.PI * 2,
    );
  }

  if (hasOpenPath) {
    context.fillStyle = currentColor;
    context.fill();
  }
};

const renderLinkBatches = (
  context: CanvasRenderingContext2D,
  particles: ParticleStore,
  links: LinkStore,
  options: RenderOptions,
) => {
  context.lineWidth = 1;
  context.beginPath();

  for (let linkIndex = 0; linkIndex < links.count; linkIndex += 1) {
    const a = links.a[linkIndex];
    const b = links.b[linkIndex];

    context.moveTo(particles.x[a], particles.y[a]);
    context.lineTo(particles.x[b], particles.y[b]);
  }

  context.strokeStyle = options.linkColor;
  context.stroke();
};

const isParticleVisible = (
  particles: ParticleStore,
  particle: number,
  viewport: Viewport,
) => {
  return (
    particles.x[particle] + particles.radius >= viewport.left &&
    particles.x[particle] - particles.radius <= viewport.right &&
    particles.y[particle] + particles.radius >= viewport.top &&
    particles.y[particle] - particles.radius <= viewport.bottom
  );
};

const renderGrid = (
  context: CanvasRenderingContext2D,
  camera: Camera,
  width: number,
  height: number,
  options: RenderOptions,
) => {
  if (options.gridSize <= 0) {
    return;
  }

  const left = camera.x;
  const right = camera.x + width / camera.zoom;
  const top = camera.y;
  const bottom = camera.y + height / camera.zoom;
  const startX = Math.floor(left / options.gridSize) * options.gridSize;
  const startY = Math.floor(top / options.gridSize) * options.gridSize;

  context.beginPath();
  context.strokeStyle = options.gridColor;
  context.lineWidth = 1 / camera.zoom;

  for (let x = startX; x <= right; x += options.gridSize) {
    context.moveTo(x, top);
    context.lineTo(x, bottom);
  }

  for (let y = startY; y <= bottom; y += options.gridSize) {
    context.moveTo(left, y);
    context.lineTo(right, y);
  }

  context.stroke();
};
