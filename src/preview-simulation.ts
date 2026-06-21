import type { MoleculeSnapshot } from "./catalog";

export type ParticleIndex = number;

export type ParticleStore = {
  accelerationX: Float64Array;
  accelerationY: Float64Array;
  colors: readonly string[];
  count: number;
  kindIndex: Uint8Array;
  linkCount: Uint8Array;
  maxLinks: Uint8Array;
  previousX: Float64Array;
  previousY: Float64Array;
  radius: number;
  x: Float64Array;
  y: Float64Array;
};

export type LinkStore = {
  a: Int32Array;
  adjacency: Uint8Array;
  b: Int32Array;
  count: number;
};

export type MoleculePreviewSimulation = {
  links: LinkStore;
  particles: ParticleStore;
  update: (deltaSeconds: number) => void;
};

const fixedTimeStep = 1 / 60;
const particleRadius = 5;
const damping = 0.98;
const interactionRadius = 100;
const interactionSpeed = 4;
const linkForce = -0.015;
const logicStepsPerFrame = 3;
const maxSpeed = 1;
const kindCount = 3;
const interactionValues = new Float64Array([1, 1, -1, 1, 1, 1, 1, 1, 1]);
const linkLimits = new Uint8Array([1, 3, 2]);

export const createMoleculePreviewSimulation = (
  molecule: MoleculeSnapshot,
): MoleculePreviewSimulation => {
  const particles = createParticles(molecule);
  const links = createLinks(molecule, particles);
  let accumulator = 0;

  return {
    particles,
    links,
    update: (deltaSeconds: number) => {
      accumulator += Math.min(deltaSeconds, fixedTimeStep * 5);

      while (accumulator >= fixedTimeStep) {
        for (let step = 0; step < logicStepsPerFrame; step += 1) {
          stepSimulation(particles, links);
        }

        accumulator -= fixedTimeStep;
      }
    },
  };
};

export const shakeParticles = (particles: ParticleStore, strength: number) => {
  for (let index = 0; index < particles.count; index += 1) {
    const angle = Math.random() * Math.PI * 2;
    const force = randomBetween(strength * 0.35, strength);

    particles.previousX[index] -= Math.cos(angle) * force;
    particles.previousY[index] -= Math.sin(angle) * force;
  }
};

export const moveParticle = (
  particles: ParticleStore,
  index: ParticleIndex,
  position: { x: number; y: number },
) => {
  particles.x[index] = position.x;
  particles.y[index] = position.y;
  particles.previousX[index] = position.x;
  particles.previousY[index] = position.y;
  particles.accelerationX[index] = 0;
  particles.accelerationY[index] = 0;
};

const createParticles = (molecule: MoleculeSnapshot): ParticleStore => {
  const count = molecule.nodes.length;
  const scale = getSnapshotScale(molecule);
  const particles: ParticleStore = {
    accelerationX: new Float64Array(count),
    accelerationY: new Float64Array(count),
    colors: molecule.nodes.map((node) => node.color),
    count,
    kindIndex: new Uint8Array(count),
    linkCount: new Uint8Array(count),
    maxLinks: new Uint8Array(count),
    previousX: new Float64Array(count),
    previousY: new Float64Array(count),
    radius: particleRadius,
    x: new Float64Array(count),
    y: new Float64Array(count),
  };

  molecule.nodes.forEach((node, index) => {
    const x = (node.x - 0.5) * scale;
    const y = (node.y - 0.5) * scale;

    particles.x[index] = x;
    particles.y[index] = y;
    particles.kindIndex[index] = node.kindIndex;
    particles.maxLinks[index] = linkLimits[node.kindIndex] ?? 0;
    particles.previousX[index] = x;
    particles.previousY[index] = y;
  });

  return particles;
};

const createLinks = (
  molecule: MoleculeSnapshot,
  particles: ParticleStore,
): LinkStore => {
  const validLinks = molecule.links.filter(
    (link) =>
      link.a >= 0 &&
      link.a < particles.count &&
      link.b >= 0 &&
      link.b < particles.count &&
      link.a !== link.b,
  );
  const links: LinkStore = {
    a: new Int32Array(validLinks.length),
    adjacency: new Uint8Array(particles.count * particles.count),
    b: new Int32Array(validLinks.length),
    count: validLinks.length,
  };

  validLinks.forEach((link, index) => {
    links.a[index] = link.a;
    links.b[index] = link.b;
    links.adjacency[link.a * particles.count + link.b] = 1;
    links.adjacency[link.b * particles.count + link.a] = 1;
    particles.linkCount[link.a] += 1;
    particles.linkCount[link.b] += 1;
  });

  return links;
};

const stepSimulation = (particles: ParticleStore, links: LinkStore) => {
  particles.accelerationX.fill(0);
  particles.accelerationY.fill(0);
  applyLinkForces(particles, links);
  applyInteractionForces(particles, links);
  integrateParticles(particles);
};

const applyLinkForces = (particles: ParticleStore, links: LinkStore) => {
  const overlapDistanceSquared = (particleRadius * 2) ** 2;

  for (let index = 0; index < links.count; index += 1) {
    const a = links.a[index];
    const b = links.b[index];
    const dx = particles.x[a] - particles.x[b];
    const dy = particles.y[a] - particles.y[b];
    const distanceSquared = dx * dx + dy * dy;

    if (distanceSquared <= overlapDistanceSquared) {
      continue;
    }

    const forceScale =
      (linkForce * interactionSpeed) / Math.sqrt(distanceSquared);
    const forceX = dx * forceScale;
    const forceY = dy * forceScale;

    particles.accelerationX[a] += forceX;
    particles.accelerationY[a] += forceY;
    particles.accelerationX[b] -= forceX;
    particles.accelerationY[b] -= forceY;
  }
};

const applyInteractionForces = (particles: ParticleStore, links: LinkStore) => {
  const interactionRadiusSquared = interactionRadius * interactionRadius;

  for (let a = 0; a < particles.count; a += 1) {
    for (let b = a + 1; b < particles.count; b += 1) {
      const dx = particles.x[a] - particles.x[b];
      const dy = particles.y[a] - particles.y[b];
      const distanceSquared = dx * dx + dy * dy;

      if (distanceSquared >= interactionRadiusSquared) {
        continue;
      }

      const clampedDistanceSquared = Math.max(distanceSquared, 1);
      const kindA = particles.kindIndex[a];
      const kindB = particles.kindIndex[b];
      let forceA =
        (interactionValues[kindA * kindCount + kindB] ?? 1) /
        clampedDistanceSquared;
      let forceB =
        (interactionValues[kindB * kindCount + kindA] ?? 1) /
        clampedDistanceSquared;

      if (
        !hasLink(links, particles.count, a, b) &&
        (!hasFreeLinkSlot(particles, a) || !hasFreeLinkSlot(particles, b))
      ) {
        forceA = 1 / clampedDistanceSquared;
        forceB = 1 / clampedDistanceSquared;
      }

      if (distanceSquared < (particleRadius * 2) ** 2) {
        forceA = 1 / clampedDistanceSquared;
        forceB = 1 / clampedDistanceSquared;
      }

      const inverseDistance =
        distanceSquared > 0 ? 1 / Math.sqrt(distanceSquared) : 0;
      const directionX = distanceSquared > 0 ? dx * inverseDistance : 1;
      const directionY = distanceSquared > 0 ? dy * inverseDistance : 0;

      particles.accelerationX[a] += directionX * forceA * interactionSpeed;
      particles.accelerationY[a] += directionY * forceA * interactionSpeed;
      particles.accelerationX[b] -= directionX * forceB * interactionSpeed;
      particles.accelerationY[b] -= directionY * forceB * interactionSpeed;
    }
  }
};

const hasLink = (
  links: LinkStore,
  particleCount: number,
  a: ParticleIndex,
  b: ParticleIndex,
) => {
  return links.adjacency[a * particleCount + b] === 1;
};

const hasFreeLinkSlot = (particles: ParticleStore, particle: ParticleIndex) => {
  return particles.linkCount[particle] < particles.maxLinks[particle];
};

const integrateParticles = (particles: ParticleStore) => {
  for (let index = 0; index < particles.count; index += 1) {
    const x = particles.x[index];
    const y = particles.y[index];
    let velocityX = (x - particles.previousX[index]) * damping;
    let velocityY = (y - particles.previousY[index]) * damping;
    const speed = Math.hypot(velocityX, velocityY);

    if (speed > maxSpeed) {
      const scale = maxSpeed / speed;

      velocityX *= scale;
      velocityY *= scale;
    }

    particles.previousX[index] = x;
    particles.previousY[index] = y;
    particles.x[index] = x + velocityX + particles.accelerationX[index];
    particles.y[index] = y + velocityY + particles.accelerationY[index];
  }
};

const getSnapshotScale = (molecule: MoleculeSnapshot) => {
  const radius = molecule.nodes[0]?.radius ?? 1;

  return particleRadius / Math.max(radius, Number.EPSILON);
};

const randomBetween = (min: number, max: number) => {
  return min + Math.random() * (max - min);
};
