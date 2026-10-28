// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Creates a debounced version of the provided function.
 * The debounced function delays invoking func until after wait milliseconds
 * have elapsed since the last time it was invoked.
 */
export function debounce<T extends (...args: never[]) => unknown>(
  func: T,
  wait: number,
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return function (this: unknown, ...args: Parameters<T>) {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(() => {
      func.apply(this, args);
      timeoutId = null;
    }, wait);
  };
}
