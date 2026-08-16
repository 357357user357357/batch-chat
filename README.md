# Fable5 🧮

Android (and web) app for asking batches of questions through the
[OpenRouter Batch API](https://openrouter.ai/docs/batch-quickstart) — one line =
one request, ~50% off the model's price — plus a live **Chat** tab.

## Download the APK

The latest standalone Android build (JS embedded, arm64-v8a, installable without
Metro or Expo Go) is attached to the GitHub release:

- **https://github.com/357357user357357/my-fable5-app/releases**

Download `fable5-app.apk` and open it on the phone to install. The release is
rebuilt automatically on every push to `main` (see
`.github/workflows/android.yml`).

## Features

- **Language**: English (default) ⇄ Russian — the EN|RU toggle lives on the
  main screens and remembers your choice.
- **Live chat**: instant answers from any OpenRouter model you pick from the
  live catalog (the list loads from `openrouter.ai/api/v1/models`, tap
  `refresh` to re-fetch). LaTeX answers render with MathJax.
- **Batches**: compose up to 30 questions, pick a `…:batch` model from the same
  catalog, and watch them complete in the background — even across restarts
  (history is persisted on-device and in-flight batches resume automatically).
- **Export**: every finished batch can be saved as `.csv` or a full JSON
  journal (Android opens the system “Save” dialog, other platforms use the
  share sheet).
- Your OpenRouter key is stored in the device's secure storage (Android
  Keystore), never in the bundle — unless you put it in `.env.local` for
  development (gitignored).

## Get started (dev)

```bash
npm install
npx expo start
```

- Android device build: `npx expo run:android`
- Web: press `w` in the Expo terminal

## Under the hood

- `src/app/batches.tsx` — the batch composer + history + export
- `src/app/chat.tsx` — the live chat screen
- `src/components/math-view.tsx` — MathJax LaTeX rendering with auto-height
  (no more clipped formulas)
- `src/services/openrouter.ts` — OpenRouter sync + batch + models catalog
- `src/i18n/` — English/Russian strings (default: English)