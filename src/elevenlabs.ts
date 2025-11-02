/**
 * ElevenLabs Text-to-Speech Integration via Cloudflare AI Gateway
 */

export interface ElevenLabsConfig {
  accountId?: string;  // Optional - not used in direct API calls
  gatewayId?: string;  // Optional - not used in direct API calls
  apiKey: string;
}

export interface TextToSpeechOptions {
  text: string;
  voiceId?: string;
  modelId?: string;
  outputFormat?: string;
}

export interface TextToSpeechResult {
  audio: ArrayBuffer;
  contentType: string;
}

/**
 * ElevenLabs client for text-to-speech conversion
 */
export class ElevenLabsClient {
  private config: ElevenLabsConfig;

  // Default voice ID (Rachel - professional female voice)
  private static readonly DEFAULT_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb";

  // Default model (multilingual v2 - supports Portuguese)
  private static readonly DEFAULT_MODEL_ID = "eleven_multilingual_v2";

  // Default output format
  private static readonly DEFAULT_OUTPUT_FORMAT = "mp3_44100_128";

  constructor(config: ElevenLabsConfig) {
    this.config = config;
  }

  /**
   * Convert text to speech using ElevenLabs API
   * NOTE: Direct API call (not via AI Gateway) because ElevenLabs free tier
   * blocks requests from proxies/gateways
   */
  async textToSpeech(options: TextToSpeechOptions): Promise<TextToSpeechResult> {
    const {
      text,
      voiceId = ElevenLabsClient.DEFAULT_VOICE_ID,
      modelId = ElevenLabsClient.DEFAULT_MODEL_ID,
      outputFormat = ElevenLabsClient.DEFAULT_OUTPUT_FORMAT
    } = options;

    // Direct ElevenLabs API URL (not using AI Gateway due to free tier restrictions)
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=${outputFormat}`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": this.config.apiKey
      },
      body: JSON.stringify({
        text,
        model_id: modelId
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `ElevenLabs API error: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    const audio = await response.arrayBuffer();

    return {
      audio,
      contentType: response.headers.get("content-type") || "audio/mpeg"
    };
  }

  /**
   * Get available voice IDs
   * Common Portuguese-compatible voices:
   * - JBFqnCBsd6RMkjVDRZzb: Rachel (English, but works well with multilingual model)
   * - pNInz6obpgDQGcFmaJgB: Adam
   * - EXAVITQu4vr4xnSDxMaL: Bella
   */
  static getVoiceIds() {
    return {
      rachel: "JBFqnCBsd6RMkjVDRZzb",
      adam: "pNInz6obpgDQGcFmaJgB",
      bella: "EXAVITQu4vr4xnSDxMaL",
      elli: "MF3mGyEYCl7XYWbV9V6O",
      josh: "TxGEqnHWrfWFTfGW9XjX",
      arnold: "VR6AewLTigWG4xSOukaG",
      domi: "AZnzlk1XvdvUeBnXmlld",
      nicole: "piTKgcLEGmPE4e6mEKli"
    };
  }
}