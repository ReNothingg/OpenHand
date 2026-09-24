/** The same hierarchy is used for screen text and physical pen trajectories. */
export const HEADING_SCALES = [1, 1.8, 1.5, 1.3, 1.16, 1.08, 1.02];

export function isExerciseLabel(text: string) {
  return /^(?:[а-яёa-z]\)|(?:№\s*)?\d+(?:\.\d+)+(?:\s*[а-яёa-z]\)?)?)$/iu.test(text.trim());
}
