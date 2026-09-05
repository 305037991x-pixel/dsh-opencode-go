// dsh-opencode-go — host half.
//
// 提供 `GET /dsh-opencode-go/usage` 路由，并行查询三类账号的套餐用量：
// - OpenCode GO 账号 A/B（OPENCODE_GO_API_KEY / OPENCODE_GO_API_KEY_B）：
//   调官方用量接口 `https://opencode.ai/zen/go/v1/usage`；
// - CommandCode 账号（COMMANDCODE_API_KEY）：调官方 CLI `/usage` 命令同款
//   `https://api.commandcode.ai/alpha/billing/credits`（5h/周窗口）+
//   `/alpha/usage/summary`（本月已用），与 command-code CLI 同源同参。
// 凭证解析顺序（凭证服务：环境变量 → $DSH_HOME/.credentials.yaml → .env）；
// 密钥只存在于宿主侧，绝不下发到浏览器；单个账号失败不影响其他账号。
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";

/** Stable Cordis plugin name. */
const name = "dsh-opencode-go";
/** Service required before the usage route can be claimed. */
const inject = ["webServer"];

/** OpenCode GO 官方用量接口（滚动 5h / 每周 / 每月 三个窗口）。 */
const USAGE_URL = "https://opencode.ai/zen/go/v1/usage";
/** CommandCode 官方用量接口基址（/alpha 系列端点，与 command-code CLI 同源）。 */
const CMD_API_BASE = "https://api.commandcode.ai";
/** 请求上游接口的超时。 */
const USAGE_TIMEOUT_MS = 15000;

/** 账号清单：kind 决定用量接口，credential 是凭证引用名。 */
const ACCOUNTS = [
	{ id: "A", kind: "opencode", credential: "OPENCODE_GO_API_KEY", label: "账号 A" },
	{ id: "B", kind: "opencode", credential: "OPENCODE_GO_API_KEY_B", label: "账号 B" },
	{ id: "CMD", kind: "commandcode", credential: "COMMANDCODE_API_KEY", label: "CommandCode" }
];

/**
 * 解析指定凭证引用名的 API key：优先凭证服务（环境 → 托管文件 → .env），
 * 与 dsh-account-balance 相同的解析顺序；取不到返回 undefined。
 * @param ctx - plugin context carrying the credential and environment planes.
 * @param refName - credential reference name（如 OPENCODE_GO_API_KEY）。
 * @returns the resolved key, or undefined when unconfigured.
 */
async function resolveApiKey(ctx, refName) {
	const credentials = ctx.get("credentials");
	if (credentials !== void 0) {
		const hit = await credentials.resolve(credentialRef(refName));
		if (hit !== void 0 && hit.value.length > 0) return hit.value;
	}
	const ambient = launchEnvironmentOf(ctx).get(refName);
	return ambient !== void 0 && ambient.value.length > 0 ? ambient.value : void 0;
}

/** Bearer 鉴权 GET，返回 { ok, status, body }；非 2xx 时 body 为截断文本。 */
async function getJson(url, apiKey) {
	const response = await fetch(url, {
		headers: { Authorization: `Bearer ${apiKey}`, accept: "application/json" },
		signal: AbortSignal.timeout(USAGE_TIMEOUT_MS)
	});
	const text = await response.text();
	if (!response.ok) return { ok: false, status: response.status, body: text.slice(0, 200) };
	try {
		return { ok: true, status: response.status, body: JSON.parse(text) };
	} catch {
		return { ok: false, status: response.status, body: "响应解析失败" };
	}
}

/** used/cap → 百分比（保留 1 位小数）；入参非法返回 null。 */
function windowPercent(used, cap) {
	if (typeof used !== "number" || typeof cap !== "number" || cap <= 0) return null;
	return Math.round((used / cap) * 1000) / 10;
}

/**
 * 查询单个 OpenCode GO 账号的用量。任何失败都返回 { ok:false, error }，不抛出。
 * @param ctx - plugin context。
 * @param account - ACCOUNTS 中 kind=opencode 的一项。
 * @returns { id, label, ok, usage?, error? }
 */
async function fetchOpencodeUsage(ctx, account) {
	try {
		const apiKey = await resolveApiKey(ctx, account.credential);
		if (apiKey === void 0) {
			return { id: account.id, label: account.label, ok: false, error: `${account.credential} 未配置` };
		}
		const response = await getJson(USAGE_URL, apiKey);
		if (!response.ok) {
			return { id: account.id, label: account.label, ok: false, error: `HTTP ${response.status}: ${String(response.body).slice(0, 200)}` };
		}
		const parsed = response.body;
		return {
			id: account.id,
			label: account.label,
			ok: true,
			usage: parsed && parsed.usage ? parsed.usage : {}
		};
	} catch (error) {
		return { id: account.id, label: account.label, ok: false, error: error instanceof Error ? error.message : String(error) };
	}
}

/**
 * 查询 CommandCode 账号用量：`/alpha/billing/credits` 给 5h/周窗口（used/cap/
 * resetAt），`/alpha/usage/summary` 给本月已用（totalMonthlyCredits，计费周期
 * 口径），月窗口百分比 = 已用 /（已用 + 剩余 monthlyCredits）。组织账号先经
 * `/alpha/whoami?limits=1` 取 orgId（个人账号 org 为 null，省略即可）。
 * @param ctx - plugin context。
 * @param account - ACCOUNTS 中 kind=commandcode 的一项。
 * @returns { id, label, ok, usage?, error? }
 */
async function fetchCommandCodeUsage(ctx, account) {
	try {
		const apiKey = await resolveApiKey(ctx, account.credential);
		if (apiKey === void 0) {
			return { id: account.id, label: account.label, ok: false, error: `${account.credential} 未配置` };
		}
		let orgId = null;
		const who = await getJson(`${CMD_API_BASE}/alpha/whoami?limits=1`, apiKey);
		if (who.ok && who.body && typeof who.body === "object") {
			orgId = who.body.org?.id ?? null;
		}
		const orgQuery = orgId !== null ? `?orgId=${encodeURIComponent(orgId)}` : "";
		const credits = await getJson(`${CMD_API_BASE}/alpha/billing/credits${orgQuery}`, apiKey);
		if (!credits.ok) {
			return { id: account.id, label: account.label, ok: false, error: `HTTP ${credits.status}: ${String(credits.body).slice(0, 200)}` };
		}
		const limits = credits.body?.windowLimits ?? {};
		const monthlyRemaining = credits.body?.credits?.monthlyCredits;
		const toWindow = (w) => ({
			status: w?.exceeded === true ? "limited" : "ok",
			percent: windowPercent(w?.used, w?.cap) ?? 0,
			resetsAt: typeof w?.resetAt === "number" && w.resetAt > 0 ? new Date(w.resetAt).toISOString() : null
		});
		let monthly = { status: "ok", percent: null, resetsAt: null };
		const summary = await getJson(`${CMD_API_BASE}/alpha/usage/summary${orgQuery}`, apiKey);
		if (summary.ok) {
			const monthlyUsed = summary.body?.totalMonthlyCredits;
			const percent = windowPercent(monthlyUsed, typeof monthlyUsed === "number" ? monthlyUsed + monthlyRemaining : void 0);
			if (percent !== null) monthly = { status: "ok", percent, resetsAt: null };
		}
		return {
			id: account.id,
			label: account.label,
			ok: true,
			usage: {
				rolling: toWindow(limits.fiveHour),
				weekly: toWindow(limits.weekly),
				monthly
			}
		};
	} catch (error) {
		return { id: account.id, label: account.label, ok: false, error: error instanceof Error ? error.message : String(error) };
	}
}

/** 按账号类型分发用量查询。 */
function fetchAccountUsage(ctx, account) {
	return account.kind === "commandcode" ? fetchCommandCodeUsage(ctx, account) : fetchOpencodeUsage(ctx, account);
}

/**
 * 注册用量路由：并行查询全部账号，返回 { ok:true, accounts:[...] }。
 * @param ctx - plugin context carrying the webServer service.
 */
function apply(ctx) {
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: "/dsh-opencode-go/usage",
		handler: async (req, res) => {
			if (req.method !== "GET" && req.method !== "HEAD") {
				res.writeHead(405);
				res.end();
				return;
			}
			const sendJson = (status, payload) => {
				res.writeHead(status, {
					"content-type": "application/json; charset=utf-8",
					"cache-control": "no-store"
				});
				res.end(JSON.stringify(payload));
			};
			try {
				const accounts = await Promise.all(ACCOUNTS.map((account) => fetchAccountUsage(ctx, account)));
				sendJson(200, { ok: true, accounts });
			} catch (error) {
				sendJson(200, { ok: false, error: error instanceof Error ? error.message : String(error) });
			}
		}
	}), "dsh-opencode-go: usage route");
}
//#endregion
export { ACCOUNTS, CMD_API_BASE, USAGE_URL, apply, fetchAccountUsage, fetchCommandCodeUsage, fetchOpencodeUsage, inject, name, resolveApiKey, windowPercent };
