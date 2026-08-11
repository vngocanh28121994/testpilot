/**
 * Source citation — item 30 (plan §53).
 *
 * Every business rule and requirement claim must be traceable to a source.
 * If the AI cannot find evidence, status must be 'unverified' — never promote
 * an assumption to a requirement.
 */

export interface SourceReference {
  /** Document identifier: filename, URL, Confluence page id, or Figma node id. */
  document: string;
  /** Page number for paginated documents (PDFs, Word). */
  page?: number;
  /** Section heading or anchor within the document. */
  section?: string;
  /** Line number within the section (for structured plain-text sources). */
  line?: number;
  /**
   * Verbatim excerpt from the source — kept ≤200 characters.
   * Must be quoted exactly as found; never paraphrased here.
   */
  quote?: string;
  /**
   * 'verified'  — AI found explicit evidence in the document.
   * 'unverified' — AI inferred but did not find direct textual evidence.
   */
  status: 'verified' | 'unverified';
}

/** Convenience: build a minimal verified reference. */
export function makeRef(document: string, section?: string, quote?: string): SourceReference {
  return { document, section, quote, status: 'verified' };
}

/** Convenience: build an unverified inference reference. */
export function makeInferredRef(document: string, section?: string): SourceReference {
  return { document, section, status: 'unverified' };
}
