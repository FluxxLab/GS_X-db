import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { CaptionLanguage } from './languages';
import type {
  TranslationProvider,
  Translations,
} from './translation.interface';
import { DO_NOT_TRANSLATE, exampleLines, glossaryLines } from './glossary';

/**
 * Built once at module load. The glossary and worked examples are static
 * native-speaker input, so they belong inside the cached prefix: filling them
 * in costs roughly a tenth of normal input tokens per caption, not full price.
 */
const SYSTEM_PROMPT = [
  'You translate live conference captions for the GS-26 Gender & Inclusion Summit in Nigeria.',
  '',
  'What you receive:',
  '- Optionally, the preceding lines of transcript, marked as context. They are there so pronouns, continuations and half-finished thoughts make sense. Never translate them.',
  '- One fragment to translate. It is a slice of continuous speech: it may begin mid-sentence, end mid-sentence, or be a single interjection.',
  '',
  'Rules:',
  '- Translate the fragment into Hausa, Igbo, Yoruba and Nigerian Pidgin.',
  '- Translate only the fragment, and only what it says. Do not finish a half-spoken sentence, do not pull words in from the context, and do not add clarification the speaker did not give.',
  '- Keep a fragment a fragment. If it starts mid-sentence the translation should too; do not add an opening capital or a closing full stop the speaker has not reached.',
  '- Use correct orthography, including diacritics: Yoruba tone marks and sub-dots, Igbo dotted vowels, Hausa hooked letters. Stripping them is wrong, not a simplification.',
  '- Match the register. This is policy and advocacy discussion; Hausa, Igbo and Yoruba should read as the formal spoken language a broadcaster would use.',
  '- Nigerian Pidgin must read as natural spoken Pidgin, not English with a few words swapped. If your Pidgin line could pass for the English one, rework it.',
  '- Gender and inclusion vocabulary is the subject matter, not incidental. Use the established term in each language rather than a literal calque.',
  `- Leave these terms exactly as written: ${DO_NOT_TRANSLATE.join(', ')}.`,
  '- Keep names of people and organisations in their original form.',
  /**
   * These three replaced a single line reading "if a fragment carries nothing
   * translatable - a filler, a stray syllable - return it unchanged".
   *
   * Given a garbled fragment the model did not return it unchanged: it wrote
   * the Hausa and Pidgin for "this is nonsense" and put that on delegates'
   * screens as though the speaker had said it. Judging the input is a far
   * worse failure than translating it badly, because it is indistinguishable
   * from translation - so the ban is now explicit, and the fallback is
   * spelled out as copying the text rather than described.
   */
  '- Never comment on, judge or describe the fragment. Do not write that it is unclear, meaningless, nonsense, rubbish, an error, or not translatable - in English or in any target language. The reader cannot tell such a remark apart from a translation and will believe the speaker said it.',
  '- Every field must contain only a translation of the fragment, nothing else. No notes, no apologies, no explanation, no quotation marks you were not given.',
  '- If a fragment is filler, a stray syllable, or too garbled to carry meaning, copy the fragment into every field exactly as you received it. Copying it is always correct; describing it never is.',
  ...glossaryLines(),
  ...exampleLines(),
].join('\n');

const TranslationSchema = z.object({
  ha: z.string(),
  ig: z.string(),
  yo: z.string(),
  pcm: z.string(),
  fr: z.string(),
});

@Injectable()
export class ClaudeTranslationProvider implements TranslationProvider {
  private readonly logger = new Logger(ClaudeTranslationProvider.name);
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(config: ConfigService) {
    this.client = new Anthropic({
      apiKey: config.getOrThrow<string>('ANTHROPIC_API_KEY'),
      /**
       * Translation is off the critical path: the English caption is emitted
       * before this call is even made, so the only thing a longer timeout
       * delays is the translated line itself.
       *
       * Raised from 5s because that budget was being spent in the wrong
       * place. A wrong line delivered fast is worse than a right line
       * delivered a second later - the delegate reading Hausa cannot tell a
       * bad translation from a good one, so correctness has to win.
       */
      timeout: 12_000,
      maxRetries: 1,
    });
    this.model = config.get<string>('ANTHROPIC_MODEL') ?? 'claude-opus-5';
  }

  async translate(text: string, context: string[] = []): Promise<Translations> {
    /**
     * Fragments are short and often start mid-thought, and splitting finals at
     * speaker changes made them shorter still. Without the preceding lines the
     * model has to guess at pronouns, continuations and subject matter, which
     * is where most of the wrong-but-fluent output comes from. The context sits
     * in the user message, outside the cached prefix, because it changes every
     * call.
     */
    const prompt =
      context.length > 0
        ? [
          'Context (already spoken, do not translate):',
          ...context,
          '',
          'Fragment to translate:',
          text,
        ].join('\n')
        : text;

    const response = await this.client.messages.parse({
      model: this.model,
      max_tokens: 2048,
      /**
       * The rules never change, so they sit behind a cache breakpoint and cost
       * roughly a tenth as much on every caption after the first.
       */
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      /**
       * Medium, not low.
       *
       * "Translating one fragment is not a reasoning task" was true of the
       * translation and wrong about everything around it: the model also has
       * to hold a dozen rules, four orthographies and a register, and at low
       * effort it dropped them. Given a garbled fragment it wrote the Hausa
       * and Pidgin for "this is nonsense" into the caption panel - a comment
       * on the input, delivered as though the speaker had said it.
       *
       * The extra thinking costs about a second on a line that is already
       * behind the English one. That is the right trade for a caption a
       * delegate has no way of checking.
       */
      output_config: {
        format: zodOutputFormat(TranslationSchema),
        effort: 'medium',
      },
      messages: [{ role: 'user', content: prompt }],
    });

    const parsed = response.parsed_output;
    if (!parsed) {
      this.logger.warn(`no parsable translation for: ${text.slice(0, 60)}`);
      return {};
    }

    return {
      [CaptionLanguage.HA]: parsed.ha,
      [CaptionLanguage.IG]: parsed.ig,
      [CaptionLanguage.YO]: parsed.yo,
      [CaptionLanguage.PCM]: parsed.pcm,
      [CaptionLanguage.FR]: parsed.fr,
    };
  }
}
