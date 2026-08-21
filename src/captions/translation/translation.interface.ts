import type { CaptionLanguage } from './languages';

export const TRANSLATION_PROVIDER = Symbol('TRANSLATION_PROVIDER');

export type Translations = Partial<Record<CaptionLanguage, string>>;

export interface TranslationProvider {
  /**
   * Translate one finalised caption into every target language. Implementations
   * return all languages from a single call: the fragment is short, so the
   * per-request overhead dominates, and one call keeps the four translations
   * consistent with each other.
   */
  translate(text: string): Promise<Translations>;
}
