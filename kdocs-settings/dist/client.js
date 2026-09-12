// kdocs-settings web client — settings.section entry for 金山文档 (kdocs).
//
// DSH 0.1.5 contract:
//   * credential reads/writes go through the `remote.credentials` namespace
//     service: describe([refs]) -> {ok,value:{ref:{configured,source?,writable}}},
//     set(ref, value), unset(ref). The pre-0.1.5 face
//     (`ctx.get("connection").api.credentials`) no longer exists — every read
//     threw "Cannot read properties of undefined (reading 'credentials')".
//   * the host's credential-change event is forwarded to the browser as
//     `credentials/reference-updated`, consumed with remote.$on.
window.__ModuleLoader__.load({
	id: "kdocs-settings",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let jsxRuntime = require("react/jsx-runtime");

		const { useState, useCallback, useEffect, useRef, Component } = react;
		const { jsx, jsxs } = jsxRuntime;

		const REF_TOKEN = "KDOCS_TOKEN";
		const REF_LOGIN = "KDOCS_AUTH_LOGIN";
		const REF_STATUS = "KDOCS_AUTH_STATUS";
		const DISPLAY_NAME = "金山文档 (kdocs)";
		const LOGIN_POLL_MS = 2500;
		const LOGIN_WAIT_MS = 330000;

		// Minimal inline WPS-style logo (green rounded square with white "K").
		const LOGO_SVG = "data:image/svg+xml," + encodeURIComponent(
			'<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">' +
			'<rect width="48" height="48" rx="10" fill="#2e7d32"/>' +
			'<text x="24" y="33" font-family="Arial, sans-serif" font-size="26" font-weight="bold" fill="#ffffff" text-anchor="middle">K</text>' +
			'</svg>'
		);

		// ---- minimal inline styles ----
		const s = {
			section: { display: "flex", maxWidth: 720, flexDirection: "column", gap: 11, color: "var(--dsw-alias-label-primary, #1f2329)" },
			card: { border: "1px solid var(--dsw-alias-border, #d9dde3)", borderRadius: 8, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10, background: "var(--dsw-alias-bg-card, #ffffff)" },
			header: { display: "flex", alignItems: "center", gap: 12 },
			logo: { width: 40, height: 40, borderRadius: 8, flex: "0 0 40px" },
			title: { fontSize: 15, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 },
			badge: { fontSize: 12, padding: "2px 10px", borderRadius: 999, fontWeight: 500 },
			badgeOk: { background: "rgba(46,125,50,.12)", color: "#2e7d32" },
			badgeNo: { background: "rgba(158,46,40,.12)", color: "#9e2e28" },
			badgeBusy: { background: "rgba(120,120,120,.14)", color: "var(--dsw-alias-label-secondary, #8a9099)" },
			row: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" },
			button: { font: "inherit", fontSize: 13, padding: "6px 14px", borderRadius: 6, border: "1px solid var(--dsw-alias-border, #d9dde3)", background: "var(--dsw-alias-bg-card, #ffffff)", cursor: "pointer", color: "var(--dsw-alias-label-primary, #1f2329)" },
			buttonPrimary: { background: "#2e7d32", borderColor: "#2e7d32", color: "#ffffff" },
			buttonDanger: { color: "#9e2e28", borderColor: "rgba(158,46,40,.4)" },
			buttonDisabled: { opacity: .55, cursor: "not-allowed" },
			input: { font: "inherit", fontSize: 13, padding: "6px 10px", borderRadius: 6, border: "1px solid var(--dsw-alias-border, #d9dde3)", minWidth: 260, background: "var(--dsw-alias-bg-card, #ffffff)", color: "inherit" },
			desc: { fontSize: 12.5, color: "var(--dsw-alias-label-secondary, #5f6672)", lineHeight: 1.6 },
			message: { fontSize: 12.5, padding: "6px 10px", borderRadius: 6, background: "rgba(21,101,192,.08)", color: "#1565c0" },
		};

		/**
		 * Unwrap one client Remote answer. The client face of a namespace always
		 * answers `{ok:true, value}` or `{ok:false, error}` — a business failure
		 * arrives as a rejected envelope, not as a thrown exception.
		 */
		function unwrap(response, what) {
			if (response && response.ok === true) return response.value;
			const detail = response?.error?.message ?? response?.error?.code ?? "未返回结果";
			throw new Error(what + "失败: " + detail);
		}

		/** Read the two references this panel renders. Values are never returned by the host. */
		async function readConfigured(credentials) {
			const views = unwrap(await credentials.describe([REF_TOKEN, REF_STATUS]), "读取认证状态") ?? {};
			return {
				tokenConfigured: Boolean(views[REF_TOKEN]?.configured),
				statusConfigured: Boolean(views[REF_STATUS]?.configured),
			};
		}

		function KdocsSettingsSection(props) {
			const credentials = props.credentials;
			const remote = props.remote;
			const [ready, setReady] = useState(false);
			const [tokenConfigured, setTokenConfigured] = useState(false);
			const [statusConfigured, setStatusConfigured] = useState(false);
			const [busy, setBusy] = useState(false);
			const [tokenInput, setTokenInput] = useState("");
			const [message, setMessage] = useState(null);
			const pollTimer = useRef(null);

			const refresh = useCallback(async () => {
				try {
					const snapshot = await readConfigured(credentials);
					setTokenConfigured(snapshot.tokenConfigured);
					setStatusConfigured(snapshot.statusConfigured);
					setMessage(null);
					return snapshot;
				} catch (error) {
					setMessage("无法读取认证状态: " + (error?.message ?? String(error)));
					return null;
				} finally {
					setReady(true);
				}
			}, [credentials]);

			useEffect(() => {
				void refresh();
				return () => {
					if (pollTimer.current) { clearInterval(pollTimer.current); pollTimer.current = null; }
				};
			}, [refresh]);

			// The host writes KDOCS_AUTH_STATUS when its own status refresh lands
			// (including right after `kdocs-cli auth login` exits), so follow the
			// forwarded event instead of waiting for the next manual refresh.
			useEffect(() => {
				if (!remote || typeof remote.$on !== "function") return undefined;
				let dispose;
				try {
					dispose = remote.$on("credentials/reference-updated", (ref) => {
						if (ref === REF_TOKEN || ref === REF_STATUS || ref === REF_LOGIN) void refresh();
					});
				} catch (error) {
					return undefined; // best-effort: manual refresh still works
				}
				return () => {
					try { if (typeof dispose === "function") dispose(); } catch (error) { /* ignore */ }
				};
			}, [remote, refresh]);

			const startLogin = useCallback(async () => {
				setBusy(true); setMessage(null);
				try {
					unwrap(await credentials.set(REF_LOGIN, String(Date.now())), "发起登录");
					setMessage("已发起登录：浏览器将自动打开 WPS 授权页面，请完成确认…");
					const started = Date.now();
					if (pollTimer.current) clearInterval(pollTimer.current);
					pollTimer.current = setInterval(async () => {
						let snapshot;
						try { snapshot = await readConfigured(credentials); } catch { return; }
						setTokenConfigured(snapshot.tokenConfigured);
						setStatusConfigured(snapshot.statusConfigured);
						const done = snapshot.tokenConfigured || snapshot.statusConfigured || Date.now() - started > LOGIN_WAIT_MS;
						if (done) {
							if (pollTimer.current) { clearInterval(pollTimer.current); pollTimer.current = null; }
							setBusy(false);
							setMessage(snapshot.tokenConfigured || snapshot.statusConfigured ? "认证完成。" : "等待授权超时，请重试。");
						}
					}, LOGIN_POLL_MS);
				} catch (error) {
					setBusy(false);
					setMessage("发起登录失败: " + (error?.message ?? String(error)));
				}
			}, [credentials]);

			const saveToken = useCallback(async () => {
				const value = tokenInput.trim();
				if (!value) { setMessage("请输入 Token 再保存。"); return; }
				setBusy(true); setMessage(null);
				try {
					unwrap(await credentials.set(REF_TOKEN, value), "保存 Token");
					setTokenInput("");
					setMessage("Token 已安全保存，正在验证…");
					await new Promise((resolve) => setTimeout(resolve, 1500));
					const snapshot = await refresh();
					if (snapshot !== null) {
						setMessage(snapshot.tokenConfigured || snapshot.statusConfigured
							? "Token 已验证并启用。"
							: "Token 已保存，但 kdocs-cli 仍报告未认证：请确认 Token 有效、本机已安装 kdocs-cli。");
					}
				} catch (error) {
					setMessage("Token 保存失败: " + (error?.message ?? String(error)));
				} finally {
					setBusy(false);
				}
			}, [credentials, tokenInput, refresh]);

			const logout = useCallback(async () => {
				setBusy(true); setMessage(null);
				try {
					unwrap(await credentials.unset(REF_TOKEN), "退出登录");
					setMessage("已退出登录（host 端将执行 kdocs-cli auth logout）。");
					await new Promise((resolve) => setTimeout(resolve, 1500));
					const snapshot = await refresh();
					if (snapshot !== null && (snapshot.statusConfigured || snapshot.tokenConfigured)) {
						setMessage("已清除 Token，但 kdocs-cli 仍报告已认证：可能还有其他来源的凭据。");
					}
				} catch (error) {
					setMessage("退出失败: " + (error?.message ?? String(error)));
				} finally {
					setBusy(false);
				}
			}, [credentials, refresh]);

			const authenticated = statusConfigured || tokenConfigured;
			const badge = !ready
				? { label: "检查中…", style: { ...s.badge, ...s.badgeBusy } }
				: authenticated
					? { label: "已认证", style: { ...s.badge, ...s.badgeOk } }
					: { label: "未认证", style: { ...s.badge, ...s.badgeNo } };
			const disabled = busy;

			return jsxs("div", { style: s.section, children: [
				jsx("div", { style: s.header, children: jsxs("div", { style: s.title, children: [
					jsx("img", { src: LOGO_SVG, alt: "", style: s.logo }),
					jsx("span", { children: DISPLAY_NAME }),
					jsx("span", { style: badge.style, children: badge.label }),
				] }) }),
				jsxs("div", { style: s.card, children: [
					jsx("div", { style: s.desc, children: "通过本机 kdocs-cli 操作金山文档云服务。令牌保存在操作系统钥匙串；本页负责发起授权、保存 Token 与退出登录。" }),
					jsxs("div", { style: s.row, children: [
						jsx("button", { style: { ...s.button, ...s.buttonPrimary, ...(disabled ? s.buttonDisabled : {}) }, disabled, onClick: startLogin, children: "OAuth 登录" }),
						jsx("button", { style: { ...s.button, ...(disabled ? s.buttonDisabled : {}) }, disabled, onClick: () => { void refresh(); }, children: "刷新状态" }),
						jsx("button", { style: { ...s.button, ...s.buttonDanger, ...(disabled ? s.buttonDisabled : {}) }, disabled, onClick: logout, children: "退出登录" }),
					] }),
				] }),
				jsxs("div", { style: s.card, children: [
					jsx("div", { style: { ...s.desc, fontWeight: 600 }, children: "使用 API Token（可选，与 OAuth 二选一）" }),
					jsxs("div", { style: s.row, children: [
						jsx("input", { style: s.input, type: "password", placeholder: "粘贴 WPS Token（KINGSOFT_DOCS_TOKEN）", value: tokenInput, disabled, onChange: (event) => { setTokenInput(event.target.value); } }),
						jsx("button", { style: { ...s.button, ...(disabled ? s.buttonDisabled : {}) }, disabled, onClick: saveToken, children: "保存 Token" }),
					] }),
				] }),
				message ? jsx("div", { style: s.message, children: message }) : null,
			] });
		}

		/**
		 * Slot bodies are rendered inside a runtime that swallows render throws
		 * (the section would just go blank), so own the failure here and show it.
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

		function apply(e) {
			const remote = e.remote;
			const credentials = e.remote.credentials;
			e.slots.inject("settings.section", () => e.slots.register({
				name: "settings.section",
				id: "kdocs",
				order: 35,
				label: DISPLAY_NAME,
			}, () => jsx(SectionBoundary, { children: jsx(KdocsSettingsSection, { credentials, remote }) })));
		}

		exports.apply = apply;
		exports.inject = ["slots", "remote", "remote.credentials"];
		exports.DISPLAY_NAME = DISPLAY_NAME;
		return module.exports;
	}
});
