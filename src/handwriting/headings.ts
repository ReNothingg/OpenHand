/** The same hierarchy is used for screen text and physical pen trajectories. */
export const HEADING_SCALES = [1, 1.4, 1.25, 1.15, 1.08, 1.04, 1.0];

export function isExerciseLabel(text: string) {
  return /^(?:[а-яёa-z]\)|(?:№\s*)?\d+(?:\.\d+)+(?:\s*[а-яёa-z]\)?)?)$/iu.test(text.trim());
}
