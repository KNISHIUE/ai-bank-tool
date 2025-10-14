#!/usr/bin/env node
import express from "express";
import cors from "cors";
import { randomUUID } from "crypto";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

/** -------- ユーティリティ -------- */
function mkResult<T>(data: T) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: data as unknown as Record<string, unknown>,
  };
}

// 各ツール呼び出しのログを出力するラッパー
function withToolLogging<A, R>(
  toolName: string,
  handler: (args: A, extra: any) => R | Promise<R>
) {
  return async (args: A, extra: any): Promise<R> => {
    const startedAt = new Date().toISOString();
    // eslint-disable-next-line no-console
    console.log(`[MCP] ${toolName} start`, { startedAt, args });
    const t0 = Date.now();
    try {
      const result = await handler(args, extra);
      // eslint-disable-next-line no-console
      console.log(`[MCP] ${toolName} ok`, {
        ms: Date.now() - t0,
        finishedAt: new Date().toISOString(),
      });
      return result;
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.error(`[MCP] ${toolName} error`, {
        ms: Date.now() - t0,
        error: e?.message ?? String(e),
      });
      throw e;
    }
  };
}

/** -------- モック固定データ -------- */
const MOCK_NOW_ISO = "2025-09-24T09:00:00Z";

const MOCK_PAYEES = [
  {
    id: "P-0001",
    nickname: "A社",
    bank: "○○銀行",
    branch: "本店",
    accountType: "普通",
    accountLast4: "1234",
    nameKana: "エーシャ",
  },
  {
    id: "P-0002",
    nickname: "B社",
    bank: "△△銀行",
    branch: "渋谷",
    accountType: "普通",
    accountLast4: "9876",
    nameKana: "ビーシャ",
  },
];

const MOCK_ACCOUNTS = [
  { id: "ACC-001", type: "普通", last4: "3456", currency: "JPY", balance: 2345678 },
  { id: "ACC-002", type: "当座", last4: "1122", currency: "JPY", balance: 520000 },
];

const MOCK_LIMITS_FEES = {
  perTransactionLimit: 1000000,
  dailyRemainingLimit: 900000,
  estimatedFeeJPY: 330,
};

const MOCK_RISK_MEDIUM = {
  risk: "中" as const,
  reasonCodes: ["DEVICE_TRUST_MODERATE", "VELOCITY_NORMAL"],
};

const MOCK_TRANSFER_OK = {
  transactionId: "TX-000123",
  status: "success",
  bookedAt: MOCK_NOW_ISO,
  newBalance: 1234567,
};

const MOCK_TD_PRECHECK = {
  eligible: true,
  minAmount: 100000,
  productCode: "TD-STD-12M",
  termMonths: 12,
  rateAnnualPct: 0.25,
  kycRisk: "低",
};

const MOCK_TD_ACCEPTED = {
  termDepositId: "TD-000789",
  status: "accepted",
  startDate: "2025-09-24",
  maturityDate: "2026-09-24",
  rateAnnualPct: 0.25,
  handling: "利息を普通へ入金",
};

/** -------- MCPサーバ -------- */
const server = new McpServer({
  name: "ai-bank-tool",
  version: "0.1.0",
});

/** 1) OTPデバイス種別確認 */
server.registerTool(
  "otp_device_check",
  {
    title: "OTPデバイス種別確認",
    description:
      "振り込みできる条件かどうかを確認します。お客様が紙のご利用カードを利用している場合は利用可能ではありません。入力はユーザーID、出力は利用可能なら true、不可なら false を返します。",
    inputSchema: {
      userId: z.string(),
    },
  },
  withToolLogging("otp_device_check", async ({ userId }) => {
    const usesPaperCard = typeof userId === "string" && userId.toLowerCase().includes("paper");
    const allowed = !usesPaperCard;
    return mkResult({ allowed });
  }),
);

/** 2) 振込事前処理 */
server.registerTool(
  "pre_transfer_prep",
  {
    title: "振込事前処理",
    description:
      "振り込み事前処理を確認するためにユーザーの各種情報を返します。登録振込先・出金口座・限度額/手数料を返します。インプットはユーザーIDです。",
    inputSchema: { userId: z.string() },
  },
  withToolLogging(
    "pre_transfer_prep",
    async () =>
      mkResult({
        generatedAt: MOCK_NOW_ISO,
        payees: MOCK_PAYEES,
        sourceAccounts: MOCK_ACCOUNTS,
        limitAndFees: MOCK_LIMITS_FEES,
      })
  ),
);

/** 3) 振込内容照会 */
server.registerTool(
  "review_transfer",
  {
    title: "振込内容照会",
    description:
      "ユーザーID・出金口座情報・振込先を入力として、残高・限度額・手数料の最終チェックを行い、確認した内容をそのまま応答します（モック）。",
    inputSchema: {
      userId: z.string(),
      fromAccountId: z.string(),
      toPayeeId: z.string(),
      amountJPY: z.number().int().positive().optional(),
    },
  },
  withToolLogging("review_transfer", async ({ fromAccountId, toPayeeId, amountJPY }) => {
    const amount = amountJPY ?? 50000;
    return mkResult({
      checkedAt: MOCK_NOW_ISO,
      fromAccountId,
      toPayeeId,
      amountJPY: amount,
      sufficientBalance: true,
      withinLimit: amount <= MOCK_LIMITS_FEES.perTransactionLimit,
      feeJPY: MOCK_LIMITS_FEES.estimatedFeeJPY,
      advisory: "問題ありません（モック）",
    });
  }),
);

/** 4) ThreatMetrixリスク判定 */
server.registerTool(
  "threatmetrix_risk",
  {
    title: "ThreatMetrixリスク判定",
    description:
      "ユーザーID（任意のセッションIDと併用可）を基に端末・行動シグナルを評価し、低/中/高のリスク評価を返します。",
    inputSchema: { userId: z.string(), sessionId: z.string().optional() },
  },
  withToolLogging(
    "threatmetrix_risk",
    async () => mkResult({ evaluatedAt: MOCK_NOW_ISO, ...MOCK_RISK_MEDIUM })
  ),
);

/** 5) 第2暗証取得 */
server.registerTool(
  "obtain_second_password",
  {
    title: "第2暗証取得",
    description: "ユーザーIDを基に第2暗証の承認フローを開始し、端末側承認後のトークンを返します。",
    inputSchema: { userId: z.string(), authRequestId: z.string().optional() },
  },
  withToolLogging(
    "obtain_second_password",
    async () =>
      mkResult({
        approved: true,
        method: "app",
        token: "2FA-TOKEN-MOCK",
        expiresAt: "2025-12-31T00:00:00Z",
      })
  ),
);

/** 6) 振込実行 */
server.registerTool(
  "execute_transfer",
  {
    title: "振込実行",
    description:
      "ユーザーID・出金口座・振込先・金額（および必要に応じて第2暗証トークン/OTP）を受け取り、送金実行結果を返します。",
    inputSchema: {
      userId: z.string(),
      fromAccountId: z.string(),
      toPayeeId: z.string(),
      amountJPY: z.number().int().positive(),
      secondPasswordToken: z.string().optional(),
      otpCode: z.string().optional(),
      idempotencyKey: z.string().optional(),
    },
  },
  withToolLogging(
    "execute_transfer",
    async ({ fromAccountId, toPayeeId, amountJPY }) =>
      mkResult({
        executedAt: MOCK_NOW_ISO,
        fromAccountId,
        toPayeeId,
        amountJPY,
        ...MOCK_TRANSFER_OK,
      })
  ),
);

/** 7) 高リスク履歴の認証ステータス更新 */
server.registerTool(
  "update_high_risk_auth_status",
  {
    title: "高リスク履歴の認証ステータス更新",
    description:
      "ユーザーIDとケースIDを指定して、メールOTP等の照合結果に基づく認証ステータスを更新します。",
    inputSchema: {
      userId: z.string(),
      caseId: z.string(),
      otpVerified: z.boolean(),
    },
  },
  withToolLogging(
    "update_high_risk_auth_status",
    async ({ caseId, otpVerified }) =>
      mkResult({
        updatedAt: MOCK_NOW_ISO,
        caseId,
        otpVerified,
        status: "updated",
      })
  ),
);

/** 8) 定期移管事前処理 */
server.registerTool(
  "term_deposit_prep",
  {
    title: "定期移管事前処理",
    description:
      "ユーザーID・出金口座・金額（任意の商品/期間指定を含む）を基に、残高・商品条件・リスク観点の事前チェック結果を返します。",
    inputSchema: {
      userId: z.string(),
      fromAccountId: z.string(),
      amountJPY: z.number().int().positive(),
      termMonths: z.number().int().positive().optional(),
      productCode: z.string().optional(),
    },
  },
  withToolLogging(
    "term_deposit_prep",
    async ({ fromAccountId, amountJPY, termMonths, productCode }) =>
      mkResult({
        checkedAt: MOCK_NOW_ISO,
        fromAccountId,
        amountJPY,
        requested: { termMonths, productCode },
        ...MOCK_TD_PRECHECK,
      })
  ),
);

/** 9) 定期預金申込 */
server.registerTool(
  "apply_term_deposit",
  {
    title: "定期預金申込",
    description:
      "ユーザーID・出金口座・金額・期間等の条件を入力として、定期預金の申込結果を返します。",
    inputSchema: {
      userId: z.string(),
      fromAccountId: z.string(),
      amountJPY: z.number().int().positive(),
      termMonths: z.number().int().positive(),
      productCode: z.string().optional(),
      handling: z.string().optional(),
      idempotencyKey: z.string().optional(),
    },
  },
  withToolLogging(
    "apply_term_deposit",
    async ({ fromAccountId, amountJPY, termMonths, productCode, handling }) =>
      mkResult({
        appliedAt: MOCK_NOW_ISO,
        fromAccountId,
        amountJPY,
        termMonths,
        productCode,
        ...MOCK_TD_ACCEPTED,
        handling,
      })
  ),
);

/** -------- Streamable HTTP ルーター -------- */
const app = express();
app.use(express.json());

// ブラウザ系クライアント対応（Inspector等）：Mcp-Session-Id を見えるようにする
app.use(
  cors({
    origin: true,
    credentials: true,
    exposedHeaders: ["Mcp-Session-Id"],
  }),
);

// Streamable HTTP Transport はプロセス内で単一インスタンスを共有（セッション維持のため）
const httpTransport = new StreamableHTTPServerTransport({
  sessionIdGenerator: undefined,
  // enableDnsRebindingProtection: true,
  enableJsonResponse: true,
});

// サーバ起動時に一度だけ接続
await server.connect(httpTransport);

// 単一エンドポイント（POST）: リクエストを既存 transport に委譲
app.post("/mcp", async (req: express.Request, res: express.Response) => {
  await httpTransport.handleRequest(req, res, req.body);
});

// SSE 用: GET /mcp を同一 transport に委譲（Inspector が開く SSE ストリーム）
app.get("/mcp", async (req: express.Request, res: express.Response) => {
  await httpTransport.handleRequest(req, res);
});
app.delete("/mcp", async (req: express.Request, res: express.Response) => {
  await httpTransport.handleRequest(req, res);
});

// --- 互換: 一部ゲートウェイは /mcp/rpc を利用するため、同一ハンドラにエイリアスを提供 ---
app.post("/mcp/rpc", async (req: express.Request, res: express.Response) => {
  await httpTransport.handleRequest(req, res, req.body);
});
app.get("/mcp/rpc", async (req: express.Request, res: express.Response) => {
  await httpTransport.handleRequest(req, res);
});
app.delete("/mcp/rpc", async (req: express.Request, res: express.Response) => {
  await httpTransport.handleRequest(req, res);
});

// --- 互換: /mcp/health でもヘルスを返す ---
app.get("/mcp/health", (_req: express.Request, res: express.Response) => res.status(200).json({ ok: true }));

// ヘルスチェック
app.get("/health", (_req: express.Request, res: express.Response) => res.status(200).json({ ok: true }));

const port = parseInt(process.env.PORT || "8080", 10);
app
  .listen(port, () => {
    console.log(`MCP (Streamable HTTP) listening on http://localhost:${port}/mcp`);
  })
  .on("error", (err: unknown) => {
    console.error("Server error:", err);
    process.exit(1);
  });
