/**
 * Shared THREE texture helpers — tileable PBR-style materials (v0.3).
 */
import * as THREE from 'three';

export interface PlantTextures {
  grass: THREE.Texture;
  concrete: THREE.Texture;
  concreteWeathered: THREE.Texture;
  asphalt: THREE.Texture;
  water: THREE.Texture;
  waterNormal: THREE.Texture;
  metal: THREE.Texture;
  metalPainted: THREE.Texture;
}

const loader = new THREE.TextureLoader();

function loadRepeat(
  url: string,
  repeatX: number,
  repeatY: number,
  colorSpace: THREE.ColorSpace | null = THREE.SRGBColorSpace,
): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (tex) => {
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(repeatX, repeatY);
        if (colorSpace) tex.colorSpace = colorSpace;
        else tex.colorSpace = THREE.NoColorSpace;
        tex.anisotropy = 8;
        resolve(tex);
      },
      undefined,
      reject,
    );
  });
}

export async function loadPlantTextures(): Promise<PlantTextures> {
  const [grass, concrete, concreteWeathered, asphalt, water, waterNormal, metal, metalPainted] =
    await Promise.all([
      loadRepeat('./textures/terrain-grass.png', 28, 28),
      loadRepeat('./textures/mat-concrete.png', 5, 5),
      loadRepeat('./textures/mat-concrete-weathered.png', 4, 4),
      loadRepeat('./textures/mat-asphalt.png', 10, 10),
      loadRepeat('./textures/mat-water.png', 4, 4),
      loadRepeat('./textures/mat-water-normal.png', 5, 5, null),
      loadRepeat('./textures/mat-metal.png', 3, 3),
      loadRepeat('./textures/mat-metal-painted.png', 2, 2),
    ]);
  return { grass, concrete, concreteWeathered, asphalt, water, waterNormal, metal, metalPainted };
}

export function concreteMat(tex: PlantTextures, color = 0xffffff): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: tex.concrete,
    color,
    roughness: 0.88,
    metalness: 0.02,
    envMapIntensity: 0.35,
  });
}

export function weatheredConcreteMat(tex: PlantTextures, color = 0xffffff): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: tex.concreteWeathered,
    color,
    roughness: 0.92,
    metalness: 0.02,
  });
}

export function asphaltMat(tex: PlantTextures): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: tex.asphalt,
    color: 0xffffff,
    roughness: 0.95,
    metalness: 0.0,
  });
}

/** Wet process water — transparent, reflective, normal-mapped ripples. */
export function waterMat(tex: PlantTextures, color = 0xffffff): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    map: tex.water,
    color,
    roughness: 0.12,
    metalness: 0.05,
    transmission: 0.35,
    thickness: 1.2,
    transparent: true,
    opacity: 0.88,
    normalMap: tex.waterNormal,
    normalScale: new THREE.Vector2(0.45, 0.45),
    clearcoat: 0.55,
    clearcoatRoughness: 0.18,
    side: THREE.DoubleSide,
  });
}

export function metalMat(tex: PlantTextures, color = 0xffffff): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: tex.metal,
    color,
    roughness: 0.38,
    metalness: 0.72,
  });
}

export function paintedMetalMat(tex: PlantTextures, color = 0xffffff): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: tex.metalPainted,
    color,
    roughness: 0.48,
    metalness: 0.45,
  });
}

export function grassMat(tex: PlantTextures): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: tex.grass,
    color: 0xffffff,
    roughness: 0.97,
    metalness: 0.0,
  });
}
