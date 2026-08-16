// dsh-opencode-go — browser half.
//
// 在会话头部（conversation.session.header.utilities，与 dsh-balance 同槽位）
// 常驻一个「OpenCode GO」芯片：显示两个账号的周窗口用量百分比（红/橙/绿），
// 3 分钟自动刷新 + 手动刷新按钮；悬停气泡分账号展示 滚动(5h)/周/月 用量
// 与滚动窗口剩余时间。数据来自宿主侧路由 /dsh-opencode-go/usage
// （密钥不出宿主机），接口详见 lib/index.js。
//
// 用量数据与 3 分钟定时器为模块级共享：切换会话时芯片组件随会话卸载/重挂载，
// 但直接读取共享缓存，不重新拉取、不闪「查询中…」。
window.__ModuleLoader__.load({
	id: "dsh-opencode-go",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
		let primitives = require("@deepseek-ai/dsh-client-ui-primitives");

		//#region GoUsageChip.module.css
		const css = ".goChip_root{box-sizing:border-box;min-height:28px;color:var(--dsw-alias-label-secondary);background:0 0;border:none;border-radius:6px;align-items:center;gap:4px;padding:3px 6px;font-size:12px;line-height:18px;display:inline-flex}.goChip_root:hover{background:var(--dsw-alias-interactive-bg-hover)}.goChip_lead{color:var(--dsw-alias-label-tertiary);flex:none;display:inline-flex}.goChip_amount{min-width:0;font-variant-numeric:tabular-nums;white-space:nowrap;font-weight:500}.goChip_ok{color:var(--dsw-alias-state-success-primary)}.goChip_warn{color:var(--dsw-alias-state-warn-primary)}.goChip_danger{color:var(--dsw-alias-state-error-primary)}.goChip_loading{color:var(--dsw-alias-label-tertiary);white-space:nowrap}.goChip_errorText{color:var(--dsw-alias-state-error-primary);white-space:nowrap}.goChip_refresh{color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:none;border-radius:4px;flex:none;align-items:center;justify-content:center;padding:1px;display:inline-flex}.goChip_refresh:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}.goChip_refresh:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-1px}.goChip_spin{animation:.8s linear infinite goChip_spin}@keyframes goChip_spin{to{transform:rotate(360deg)}}.goChip_tooltip{display:flex;flex-direction:column;gap:4px}.goChip_tooltipLine{white-space:nowrap}";
		const tagId = "dsh-opencode-go/GoUsageChip.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-opencode-go";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		const cssMap = {
			root: "goChip_root",
			lead: "goChip_lead",
			amount: "goChip_amount",
			ok: "goChip_ok",
			warn: "goChip_warn",
			danger: "goChip_danger",
			loading: "goChip_loading",
			errorText: "goChip_errorText",
			refresh: "goChip_refresh",
			spin: "goChip_spin"
		};
		//#endregion

		//#region locales
		const NS = "dshOpencodeGo";
		const zh = {
			"chip.label": "OpenCode GO",
			"chip.loading": "查询中…",
			"chip.error": "用量获取失败",
			"chip.noKey": "未配置密钥",
			"chip.refresh": "刷新用量",
			"chip.weeklyLabel": "周",
			"chip.statusLimited": "受限",
			"chip.accountBreakdown": "{label}: 滚动(5h) {rolling} · 周 {weekly} · 月 {monthly} · 滚动 剩余 {rollingRemaining}",
			"chip.accountError": "{label}: 获取失败",
			"time.soon": "即将重置",
			"time.minutes": "{n}分",
			"time.hours": "{n}小时{m}分",
			"time.days": "{n}天{m}小时"
		};
		const en = {
			"chip.label": "OpenCode GO",
			"chip.loading": "Loading…",
			"chip.error": "Failed to load usage",
			"chip.noKey": "No API key",
			"chip.refresh": "Refresh usage",
			"chip.weeklyLabel": "Wk",
			"chip.statusLimited": "limited",
			"chip.accountBreakdown": "{label}: Rolling(5h) {rolling} · Weekly {weekly} · Monthly {monthly} · Rolling {rollingRemaining} left",
			"chip.accountError": "{label}: failed",
			"time.soon": "resets soon",
			"time.minutes": "{n}m",
			"time.hours": "{n}h{m}m",
			"time.days": "{n}d{m}h"
		};
		//#endregion

		//#region helpers
		/** 取一个窗口对象（rolling/weekly/monthly），非对象返回 null。 */
		function pickWindow(usage, key) {
			if (!usage || typeof usage !== "object") return null;
			const w = usage[key];
			if (!w || typeof w !== "object") return null;
			const percent = typeof w.percent === "number" ? w.percent : Number(w.percent);
			return {
				status: typeof w.status === "string" ? w.status : null,
				percent: Number.isFinite(percent) ? percent : null,
				resetsAt: typeof w.resetsAt === "string" ? w.resetsAt : null
			};
		}

		/** 用量色：>=90 或受限 → 红；>=70 → 橙；否则绿。 */
		function colorClass(win) {
			if (win === null || win.percent === null) return cssMap.amount;
			if (win.status !== null && win.status !== "ok") return cssMap.danger;
			if (win.percent >= 90) return cssMap.danger;
			if (win.percent >= 70) return cssMap.warn;
			return cssMap.ok;
		}

		/** 窗口展示文本：`64%`，受限时追加 `(受限)`。 */
		function windowText(win, t) {
			if (win === null || win.percent === null) return "–";
			const status = win.status !== null && win.status !== "ok" ? `(${t("chip.statusLimited")})` : "";
			return `${win.percent}%${status}`;
		}

		/** 剩余时间：ISO → 人类可读倒计时（本地时间）。 */
		function remainingText(iso, t) {
			if (!iso) return "–";
			const target = new Date(iso).getTime();
			if (!Number.isFinite(target)) return "–";
			const diff = target - Date.now();
			if (diff <= 0) return t("time.soon");
			const mins = Math.floor(diff / 60000);
			if (mins < 60) return t("time.minutes", { n: mins });
			const hours = Math.floor(mins / 60);
			if (hours < 24) return t("time.hours", { n: hours, m: mins % 60 });
			return t("time.days", { n: Math.floor(hours / 24), m: hours % 24 });
		}
		//#endregion

		//#region shared store（模块级共享：数据 + 3 分钟定时器）
		/** 自动刷新间隔：3 分钟。 */
		const REFRESH_MS = 180000;
		const shared = {
			accounts: null,
			error: null,
			phase: "idle", // idle | loading | ready | error
			version: 0,
			fetching: null,
			timer: null,
			listeners: new Set(),
			subscribe(listener) {
				this.listeners.add(listener);
				return () => {
					this.listeners.delete(listener);
				};
			},
			getSnapshot() {
				return this.version;
			}
		};
		const notify = () => {
			shared.version++;
			for (const listener of [...shared.listeners]) {
				try {
					listener();
				} catch (error) {
					console.error("[dsh-opencode-go] store listener failed:", error);
				}
			}
		};
		/** 拉取一次用量（两个账号）；并发去重（同一时刻只发一个请求）。 */
		const fetchUsage = () => {
			if (shared.fetching !== null) return shared.fetching;
			shared.fetching = (async () => {
				shared.phase = "loading";
				notify();
				try {
					const response = await fetch("/dsh-opencode-go/usage", {
						headers: { accept: "application/json" },
						cache: "no-store"
					});
					const payload = await response.json().catch(() => null);
					if (!response.ok) throw new Error(`HTTP ${response.status}`);
					if (payload && payload.ok === false) throw new Error(payload.error || "error");
					shared.accounts = Array.isArray(payload && payload.accounts) ? payload.accounts : [];
					shared.error = null;
					shared.phase = "ready";
				} catch (error) {
					shared.error = error instanceof Error ? error.message : String(error);
					shared.phase = "error";
				} finally {
					shared.fetching = null;
					notify();
				}
			})();
			return shared.fetching;
		};
		/** 确保共享定时器存在（跨组件只建一个；组件卸载不清理）。 */
		const ensureTimer = () => {
			if (shared.timer === null) {
				shared.timer = setInterval(() => {
					void fetchUsage();
				}, REFRESH_MS);
			}
		};
		//#endregion

		//#region GoUsageChip
		/**
		 * 会话头部 OpenCode GO 用量芯片：显示两个账号的周窗口百分比（红/橙/绿），
		 * 3 分钟自动刷新，手动刷新按钮 + 悬停分账号明细气泡。
		 * 数据读模块级共享缓存：切换会话重挂载时直接展示，不重新拉取。
		 * @param props - 标准 slot props（t 为注册 locale 的翻译器）。
		 */
		function GoUsageChip(props) {
			const { t } = props;
			// 订阅共享 store（版本号变化触发重渲染）
			react.useSyncExternalStore(shared.subscribe.bind(shared), shared.getSnapshot.bind(shared));

			react.useEffect(() => {
				ensureTimer();
				// 首次挂载且尚无数据时才拉取；已有缓存（切会话回来）直接展示
				if (shared.phase === "idle" && shared.accounts === null) {
					void fetchUsage();
				}
				// 注意：不清理定时器 —— 定时器是模块级共享的
			}, []);

			const { accounts, error, phase } = shared;
			const refreshing = phase === "loading";
			const okAccounts = (accounts || []).filter((a) => a && a.ok && a.usage);
			const hasData = okAccounts.length > 0;

			// 芯片：两个账号的周用量百分比，各自着色，用 · 连接
			let content;
			if (hasData) {
				const weeklyParts = okAccounts.map((a) => {
					const w = pickWindow(a.usage, "weekly");
					const pct = w && w.percent !== null ? w.percent : null;
					return react_jsx_runtime.jsx("span", {
						className: [cssMap.amount, colorClass(w)].join(" "),
						children: pct === null ? "–" : `${pct}%`
					}, a.id);
				});
				const joined = [];
				weeklyParts.forEach((part, i) => {
					if (i > 0) joined.push(react_jsx_runtime.jsx("span", { className: cssMap.amount, children: "·" }, `sep${i}`));
					joined.push(part);
				});
				content = react_jsx_runtime.jsx("span", {
					children: [t("chip.weeklyLabel"), " ", joined]
				});
			} else if (phase === "error" && !hasData) {
				content = react_jsx_runtime.jsx("span", {
					className: cssMap.errorText,
					children: [react_jsx_runtime.jsx(primitives.IconWarningOutline16, { size: 14 }), " ", t("chip.error")]
				});
			} else {
				content = react_jsx_runtime.jsx("span", { className: cssMap.loading, children: t("chip.loading") });
			}

			// 气泡：分账号明细（滚动/周/月 + 滚动剩余时间）
			const sections = [];
			for (const a of accounts || []) {
				if (a && a.ok && a.usage) {
					const rolling = pickWindow(a.usage, "rolling");
					const weekly = pickWindow(a.usage, "weekly");
					const monthly = pickWindow(a.usage, "monthly");
					sections.push(t("chip.accountBreakdown", {
						label: a.label || a.id,
						rolling: windowText(rolling, t),
						weekly: windowText(weekly, t),
						monthly: windowText(monthly, t),
						rollingRemaining: remainingText(rolling && rolling.resetsAt, t)
					}));
				} else if (a && !a.ok) {
					sections.push(t("chip.accountError", { label: a.label || a.id }));
				}
			}
			const breakdown = sections.length > 0
				? react_jsx_runtime.jsx("span", {
					className: "goChip_tooltip",
					children: sections.map((s, i) => react_jsx_runtime.jsx("span", { className: "goChip_tooltipLine", children: s }, i))
				})
				: "";

			const anchor = react_jsx_runtime.jsx("span", {
				className: cssMap.root,
				"data-opencode-go-chip": "",
				"aria-label": `${t("chip.label")}: ${hasData ? t("chip.weeklyLabel") + " " + okAccounts.map((a) => { const w = pickWindow(a.usage, "weekly"); return w && w.percent !== null ? `${w.percent}%` : "–"; }).join("·") : t("chip.loading")}`,
				children: [
					react_jsx_runtime.jsx("span", {
						className: cssMap.lead,
						children: react_jsx_runtime.jsx(primitives.IconApiOutline14, { size: 14 })
					}),
					content,
					react_jsx_runtime.jsx("button", {
						type: "button",
						className: cssMap.refresh,
						"aria-label": t("chip.refresh"),
						title: t("chip.refresh"),
						onClick: () => void fetchUsage(),
						children: react_jsx_runtime.jsx(primitives.IconRefreshOutline14, {
							size: 14,
							className: refreshing ? cssMap.spin : void 0
						})
					})
				]
			});

			const labeled = breakdown !== "" && primitives.Tooltip !== void 0
				? react_jsx_runtime.jsx(primitives.Tooltip, { label: breakdown, side: "bottom", delayMs: 300, children: anchor })
				: anchor;
			return labeled;
		}
		//#endregion

		//#region plugin body
		const inject = ["slots", "locale"];
		/**
		 * Client plugin body: register the「OpenCode GO」chip in the conversation
		 * header utilities slot（与 dsh-balance 同槽位，order 在其后）。
		 * @param ctx - client root context。
		 */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "dsh-opencode-go: dictionaries");
			ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register({
				name: "conversation.session.header.utilities",
				id: "dsh-opencode-go",
				order: 20,
				locale: NS
			}, GoUsageChip));
		}
		//#endregion

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
