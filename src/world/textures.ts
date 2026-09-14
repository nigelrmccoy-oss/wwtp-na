/**
 * Shared THREE.TextureLoader helpers — RepeatWrapping material maps.
 */
import * as THREE from 'three';

export interface PlantTextures {
  grass: THREE.Texture;
  concrete: THREE.Texture;
  asphalt: THREE.Texture;
  water: THREE.Texture;
  metal: THREE.Texture;
}

const loader = new THREE.TextureLoader();

function loadRepeat(url: string, repeatX: number, repeatY: number): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (tex) => {
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(repeatX, repeatY);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        resolve(tex);
      },
      undefined,
      reject,
    );
  });
}

export async function loadPlantTextures(): Promise<PlantTextures> {
  const [grass, concrete, asphalt, water, metal] = await Promise.all([
    loadRepeat('./textures/terrain-grass.png', 24, 24),
    loadRepeat('./textures/mat-concrete.png', 4, 4),
    loadRepeat('./textures/mat-asphalt.png', 8, 2),
    loadRepeat('./textures/mat-water.png', 3, 3),
    loadRepeat('./textures/mat-metal.png', 2, 2),
  ]);
  return { grass, concrete, asphalt, water, metal };
}

export function concreteMat(tex: PlantTextures, color = 0xffffff): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: tex.concrete,
    color,
    roughness: 0.82,
    metalness: 0.05,
  });
}

export function asphaltMat(tex: PlantTextures): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: tex.asphalt,
    color: 0xffffff,
    roughness: 0.92,
    metalness: 0.02,
  });
}

export function waterMat(tex: PlantTextures, color = 0xffffff): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: tex.water,
    color,
    roughness: 0.22,
    metalness: 0.35,
    transparent: true,
    opacity: 0.92,
  });
}

export function metalMat(tex: PlantTextures, color = 0xffffff): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: tex.metal,
    color,
    roughness: 0.45,
    metalness: 0.55,
  });
}

export function grassMat(tex: PlantTextures): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: tex.grass,
    color: 0xffffff,
    roughness: 0.95,
    metalness: 0.0,
  });
}
