export const TRANSCRIPTION_PROVIDER = Symbol('TRANSCRIPTION_PROVIDER');

export interface TranscriptEvent {
  text: string;
  isFinal: boolean; // interrim guess vs settled text - the one ASR concept the domain needs
  /**
   * Diarised speaker index, 0-based, or undefined when the provider could not
   * attribute the segment. These are voices, not people: the provider has no
   * idea which index is the moderator, and the numbering restarts at 0 every
   * time the stream reopens.
   */
  speaker?: number;
}

export interface TranscriptionStream {
  sendAudio(chunk: Buffer): void;
  close(): Promise<void>;
}

/** One speaker turn from a finished recording. */
export interface ArchiveUtterance {
  text: string;
  speaker?: number;
  /** Milliseconds from the start of the recording, so the archive transcript
   *  can be ordered and seeked even though the rows are written at once. */
  offsetMs: number;
}

export interface TranscriptionProvider {
  /**
   * Re-transcribe a finished recording at higher quality than the live pass.
   *
   * Optional: a provider without a batch API simply omits it and the archive
   * step is skipped. Streaming has to settle for diarisation v1, which splits
   * one speaker into several; batch sees the whole recording at once and gets
   * both the words and the speakers materially better.
   */
  archive?(
    filePath: string,
    opts: { keywords: string[] },
  ): Promise<ArchiveUtterance[]>;

  openStream(
    /**
     * diarise=false for a single-voice room. Streaming diarisation splits one
     * speaker into several when the voice varies - distance from the mic,
     * volume, laughter - and a false "Speaker 2" mid-monologue reads worse
     * than no labels at all.
     */
    opts: { room: string; keywords: string[]; diarise?: boolean },
    onTranscript: (event: TranscriptEvent) => void,
  ): Promise<TranscriptionStream>;
}
