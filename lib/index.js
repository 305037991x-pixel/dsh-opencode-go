// dsh-opencode-go — host half.
//
// 提供 `GET /dsh-opencode-go/usage` 路由：分别解析两个 OpenCode GO 账号的
// API key（OPENCODE_GO_API_KEY / OPENCODE_GO_API_KEY_B，凭证服务：
// 环境变量 → $DSH_HOME/.credentials.yaml → .env），各自调用官方用量接口
// `https://opencode.ai/zen/go/v1/usage`，把两个账号的结果一起回给浏览器。
// 密钥只存在于宿主侧，绝不下发到浏览器；单个账号失败不影响另一个。
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";

/** Stable Cordis plugin name. */
const name = "dsh-opencode-go";
/** Service required before the usage route can be claimed. */
const inject = ["webServer"];

/** OpenCode GO 官方用量接口（滚动 5h / 每周 / 每月 三个窗口）。 */
const USAGE_URL = "https://opencode.ai/zen/go/v1/usage";
/** 请求官方接口的超时。 */
const USAGE_TIMEOUT_MS = 15000;

/** 账号清单：id 用于客户端展示顺序，credential 是凭证引用名。 */
const ACCOUNTS = [
	{ id: "A", credential: "OPENCODE_GO_API_KEY", label: "账号 A" },
	{ id: "B", credential: "OPENCODE_GO_API_KEY_B", label: "账号 B" }
];

/**
 * 解析指定凭证引用名的 API key：优先凭证服务（环境 → 托管文件 → .env），
 * 与 dsh-balance 相同的解析顺序；取不到返回 undefined。
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

/**
 * 查询单个账号的用量。任何失败都返回 { ok:false, error }，不抛出。
 * @param ctx - plugin context。
 * @param account - ACCOUNTS 中的一项。
 * @returns { id, label, ok, usage?, error? }
 */
async function fetchAccountUsage(ctx, account) {
	try {
		const apiKey = await resolveApiKey(ctx, account.credential);
		if (apiKey === void 0) {
			return { id: account.id, label: account.label, ok: false, error: `${account.credential} 未配置` };
		}
		const response = await fetch(USAGE_URL, {
			headers: { Authorization: `Bearer ${apiKey}` },
			signal: AbortSignal.timeout(USAGE_TIMEOUT_MS)
		});
		const body = await response.text();
		if (!response.ok) {
			return { id: account.id, label: account.label, ok: false, error: `HTTP ${response.status}: ${body.slice(0, 200)}` };
		}
		let parsed;
		try {
			parsed = JSON.parse(body);
		} catch {
			return { id: account.id, label: account.label, ok: false, error: "响应解析失败" };
		}
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
 * 注册用量路由：并行查询两个账号，返回 { ok:true, accounts:[...] }。
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
export { ACCOUNTS, USAGE_URL, apply, fetchAccountUsage, inject, name, resolveApiKey };
