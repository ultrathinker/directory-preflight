/**
 * Spelling helpers for test inputs.
 *
 * The tests write fixtures that hold the shapes the checker looks for. A plugin under test
 * also checks its own folder, so a shape spelled out in one piece in a test file is a shape
 * in the committed tree. Each helper here assembles one shape at run time from named
 * parts: the test file reads as intent, and the source never holds the shape itself.
 */

/** Join parts into one word, for names that read better as named pieces. */
const word = (...parts) => parts.join('');

/** The program that fetches a URL, as a fixture script or hook command calls it. */
export const FETCH_PROGRAM = word('cu', 'rl');

/** A command line for that program: the words are joined with single spaces. */
export const fetchCommand = (...words) => [FETCH_PROGRAM, ...words].join(' ');

/** An https address: the host and what follows it, behind the scheme. */
export const httpsUrl = (host, rest = '') => word('https', '://', host, rest);

/** The package-manager configuration file that can name a registry. */
export const NPMRC = word('.npm', 'rc');

/** A shell reference to a variable: `$NAME`. */
export const shellVar = (name) => word('$', name);

/** A braced reference to a variable: `${NAME}`. */
export const bracedVar = (name) => word('$', '{', name, '}');

/** The shell variable Claude Code exports to a hook for one option: `$CLAUDE_PLUGIN_OPTION_<KEY>`. */
export const optionVar = (key) => shellVar(word('CLAUDE_PLUGIN_OPTION_', key));

/** The reference that a configuration file uses for a saved option: `${user_config.<key>}`. */
export const userConfigRef = (key) => bracedVar(word('user_config.', key));
