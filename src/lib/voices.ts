// The character voices, shared by the creator and the TTS route.
// The best-graded American English Kokoro-82M voices of each gender.
// Grades: https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md
// The labels are what the character creator saves in characters.voice.

export type VoiceGender = "female" | "male";

export type Voice = {
  label: string;
  id: string;
  gender: VoiceGender;
  description: string;
};

export const VOICES: readonly Voice[] = [
  { label: "Voice 1", id: "af_heart", gender: "female", description: "Warm" },
  { label: "Voice 2", id: "af_bella", gender: "female", description: "Bright" },
  { label: "Voice 3", id: "af_nicole", gender: "female", description: "Soft, close" },
  { label: "Voice 4", id: "am_michael", gender: "male", description: "Low, steady" },
  { label: "Voice 5", id: "am_fenrir", gender: "male", description: "Rough" },
  { label: "Voice 6", id: "am_puck", gender: "male", description: "Playful" },
];
