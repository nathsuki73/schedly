// Vite `?raw` imports (used for HTML fixtures).
declare module "*?raw" {
  const content: string;
  export default content;
}
