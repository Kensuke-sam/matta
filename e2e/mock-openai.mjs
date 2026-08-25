/**
 * E2E専用のOpenAI APIモックサーバー。
 * アプリ側はOPENAI_BASE_URLでここへ向く。実APIへは一切接続しない。
 * Embeddingはドメインキーワードで決定的なベクトルを返す。
 */
import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_OPENAI_PORT ?? 8965);
const CORPUS_SIZE = 12;

function baseVec(text) {
  if (/(闇バイト|副業|身分証|即日即金|高収入)/.test(text)) return [0, 0, 1];
  if (/(不在|宅配|フィッシング|偽サイト|SMS)/.test(text)) return [0, 1, 0];
  if (/(警察|逮捕|取り調べ)/.test(text)) return [1, 0, 0];
  return null; // 圏外
}

function vecFor(text, index, isCorpus) {
  const base = baseVec(text);
  if (base === null) return [0, 0, 0, 1];
  const noise = isCorpus ? 0.005 * (index + 1) : 0;
  return [...base, noise];
}

const INCIDENT_RE = /(振り込んで|渡して|払って|送って|入力して)しま/;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function json(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/healthz") {
    res.writeHead(200);
    res.end("ok");
    return;
  }
  if (req.method !== "POST") {
    json(res, 404, { error: "not found" });
    return;
  }
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    json(res, 400, { error: "bad json" });
    return;
  }

  if (req.url === "/v1/embeddings") {
    const inputs = Array.isArray(body.input) ? body.input : [body.input];
    const isCorpus = inputs.length === CORPUS_SIZE;
    const data = inputs.map((text, index) => ({
      object: "embedding",
      index,
      embedding: vecFor(String(text), index, isCorpus),
    }));
    json(res, 200, { object: "list", data, model: body.model });
    return;
  }

  if (req.url === "/v1/chat/completions") {
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const system = messages.find((m) => m.role === "system")?.content ?? "";
    const user = messages
      .filter((m) => m.role === "user")
      .map((m) => m.content)
      .join("\n");
    let payload;
    if (system.includes("トリアージ")) {
      payload = INCIDENT_RE.test(user)
        ? { category: "incident", missing: [] }
        : { category: "consultation", missing: [] };
    } else {
      payload = {
        related: true,
        similar_cases: [
          "警察官などを名乗って口座やお金の確認を求める手口の事例が公的資料にあります",
        ],
        danger_signs: ["電話やビデオ通話でお金や口座の話が出ています"],
        normal_response: [
          "本物の警察がメッセージアプリで連絡したり手帳の画像を送ったりすることはありません",
        ],
        do_not: ["言われた口座への振り込みやカードの引き渡し"],
        safe_verification: [
          "いったん切って、警察相談専用電話#9110へ自分からかけて確認する",
        ],
      };
    }
    json(res, 200, {
      id: "mock-completion",
      object: "chat.completion",
      model: body.model,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: JSON.stringify(payload) },
          finish_reason: "stop",
        },
      ],
    });
    return;
  }

  json(res, 404, { error: "not found" });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[mock-openai] listening on http://127.0.0.1:${PORT}`);
});
