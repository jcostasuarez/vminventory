declare const __APP_VERSION__: string | undefined;

declare module 'node:fs' {
  export function readFileSync(path: URL | string, encoding: 'utf8'): string;
}
