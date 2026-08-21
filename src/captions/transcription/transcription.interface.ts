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

export interface TranscriptionProvider {
  openStream(
    opts: { room: string; keywords: string[] },
    onTranscript: (event: TranscriptEvent) => void,
  ): Promise<TranscriptionStream>;
}
