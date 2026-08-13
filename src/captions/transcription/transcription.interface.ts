export const TRANSCRIPTION_PROVIDER = Symbol('TRANSCRIPTION_PROVIDER')


export interface TranscriptEvent {
    text: string;
    isFinal: boolean; // interrim guess vs settled text - the one ASR concept the domain needs
}

export interface TranscriptionStream{
    sendAudio(chunk: Buffer): void;
    close(): Promise<void>;
}

export interface TranscriptionProvider {
    openStream(
        opts: {room: string; keywords: string[]},
        onTranscript: (event: TranscriptEvent) => void,
    ): Promise<TranscriptionStream>
}