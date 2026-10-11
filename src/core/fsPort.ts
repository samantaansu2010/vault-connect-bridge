export interface DirEntry {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
  isSymlink: boolean;
}

/**
 * The only filesystem access Bridge needs: read-only. There is deliberately
 * no write/delete method here, so core code cannot modify another vault.
 */
export interface FsPort {
  isDirectory(path: string): Promise<boolean>;
  isFile(path: string): Promise<boolean>;
  readdir(path: string): Promise<DirEntry[]>;
}
