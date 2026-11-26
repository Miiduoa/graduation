// Deterministic native file-system boundary for testing cache ownership and deletion.
export const fileBytes = new Map<string, Uint8Array>();
export const directories = new Set<string>(['file:///cache']);
export const deleted: string[] = [];
function uri(parts: Array<string | { uri: string }>): string {
  return parts
    .map((part) => (typeof part === 'string' ? part : part.uri).replace(/\/$/, ''))
    .join('/');
}
export class File {
  uri: string;
  constructor(...parts: Array<string | { uri: string }>) {
    this.uri = uri(parts);
  }
  get exists() {
    return fileBytes.has(this.uri);
  }
  get size() {
    return fileBytes.get(this.uri)?.byteLength ?? 0;
  }
  get name() {
    return this.uri.split('/').at(-1) || '';
  }
  async arrayBuffer() {
    return new Uint8Array(fileBytes.get(this.uri) ?? []).buffer;
  }
  create() {
    fileBytes.set(this.uri, new Uint8Array());
  }
  write(bytes: Uint8Array) {
    fileBytes.set(this.uri, new Uint8Array(bytes));
  }
  move(target: { uri: string }) {
    const value = fileBytes.get(this.uri);
    if (!value) throw new Error('missing file');
    fileBytes.delete(this.uri);
    fileBytes.set(target.uri, value);
    this.uri = target.uri;
  }
  delete() {
    deleted.push(this.uri);
    fileBytes.delete(this.uri);
  }
}
export class Directory {
  uri: string;
  constructor(...parts: Array<string | { uri: string }>) {
    this.uri = uri(parts);
  }
  get name() {
    return this.uri.split('/').at(-1) || '';
  }
  get exists() {
    return directories.has(this.uri);
  }
  create() {
    directories.add(this.uri);
  }
  list() {
    return [...directories]
      .filter(
        (value) =>
          value.startsWith(`${this.uri}/`) && !value.slice(this.uri.length + 1).includes('/'),
      )
      .map((value) => new Directory(value));
  }
  delete() {
    deleted.push(this.uri);
    for (const name of fileBytes.keys())
      if (name.startsWith(`${this.uri}/`)) fileBytes.delete(name);
    for (const name of directories)
      if (name === this.uri || name.startsWith(`${this.uri}/`)) directories.delete(name);
  }
}
export const Paths = { cache: new Directory('file:///cache') };
export function resetFileSystem() {
  fileBytes.clear();
  directories.clear();
  directories.add('file:///cache');
  deleted.length = 0;
}
