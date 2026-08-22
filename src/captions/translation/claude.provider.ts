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

/**
 * Terms that must survive untranslated. Same list the transcription provider
 * hands Deepgram as keyterms, for the same reason: these are the words a
 * general-purpose model is most likely to mangle.
 */
const DO_NOT_TRANSLATE = ['Pitchathon', 'GBV', 'GS-26'];

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
  '- If a fragment carries nothing translatable - a filler, a stray syllable - return it unchanged.',
].join('\n');

const TranslationSchema = z.object({
  ha: z.string(),
  ig: z.string(),
  yo: z.string(),
  pcm: z.string(),
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
       * A caption nobody reads within a couple of seconds is worthless, so
       * fail fast instead of queueing behind a slow call. Retries cost the
       * same latency twice, which is why there is only one.
       */
      timeout: 5_000,
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
       * Translating one fragment is not a reasoning task, and every thinking
       * token is latency a delegate feels. Low effort rather than thinking
       * disabled: disabling it on Opus can leak reasoning into the answer.
       */
      output_config: {
        format: zodOutputFormat(TranslationSchema),
        effort: 'low',
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
    };
  }
}
