export type MoleculeNode = {
  color: string;
  kindIndex: number;
  radius: number;
  x: number;
  y: number;
};

export type MoleculeSnapshot = {
  key: string;
  links: Array<{
    a: number;
    b: number;
  }>;
  nodes: MoleculeNode[];
};
