# Batch Chat 🧮

Android app for asking batches of questions through the
[OpenRouter Batch API](https://openrouter.ai/docs/batch-quickstart) — one line =
one request, ~50% off the model's price — plus a live **Chat** tab.

## Download the APK

The latest standalone Android build (JS embedded, arm64-v8a, installable without
Metro or Expo Go) is attached to the GitHub release:

- **https://github.com/357357user357357/batch-chat/releases**

Download `batch-chat.apk` and open it on the phone to install. The release is
rebuilt automatically on every push to `main` (see
`.github/workflows/android.yml`).

## Features

- **Live chat**: instant answers from any OpenRouter model you pick. LaTeX
  answers render with MathJax, and **long-pressing** anywhere on a rendered
  answer copies the whole message to the clipboard **including its LaTeX
  formulas** — no need to switch to the raw `source` view (each formula is
  also copied as its LaTeX source, just like OpenRouter's own copy
  affordance).
- **Browse models**: an in-app catalog of *every* OpenRouter model — live and
  `:batch` together — searchable by name/id and sortable by newest, price
  (low→high or high→low) or context length, so you can hunt for interesting
  new models.
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

## Under the hood

- `src/app/batches.tsx` — the batch composer + history + export
- `src/app/chat.tsx` — the live chat screen
- `src/components/math-view.tsx` — MathJax LaTeX rendering with auto-height
  (no more clipped formulas)
- `src/components/model-browser.tsx` — searchable, sortable catalog of all models
- `src/services/openrouter.ts` — OpenRouter sync + batch + models catalog
## Server sync & security (HTTPS + cert pinning)

When pairing with the server, use its **https** URL (ask the server
administrator, or check the `SERVER_IP` in the server repo's gitignored
`.env`). The URL is entered once on the pairing screen and stored locally:

```
https://<server-ip>
```

The app embeds the server's root CA (`res/raw/batch_chat_ca.pem`) and pins it
via Android's network security config — the password, tokens and dialogs are
encrypted in transit, and Android refuses any certificate that was not issued
by that CA (man-in-the-middle protection). If the server certs are regenerated
(`scripts/gen-certs.sh` on the server), copy the new `ca.crt` here and rebuild.
