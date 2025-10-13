#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
// ---- ユーティリティ：構造化+テキスト(後方互換)で返す ----
function mkResult(data) {
    return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        structuredContent: data,
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
    perTransactionLimit: 1000000, // ¥1,000,000
    dailyRemainingLimit: 900000, // ¥900,000
    estimatedFeeJPY: 330
};
const MOCK_RISK_MEDIUM = {
    risk: "中", // 低／中／高
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
server.registerTool("otp_device_check", {
    title: "OTPデバイス種別確認",
    description: "振り込みできる条件かどうかを確認します。お客様が紙のご利用カードを利用している場合は利用可能ではありません。入力はユーザーID、出力は利用可能なら true、不可なら false を返します。",
    inputSchema: {
        userId: z.string()
    }
}, async ({ userId }) => {
    const usesPaperCard = typeof userId === "string" && userId.toLowerCase().includes("paper");
    const allowed = !usesPaperCard;
    return mkResult(allowed);
});
// 2) 振込事前処理MCP：登録振込先一覧取得／出金口座リスト&残高取得／限度額・手数料見積
server.registerTool("pre_transfer_prep", {
    title: "振込事前処理",
    description: "振り込み事前処理を確認するためにユーザーの各種情報を返します。登録振込先・出金口座・限度額/手数料を返します。インプットはユーザーIDです。",
    inputSchema: { userId: z.string() }
}, async ({ userId }) => {
    return mkResult({
        generatedAt: MOCK_NOW_ISO,
        payees: MOCK_PAYEES,
        sourceAccounts: MOCK_ACCOUNTS,
        limitAndFees: MOCK_LIMITS_FEES
    });
});
// 3) 振込内容照会MCP：残高・限度額・手数料の最終チェック
server.registerTool("review_transfer", {
    title: "振込内容照会",
    description: "ユーザーID・出金口座情報・振込先を入力として、残高・限度額・手数料の最終チェックを行い、確認した内容をそのまま応答します（モック）。",
    inputSchema: {
        userId: z.string(),
        fromAccountId: z.string(),
        toPayeeId: z.string(),
        amountJPY: z.number().int().positive().optional()
    }
}, async ({ userId, fromAccountId, toPayeeId, amountJPY }) => {
    // モック: 金額未指定時はデフォルトを使用
    const amount = amountJPY ?? 50000;
    return mkResult({
        checkedAt: MOCK_NOW_ISO,
        fromAccountId,
        toPayeeId,
        amountJPY: amount,
        sufficientBalance: true,
        withinLimit: amount <= MOCK_LIMITS_FEES.perTransactionLimit,
        feeJPY: MOCK_LIMITS_FEES.estimatedFeeJPY,
        advisory: "問題ありません（モック）"
    });
});
// 4) ThreatMetrixリスク判定MCP：低／中／高 を返却
server.registerTool("threatmetrix_risk", {
    title: "ThreatMetrixリスク判定",
    description: "ユーザーID（任意のセッションIDと併用可）を基に端末・行動シグナルを評価し、低/中/高のリスク評価を返します。",
    inputSchema: { userId: z.string(), sessionId: z.string().optional() }
}, async () => mkResult({ evaluatedAt: MOCK_NOW_ISO, ...MOCK_RISK_MEDIUM }));
// 5) 第2暗証取得MCP：ユーザーアプリ承認→トークン取得（モック）
server.registerTool("obtain_second_password", {
    title: "第2暗証取得",
    description: "ユーザーIDを基に第2暗証の承認フローを開始し、端末側承認後のトークンを返します。",
    inputSchema: { userId: z.string(), authRequestId: z.string().optional() }
}, async () => mkResult({
    approved: true,
    method: "app",
    token: "2FA-TOKEN-MOCK",
    expiresAt: "2025-12-31T00:00:00Z"
}));
// 6) 振込実行MCP：送金の本実行（モック）
server.registerTool("execute_transfer", {
    title: "振込実行",
    description: "ユーザーID・出金口座・振込先・金額（および必要に応じて第2暗証トークン/OTP）を受け取り、送金実行結果を返します。",
    inputSchema: {
        userId: z.string(),
        fromAccountId: z.string(),
        toPayeeId: z.string(),
        amountJPY: z.number().int().positive(),
        secondPasswordToken: z.string().optional(),
        otpCode: z.string().optional(),
        idempotencyKey: z.string().optional()
    }
}, async ({ fromAccountId, toPayeeId, amountJPY }) => {
    return mkResult({
        executedAt: MOCK_NOW_ISO,
        fromAccountId,
        toPayeeId,
        amountJPY,
        ...MOCK_TRANSFER_OK
    });
});
// 7) リスク高履歴認証結果ステータス変更MCP：メールOTP照合結果の更新
server.registerTool("update_high_risk_auth_status", {
    title: "高リスク履歴の認証ステータス更新",
    description: "ユーザーIDとケースIDを指定して、メールOTP等の照合結果に基づく認証ステータスを更新します。",
    inputSchema: {
        userId: z.string(),
        caseId: z.string(),
        otpVerified: z.boolean()
    }
}, async ({ caseId, otpVerified }) => {
    return mkResult({
        updatedAt: MOCK_NOW_ISO,
        caseId,
        otpVerified,
        status: "updated"
    });
});
// 8) 定期移管事前処理MCP：定期作成の事前チェック（残高・商品条件・リスク）
server.registerTool("term_deposit_prep", {
    title: "定期移管事前処理",
    description: "ユーザーID・出金口座・金額（任意の商品/期間指定を含む）を基に、残高・商品条件・リスク観点の事前チェック結果を返します。",
    inputSchema: {
        userId: z.string(),
        fromAccountId: z.string(),
        amountJPY: z.number().int().positive(),
        termMonths: z.number().int().positive().optional(),
        productCode: z.string().optional()
    }
}, async ({ fromAccountId, amountJPY, termMonths, productCode }) => {
    return mkResult({
        checkedAt: MOCK_NOW_ISO,
        fromAccountId,
        amountJPY,
        requested: { termMonths, productCode },
        ...MOCK_TD_PRECHECK
    });
});
// 9) 定期預金申込MCP / 申込MCP：定期の本申込
server.registerTool("apply_term_deposit", {
    title: "定期預金申込",
    description: "ユーザーID・出金口座・金額・期間等の条件を入力として、定期預金の申込結果を返します。",
    inputSchema: {
        userId: z.string(),
        fromAccountId: z.string(),
        amountJPY: z.number().int().positive(),
        termMonths: z.number().int().positive(),
        productCode: z.string().optional(),
        handling: z.string().optional(), // 満期取扱い
        idempotencyKey: z.string().optional()
    }
}, async ({ fromAccountId, amountJPY, termMonths, productCode, handling }) => {
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
});
// ---- stdio接続 ----
const transport = new StdioServerTransport();
await server.connect(transport);
