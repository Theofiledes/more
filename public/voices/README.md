# Voices

This directory is empty by default. BMO's text-to-speech runs through Capacitor's
native `TextToSpeech` plugin on Android, with the browser's Web Speech API as the
fallback on desktop/web — neither needs a model file here, so nothing is shipped
in this repo.

## Using a custom Piper voice instead

If you'd rather have BMO speak through a local [Piper](https://github.com/rhasspy/piper)
voice model instead of the platform TTS:

1. Pick or train a Piper `.onnx` voice + its matching `.onnx.json` config.
2. Drop both files in this directory (e.g. `bmo.onnx` / `bmo.onnx.json`).
3. Wire a Piper playback path into the TTS code (`src/App.jsx`'s `useNativeTTS` hook
   is the integration point) — this isn't wired up out of the box, so it's a small
   amount of glue code on your end.

Voice models are typically tens of megabytes, which is why one isn't bundled here —
keeping the base clone small matters more than a default voice.
