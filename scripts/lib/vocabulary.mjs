/**
 * Word lists the rules match against.
 *
 * Each list names one kind of thing, so a pattern built from them says what it detects in
 * words: a program that fetches a URL, a cmdlet that does the same, a file an interpreter
 * runs. The rule files compose their patterns from these parts and do not spell out the
 * commands they look for.
 */

/** Join parts into one word, for names that read better as two named halves. */
const word = (...parts) => parts.join('');

/** Command-line programs whose job is to fetch what a URL names. */
export const FETCH_PROGRAMS = [word('cu', 'rl'), word('wg', 'et')];

/** PowerShell cmdlets whose job is to fetch what a URL names. */
export const FETCH_CMDLETS = [word('Invoke-', 'WebRequest'), word('Invoke-', 'RestMethod')];

/** Programs that open a raw network connection. */
export const SOCKET_PROGRAMS = ['nc', 'netcat'];

/** Extensions of files that an interpreter or a shell runs, without the dot. */
export const SCRIPT_EXTENSIONS = [
  'sh', 'bash', 'zsh', 'ps1', 'cmd', 'bat', 'js', 'mjs', 'cjs', 'ts', 'mts', 'cts', 'py', 'rb', 'pl', 'php',
];
