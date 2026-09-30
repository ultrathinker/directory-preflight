/**
 * Spelling helpers for test inputs.
 *
 * The tests write fixtures that hold the shapes the checker looks for. A plugin under test
 * also checks its own folder, so a shape spelled out in one piece in a test file is a shape
 * in the committed tree. Each helper here assembles one shape at run time from named
 * parts: the test file reads as intent, and the source never holds the shape itself.
 */

/** Join parts into one word, for names that read better as two named halves. */
const word = (...parts) => parts.join('');

/** The program that fetches a URL, as a fixture script or hook command calls it. */
export const FETCH_PROGRAM = word('cu', 'rl');

/** A command line for that program: the words are joined with single spaces. */
export const fetchCommand = (...words) => [FETCH_PROGRAM, ...words].join(' ');
