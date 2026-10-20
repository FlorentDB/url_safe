/**
 * Unicode confusable and mixed-script detection.
 *
 * This is the JavaScript counterpart of `app/unicode_security.py`. It reads
 * the tables exported by `python -m app.export_datasets`, which are trimmed
 * to the characters that can be confusable with Latin, the only relation the
 * product asks about.
 *
 * The exported tables use the same shape as the `confusable-homoglyphs`
 * package: a map from a character to the list of characters it can be
 * mistaken for, and the script ranges that assign a script to every code
 * point.
 */

/** The Unicode script aliases, in the order used by the script ranges. */
export class ScriptTable {
  /**
   * @param {number[][]} ranges `[start, end, aliasIndex, categoryIndex]` rows
   * @param {string[]} aliases the script alias names
   */
  constructor(ranges, aliases) {
    this.ranges = ranges;
    this.aliases = aliases;
  }

  /**
   * The script a character belongs to.
   *
   * @param {string} character a single character
   * @returns {string} the script alias, or `Unknown`
   */
  alias(character) {
    const codePoint = character.codePointAt(0);
    let low = 0;
    let high = this.ranges.length - 1;

    while (low <= high) {
      const middle = (low + high) >> 1;
      const range = this.ranges[middle];
      if (codePoint < range[0]) {
        high = middle - 1;
      } else if (codePoint > range[1]) {
        low = middle + 1;
      } else {
        return this.aliases[range[2]];
      }
    }

    return "Unknown";
  }

  /**
   * Every distinct script used in a string.
   *
   * @param {string} value the string to inspect
   * @returns {Set<string>} the script aliases
   */
  uniqueAliases(value) {
    const aliases = new Set();
    for (const character of value) {
      aliases.add(this.alias(character));
    }
    return aliases;
  }
}

/**
 * The confusable table, mapping a character to the characters it can be
 * mistaken for.
 */
export class ConfusableTable {
  /**
   * @param {Record<string, string[]>} table the exported confusables
   * @param {ScriptTable} scripts the script table
   */
  constructor(table, scripts) {
    this.table = table;
    this.scripts = scripts;
  }

  /**
   * The characters a given character can be mistaken for, restricted to the
   * ones belonging to the preferred script.
   *
   * @param {string} character a single character
   * @param {string} preferred the script to keep
   * @returns {string[] | null} the matching characters, or null
   */
  preferredHomoglyphs(character, preferred) {
    const entries = this.table[character];
    if (!entries) {
      return null;
    }

    const matches = [];
    for (const entry of entries) {
      for (const glyph of entry) {
        if (this.scripts.alias(glyph) === preferred) {
          matches.push(glyph);
        }
      }
    }

    return matches.length > 0 ? matches : null;
  }

  /**
   * Whether a string mixes scripts, ignoring the allowed ones.
   *
   * @param {string} value the string to inspect
   * @param {string[]} allowed the scripts to ignore
   * @returns {boolean} true when more than one script remains
   */
  isMixedScript(value, allowed = ["COMMON"]) {
    const aliases = this.scripts.uniqueAliases(value);
    for (const alias of allowed) {
      aliases.delete(alias);
    }
    return aliases.size > 1;
  }

  /**
   * Whether a string is dangerous: it mixes scripts and contains a
   * character that can be mistaken for one in the preferred script.
   *
   * @param {string} value the string to inspect
   * @param {string} preferred the script to protect
   * @returns {boolean} true when the string is dangerous
   */
  isDangerous(value, preferred) {
    if (!this.isMixedScript(value)) {
      return false;
    }
    for (const character of new Set(value)) {
      if (this.scripts.alias(character) === preferred) {
        continue;
      }
      if (this.preferredHomoglyphs(character, preferred)) {
        return true;
      }
    }
    return false;
  }
}

/**
 * The labels of a hostname that mix scripts and contain a character that can
 * be mistaken for Latin.
 *
 * @param {ConfusableTable} confusables the confusable table
 * @param {string} hostname the Unicode hostname
 * @returns {string[]} the suspicious labels
 */
export function dangerousMixedScriptLabels(confusables, hostname) {
  const suspicious = [];
  for (const label of hostname.split(".")) {
    if (confusables.isDangerous(label, "LATIN")) {
      suspicious.push(label);
    }
  }
  return suspicious;
}

/**
 * Compare a candidate label with a reference label, character by character,
 * and report the characters that can be mistaken for the reference ones.
 *
 * @param {ConfusableTable} confusables the confusable table
 * @param {string} candidate the candidate label
 * @param {string} reference the reference label
 * @returns {{character: string, matches: string}[] | null} the matches, or null
 */
export function confusableCharacters(confusables, candidate, reference) {
  if (candidate.length !== reference.length) {
    return null;
  }

  const matches = [];
  for (let index = 0; index < candidate.length; index += 1) {
    const candidateCharacter = candidate[index];
    const referenceCharacter = reference[index];

    if (candidateCharacter === referenceCharacter) {
      continue;
    }
    if (candidateCharacter.codePointAt(0) < 0x80) {
      return null;
    }

    const homoglyphs = confusables.preferredHomoglyphs(candidateCharacter, "LATIN");
    if (!homoglyphs) {
      return null;
    }
    if (!homoglyphs.some((glyph) => glyph.toLowerCase() === referenceCharacter.toLowerCase())) {
      return null;
    }

    matches.push({ character: candidateCharacter, matches: referenceCharacter });
  }

  return matches.length > 0 ? matches : null;
}
