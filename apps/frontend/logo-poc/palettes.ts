export type Palette = {
  readonly label: string;
  readonly description: string;
  readonly colors: readonly (readonly [number, number, number])[];
};

// biome-ignore-start lint/style/noMagicNumbers: These linear RGB values define the three lighting studies.
export const PALETTES = {
  cool: {
    label: 'Cool',
    description: 'ice blue, mint green, and lavender',
    colors: [
      [0.28, 0.62, 0.95],
      [0.24, 0.72, 0.42],
      [0.64, 0.45, 0.86],
    ],
  },
  warm: {
    label: 'Sand',
    description: 'champagne, sand beige, and warm taupe',
    colors: [
      [0.9, 0.78, 0.61],
      [0.72, 0.59, 0.43],
      [0.52, 0.45, 0.36],
    ],
  },
  neon: {
    label: 'Neon',
    description: 'cyan, electric blue, and magenta',
    colors: [
      [0.02, 0.9, 1.15],
      [0.12, 0.28, 1.35],
      [1.1, 0.07, 0.7],
    ],
  },
} as const satisfies Record<string, Palette>;
// biome-ignore-end lint/style/noMagicNumbers: End of lighting palette configuration.

export function getPalette(name: string | undefined): Palette {
  return name && Object.hasOwn(PALETTES, name)
    ? PALETTES[name as keyof typeof PALETTES]
    : PALETTES.cool;
}
