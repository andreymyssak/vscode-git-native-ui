export function classifySearch(text: string): 'text' | 'hash-and-text' {
  return /^[a-f\d]{7,64}$/i.test(text) ? 'hash-and-text' : 'text';
}
