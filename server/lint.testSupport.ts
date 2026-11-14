/**
 * Stderr without clarity lint lines. Fixtures predate keys and context, so tests about other
 * warnings compare the rest; questionLint.test.ts covers the lint itself.
 */
export const withoutLint = (stderr: string): string =>
  stderr
    .split('\n')
    .filter(line => !line.startsWith('lint: '))
    .join('\n')
