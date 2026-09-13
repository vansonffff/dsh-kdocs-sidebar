// kdocs-settings web client — the 金山文档 (kdocs) status panel.
//
// Since 0.2.0 this section is a *status-only* view. It renders whatever the core
// plugin's Provider reports through `remote.kdocs.status()` and offers one
// button that calls the same method again. It deliberately has no login button,
// no Token field and no logout button:
//
//   * the panel used to read and write DSH Credentials refs (KDOCS_TOKEN,
//     KDOCS_AUTH_LOGIN, KDOCS_AUTH_STATUS) and to run its own copy of
//     `kdocs-cli`. Two implementations of the same CLI meant two sets of bugs,
//     and "a Token is configured" was rendered as "authenticated" — which is not
//     the same claim and was wrong whenever the Token had expired.
//   * credentials live in the OS keychain, owned by `kdocs-cli`. Browser OAuth
//     belongs to the terminal (`kdocs-cli auth login`), where its output and its
//     failure modes are visible.
//
// DSH client contract that matters here:
//   * a Remote namespace is a *service* named `remote.<namespace>`, so the panel
//     parks on `ctx.inject(['remote.kdocs'], …)` rather than reading
//     `ctx.remote.kdocs` at activation time — an uninjected read poisons the
//     context permanently (`cannot get property "remote.kdocs" without inject`).
//   * every call answers `{ok:true,value}` or `{ok:false,error}`; the business
//     value is one level in.
window.__ModuleLoader__.load({
	id: "kdocs-settings",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let jsxRuntime = require("react/jsx-runtime");

		const { useCallback, useEffect, useRef, useState, Component } = react;
		const { jsx, jsxs } = jsxRuntime;

		const DISPLAY_NAME = "金山文档 (kdocs)";

		/**
		 * How long one `remote.kdocs.status()` may take before the panel reports a
		 * failure instead of staying in "checking" forever.
		 *
		 * The Provider bounds the CLI call it makes, so a healthy status answers in
		 * well under a second; this only fires when the carrier itself stops
		 * answering — which is exactly the case where a stuck spinner would be
		 * indistinguishable from a slow CLI.
		 */
		const STATUS_TIMEOUT_MS = 15000;

		// Minimal inline WPS-style logo (green rounded square with white "K").
		const LOGO_SVG = "data:image/svg+xml," + encodeURIComponent(
			'<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">' +
			'<rect width="48" height="48" rx="10" fill="#2e7d32"/>' +
			'<text x="24" y="33" font-family="Arial, sans-serif" font-size="26" font-weight="bold" fill="#ffffff" text-anchor="middle">K</text>' +
			'</svg>'
		);

		// Only tokens the product actually defines on the app root are used, each
		// with the value the running build resolves to as its fallback.
		const token = (name, fallback) => "var(" + name + ", " + fallback + ")";
		const LABEL_PRIMARY = token("--dsw-alias-label-primary", "#0f1115");
		const LABEL_SECONDARY = token("--dsw-alias-label-secondary", "#61666b");
		const LABEL_TERTIARY = token("--dsw-alias-label-tertiary", "#81858c");
		const BORDER = token("--dsw-alias-border-l3", "#0000001f");
		const CARD = token("--dsw-alias-bg-layer-1", "#ffffff");
		const SUCCESS = token("--dsw-alias-state-success-primary", "#22c55e");
		const ERROR = token("--dsw-alias-state-error-primary", "#ec1313");
		const WARN = token("--dsw-alias-state-warn-label", "#dd8629");

		/** One status colour, tinted at 12% for a badge background. */
		const badge = (colour) => ({
			fontSize: 12,
			padding: "2px 10px",
			borderRadius: 999,
			fontWeight: 500,
			color: colour,
			background: "color-mix(in srgb, " + colour + " 12%, transparent)",
		});

		const s = {
			section: { display: "flex", maxWidth: 720, flexDirection: "column", gap: 11, color: LABEL_PRIMARY },
			card: { border: "1px solid " + BORDER, borderRadius: 8, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10, background: CARD },
			header: { display: "flex", alignItems: "center", gap: 12 },
			logo: { width: 40, height: 40, borderRadius: 8, flex: "0 0 40px" },
			title: { fontSize: 15, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 },
			row: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" },
			button: { font: "inherit", fontSize: 13, padding: "6px 14px", borderRadius: 6, border: "1px solid " + BORDER, background: CARD, cursor: "pointer", color: LABEL_PRIMARY },
			buttonDisabled: { opacity: .55, cursor: "not-allowed" },
			// A definition list rather than a table: it wraps the same way at any
			// panel width and needs no column sizing.
			fields: { display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 14px", fontSize: 13, alignItems: "baseline" },
			key: { color: LABEL_SECONDARY },
			value: { color: LABEL_PRIMARY, wordBreak: "break-all" },
			muted: { color: LABEL_TERTIARY, wordBreak: "break-all" },
			desc: { fontSize: 12.5, color: LABEL_SECONDARY, lineHeight: 1.6 },
			code: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontSize: 12.5, padding: "1px 6px", borderRadius: 4, background: token("--dsw-alias-interactive-bg-hover", "#2631480f"), color: LABEL_PRIMARY },
			message: { fontSize: 12.5, padding: "6px 10px", borderRadius: 6, background: "color-mix(in srgb, " + ERROR + " 10%, transparent)", color: ERROR },
			hint: { fontSize: 12.5, padding: "6px 10px", borderRadius: 6, background: token("--dsw-alias-interactive-bg-hover", "#2631480f"), color: LABEL_SECONDARY, lineHeight: 1.7 },
		};

		/**
		 * Unwrap one client Remote answer.
		 *
		 * The client face of a namespace answers `{ok:true, value}` or
		 * `{ok:false, error}`; a business failure is a rejected envelope, not a
		 * thrown exception. Both shapes are accepted because the host half of a
		 * Remote returns its business value directly (note 10 in the project's
		 * own notes): if that ever reaches the browser unenveloped, reading
		 * through `value` here must not turn a good answer into `undefined`.
		 */
		function unwrap(response, what) {
			if (response && response.ok === true) return response.value;
			if (response && response.ok === false) {
				const detail = response.error?.message ?? response.error?.code ?? "未返回结果";
				throw new Error(what + "失败: " + detail);
			}
			if (response && typeof response === "object") return response;
			throw new Error(what + "失败: 未返回结果");
		}

		/**
		 * Format the observation instant as a **date**.
		 *
		 * "上次检查" answers one question — is this reading current? — and a day is
		 * the resolution that question needs. The seconds were noise: the Provider
		 * caches for about ten seconds, so a minute-precision stamp mostly reported
		 * when the user last clicked, not when the CLI last ran.
		 *
		 * @param iso - `KDocsStatus.checkedAt`, an ISO 8601 instant.
		 * @returns the date, or null when there is no usable instant.
		 */
		function formatCheckedAt(iso) {
			if (typeof iso !== "string") return null;
			const when = new Date(iso);
			if (Number.isNaN(when.getTime())) return null;
			try {
				return when.toLocaleDateString();
			} catch (ignored) {
				// A runtime without Intl must still say something truthful.
				return iso.slice(0, 10);
			}
		}

		/** The credential source, as `KDocsStatus.source` names it. */
		const SOURCE_LABEL = {
			keychain: "系统钥匙串（System Keychain）",
			environment: "环境变量",
			flag: "命令行参数",
			none: "无",
		};

		/**
		 * Derive everything the panel renders from one status report.
		 *
		 * Kept as a pure function so the states are testable without a DOM: the
		 * four outcomes (not installed / not signed in / signed in / never
		 * checked) are otherwise only observable by looking at a rendered panel.
		 *
		 * @param status - a `KDocsStatus`, or null before the first answer.
		 * @param failed - true when the last request itself failed.
		 * @param errorMessage - why it failed.
		 * @param pending - true while a request is in flight.
		 * @returns the badge, the field rows and the reason line.
		 */
		function describeState(status, failed, errorMessage, pending) {
			if (pending && status === null) {
				return { badge: { label: "检查中…", colour: LABEL_TERTIARY }, rows: statusRows(null), problem: null };
			}
			if (failed) {
				return {
					badge: { label: "检查失败", colour: ERROR },
					rows: statusRows(status),
					problem: errorMessage ?? "无法从核心插件读取状态。",
				};
			}
			if (status === null) {
				return { badge: { label: "未检查", colour: LABEL_TERTIARY }, rows: statusRows(null), problem: null };
			}
			if (status.cliAvailable !== true) {
				return {
					badge: { label: "CLI 未安装", colour: WARN },
					rows: statusRows(status),
					problem: null,
				};
			}
			if (status.authenticated !== true) {
				return {
					badge: { label: "未登录", colour: WARN },
					rows: statusRows(status),
					problem: null,
				};
			}
			return { badge: { label: "已登录", colour: SUCCESS }, rows: statusRows(status), problem: null };
		}

		/**
		 * The label/value rows for one status report.
		 *
		 * A missing field renders as `—` rather than being dropped: "the version
		 * is unknown" and "the version is not reported here" are different
		 * states, and only one of them means something is wrong.
		 *
		 * @param status - a `KDocsStatus`, or null.
		 * @returns the rows.
		 */
		function statusRows(status) {
			const cliAvailable = status?.cliAvailable === true;
			const rows = [
				{ key: "CLI", value: cliAvailable ? "已安装" : "未安装" },
				{ key: "版本", value: cliAvailable && typeof status.cliVersion === "string" ? status.cliVersion : "—" },
			];
			if (cliAvailable && typeof status.cliPath === "string") {
				rows.push({ key: "路径", value: status.cliPath, muted: true });
			}
			if (cliAvailable) {
				const source = SOURCE_LABEL[status.source] ?? (typeof status.source === "string" ? status.source : "—");
				rows.push({ key: "凭据来源", value: status.authenticated === true ? source : "—" });
				if (cliAvailable && typeof status.keychainBackend === "string") {
					rows.push({ key: "系统钥匙串", value: status.keychainBackend });
				}
			}
			const checkedAt = formatCheckedAt(status?.checkedAt);
			rows.push({ key: "上次检查", value: checkedAt ?? "—", muted: checkedAt === null });
			return rows;
		}

		/** One label/value row. */
		function Field(props) {
			return jsxs("div", { style: { display: "contents" }, children: [
				jsx("div", { style: s.key, children: props.label }),
				jsx("div", { style: props.muted ? s.muted : s.value, children: props.children }),
			] });
		}

		/** The `kdocs-cli auth login` instruction, shown whenever a sign-in is needed. */
		function SignInHint(props) {
			if (props.cliAvailable !== true) {
				return jsxs("div", { style: s.hint, children: [
					"本插件不安装 CLI。请先在终端安装金山官方 ",
					jsx("code", { style: s.code, children: "kdocs-cli" }),
					"（",
					jsx("a", { href: "https://github.com/kdocs-app/kdocs-skill", target: "_blank", rel: "noreferrer", style: { color: "inherit" }, children: "kdocs-app/kdocs-skill" }),
					"），再回到本页刷新状态。",
				] });
			}
			return jsxs("div", { style: s.hint, children: [
				"请在终端登录，然后在下方点击刷新：",
				jsx("div", { style: { marginTop: 6 } }),
				jsx("code", { style: s.code, children: "kdocs-cli auth login" }),
			] });
		}

		/**
		 * The settings section body.
		 *
		 * Props come from the slot factory's `inject`, so `remote` is the
		 * `remote.kdocs` namespace service itself.
		 */
		function KdocsSettingsSection(props) {
			const remote = props.remote;
			const [status, setStatus] = useState(null);
			const [pending, setPending] = useState(false);
			const [error, setError] = useState(null);
			// The raw answer trace, surfaced as a DOM attribute: when this panel has
			// nothing to show, the reason it has nothing must be readable from the
			// page rather than inferred from a blank card.
			const [trace, setTrace] = useState("");
			// Every awaited continuation checks this before setting state: a
			// section that unmounts mid-request (a settings tab switch, a hot
			// reload) must not write into an unmounted component.
			const alive = useRef(true);
			// The id of the newest request. Two overlapping refreshes would
			// otherwise let the slower, older answer win.
			const lastRequest = useRef(0);

			useEffect(() => () => { alive.current = false; }, []);

			const refresh = useCallback(async () => {
				lastRequest.current += 1;
				const mine = lastRequest.current;
				setPending(true);
				setError(null);
				try {
					// The namespace is injected, so its absence means the core plugin is
					// not mounted. Say that instead of calling into nothing: a thrown
					// `undefined is not a function` is exactly the kind of message a user
					// cannot act on.
					if (remote === undefined || remote === null || typeof remote.status !== "function") {
						throw new Error("核心插件 dsh-kdocs-inside 未挂载：设置页读不到 remote.kdocs。");
					}
					// Race the carrier. `status()` is called here, outside the timeout
					// callback, so the request goes out immediately; the second arm only
					// exists so that a carrier which never answers surfaces as a failure
					// instead of a permanently disabled button. "Still checking" is not a
					// state a status panel may occupy forever.
					const startedAt = Date.now();
					setTrace("waiting for remote.kdocs.status()");
					/** @type {any} */
					let timer;
					const call = Promise.resolve(remote.status()).then(
						(value) => ({ kind: "answer", value }),
						(error) => ({ kind: "threw", error }),
					);
					const answer = await Promise.race([
						call,
						new Promise((resolve) => {
							timer = setTimeout(() => {
								resolve({ kind: "timeout" });
							}, STATUS_TIMEOUT_MS);
						}),
					]);
					clearTimeout(timer);
					const elapsed = String(Date.now() - startedAt);
					if (answer.kind === "timeout") {
						setTrace("timed out after " + elapsed + "ms");
						throw new Error("读取超时：核心插件未在 " + String(STATUS_TIMEOUT_MS) + " 毫秒内返回状态。");
					}
					if (answer.kind === "threw") {
						setTrace("threw after " + elapsed + "ms: " + (answer.error?.message ?? String(answer.error)));
						throw answer.error;
					}
					setTrace("answered in " + elapsed + "ms: "
						+ (typeof answer.value === "string"
							? answer.value
							: (JSON.stringify(answer.value) ?? String(answer.value))).slice(0, 300));
					const report = unwrap(answer.value, "读取金山文档状态");
					if (!alive.current || mine !== lastRequest.current) return;
					setStatus(report ?? null);
				} catch (failure) {
					// Never an empty string: `data-kdocs-settings-error` is how this
					// panel says why it has nothing to show, and a blank reason is
					// indistinguishable from "no reason".
					const reason = failure?.message || String(failure) || "未知错误";
					setTrace((current) => (current === "" ? "failed: " + reason : current));
					setError(reason);
				} finally {
					setPending(false);
				}
			}, [remote]);

			// One request when the section mounts, and nothing else: the Provider
			// caches its status for about ten seconds, so polling would spawn CLI
			// processes to re-learn the same answer.
			useEffect(() => {
				void refresh();
			}, [refresh]);

			const state = describeState(status, error !== null, error, pending);
			const problem = state.problem ?? (error === null && status?.reason !== undefined ? status.reason : null);
			const needsSignIn = error === null && status !== null && (status.cliAvailable !== true || status.authenticated !== true);

			return jsxs("div", {
				style: s.section,
				"data-kdocs-settings-state": state.badge.label,
				"data-kdocs-settings-error": error ?? "",
				"data-kdocs-settings-trace": trace,
				children: [
					jsx("div", { style: s.header, children: jsxs("div", { style: s.title, children: [
						jsx("img", { src: LOGO_SVG, alt: "", style: s.logo }),
						jsx("span", { children: DISPLAY_NAME }),
						jsx("span", { style: badge(state.badge.colour), children: state.badge.label }),
					] }) }),
					jsxs("div", { style: s.card, children: [
						jsx("div", { style: s.desc, children: "只读状态面板：显示本机 kdocs-cli 是否可用、是否已登录。登录、退出与凭据都由 CLI 自己管理，本页不写入任何凭据。" }),
						jsx("div", { style: s.fields, children: state.rows.map((row) => jsx(Field, { label: row.key, muted: row.muted === true, children: row.value })) }),
						jsx("div", { style: s.row, children: jsx("button", {
							style: { ...s.button, ...(pending ? s.buttonDisabled : {}) },
							// `undefined` rather than `false`: an enabled button must not
							// carry a `disabled` attribute at all.
							disabled: pending || undefined,
							onClick: () => { void refresh(); },
							children: pending ? "刷新中…" : "刷新状态",
						}) }),
						problem === null ? null : jsx("div", { style: s.message, children: problem }),
						needsSignIn ? jsx(SignInHint, { cliAvailable: status.cliAvailable === true }) : null,
						// Signing out is a terminal command with no UI here, so the only
						// thing worth adding is where it lives. Everything else this panel
						// knows is already in the field rows above.
						status !== null && status.cliAvailable === true && status.authenticated === true
							? jsx("div", { style: s.desc, children: "需要退出登录时，请在终端执行 kdocs-cli auth logout。" })
							: null,
					] }),
				],
			});
		}

		/**
		 * Slot bodies render inside a runtime that swallows render throws (the
		 * section would just go blank), so own the failure here and show it.
		 */
		class SectionBoundary extends Component {
			constructor(props) {
				super(props);
				this.state = { error: null };
			}
			static getDerivedStateFromError(error) {
				return { error };
			}
			componentDidCatch(error) {
				try { console.error("[kdocs-settings] section render failed", error); } catch (ignored) { /* ignore */ }
			}
			render() {
				const error = this.state.error;
				if (error) {
					return jsx("div", { style: s.message, children: "金山文档设置面板渲染失败: " + (error?.message ?? String(error)) });
				}
				return this.props.children;
			}
		}

		function apply(ctx) {
			// Park on the namespace service instead of reading through
			// `ctx.remote.kdocs` now: that read would mark this context as having
			// touched an uninjected service and every later access would throw.
			// Without the core plugin the body simply never runs, so a
			// `kdocs-settings` installed alone shows no section rather than an
			// error — which is the honest outcome, since it owns no data itself.
			//
			// `ctx.inject` returns a fiber whose effects belong to this plugin, so
			// unloading (or hot-reloading) it withdraws the section and the
			// namespace subscription together. `ctx.effect` is deliberately *not*
			// wrapped around it: the callback would then have to return that fiber
			// as a disposer, which Cordis rejects.
			ctx.inject(["remote.kdocs"], (scoped) => {
				ctx.slots.inject("settings.section", () => ctx.slots.register({
					name: "settings.section",
					id: "kdocs",
					order: 35,
					label: DISPLAY_NAME,
					inject: () => ({ remote: scoped.remote.kdocs }),
				}, () => jsx(SectionBoundary, { children: jsx(KdocsSettingsSection, { remote: scoped.remote.kdocs }) })));
			});
		}

		exports.apply = apply;
		exports.inject = ["slots", "remote"];
		exports.DISPLAY_NAME = DISPLAY_NAME;
		exports.describeState = describeState;
		exports.statusRows = statusRows;
		exports.formatCheckedAt = formatCheckedAt;
		exports.unwrap = unwrap;
		exports.KdocsSettingsSection = KdocsSettingsSection;
		return module.exports;
	}
});
