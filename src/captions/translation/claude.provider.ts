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
  'Rules:',
  '- Translate the English caption into Hausa, Igbo, Yoruba and Nigerian Pidgin.',
  '- Captions are fragments of continuous speech. Translate what is there. Never add, explain, or finish a half-spoken sentence.',
  '- Match the register of the original. This is policy and advocacy discussion, not casual conversation, but Nigerian Pidgin should read as natural spoken Pidgin rather than transliterated English.',
  `- Leave these terms exactly as written: ${DO_NOT_TRANSLATE.join(', ')}.`,
  '- Keep names of people and organisations in their original form.',
  '- If a fragment carries nothing translatable, return it unchanged.',
].join('\n');

/**
 * `output_config.effort` is only valid on the Opus/Sonnet-5 tier. Haiku 4.5 and
 * Sonnet 4.5 reject it outright (400), so it has to be omitted rather than
 * hardcoded - otherwise switching ANTHROPIC_MODEL to Haiku fails every call.
 * Those models also do not think unless explicitly asked, which is what we want
 * here anyway: no thinking tokens, no thinking latency.
 */
const supportsEffort = (model: string): boolean =>
  !/haiku|sonnet-4-5/i.test(model);

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
  private readonly effort?: 'low';

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
    /**
     * Haiku 4.5 by default: translating a one-sentence fragment is not a
     * reasoning task, and this is the latency a delegate reads through. Set
     * ANTHROPIC_MODEL=claude-opus-5 to trade cost back for quality - the
     * effort guard below keeps either choice a config change, not a code one.
     */
    this.model = config.get<string>('ANTHROPIC_MODEL') ?? 'claude-haiku-4-5';
    this.effort = supportsEffort(this.model) ? 'low' : undefined;
  }

  async translate(text: string): Promise<Translations> {
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
       * On Haiku no `thinking` block is sent, so the model does not think at
       * all - the cheapest possible latency for a task that needs none. On the
       * Opus/Sonnet-5 tier thinking is on by default, so effort is dialled to
       * 'low' rather than disabled outright: disabling it on Opus can leak
       * reasoning into the visible answer.
       */
      output_config: {
        format: zodOutputFormat(TranslationSchema),
        ...(this.effort ? { effort: this.effort } : {}),
      },
      messages: [{ role: 'user', content: text }],
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
