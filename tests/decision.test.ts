import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import sharp from "sharp";
import { catalog, defaults } from "../server/catalog.js";
import { createApp } from "../server/app.js";
import {
  buildDecisionInput, FoundryDecisionProvider, DecisionServiceError,
} from "../server/decision.js";

const config = {
  endpoint: "https://example.services.ai.azure.com/",
  deployment: "my-decision-1-1",
  auth: { type: "api-key" as const, key: "test-key-not-a-secret" },
  timeoutMs: 1000,
};
const input = () => buildDecisionInput(Buffer.from("normalized-png"));
const answers = () => Object.fromEntries(catalog.map(c => [
  c.id, { type: "choice", choice: defaults[c.id] },
]));
const success = () => Response.json({
  model: "microsoft-decision-1.1",
  answers: { ...answers(), hairColor: { type: "choice", choice: "pink" } },
});

test("live request uses supplied assets contract, named choices, deployment, and API-key auth", async () => {
  const provider = new FoundryDecisionProvider(config, {
    fetch: async (url, init) => {
      assert.equal(url, "https://example.services.ai.azure.com/providers/microsoft/v1/systemone");
      assert.equal(init?.method, "POST");
      assert.equal(init?.redirect, "error");
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("api-key"), config.auth.key);
      assert.equal(headers.get("Authorization"), null);
      assert.ok(init?.signal);
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, config.deployment);
      assert.match(body.state, /image:person\.png/);
      assert.deepEqual(body.assets, {
        "person.png": { type: "image", format: "png", data_base64: input().image.base64 },
      });
      assert.equal(body.image, undefined);
      assert.deepEqual(body.questions, input().questions);
      return success();
    },
  });
  const result = await provider.decide(input());
  assert.equal(result.mode, "live");
  assert.equal(result.appearance.hairColor, "pink");
  assert.equal(result.decisions.find(d => d.category === "hairColor")?.choice, "pink");
  assert.ok(result.decisions.every(d => d.confidence === null));
});

test("Azure ML endpoints use the scoring route and bearer-key authentication", async () => {
  for (const [path, expectedPath] of [
    ["", "/score"], ["/", "/score"], ["/score", "/score"], ["/score/", "/score"],
    ["/v1/systemone", "/v1/systemone"], ["/v1/systemone/", "/v1/systemone"],
  ]) {
    const provider = new FoundryDecisionProvider({
      ...config, endpoint: `https://example.centralus.inference.ml.azure.com${path}`,
    }, {
      fetch: async (url, init) => {
        assert.equal(url, `https://example.centralus.inference.ml.azure.com${expectedPath}`);
        const headers = new Headers(init?.headers);
        assert.equal(headers.get("Authorization"), `Bearer ${config.auth.key}`);
        assert.equal(headers.get("api-key"), null);
        assert.equal(init?.redirect, "error");
        return success();
      },
    });
    assert.equal((await provider.decide(input())).mode, "live");
  }
});

test("Entra auth obtains a bearer token without forwarding an API key", async () => {
  let tokenCalls = 0;
  const provider = new FoundryDecisionProvider({
    ...config,
    endpoint: "https://example.services.ai.azure.com/providers/microsoft/v1/systemone/",
    auth: { type: "entra" },
  }, {
    getToken: async signal => { tokenCalls++; assert.ok(signal); return "test-token"; },
    fetch: async (url, init) => {
      assert.equal(url, "https://example.services.ai.azure.com/providers/microsoft/v1/systemone");
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("Authorization"), "Bearer test-token");
      assert.equal(headers.get("api-key"), null);
      return success();
    },
  });
  await provider.decide(input());
  await provider.decide(input());
  assert.equal(tokenCalls, 2);
});

test("Entra auth requests the endpoint-specific scope from the credential", async () => {
  for (const [endpoint, expectedScope] of [
    ["https://example.services.ai.azure.com/", "https://cognitiveservices.azure.com/.default"],
    ["https://example.centralus.inference.ml.azure.com/", "https://ml.azure.com/.default"],
  ]) {
    let requestedScope: string | string[] | undefined;
    const provider = new FoundryDecisionProvider({
      ...config, endpoint, auth: { type: "entra" },
    }, {
      credential: {
        getToken: async (scope, options) => {
          requestedScope = scope;
          assert.ok(options?.abortSignal);
          return { token: "test-token", expiresOnTimestamp: Date.now() + 60_000 };
        },
      },
      fetch: async () => success(),
    });
    await provider.decide(input());
    assert.equal(requestedScope, expectedScope);
  }
});

test("live catalog and upload return model-selected features and a usable PNG", async () => {
  const image = await sharp({ create: { width: 10, height: 20, channels: 3, background: "#ad8261" } }).png().toBuffer();
  const provider = new FoundryDecisionProvider(config, {
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      const normalized = await sharp(Buffer.from(body.assets["person.png"].data_base64, "base64")).metadata();
      assert.equal(normalized.format, "png");
      assert.equal(normalized.width, 10);
      return success();
    },
  });
  const server = createApp(provider);
  const metadata = await request(server).get("/api/catalog").expect(200);
  assert.equal(metadata.body.mode, "live");
  assert.equal(metadata.body.endpoint, undefined);
  assert.equal(metadata.body.key, undefined);
  const response = await request(server).post("/api/generate").attach("image", image, "portrait.png").expect(200);
  assert.equal(response.body.mode, "live");
  assert.equal(response.body.appearance.hairColor, "pink");
  assert.equal((await sharp(Buffer.from(response.body.skin.split(",")[1], "base64")).metadata()).width, 64);
});

test("missing, mistyped, malformed, and unsupported answers never fall back to demo choices", async () => {
  const missing = answers();
  delete missing.hairColor;
  const payloads: unknown[] = [
    { answers: missing },
    { answers: { ...answers(), hairColor: { type: "choice", choice: "invented" } } },
    { answers: { ...answers(), hairColor: { type: "noul", noul: 0.8 } } },
    { answers: { ...answers(), hairColor: { type: "choice", choice: 1 } } },
    { answers: [] }, {}, null,
  ];
  for (const payload of payloads) {
    const provider = new FoundryDecisionProvider(config, { fetch: async () => Response.json(payload) });
    await assert.rejects(provider.decide(input()), (e: unknown) =>
      e instanceof DecisionServiceError && e.status === 502);
  }
});

test("upstream failures are actionable and do not expose credentials or response bodies", async () => {
  for (const [status, expected, message] of [
    [401, 503, /denied access/], [403, 503, /denied access/],
    [429, 503, /quota/], [500, 502, /HTTP 500/], [400, 502, /image assets/],
  ] as const) {
    let attempts = 0;
    const provider = new FoundryDecisionProvider(config, { fetch: async () => {
      attempts++;
      return new Response("sensitive upstream body", { status });
    } });
    await assert.rejects(provider.decide(input()), (e: unknown) => {
      assert.ok(e instanceof DecisionServiceError);
      assert.equal(e.status, expected);
      assert.match(e.message, message);
      assert.doesNotMatch(e.message, /sensitive|test-key/);
      return true;
    });
    assert.equal(attempts, 1);
  }
  const authFailure = new FoundryDecisionProvider({ ...config, auth: { type: "entra" } }, {
    getToken: async () => { throw new Error("sensitive token details"); },
    fetch: async () => { assert.fail("Should not call inference without credentials"); },
  });
  await assert.rejects(authFailure.decide(input()), /Could not authenticate/);
  const invalidJSON = new FoundryDecisionProvider(config, { fetch: async () => new Response("{invalid") });
  await assert.rejects(invalidJSON.decide(input()), /unreadable response/);
  const networkError = new FoundryDecisionProvider(config, { fetch: async () => { throw new Error("private network details"); } });
  await assert.rejects(networkError.decide(input()), /Could not reach/);
});

test("HTTP API preserves actionable live errors without producing a skin", async () => {
  const provider = new FoundryDecisionProvider(config, {
    fetch: async () => new Response("private upstream error", { status: 429 }),
  });
  const image = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#fff" } }).png().toBuffer();
  const response = await request(createApp(provider)).post("/api/generate").attach("image", image, "portrait.png").expect(503);
  assert.match(response.body.error, /quota/);
  assert.equal(response.body.skin, undefined);
});

test("Azure ML 424 reports the underlying model failure without exposing arbitrary diagnostics", async () => {
  for (const [status, expected] of [
    ["400", /model rejected the request/],
    ["404", /scoring URI/],
    ["401", /service-side credentials/],
    ["403", /service-side credentials/],
    ["429", /quota/],
    ["500", /inference logs and health/],
    [null, /inference logs and health/],
    ["private status", /inference logs and health/],
  ] as const) {
    const provider = new FoundryDecisionProvider(config, {
      fetch: async () => new Response("private upstream diagnostic", {
        status: 424,
        headers: {
          ...(status ? { "ms-azureml-model-error-statuscode": status } : {}),
          "ms-azureml-model-error-reason": "private reason",
          "x-request-id": "f8c1493e-ed0a-4361-afd8-95e3e7f6242f",
        },
      }),
    });
    await assert.rejects(provider.decide(input()), (error: unknown) => {
      assert.ok(error instanceof DecisionServiceError);
      assert.equal(error.status, 502);
      assert.match(error.message, /HTTP 424/);
      if (status && /^[45]\d{2}$/.test(status)) assert.match(error.message, new RegExp(`model HTTP ${status}`));
      assert.match(error.message, expected);
      assert.match(error.message, /Request ID: f8c1493e-ed0a-4361-afd8-95e3e7f6242f/);
      assert.doesNotMatch(error.message, /private|test-key/);
      return true;
    });
  }
});

test("Azure ML wrapped image errors surface minimum dimensions and preserve failed generation", async () => {
  const provider = new FoundryDecisionProvider(config, {
    fetch: async () => Response.json({
      error: "invalid_image",
      message: "asset 'person.png' is 8x8; each side must be at least 280 pixels",
      detail: "private diagnostics",
    }, { status: 424, headers: { "ms-azureml-model-error-statuscode": "400" } }),
  });
  const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#fff" } }).png().toBuffer();
  const response = await request(createApp(provider)).post("/api/generate").attach("image", image, "portrait.png").expect(502);
  assert.match(response.body.error, /each side must be at least 280 pixels/);
  assert.match(response.body.error, /Choose a larger photo/);
  assert.doesNotMatch(response.body.error, /private/);
  assert.equal(response.body.skin, undefined);
});

test("unrecognized or unreadable wrapped model errors retain HTTP 424 without leaking the body", async () => {
  for (const body of [
    "{invalid",
    JSON.stringify({ error: "invalid_image", message: "private diagnostic" }),
    JSON.stringify({ error: "other", message: "asset 'person.png' is 8x8; each side must be at least 280 pixels" }),
  ]) {
    const provider = new FoundryDecisionProvider(config, {
      fetch: async () => new Response(body, {
        status: 424,
        headers: {
          "Content-Type": "application/json",
          "ms-azureml-model-error-statuscode": "400",
          "x-request-id": "private request id",
        },
      }),
    });
    await assert.rejects(provider.decide(input()), (error: unknown) => {
      assert.ok(error instanceof DecisionServiceError);
      assert.match(error.message, /HTTP 424; model HTTP 400/);
      assert.match(error.message, /model rejected the request/);
      assert.doesNotMatch(error.message, /private|280|unreadable/);
      return true;
    });
  }
});

test("rejected image assets report the route contract mismatch without exposing upstream details", async () => {
  const provider = new FoundryDecisionProvider(config, {
    fetch: async () => Response.json({
      error: {
        code: "unrecognized_request_argument",
        message: "Unrecognized request argument supplied: assets",
        details: "private diagnostic details",
      },
    }, { status: 400 }),
  });
  await assert.rejects(provider.decide(input()), (e: unknown) => {
    assert.ok(e instanceof DecisionServiceError);
    assert.equal(e.status, 502);
    assert.match(e.message, /rejected the assets field/);
    assert.match(e.message, /resource and endpoint/);
    assert.doesNotMatch(e.message, /private diagnostic/);
    return true;
  });
  const differentError = new FoundryDecisionProvider(config, {
    fetch: async () => Response.json({
      error: { code: "unrecognized_request_argument", message: "Unrecognized request argument supplied: other" },
    }, { status: 400 }),
  });
  await assert.rejects(differentError.decide(input()), /returned HTTP 400/);
});

test("request deadline cancels inference instead of leaving generation running", async () => {
  const provider = new FoundryDecisionProvider({ ...config, timeoutMs: 5 }, {
    fetch: async (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    }),
  });
  // AbortSignal.timeout is unref'd; keep the test process alive until its callback runs.
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(provider.decide(input()), (e: unknown) =>
      e instanceof DecisionServiceError && e.status === 504);
  } finally { clearTimeout(keepAlive); }
});

test("configuration rejects invalid routes, credentials, deployment, and deadlines", () => {
  for (const endpoint of ["", "http://example.com", "https://example.com/api/projects/test", "https://example.com/?key=secret", "https://user:pass@example.com", "https://example.com/score", "https://example.centralus.inference.ml.azure.com/providers/microsoft/v1/systemone", "https://example.centralus.inference.ml.azure.com/score?key=secret"]) {
    assert.throws(() => new FoundryDecisionProvider({ ...config, endpoint }), /DECISION_ENDPOINT/);
  }
  assert.throws(() => new FoundryDecisionProvider({ ...config, deployment: "" }), /DECISION_DEPLOYMENT/);
  assert.throws(() => new FoundryDecisionProvider({ ...config, auth: { type: "api-key", key: "" } }), /DECISION_API_KEY/);
  for (const timeoutMs of [0, -1, 180001, NaN, 1.5]) {
    assert.throws(() => new FoundryDecisionProvider({ ...config, timeoutMs }), /DECISION_TIMEOUT_MS/);
  }
});
