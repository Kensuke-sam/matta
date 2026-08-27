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
      const hasAnswers = user.includes("# 追加質問への回答");
      if (INCIDENT_RE.test(user)) {
        payload = { category: "incident", missing: [] };
      } else if (!hasAnswers && user.includes("変な連絡が来て困っています")) {
        // 質問フローE2E用: 初回だけ固定質問2問を要求する
        payload = { category: "consultation", missing: ["q_org", "q_request"] };
      } else {
        payload = { category: "consultation", missing: [] };
      }
    } else {
      // ドメイン別の生成応答。固定質問文には全ドメインの例示語が含まれるため、
      // 「- 質問:」行を除いた相談文・回答だけで判定する
      const judgeText = user
        .split("\n")
        .filter((line) => !line.trimStart().startsWith("- 質問:"))
        .join("\n");
      const base = baseVec(judgeText);
      const domainKey =
        base === null ? "police" : base[2] === 1 ? "yami" : base[1] === 1 ? "delivery" : "police";
      const byDomain = {
        police: {
          similar_cases: [
            "警察官を名乗り口座やお金の確認を求める手口の事例が公的資料にあります",
          ],
          safe_verification: [
            "いったん切って、警察相談専用電話#9110へ自分からかけて確認する",
          ],
        },
        delivery: {
          similar_cases: [
            "宅配業者を装う不在通知の文面で偽サイトへ誘導する手口が報告されています",
          ],
          safe_verification: [
            "メッセージのURLは開かず、公式アプリや公式サイトで荷物を確認する",
          ],
        },
        yami: {
          similar_cases: [
            "高額報酬をうたい身分証を送らせる闇バイト募集の手口が公的資料にあります",
          ],
          safe_verification: ["応募をやめて、警察相談専用電話#9110へ相談する"],
        },
      };
      payload = {
        related: true,
        danger_signs: ["相手の要求どおりに操作するよう急かされています"],
        normal_response: [
          "本物の機関や事業者が、この方法でお金や個人情報を求めることはありません",
        ],
        do_not: ["相手に言われたままの振り込みや情報の送信"],
        ...byDomain[domainKey],
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
