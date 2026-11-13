# Block & You — Minecraft Character Building
Using Microsoft Decision model to build a Minecraft character skin

A React/TypeScript web app with a Node/Express backend. Upload a person's photograph on the left, preview a rotatable classic Minecraft character on the right, customize its appearance, and download a 64×64 RGBA PNG skin.

## Run locally

Requires Node.js 22+ and npm.

```sh
npm install
cp .env.example .env
npm run dev
```

Open `http://127.0.0.1:5173`. The backend listens on `127.0.0.1:3001`. For a production build:

```sh
npm run build
npm start
```

Open `http://127.0.0.1:3001`. The backend serves the compiled frontend. `HOST` and `PORT` configure the backend; the development proxy expects port 3001. Bind to a non-loopback address only when intentionally exposing the app.

## Decision 1.1 photo analysis

The live adapter uses the image contract supplied for this project: base64 image data in `assets`, with `image:<name>` referenced in `state`. It sends all 12 catalog-driven `choice` questions in one JSON request to `/providers/microsoft/v1/systemone`.

The default `DECISION_MODE=demo` returns a fixed, clearly labeled preset. It does not analyze the photo or invent confidence scores. The manual editor and PNG generation work independently. `DECISION_MODE=placeholder` also keeps the manual editor available, but explicitly returns HTTP 503 when photo analysis is requested.

To enable live analysis, deploy an **image-capable Microsoft Decision 1.1** model and set these values in `.env`:

```dotenv
DECISION_MODE=live
DECISION_ENDPOINT=https://YOUR-RESOURCE.services.ai.azure.com
DECISION_DEPLOYMENT=YOUR-DEPLOYMENT-NAME
DECISION_AUTH=entra
DECISION_TIMEOUT_MS=60000
```

`DECISION_ENDPOINT` accepts either the resource root or the full `/providers/microsoft/v1/systemone` route, not a project endpoint. `DECISION_DEPLOYMENT` is your deployment name, not necessarily the model name. Restart the backend after changing configuration.

**Microsoft Entra authentication:** The backend uses `DefaultAzureCredential` from `@azure/identity`, which refreshes tokens. Run `az login` locally, or configure a managed identity in Azure. The identity needs inference access to the Foundry resource (for example, **Cognitive Services User**). The token scope is `https://cognitiveservices.azure.com/.default`.

**API-key authentication:** If your resource permits local authentication, use:

```dotenv
DECISION_AUTH=api-key
DECISION_API_KEY=YOUR-RESOURCE-KEY
```

Credentials never go to the browser. Live mode validates configuration at startup; incomplete configuration does not silently select demo mode.

The request contains this structure, with `questions` generated from `server/data/options.json`:

```json
{
  "model": "YOUR-DEPLOYMENT-NAME",
  "state": "... image:person.png ...",
  "assets": {
    "person.png": {
      "type": "image",
      "format": "png",
      "data_base64": "<normalized photo bytes as base64>"
    }
  },
  "questions": {
    "hairColor": {
      "type": "choice",
      "instructions": "Which hair color is the closest visible match?",
      "criteria": {"black": "Near-black hair", "chestnut": "Warm medium brown hair"}
    }
  }
}
```

Each response must include `answers.<category>.type: "choice"` and a `choice` ID from that category. Missing answers, unknown choices, malformed JSON, authentication errors, quota errors, network errors, and timeouts are surfaced explicitly; the adapter never silently substitutes default selections. Choice confidence remains `null` because the supplied image example does not specify the probability field schema.

The request deadline defaults to 60 seconds (maximum 180 seconds), covers authentication/inference, and aborts slow requests. Requests are not automatically retried, avoiding duplicate inference submissions. HTTP redirects are rejected rather than forwarding credentials or photos.

## Backend wardrobe and rendering

`server/data/options.json` holds 12 appearance categories with editable labels, questions, default choices, descriptions, and color swatches. This is the single source for the editor and model questions. Add colors freely; adding new geometric style IDs also requires a rendering implementation in `server/skin.ts`.

The renderer paints the standard modern classic UV layout, including both arms, both legs, and transparent overlay layers. Hair, sleeve length, glasses, shirt details, skirts, shoes, and colors affect the texture. Skirts and hair are pixel-art interpretations on standard geometry, not custom meshes. The 3D preview uses skinview3d, with a front-view canvas fallback when WebGL is unavailable.

Photos are accepted as single-frame PNG/JPEG/WebP, limited to 10 MB and 24 megapixels, decoded on the backend, auto-oriented, resized to at most 1536 pixels per side, and re-encoded as PNG without original metadata. Files and generated skins are not persisted by this app. Demo/placeholder uploads stay in server memory and never go to an AI service. Live mode sends the normalized photo to your configured Foundry deployment; that service's data handling policies apply. API responses use `Cache-Control: no-store`; credentials belong in the ignored `.env`.

## Import your skin

- **Java Edition:** Launcher → Skins → New skin → select **Classic**, browse to the downloaded PNG, then save/use.
- **Bedrock on Windows/mobile:** Dressing Room → Classic Skins → Owned → Import → Choose New Skin. Choose the classic/wide-arm model.

Custom file import availability varies by platform; consoles generally do not expose this file picker. Preserve the PNG's original 64×64 size.

## Checks

```sh
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

The tests cover upload validation, image normalization, demo/placeholder/live modes, the supplied image request contract, both authentication paths, invalid model answers, upstream errors and deadlines, catalog-driven questions, UV opacity/transparency, appearance edits, PNG downloads, and the desktop/mobile UI. Live API tests use mocked responses and do not send images to Azure. An actual deployment and credentials are required to verify real model inference.

Not affiliated with Mojang or Microsoft.
