#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ---- ユーティリティ：構造化+テキスト(後方互換)で返す ----
function mkResult<T>(data: T) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: data as unknown as Record<string, unknown>,
  };
}

// ---- モック固定データ ----
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
  }
];

const MOCK_ACCOUNTS = [
  { id: "ACC-001", type: "普通", last4: "3456", currency: "JPY", balance: 2345678 },
  { id: "ACC-002", type: "当座", last4: "1122", currency: "JPY", balance: 520000 }
];

const MOCK_LIMITS_FEES = {
  perTransactionLimit: 1000000,             // ¥1,000,000
  dailyRemainingLimit: 900000,              // ¥900,000
  estimatedFeeJPY: 330
};

const MOCK_RISK_MEDIUM = {
  risk: "中" as const,                       // 低／中／高
  reasonCodes: ["DEVICE_TRUST_MODERATE", "VELOCITY_NORMAL"]
};

const MOCK_TRANSFER_OK = {
  transactionId: "TX-000123",
  status: "success",
  bookedAt: MOCK_NOW_ISO,
  newBalance: 1234567
};

const MOCK_TD_PRECHECK = {
  eligible: true,
  minAmount: 100000,
  productCode: "TD-STD-12M",
  termMonths: 12,
  rateAnnualPct: 0.25,
  kycRisk: "低"
};

const MOCK_TD_ACCEPTED = {
  termDepositId: "TD-000789",
  status: "accepted",
  startDate: "2025-09-24",
  maturityDate: "2026-09-24",
  rateAnnualPct: 0.25,
  handling: "利息を普通へ入金"
};

// ---- サーバ起動 ----
const server = new McpServer({
  name: "ai-bank-tool",
  version: "0.1.0"
});

// 1) 画面遷移ユーティリティMCP：OTPデバイス種別確認（紙カードでないことを確認）
server.registerTool(
  "otp_device_check",
  {
    title: "OTPデバイス種別確認",
    description: "端末が紙カードではないことを確認します（モック固定）",
    inputSchema: {
      declaredDeviceType: z.enum(["app", "sms", "email", "paper_card"]).optional()
    }
  },
  async ({ declaredDeviceType }) => {
    const device = declaredDeviceType ?? "app";
    const allowed = device !== "paper_card";
    return mkResult({
      checkedAt: MOCK_NOW_ISO,
      deviceType: device,
      isPaperCard: !allowed,
      allowed,
      message: allowed ? "非紙カードのため許可" : "紙カードのため不可"
    });
  }
);

// 2) 振込事前処理MCP：登録振込先一覧取得／出金口座リスト&残高取得／限度額・手数料見積
server.registerTool(
  "pre_transfer_prep",
  {
    title: "振込事前処理",
    description: "登録振込先・出金口座・限度額/手数料のモックを返却",
    inputSchema: { customerId: z.string().optional() }
  },
  async () => {
    return mkResult({
      generatedAt: MOCK_NOW_ISO,
      payees: MOCK_PAYEES,
      sourceAccounts: MOCK_ACCOUNTS,
      limitAndFees: MOCK_LIMITS_FEES
    });
  }
);

// 3) 振込内容照会MCP：残高・限度額・手数料の最終チェック
server.registerTool(
  "review_transfer",
  {
    title: "振込内容照会",
    description: "残高・限度額・手数料チェックのモック最終判定を返却",
    inputSchema: {
      fromAccountId: z.string(),
      toPayeeId: z.string(),
      amountJPY: z.number().int().positive(),
      idempotencyKey: z.string().optional()
    }
  },
  async ({ fromAccountId, toPayeeId, amountJPY }) => {
    return mkResult({
      checkedAt: MOCK_NOW_ISO,
      fromAccountId,
      toPayeeId,
      amountJPY,
      sufficientBalance: true,
      withinLimit: amountJPY <= MOCK_LIMITS_FEES.perTransactionLimit,
      feeJPY: MOCK_LIMITS_FEES.estimatedFeeJPY,
      advisory: "問題ありません（モック）"
    });
  }
);

// 4) ThreatMetrixリスク判定MCP：低／中／高 を返却
server.registerTool(
  "threatmetrix_risk",
  {
    title: "ThreatMetrixリスク判定",
    description: "固定で『中』を返すモック",
    inputSchema: { sessionId: z.string().optional() }
  },
  async () => mkResult({ evaluatedAt: MOCK_NOW_ISO, ...MOCK_RISK_MEDIUM })
);

// 5) 第2暗証取得MCP：ユーザーアプリ承認→トークン取得（モック）
server.registerTool(
  "obtain_second_password",
  {
    title: "第2暗証取得",
    description: "ユーザーアプリ承認済みトークンをモック返却",
    inputSchema: { authRequestId: z.string().optional() }
  },
  async () => mkResult({
    approved: true,
    method: "app",
    token: "2FA-TOKEN-MOCK",
    expiresAt: "2025-12-31T00:00:00Z"
  })
);

// 6) 振込実行MCP：送金の本実行（モック）
server.registerTool(
  "execute_transfer",
  {
    title: "振込実行",
    description: "送金を実行したことにするモック結果を返却",
    inputSchema: {
      fromAccountId: z.string(),
      toPayeeId: z.string(),
      amountJPY: z.number().int().positive(),
      secondPasswordToken: z.string().optional(),
      otpCode: z.string().optional(),
      idempotencyKey: z.string().optional()
    }
  },
  async ({ fromAccountId, toPayeeId, amountJPY }) => {
    return mkResult({
      executedAt: MOCK_NOW_ISO,
      fromAccountId,
      toPayeeId,
      amountJPY,
      ...MOCK_TRANSFER_OK
    });
  }
);

// 7) リスク高履歴認証結果ステータス変更MCP：メールOTP照合結果の更新
server.registerTool(
  "update_high_risk_auth_status",
  {
    title: "高リスク履歴の認証ステータス更新",
    description: "メールOTP照合結果の更新モック",
    inputSchema: {
      caseId: z.string(),
      otpVerified: z.boolean()
    }
  },
  async ({ caseId, otpVerified }) => {
    return mkResult({
      updatedAt: MOCK_NOW_ISO,
      caseId,
      otpVerified,
      status: "updated"
    });
  }
);

// 8) 定期移管事前処理MCP：定期作成の事前チェック（残高・商品条件・リスク）
server.registerTool(
  "term_deposit_prep",
  {
    title: "定期移管事前処理",
    description: "定期作成の事前チェック結果（モック）",
    inputSchema: {
      fromAccountId: z.string(),
      amountJPY: z.number().int().positive(),
      termMonths: z.number().int().positive().optional(),
      productCode: z.string().optional()
    }
  },
  async ({ fromAccountId, amountJPY, termMonths, productCode }) => {
    return mkResult({
      checkedAt: MOCK_NOW_ISO,
      fromAccountId,
      amountJPY,
      requested: { termMonths, productCode },
      ...MOCK_TD_PRECHECK
    });
  }
);

// 9) 定期預金申込MCP / 申込MCP：定期の本申込
server.registerTool(
  "apply_term_deposit",
  {
    title: "定期預金申込",
    description: "定期預金の申込完了（モック）",
    inputSchema: {
      fromAccountId: z.string(),
      amountJPY: z.number().int().positive(),
      termMonths: z.number().int().positive(),
      productCode: z.string().optional(),
      handling: z.string().optional(),  // 満期取扱い
      idempotencyKey: z.string().optional()
    }
  },
  async ({ fromAccountId, amountJPY, termMonths, productCode, handling }) => {
    return mkResult({
      appliedAt: MOCK_NOW_ISO,
      fromAccountId,
      amountJPY,
      termMonths,
      productCode,
      // Spread first, then override so caller-provided handling wins
      ...MOCK_TD_ACCEPTED,
      handling
    });
  }
);

// ---- stdio接続 ----
const transport = new StdioServerTransport();
await server.connect(transport);
