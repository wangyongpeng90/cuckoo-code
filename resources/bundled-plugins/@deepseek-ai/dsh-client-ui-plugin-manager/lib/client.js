window.__ModuleLoader__.load({
	id: "@deepseek-ai/dsh-client-ui-plugin-manager",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let _deepseek_ai_dsh_client_ui_slots = require("@deepseek-ai/dsh-client-ui-slots");
		let _deepseek_ai_dsh_client_store = require("@deepseek-ai/dsh-client-store");
		//#region lib/types/client/config-ledger.js
		/**
		* Which plugins bring their own configuration to the Plugins page, read from
		* the three slots the page declares: the official plugins listed beside the
		* official bundles, the bundles with a form on their page, and the rows with a
		* page of their own. The projection follows the slot ledgers and the active
		* locale and keeps its snapshot until one of them moves.
		*/
		/**
		* The key a row's configuration registers under.
		* @param bundle - the bundle's package name.
		* @param rowId - the row id the bundle's patch declares.
		* @returns the `plugins.row.config` key.
		*/
		function rowConfigKey(bundle, rowId) {
			return `${bundle}#${rowId}`;
		}
		const SLOTS = [
			"plugins.item",
			"plugins.bundle.config",
			"plugins.row.config"
		];
		/**
		* Project the configuration ledgers as one observable the page binds.
		* @param ctx - the page plugin's context, whose slot registry and locale the projection follows.
		* @returns the ledger source; its snapshot changes only when a ledger or the locale does.
		*/
		function configLedgerSource(ctx) {
			let versions = [];
			let revision = -1;
			let ledger = {
				items: [],
				bundles: /* @__PURE__ */ new Set(),
				rows: /* @__PURE__ */ new Set()
			};
			const keysOf = (name) => new Set(ctx.slots.entries(name).flatMap((entry) => entry.options.key === void 0 ? [] : [entry.options.key]));
			return {
				getSnapshot: () => {
					const next = SLOTS.map((name) => ctx.slots.getVersion(name));
					const current = ctx.locale.getSnapshot().revision;
					if (current !== revision || next.some((version, index) => version !== versions[index])) {
						versions = next;
						revision = current;
						ledger = {
							items: ctx.slots.entries("plugins.item").map((entry) => ({
								/* v8 ignore next -- list-slot registration requires id */
								id: entry.options.id ?? "",
								label: (0, _deepseek_ai_dsh_client_ui_slots.resolveSlotLabel)(entry.options.label) ?? ""
							})),
							bundles: keysOf("plugins.bundle.config"),
							rows: keysOf("plugins.row.config")
						};
					}
					return ledger;
				},
				subscribe: (listener) => {
					const offs = [...SLOTS.map((name) => ctx.slots.subscribe(name, listener)), ctx.locale.subscribe(listener)];
					return () => {
						for (const off of offs) off();
					};
				}
			};
		}
		//#endregion
		//#region ../../util/crypto/src/index.ts
		/**
		* Random v4 UUID, minted from `crypto.getRandomValues`.
		* @returns the UUID string.
		*/
		function randomUUID() {
			const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
			const hex = Array.from(bytes, (byte, index) => {
				return (index === 6 ? byte & 15 | 64 : index === 8 ? byte & 63 | 128 : byte).toString(16).padStart(2, "0");
			}).join("");
			return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
		}
		//#endregion
		//#region lib/types/client/presentation.js
		/** Display labels and toast sentences for global plugin management. */
		/** The official packages with copy of their own, and whether each is a beta feature the page tags as such. */
		const BUILTIN_COPY = new Map([
			["@deepseek-ai/dsh-experimental-agent-team-profile", {
				title: "builtinAgentTeamTitle",
				description: "builtinAgentTeamDescription",
				beta: true
			}],
			["@deepseek-ai/dsh-experimental-agent-team-web-profile", {
				title: "builtinAgentTeamWebTitle",
				description: "builtinAgentTeamWebDescription",
				beta: true
			}],
			["@deepseek-ai/dsh-experimental-auto-review", {
				title: "builtinAutoReviewTitle",
				description: "builtinAutoReviewDescription",
				beta: true
			}]
		]);
		/** The sentence each of the Host's refusal codes reads as. */
		const CODE_KEYS = {
			"management-required": "reasonManagementRequired",
			"unaddressable": "reasonUnaddressable",
			"unknown-plugin": "reasonUnknownPlugin",
			"invalid-spec": "reasonInvalidSpec",
			"ambiguous-install": "reasonAmbiguousInstall",
			"not-bundle": "reasonNotBundle",
			"not-removable": "reasonNotRemovable",
			"stop-profile": "reasonStopProfile",
			"bundle-in-use": "reasonBundleInUse",
			"stale-approval": "reasonStaleApproval",
			"operation-error": "reasonOperationError"
		};
		/** The sentence a failed action opens with, by what was being done. */
		const FAILED_KEYS = {
			enable: "failedEnable",
			disable: "failedDisable",
			uninstall: "failedUninstall",
			rowEnable: "failedRowEnable",
			rowDisable: "failedRowDisable"
		};
		/**
		* What a management error reads as: the code's sentence, or, for an
		* operation error, the Host's diagnostic as it is.
		* @param error - the Host's code and its diagnostic, when it has one.
		* @param t - the manager's translate seat.
		* @returns the sentence.
		*/
		function managementText(error, t) {
			if (error.code !== "operation-error") return t(CODE_KEYS[error.code]);
			return error.diagnostic === void 0 || error.diagnostic === "" ? t("reasonOperationError") : error.diagnostic;
		}
		/**
		* Compact a package name to what a person calls it.
		* @param name - the package name.
		* @returns the unscoped name without the harness prefixes.
		*/
		function shortName(name) {
			return (name.startsWith("@") ? name.slice(name.indexOf("/") + 1) : name).replace(/^dsh-(?:host-|client-)?/, "");
		}
		/**
		* Localize known official packages by exact npm name at render time.
		* @param pkg - original package identity and optional metadata description.
		* @param t - the manager's current translate function.
		* @returns localized copy and whether the package is a beta feature, or the package's short name and original description.
		*/
		function packageText(pkg, t) {
			const keys = BUILTIN_COPY.get(pkg.name);
			return keys === void 0 ? {
				title: shortName(pkg.name),
				description: pkg.description,
				beta: false
			} : {
				title: t(keys.title),
				description: t(keys.description),
				beta: keys.beta
			};
		}
		/**
		* The sentence one notice shows.
		* @param notice - the last action's outcome.
		* @param t - the manager's translate seat.
		* @returns the sentence.
		*/
		function noticeText(notice, t) {
			switch (notice.kind) {
				case "restart": return t("restartNotice");
				case "overridden": return t("overriddenNotice", { name: notice.packageName });
				case "cancelled": return t("installCancelled");
				case "failed": {
					const reason = notice.code === void 0 ? notice.reason : managementText({
						code: notice.code,
						diagnostic: notice.reason
					}, t);
					return t(FAILED_KEYS[notice.action], { reason: reason === "" ? t("reasonOperationError") : reason });
				}
			}
		}
		//#endregion
		//#region lib/types/client/manager-store.js
		/**
		* The plugin manager's state: the Host's bundles joined with its plugin
		* entries, the action in flight, the install run, and the confirmation an
		* uninstall waits on. Every fact comes from the Host — the store re-reads
		* after each action and after every `plugin-manager/changed` event, so a
		* change made on another surface shows here without a manual refresh.
		*/
		/**
		* Whether an installation is still owned by the Host.
		* @param phase - the dialog's current installation phase.
		* @returns true until an authoritative result settles the installation.
		*/
		function isInstallPending(phase) {
			return phase === "starting" || phase === "running" || phase === "cancelling" || phase === "applying";
		}
		/** A refused answer or a change the Host could not apply, carrying what it said and, for a refusal, its code. */
		var RemoteAnswerError = class extends Error {
			reason;
			code;
			constructor(reason, code) {
				super(reason);
				this.reason = reason;
				this.code = code;
				this.name = "RemoteAnswerError";
			}
		};
		/** The dialog's reading of a failed change: the Host's code and diagnostic, and the run's classified failure. */
		function failureOf(error, kind, pendingBuilds) {
			return {
				reason: error?.diagnostic ?? "",
				...error === void 0 ? {} : { code: error.code },
				...kind === void 0 ? {} : { kind },
				...pendingBuilds === void 0 || pendingBuilds.length === 0 ? {} : { pendingBuilds }
			};
		}
		/** The notice a thrown failure becomes: a refusal keeps its code, anything else its words. */
		function failedNotice(error, subject, seq) {
			const code = error instanceof RemoteAnswerError ? error.code : void 0;
			return {
				kind: "failed",
				reason: reasonOf(error),
				...code === void 0 ? {} : { code },
				...subject,
				seq
			};
		}
		/** The runs with every one still open settled at `exitCode`. */
		function settledRuns(runs, exitCode) {
			return runs.map((run) => run.exitCode === void 0 ? {
				...run,
				exitCode
			} : run);
		}
		/**
		* The key one row occupies in the busy list.
		* @param entryId - the row's Loader entry id.
		* @returns the busy key.
		*/
		function rowKey(entryId) {
			return `row:${entryId}`;
		}
		/**
		* One bundle as the page shows it: its rows joined with the Host's entries.
		* @param bundle - the Host's bundle.
		* @param plugins - the Host's plugin entries.
		* @returns the package view.
		*/
		function packageView(bundle, plugins) {
			const rows = bundle.rows.map((row) => {
				const live = row.entryId === void 0 ? void 0 : plugins.find((plugin) => plugin.entryId === row.entryId);
				return {
					rowId: row.rowId,
					moduleName: row.moduleName,
					enabled: live?.enabled ?? false,
					phase: live?.fiberPhase ?? null,
					...row.entryId === void 0 ? {} : { entryId: row.entryId },
					...live?.readOnlyReason === void 0 ? {} : { readOnlyReason: live.readOnlyReason }
				};
			});
			return {
				name: bundle.name,
				installed: bundle.installed,
				optional: bundle.optional,
				enabled: bundle.enabled,
				rows,
				...bundle.version === void 0 ? {} : { version: bundle.version },
				...bundle.description === void 0 ? {} : { description: bundle.description },
				...bundle.readOnlyReason === void 0 ? {} : { readOnlyReason: bundle.readOnlyReason },
				...bundle.error === void 0 ? {} : { error: bundle.error }
			};
		}
		/**
		* The order the list shows packages in: by the short name a person reads, so a
		* card stays put when its bundle is switched, whatever order the Host answers in.
		* @param packages - the Host's bundles as views.
		* @returns the views sorted by short name.
		*/
		function sortPackages(packages) {
			return [...packages].sort((a, b) => shortName(a.name).localeCompare(shortName(b.name)));
		}
		const IDLE_INSTALL = {
			open: false,
			spec: "",
			phase: "idle",
			inputError: null,
			subject: null,
			runs: [],
			detailsOpen: false,
			installed: null,
			restartRequired: false,
			failure: null,
			approvedBuilds: [],
			enabling: false
		};
		/** Reads and mutates the profile's plugins through the `pluginManager` Remote. */
		var PluginManagerController = class {
			ctx;
			store;
			inFlight;
			rerun = false;
			generation = 0;
			disposed = false;
			pendingConfirm;
			/** Cancels the check the dialog has in flight. */
			inspectAbort;
			noticeSeq = 0;
			/**
			* @param ctx - the tab plugin's context, whose `remote.pluginManager` and `remote.pluginInventory` namespaces answer.
			*/
			constructor(ctx) {
				this.ctx = ctx;
				this.store = (0, _deepseek_ai_dsh_client_store.createSnapshotStore)({
					status: "idle",
					packages: [],
					busy: [],
					notice: null,
					install: IDLE_INSTALL,
					confirm: null,
					highlight: null
				});
			}
			/**
			* Read the tab's state.
			* @returns the current sync snapshot (stable reference until the next change).
			*/
			getSnapshot() {
				return this.store.getSnapshot();
			}
			/** Stop publishing and drop every late settlement. */
			dispose() {
				this.disposed = true;
				this.generation += 1;
			}
			/**
			* Build the face the tab's slot registration injects.
			* @param configLedger - the projection of the plugins carrying configuration, bound beside the tab's own state.
			* @returns the tab's snapshot sources and its actions.
			*/
			inject(configLedger) {
				return {
					hooks: {
						pluginManager: this.store,
						configLedger
					},
					ensure: () => {
						if (this.getSnapshot().status === "idle") this.load();
					},
					refresh: () => {
						this.load();
					},
					openInstall: () => {
						if (!isInstallPending(this.getSnapshot().install.phase)) this.patch({ install: {
							...IDLE_INSTALL,
							open: true
						} });
					},
					closeInstall: () => {
						if (isInstallPending(this.getSnapshot().install.phase)) return;
						this.abortInspect();
						this.patch({ install: IDLE_INSTALL });
					},
					editInstallSpec: (text) => {
						const install = this.getSnapshot().install;
						if (install.phase === "checking" || isInstallPending(install.phase)) return;
						this.patchInstall(install.phase === "idle" ? {
							spec: text,
							inputError: null
						} : {
							...IDLE_INSTALL,
							open: true,
							spec: text
						});
					},
					runInstall: () => {
						this.runInstall();
					},
					approveBuildsAndRetry: () => {
						this.approveBuildsAndRetry();
					},
					cancelInstall: () => {
						this.cancelInstall();
					},
					cancelInstallAndClose: () => {
						this.cancelInstall(true);
					},
					toggleInstallDetails: () => {
						this.patchInstall({ detailsOpen: !this.getSnapshot().install.detailsOpen });
					},
					enableInstalled: () => {
						this.enableInstalled();
					},
					clearHighlight: () => {
						if (this.getSnapshot().highlight !== null) this.patch({ highlight: null });
					},
					setEnabled: (packageName, enabled) => {
						this.run(packageName, {
							packageName,
							action: enabled ? "enable" : "disable"
						}, async () => {
							this.applied(await this.ctx.remote.pluginManager.setBundleEnabled(packageName, enabled), packageName);
						});
					},
					uninstall: (packageName) => {
						this.pendingConfirm = () => this.run(packageName, {
							packageName,
							action: "uninstall"
						}, async () => {
							this.applied(await this.ctx.remote.pluginManager.removeBundle(packageName), packageName);
						});
						this.patch({ confirm: {
							action: "uninstall",
							packageName
						} });
					},
					confirm: () => {
						this.confirm();
					},
					cancelConfirm: () => {
						this.pendingConfirm = void 0;
						this.patch({ confirm: null });
					},
					setRowEnabled: (entryId, enabled) => {
						this.run(rowKey(entryId), {
							packageName: entryId,
							action: enabled ? "rowEnable" : "rowDisable"
						}, async () => {
							this.applied(await this.ctx.remote.pluginManager.setPluginEnabled(entryId, enabled), entryId);
						});
					},
					dismissNotice: () => {
						this.patch({ notice: null });
					}
				};
			}
			/**
			* Follow the Host's cancellation window for this dialog's installation.
			* @param progress - a request id and phase received from the Host.
			*/
			installProgress(progress) {
				const install = this.getSnapshot().install;
				if (install.requestId !== progress.requestId || !isInstallPending(install.phase)) return;
				if (install.phase === "cancelling" && progress.phase === "installing") return;
				this.patchInstall({ phase: progress.phase === "installing" ? "running" : progress.phase });
			}
			/**
			* Fold a chunk belonging to this installation into its pnpm command.
			* A final chunk may arrive after the install answer and still updates an existing run.
			* @param chunk - the chunk the Host forwarded.
			*/
			appendLog(chunk) {
				const install = this.getSnapshot().install;
				if (chunk.requestId !== install.requestId) return;
				const index = install.runs.findIndex((run) => run.jobId === chunk.jobId);
				if (index === -1 && !isInstallPending(install.phase)) return;
				const settled = chunk.exitCode === void 0 ? {} : { exitCode: chunk.exitCode };
				const runs = index === -1 ? [...install.runs, {
					jobId: chunk.jobId,
					command: chunk.argv.join(" "),
					cwd: chunk.cwd,
					output: chunk.text,
					...settled
				}] : install.runs.map((run, at) => at === index ? {
					...run,
					output: run.output + chunk.text,
					...settled
				} : run);
				this.patchInstall({ runs });
			}
			/**
			* Read the bundles and the entries their rows run as. A call during an
			* in-flight read marks one rerun after it settles.
			* @returns settlement after this call's freshness is reflected.
			*/
			load() {
				if (this.disposed) return Promise.resolve();
				if (this.inFlight !== void 0) {
					this.rerun = true;
					return this.inFlight;
				}
				const run = Promise.resolve().then(() => this.read());
				this.inFlight = run;
				return run;
			}
			async read() {
				try {
					do {
						this.rerun = false;
						const generation = ++this.generation;
						if (this.getSnapshot().status === "idle") this.patch({ status: "loading" });
						const inventory = await this.ctx.remote.pluginInventory.list();
						if (generation !== this.generation) return;
						if (!inventory.ok) {
							this.patch({ status: "error" });
							continue;
						}
						if (inventory.value.managementAvailable !== true) {
							this.patch({
								status: "unavailable",
								packages: []
							});
							continue;
						}
						const [bundles, plugins] = await Promise.all([this.ctx.remote.pluginManager.listBundles(), this.ctx.remote.pluginManager.listPlugins()]);
						if (generation !== this.generation) return;
						if (!bundles.ok || !plugins.ok) {
							this.patch({ status: "error" });
							continue;
						}
						this.patch({
							status: "ready",
							packages: sortPackages(bundles.value.map((bundle) => packageView(bundle, plugins.value)))
						});
					} while (this.shouldRerun());
				} finally {
					this.inFlight = void 0;
				}
			}
			shouldRerun() {
				return this.rerun;
			}
			async confirm() {
				const pending = this.pendingConfirm;
				this.pendingConfirm = void 0;
				this.patch({ confirm: null });
				if (pending !== void 0) await pending();
			}
			/** Drop the check in flight; its answer is ignored. */
			abortInspect() {
				this.inspectAbort?.abort();
				this.inspectAbort = void 0;
			}
			/** Whether a settlement arrives too late to matter: the store is disposed, or the dialog moved on. */
			gone(signal) {
				return this.disposed || signal.aborted;
			}
			/**
			* Check the typed spec, then install it. The Host reads what the spec
			* names first; a refused spec returns to the field with the reason, an
			* accepted one becomes the subject the next screens show while pnpm runs.
			*/
			async runInstall() {
				const state = this.getSnapshot();
				const install = state.install;
				const spec = install.spec.trim();
				if (install.phase === "checking" || isInstallPending(install.phase) || spec === "") return;
				if (state.packages.some((pkg) => pkg.name === spec)) {
					this.patchInstall({
						phase: "idle",
						inputError: {
							problem: "already-installed",
							reason: spec
						}
					});
					return;
				}
				this.abortInspect();
				const controller = new AbortController();
				this.inspectAbort = controller;
				this.patchInstall({
					phase: "checking",
					inputError: null,
					subject: null,
					runs: [],
					detailsOpen: false,
					installed: null,
					restartRequired: false,
					failure: null,
					approvedBuilds: []
				});
				const inspected = await this.ctx.remote.pluginManager.inspect(spec, controller.signal);
				if (this.gone(controller.signal)) return;
				this.inspectAbort = void 0;
				if (!inspected.ok) {
					this.patchInstall({
						phase: "idle",
						inputError: {
							problem: "unknown",
							reason: inspected.error.message
						}
					});
					return;
				}
				if (inspected.value.status === "refused") {
					this.patchInstall({
						phase: "idle",
						inputError: {
							problem: inspected.value.problem,
							reason: inspected.value.reason
						}
					});
					return;
				}
				await this.startInstall({
					spec,
					...inspected.value
				});
			}
			/**
			* Hand the checked spec to the Host and settle the dialog from its answer.
			* `approvedBuilds` names the pending install scripts the person allowed;
			* the Host saves that permission for this profile before pnpm runs.
			*/
			async startInstall(subject, approvedBuilds) {
				const { spec } = subject;
				const requestId = randomUUID();
				this.patchInstall({
					phase: "starting",
					requestId,
					subject,
					runs: [],
					failure: null,
					installed: null,
					approvedBuilds: []
				});
				const result = await this.ctx.remote.pluginManager.installBundle(spec, {
					enabled: false,
					requestId,
					...approvedBuilds === void 0 ? {} : { approvedBuilds: [...approvedBuilds] }
				});
				if (this.disposed || this.getSnapshot().install.requestId !== requestId) return;
				const runs = this.getSnapshot().install.runs;
				if (!result.ok) this.patchInstall({
					phase: "failed",
					runs: settledRuns(runs, null),
					failure: { reason: result.error.message }
				});
				else if (result.value.application === "cancelled") this.offerSpecAgain({
					kind: "cancelled",
					seq: ++this.noticeSeq
				});
				else if (result.value.application === "failed") {
					const packages = result.value.packageResult;
					this.patchInstall({
						phase: "failed",
						runs: settledRuns(runs, packages?.exitCode ?? null),
						failure: failureOf(result.value.error, packages?.kind, result.value.pendingBuilds)
					});
				} else this.patchInstall({
					phase: "done",
					runs: settledRuns(runs, 0),
					installed: result.value.bundle ?? null,
					restartRequired: result.value.application === "restart-required",
					approvedBuilds: result.value.approvedBuilds ?? []
				});
				this.load();
			}
			/**
			* Allow the install scripts the failed run left pending and run the same
			* spec again. Only the failed screen with pending names offers this.
			*/
			async approveBuildsAndRetry() {
				const install = this.getSnapshot().install;
				const pending = install.failure?.pendingBuilds;
				if (install.phase !== "failed" || install.subject === null || pending === void 0 || pending.length === 0) return;
				await this.startInstall(install.subject, pending);
			}
			/**
			* Leave the check or the failed screen for the spec at once; a Host-owned
			* run is asked to stop and the dialog waits for the Host's word, since
			* neither a dropped RPC nor a closed connection means pnpm has stopped.
			* @param closeAfter - stop only a running install, and close the dialog once the Host confirms the stop.
			*/
			async cancelInstall(closeAfter = false) {
				const install = this.getSnapshot().install;
				if (!closeAfter && (install.phase === "checking" || install.phase === "failed")) {
					this.abortInspect();
					this.offerSpecAgain();
					return;
				}
				if (install.phase !== "running" || install.requestId === void 0) return;
				const requestId = install.requestId;
				this.patchInstall({
					phase: "cancelling",
					failure: null
				});
				const result = await this.ctx.remote.pluginManager.cancelInstall(requestId);
				const current = this.getSnapshot().install;
				if (this.disposed || current.requestId !== requestId || !isInstallPending(current.phase)) return;
				if (!result.ok) {
					this.patchInstall({
						phase: "running",
						failure: {
							reason: result.error.message,
							cancelUnconfirmed: true
						}
					});
					return;
				}
				if (result.value.status === "cancelled") {
					const notice = {
						kind: "cancelled",
						seq: ++this.noticeSeq
					};
					if (closeAfter) this.patch({
						install: IDLE_INSTALL,
						notice
					});
					else this.offerSpecAgain(notice);
					this.load();
				} else if (result.value.status === "too-late") this.patchInstall({ phase: "applying" });
				else this.patchInstall({
					phase: "running",
					failure: {
						reason: "",
						cancelUnconfirmed: true
					}
				});
			}
			/**
			* Back to the spec: the check, the run, and its request are forgotten and
			* the spec is kept, with a toast when there is something to say — the Host
			* stopped the run.
			*/
			offerSpecAgain(notice = null) {
				const { open, spec } = this.getSnapshot().install;
				this.patch({
					install: {
						...IDLE_INSTALL,
						open,
						spec
					},
					...notice === null ? {} : { notice }
				});
			}
			/**
			* Enable the bundle the finished install added, then close the dialog and
			* mark it in the list. A refusal toasts and still closes: the list shows
			* what did not switch on.
			*/
			async enableInstalled() {
				const install = this.getSnapshot().install;
				if (install.phase !== "done" || install.enabling) return;
				const name = install.installed;
				this.patchInstall({ enabling: true });
				if (name !== null) {
					const result = await this.ctx.remote.pluginManager.setBundleEnabled(name, true);
					if (this.disposed) return;
					try {
						this.applied(result, name);
					} catch (error) {
						this.patch({ notice: failedNotice(error, {
							packageName: name,
							action: "enable"
						}, ++this.noticeSeq) });
					}
				}
				this.patch({
					install: IDLE_INSTALL,
					highlight: name
				});
				await this.load();
			}
			/**
			* Run one action under a busy key, turn its failure into the notice, and
			* re-read the Host afterwards whatever happened.
			*/
			async run(key, subject, action) {
				if (this.disposed || this.getSnapshot().busy.includes(key)) return;
				this.patch({
					busy: [...this.getSnapshot().busy, key],
					notice: null
				});
				try {
					await action();
				} catch (error) {
					this.patch({ notice: failedNotice(error, subject, ++this.noticeSeq) });
				} finally {
					this.patch({ busy: this.getSnapshot().busy.filter((entry) => entry !== key) });
				}
				await this.load();
			}
			/**
			* Publish a change's outcome: a refused answer or a change the Host could
			* not apply throws for {@link run} to report; a change that waits for the
			* next start, that a higher layer overrides, or that the Host stopped is
			* said in passing.
			*/
			applied(answer, packageName) {
				if (!answer.ok) throw new RemoteAnswerError(answer.error.message);
				const result = answer.value;
				switch (result.application) {
					case "failed": throw new RemoteAnswerError(result.error?.diagnostic ?? "", result.error?.code);
					case "cancelled":
						this.patch({ notice: {
							kind: "cancelled",
							seq: ++this.noticeSeq
						} });
						return;
					case "restart-required":
						this.patch({ notice: {
							kind: "restart",
							packageName,
							seq: ++this.noticeSeq
						} });
						return;
					case "overridden":
						this.patch({ notice: {
							kind: "overridden",
							packageName,
							seq: ++this.noticeSeq
						} });
						return;
					case "applied": return;
				}
			}
			patch(next) {
				if (this.disposed) return;
				this.store.set({
					...this.getSnapshot(),
					...next
				});
			}
			patchInstall(next) {
				this.patch({ install: {
					...this.getSnapshot().install,
					...next
				} });
			}
		};
		/** What a thrown failure said: a refused answer's reason, else the error's message. */
		function reasonOf(error) {
			return error instanceof Error ? error.message : String(error);
		}
		//#endregion
		//#region \0dsh-css:/home/runner/work/deepseek-harness/deepseek-harness/packages/client/ui-plugin-manager/src/client/PluginManagerPage.module.css.mjs
		const css = ".X_2TxG_page{box-sizing:border-box;height:100%;color:var(--dsw-alias-label-primary);flex-direction:column;align-items:center;gap:32px;padding:28px clamp(24px,4vw,48px) 48px;display:flex;overflow:auto}.X_2TxG_page>*{width:100%;max-width:960px}.X_2TxG_pageHead{justify-content:space-between;align-items:flex-start;gap:16px;display:flex}.X_2TxG_pageTitle{margin:0;font-size:20px;font-weight:500;line-height:28px}.X_2TxG_pageIntro{color:var(--dsw-alias-label-secondary);margin:4px 0 0;font-size:13px;line-height:20px}.X_2TxG_toolbar{justify-content:flex-end;align-items:center;gap:16px;display:flex}.X_2TxG_status,.X_2TxG_failure p,.X_2TxG_empty{color:var(--dsw-alias-label-tertiary);margin:0;font-size:13px;line-height:20px}.X_2TxG_failure{color:var(--dsw-alias-state-error-primary);align-items:center;gap:10px;display:flex}.X_2TxG_banner{background:color-mix(in srgb, var(--dsw-alias-state-warning-primary,var(--dsw-alias-state-business-primary)) 12%, transparent);color:var(--dsw-alias-label-primary);border-radius:10px;margin:0;padding:8px 12px;font-size:12px;line-height:18px}.X_2TxG_group{flex-direction:column;gap:8px;display:flex}.X_2TxG_groupHead{align-items:baseline;gap:8px;display:flex}.X_2TxG_groupTitle{margin:0;font-size:14px;font-weight:500;line-height:22px}.X_2TxG_count{color:var(--dsw-alias-label-caption);font-variant-numeric:tabular-nums;font-size:14px}.X_2TxG_groupInfo{color:var(--dsw-alias-label-caption);align-self:center;align-items:center;display:inline-flex}.X_2TxG_groupInfo:hover,.X_2TxG_groupInfo:focus-visible{color:var(--dsw-alias-label-secondary)}.X_2TxG_statusTag{height:20px;padding:0 8px;line-height:1}.X_2TxG_card[data-plugin-highlight]{animation:2.4s ease-out X_2TxG_dsh-plugin-highlight}@keyframes X_2TxG_dsh-plugin-highlight{0%,55%{box-shadow:0 0 0 2px var(--dsw-alias-state-business-primary)}to{box-shadow:0 0 #0000}}@media (prefers-reduced-motion:reduce){.X_2TxG_card[data-plugin-highlight]{box-shadow:0 0 0 2px var(--dsw-alias-state-business-primary);animation:none}}.X_2TxG_iconButton:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}.X_2TxG_cards{flex-direction:column;gap:2px;margin:0;padding:0;list-style:none;display:flex}.X_2TxG_card{--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);border-radius:12px;min-width:0;margin:0 -8px}.X_2TxG_cardHead{align-items:center;gap:14px;padding:8px;display:flex}.X_2TxG_cardIcon{border:.5px solid var(--dsw-alias-border-l3);width:48px;height:48px;color:var(--dsw-alias-label-secondary);border-radius:10px;flex:none;justify-content:center;align-items:center;display:inline-flex}.X_2TxG_cardMain{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}.X_2TxG_titleRow{flex-wrap:wrap;align-items:center;gap:8px;min-width:0;display:flex}.X_2TxG_cardTitle{text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:500;line-height:20px;overflow:hidden}.X_2TxG_cardLink{position:relative}.X_2TxG_cardLink:hover{background:var(--dsw-alias-interactive-bg-hover)}.X_2TxG_cardOpen{max-width:100%;color:inherit;font:inherit;text-align:left;cursor:pointer;background:0 0;border:0;padding:0;font-weight:500}.X_2TxG_cardOpen:after{content:\"\";border-radius:12px;position:absolute;inset:0}.X_2TxG_cardOpen:focus-visible{outline:none}.X_2TxG_cardOpen:focus-visible:after{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.X_2TxG_cardDesc{color:var(--dsw-alias-label-tertiary);-webkit-line-clamp:1;-webkit-box-orient:vertical;font-size:13px;line-height:18px;display:-webkit-box;overflow:hidden}.X_2TxG_cardEnd{z-index:1;flex:none;align-items:center;gap:8px;display:inline-flex;position:relative}.X_2TxG_iconButton{width:28px;height:28px;color:var(--dsw-alias-label-caption);cursor:pointer;background:0 0;border:0;border-radius:28px;justify-content:center;align-items:center;display:inline-flex}.X_2TxG_iconButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}.X_2TxG_iconButton:disabled{opacity:.5;cursor:default}.X_2TxG_iconWrap{display:inline-flex}.X_2TxG_danger{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb, var(--dsw-alias-state-error-primary) 30%, transparent);--dsw-alias-interactive-bg-hover:color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent)}.X_2TxG_detailActions{flex:none;align-items:center;gap:16px;display:flex}.X_2TxG_actions{align-items:center;gap:16px;display:flex}.X_2TxG_deleteButton{width:28px;height:28px;color:var(--dsw-alias-state-error-primary);cursor:pointer;background:0 0;border:0;border-radius:8px;justify-content:center;align-items:center;display:inline-flex}.X_2TxG_deleteButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger,var(--dsw-alias-interactive-bg-hover))}.X_2TxG_deleteButton:disabled{opacity:.5;cursor:default}.X_2TxG_deleteButton:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}.X_2TxG_reason{color:var(--dsw-alias-state-error-primary);overflow-wrap:anywhere;white-space:pre-wrap;margin:0;font-size:12px;line-height:18px}.X_2TxG_partsHead .X_2TxG_subLabel{margin:0}.X_2TxG_partsFilter{width:200px}.X_2TxG_partsFilter:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}.X_2TxG_installDialog{width:min(600px,100%);max-height:calc(100vh - 48px)}.X_2TxG_installBody{flex-direction:column;gap:12px;min-width:0;display:flex}.X_2TxG_installLocation{color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere;margin:0;font-size:12px;line-height:18px}.X_2TxG_installField{flex-direction:column;gap:6px;font-size:13px;display:flex}.X_2TxG_installField input[type=text]{border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-3);height:36px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:10px;padding:0 12px;font-size:13px}.X_2TxG_installField input[aria-invalid=true]{border-color:var(--dsw-alias-state-error-primary)}.X_2TxG_guideToggle{font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:0;align-self:flex-start;align-items:center;gap:4px;padding:0;font-size:12.5px;display:inline-flex}.X_2TxG_guideToggle:hover{color:var(--dsw-alias-label-primary)}.X_2TxG_guideChevron{transition:transform .16s}.X_2TxG_guideToggle[aria-expanded=true] .X_2TxG_guideChevron{transform:rotate(180deg)}.X_2TxG_guide{border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-1);border-radius:12px;flex-direction:column;gap:10px;padding:12px 14px;display:flex}.X_2TxG_guideIntro,.X_2TxG_guideHint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px}.X_2TxG_guideSafety{background:color-mix(in srgb, var(--dsw-alias-state-warning-primary,var(--dsw-alias-state-business-primary)) 12%, transparent);color:var(--dsw-alias-state-warning-primary,var(--dsw-alias-state-business-primary));border-radius:8px;align-items:flex-start;gap:6px;margin:0;padding:8px 10px;font-size:12px;line-height:18px;display:flex}.X_2TxG_guideSafety>svg{flex:none;margin-top:2px}.X_2TxG_guideNote{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);border-radius:8px;margin:0;padding:8px 10px;font-size:12px;line-height:18px}.X_2TxG_guideList{flex-direction:column;margin:0;padding:0;list-style:none;display:flex}.X_2TxG_guideItem{border-top:.5px solid var(--dsw-alias-border-l4);align-items:flex-start;gap:10px;padding:8px 0;display:flex}.X_2TxG_guideIndex{corner-shape:round;background:var(--dsw-alias-bg-layer-3);text-align:center;width:20px;height:20px;color:var(--dsw-alias-label-tertiary);border-radius:999px;flex:none;font-size:11px;line-height:20px}.X_2TxG_guideMain{flex-direction:column;flex:1;gap:2px;min-width:0;display:flex}.X_2TxG_guideTitle{color:var(--dsw-alias-label-primary);font-size:12.5px;font-weight:600}.X_2TxG_guideExample{color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere;font-size:12px}.X_2TxG_guideExample code{font-family:var(--dsw-font-mono,ui-monospace, SFMono-Regular, Menlo, monospace)}.X_2TxG_guideExampleLabel{color:var(--dsw-alias-label-tertiary)}.X_2TxG_inputError{color:var(--dsw-alias-state-error-primary);margin:-4px 0 0;font-size:12px;line-height:18px}.X_2TxG_wide{justify-content:center;width:100%}.X_2TxG_wizard{flex-direction:column;flex:auto;gap:16px;min-width:0;min-height:0;padding:16px 20px 20px;display:flex}.X_2TxG_wizardScroll{flex-direction:column;flex:auto;gap:16px;min-height:0;display:flex;overflow-y:auto}.X_2TxG_wizardHead{justify-content:space-between;align-items:center;min-height:24px;display:flex}.X_2TxG_wizardBack{font:inherit;color:var(--dsw-alias-label-primary);cursor:pointer;background:0 0;border:0;align-items:center;gap:4px;padding:0;font-size:15px;font-weight:600;display:inline-flex}.X_2TxG_wizardClose{width:24px;height:24px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:0;border-radius:6px;justify-content:center;align-items:center;padding:0;display:inline-flex}.X_2TxG_wizardClose:hover{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary)}.X_2TxG_wizardHero{text-align:center;flex-direction:column;align-items:center;gap:10px;padding:8px 0 4px;display:flex}.X_2TxG_wizardIcon{width:44px;height:44px;color:var(--dsw-alias-label-secondary);justify-content:center;align-items:center;display:inline-flex}.X_2TxG_wizardIcon[data-tone=done]{color:var(--dsw-alias-state-success-primary)}.X_2TxG_wizardIcon[data-tone=failed]{color:var(--dsw-alias-state-warning-primary,var(--dsw-alias-state-business-primary))}.X_2TxG_wizardTitle{margin:0;font-size:18px;font-weight:600;line-height:26px}.X_2TxG_wizardSub{color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere;margin:0;font-size:13px;line-height:20px}.X_2TxG_subject{border:.5px solid var(--dsw-alias-border-l3);text-align:center;border-radius:12px;flex-direction:column;align-items:center;gap:6px;padding:16px;display:flex}.X_2TxG_subjectName{overflow-wrap:anywhere;margin:0;font-size:15px;font-weight:600;line-height:22px}.X_2TxG_subjectDesc,.X_2TxG_subjectMeta{color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere;margin:0;font-size:13px;line-height:20px}.X_2TxG_wizardFoot{justify-content:space-between;align-items:center;gap:12px;display:flex}.X_2TxG_detailsToggle{font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:0;align-items:center;gap:4px;padding:0;font-size:13px;display:inline-flex}.X_2TxG_detailsChevron{transition:transform .16s}.X_2TxG_detailsToggle[aria-expanded=true] .X_2TxG_detailsChevron{transform:rotate(180deg)}.X_2TxG_detailsBody{flex-direction:column;gap:8px;min-width:0;display:flex}.X_2TxG_spinnerLarge{border:3px solid color-mix(in srgb, var(--dsw-alias-label-primary) 18%, transparent);border-top-color:var(--dsw-alias-label-primary);corner-shape:round;border-radius:50%;width:28px;height:28px;animation:.9s linear infinite X_2TxG_spin}.X_2TxG_spinner{border:2px solid color-mix(in srgb, var(--dsw-alias-label-primary) 18%, transparent);border-top-color:var(--dsw-alias-label-primary);corner-shape:round;border-radius:50%;flex:none;width:14px;height:14px;animation:.9s linear infinite X_2TxG_spin}@keyframes X_2TxG_spin{to{transform:rotate(360deg)}}@media (prefers-reduced-motion:reduce){.X_2TxG_spinner,.X_2TxG_spinnerLarge{animation:none}.X_2TxG_detailsChevron{transition:none}}.X_2TxG_result,.X_2TxG_resultWarn{background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent);color:var(--dsw-alias-label-primary);border-radius:10px;margin:0;padding:8px 12px;font-size:13px;line-height:20px}.X_2TxG_resultWarn{background:color-mix(in srgb, var(--dsw-alias-state-warning-primary,var(--dsw-alias-state-business-primary)) 12%, transparent)}.X_2TxG_approval{border:.5px solid color-mix(in srgb, var(--dsw-alias-state-warning-primary,var(--dsw-alias-state-business-primary)) 40%, transparent);background:color-mix(in srgb, var(--dsw-alias-state-warning-primary,var(--dsw-alias-state-business-primary)) 8%, transparent);border-radius:12px;flex-direction:column;gap:8px;padding:12px 14px;display:flex}.X_2TxG_approvalTitle{color:var(--dsw-alias-label-primary);margin:0;font-size:13px;font-weight:600}.X_2TxG_approvalText{color:var(--dsw-alias-label-secondary);margin:0;font-size:12.5px;line-height:18px}.X_2TxG_approvalCaution{color:var(--dsw-alias-state-warning-primary,var(--dsw-alias-state-business-primary));margin:0;font-size:12.5px;font-weight:600;line-height:18px}.X_2TxG_approvalList{flex-wrap:wrap;gap:6px;margin:0;padding:0;list-style:none;display:flex}.X_2TxG_approvalList code{background:var(--dsw-alias-bg-layer-3);font-family:var(--dsw-font-mono,ui-monospace, SFMono-Regular, Menlo, monospace);color:var(--dsw-alias-label-primary);border-radius:6px;padding:2px 8px;font-size:12px;display:inline-block}.X_2TxG_terminal{--dsl-terminal-font:var(--dsw-font-markdown-code-block-small);--dsl-terminal-line-height:18px;--dsl-terminal-output-max-height:240px;border:.5px solid var(--dsw-alias-border-l1);margin:4px 0 0}.X_2TxG_dependents{color:var(--dsw-alias-label-secondary);margin:8px 0 0;padding-left:18px;font-size:13px;line-height:20px}.X_2TxG_dangerButton{--dsw-alias-button-primary-fill:var(--dsw-alias-state-error-primary);--dsw-alias-button-primary-hover:var(--dsw-alias-state-error-primary)}.X_2TxG_detail{flex-direction:column;display:flex}.X_2TxG_crumb{color:var(--dsw-alias-label-tertiary);font:inherit;cursor:pointer;background:0 0;border:0;align-items:center;gap:6px;padding:0;font-size:12.5px;display:inline-flex}.X_2TxG_crumb:hover{color:var(--dsw-alias-label-primary)}.X_2TxG_crumb:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.X_2TxG_crumbIcon{transform:rotate(90deg)}.X_2TxG_detailHead{justify-content:space-between;align-items:center;gap:12px;margin:32px 0 0;display:flex}.X_2TxG_detailMain{flex-direction:column;gap:8px;min-width:0;margin-top:20px;display:flex}.X_2TxG_detailTitle{margin:0;font-size:20px;font-weight:500;line-height:28px}.X_2TxG_versionTag{font-variant-numeric:tabular-nums;flex:none}.X_2TxG_detailDesc{color:var(--dsw-alias-label-secondary);margin:0;font-size:14px;line-height:22px}.X_2TxG_detailName{color:var(--dsw-alias-label-caption);overflow-wrap:anywhere;margin:0;font-size:12px;line-height:18px}.X_2TxG_detailName code{font-family:var(--dsw-font-mono,ui-monospace, SFMono-Regular, Menlo, monospace)}.X_2TxG_detail>.X_2TxG_detailDesc{margin-top:12px}.X_2TxG_detailSections{flex-direction:column;gap:32px;margin-top:32px;display:flex}.X_2TxG_detailSection{flex-direction:column;gap:12px;display:flex}.X_2TxG_sectionHead{align-items:baseline;gap:10px;display:flex}.X_2TxG_sectionTitle{margin:0;font-size:14px;font-weight:500;line-height:20px}.X_2TxG_sectionCount{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}.X_2TxG_cardArrow{color:var(--dsw-alias-label-tertiary);flex:none}.X_2TxG_rows{flex-direction:column;margin:0;padding:0;list-style:none;display:flex}.X_2TxG_row{border-bottom:.5px solid var(--dsw-alias-border-l2);padding:12px 2px}.X_2TxG_row:last-child{border-bottom:0}.X_2TxG_rowLine{align-items:center;gap:16px;min-width:0;display:flex}.X_2TxG_rowIcon{border:.5px solid var(--dsw-alias-border-l3);width:40px;height:40px;color:var(--dsw-alias-label-secondary);border-radius:10px;flex:none;justify-content:center;align-items:center;display:inline-flex}.X_2TxG_rowMain{flex-direction:column;flex:1;gap:2px;min-width:0;display:flex}.X_2TxG_rowId{color:var(--dsw-alias-label-primary);overflow-wrap:anywhere;font-size:13.5px;font-weight:500;line-height:20px}.X_2TxG_row[data-state=off] .X_2TxG_rowId{color:var(--dsw-alias-label-secondary)}.X_2TxG_rowModule{font-family:var(--dsw-font-mono,ui-monospace, SFMono-Regular, Menlo, monospace);color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere;font-size:11.5px;line-height:16px}.X_2TxG_rowOpen{color:inherit;font:inherit;text-align:left;cursor:pointer;background:0 0;border:0;align-items:center;gap:2px;padding:0;display:inline-flex}.X_2TxG_rowOpen:hover .X_2TxG_rowId{text-underline-offset:3px;text-decoration:underline}.X_2TxG_rowOpenIcon{color:var(--dsw-alias-label-tertiary);flex:none}.X_2TxG_rowOpen:hover .X_2TxG_rowOpenIcon{color:var(--dsw-alias-label-primary)}.X_2TxG_rowState{color:var(--dsw-alias-label-secondary);white-space:nowrap;flex:none;align-items:center;gap:6px;font-size:12.5px;line-height:18px;display:inline-flex}.X_2TxG_row[data-state=failed] .X_2TxG_rowState{color:var(--dsw-alias-state-error-primary)}.X_2TxG_rowFailure{color:var(--dsw-alias-state-error-primary);overflow-wrap:anywhere;margin:4px 0 0 56px;font-size:12px;line-height:18px}";
		const tagId = "@deepseek-ai/dsh-client-ui-plugin-manager/PluginManagerPage.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@deepseek-ai/dsh-client-ui-plugin-manager";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var PluginManagerPage_module_css_default = {
			"actions": "X_2TxG_actions",
			"approval": "X_2TxG_approval",
			"approvalCaution": "X_2TxG_approvalCaution",
			"approvalList": "X_2TxG_approvalList",
			"approvalText": "X_2TxG_approvalText",
			"approvalTitle": "X_2TxG_approvalTitle",
			"banner": "X_2TxG_banner",
			"card": "X_2TxG_card",
			"cardArrow": "X_2TxG_cardArrow",
			"cardDesc": "X_2TxG_cardDesc",
			"cardEnd": "X_2TxG_cardEnd",
			"cardHead": "X_2TxG_cardHead",
			"cardIcon": "X_2TxG_cardIcon",
			"cardLink": "X_2TxG_cardLink",
			"cardMain": "X_2TxG_cardMain",
			"cardOpen": "X_2TxG_cardOpen",
			"cardTitle": "X_2TxG_cardTitle",
			"cards": "X_2TxG_cards",
			"count": "X_2TxG_count",
			"crumb": "X_2TxG_crumb",
			"crumbIcon": "X_2TxG_crumbIcon",
			"danger": "X_2TxG_danger",
			"dangerButton": "X_2TxG_dangerButton",
			"deleteButton": "X_2TxG_deleteButton",
			"dependents": "X_2TxG_dependents",
			"detail": "X_2TxG_detail",
			"detailActions": "X_2TxG_detailActions",
			"detailDesc": "X_2TxG_detailDesc",
			"detailHead": "X_2TxG_detailHead",
			"detailMain": "X_2TxG_detailMain",
			"detailName": "X_2TxG_detailName",
			"detailSection": "X_2TxG_detailSection",
			"detailSections": "X_2TxG_detailSections",
			"detailTitle": "X_2TxG_detailTitle",
			"detailsBody": "X_2TxG_detailsBody",
			"detailsChevron": "X_2TxG_detailsChevron",
			"detailsToggle": "X_2TxG_detailsToggle",
			"dsh-plugin-highlight": "X_2TxG_dsh-plugin-highlight",
			"empty": "X_2TxG_empty",
			"failure": "X_2TxG_failure",
			"group": "X_2TxG_group",
			"groupHead": "X_2TxG_groupHead",
			"groupInfo": "X_2TxG_groupInfo",
			"groupTitle": "X_2TxG_groupTitle",
			"guide": "X_2TxG_guide",
			"guideChevron": "X_2TxG_guideChevron",
			"guideExample": "X_2TxG_guideExample",
			"guideExampleLabel": "X_2TxG_guideExampleLabel",
			"guideHint": "X_2TxG_guideHint",
			"guideIndex": "X_2TxG_guideIndex",
			"guideIntro": "X_2TxG_guideIntro",
			"guideItem": "X_2TxG_guideItem",
			"guideList": "X_2TxG_guideList",
			"guideMain": "X_2TxG_guideMain",
			"guideNote": "X_2TxG_guideNote",
			"guideSafety": "X_2TxG_guideSafety",
			"guideTitle": "X_2TxG_guideTitle",
			"guideToggle": "X_2TxG_guideToggle",
			"iconButton": "X_2TxG_iconButton",
			"iconWrap": "X_2TxG_iconWrap",
			"inputError": "X_2TxG_inputError",
			"installBody": "X_2TxG_installBody",
			"installDialog": "X_2TxG_installDialog",
			"installField": "X_2TxG_installField",
			"installLocation": "X_2TxG_installLocation",
			"page": "X_2TxG_page",
			"pageHead": "X_2TxG_pageHead",
			"pageIntro": "X_2TxG_pageIntro",
			"pageTitle": "X_2TxG_pageTitle",
			"partsFilter": "X_2TxG_partsFilter",
			"partsHead": "X_2TxG_partsHead",
			"reason": "X_2TxG_reason",
			"result": "X_2TxG_result",
			"resultWarn": "X_2TxG_resultWarn",
			"row": "X_2TxG_row",
			"rowFailure": "X_2TxG_rowFailure",
			"rowIcon": "X_2TxG_rowIcon",
			"rowId": "X_2TxG_rowId",
			"rowLine": "X_2TxG_rowLine",
			"rowMain": "X_2TxG_rowMain",
			"rowModule": "X_2TxG_rowModule",
			"rowOpen": "X_2TxG_rowOpen",
			"rowOpenIcon": "X_2TxG_rowOpenIcon",
			"rowState": "X_2TxG_rowState",
			"rows": "X_2TxG_rows",
			"sectionCount": "X_2TxG_sectionCount",
			"sectionHead": "X_2TxG_sectionHead",
			"sectionTitle": "X_2TxG_sectionTitle",
			"spin": "X_2TxG_spin",
			"spinner": "X_2TxG_spinner",
			"spinnerLarge": "X_2TxG_spinnerLarge",
			"status": "X_2TxG_status",
			"statusTag": "X_2TxG_statusTag",
			"subLabel": "X_2TxG_subLabel",
			"subject": "X_2TxG_subject",
			"subjectDesc": "X_2TxG_subjectDesc",
			"subjectMeta": "X_2TxG_subjectMeta",
			"subjectName": "X_2TxG_subjectName",
			"terminal": "X_2TxG_terminal",
			"titleRow": "X_2TxG_titleRow",
			"toolbar": "X_2TxG_toolbar",
			"versionTag": "X_2TxG_versionTag",
			"wide": "X_2TxG_wide",
			"wizard": "X_2TxG_wizard",
			"wizardBack": "X_2TxG_wizardBack",
			"wizardClose": "X_2TxG_wizardClose",
			"wizardFoot": "X_2TxG_wizardFoot",
			"wizardHead": "X_2TxG_wizardHead",
			"wizardHero": "X_2TxG_wizardHero",
			"wizardIcon": "X_2TxG_wizardIcon",
			"wizardScroll": "X_2TxG_wizardScroll",
			"wizardSub": "X_2TxG_wizardSub",
			"wizardTitle": "X_2TxG_wizardTitle"
		};
		//#endregion
		//#region lib/types/client/PluginManagerPage.js
		/**
		* Global plugin management: the Official group's cards for the bundles the
		* installation ships switched off and for the official plugins that register
		* their configuration, the Installed group's cards for the profile's bundles,
		* their row switches, the install dialog with its guide and folded pnpm
		* output, the uninstall confirmation, and the toasts an action's outcome
		* becomes. A bundle's page lists the rows it contributes as the Host runs
		* them; a plugin's configuration renders on its own page through the slots
		* the page declares.
		*/
		/** How long the list marks a package an install just enabled. */
		const HIGHLIGHT_MS = 2400;
		/** Built-in profile bundles stay out of this page even when the profile declares them as dependencies. */
		const BUILTIN_PROFILE_BUNDLES = new Set([
			"@deepseek-ai/dsh-base",
			"@deepseek-ai/dsh-web-app",
			"@deepseek-ai/dsh-headless",
			"@deepseek-ai/dsh-sdk-app",
			"@deepseek-ai/dsh-acp-app",
			"@deepseek-ai/dsh-sdk-minimal"
		]);
		/** How long a toast holds: long enough to read a failure that names what broke. */
		function toastHoldMs(text) {
			return Math.min(8e3, Math.max(3e3, text.length * 80));
		}
		const PHASE_KEYS = {
			pending: "rowPhasePending",
			loading: "rowPhaseLoading",
			active: "rowPhaseActive",
			failed: "rowPhaseFailed",
			unloading: "rowPhaseUnloading"
		};
		/** Status dot naming a live root-fiber phase: pending and unloading fibers do nothing; only loading is in progress. */
		const PHASE_STATES = {
			pending: "idle",
			loading: "ongoing",
			active: "done",
			failed: "error",
			unloading: "idle"
		};
		/** The count line over a pack's components: the total, then only the states that occur. */
		function partsSummary(rows, t) {
			const failed = rows.filter((row) => row.phase === "failed").length;
			const off = rows.filter((row) => !row.enabled).length;
			const running = rows.filter((row) => row.enabled && row.phase === "active").length;
			return [
				t("partsCountTotal", { count: String(rows.length) }),
				...running > 0 ? [t("partsCountRunning", { count: String(running) })] : [],
				...off > 0 ? [t("partsCountOff", { count: String(off) })] : [],
				...failed > 0 ? [t("partsCountFailed", { count: String(failed) })] : []
			].join(" · ");
		}
		/** Rows beyond this count get a filter box above the list. */
		const ROW_FILTER_THRESHOLD = 10;
		/** A row's switch: locked, saying why, when the Host refuses to address the row through the profile patch. */
		function RowSwitch({ row, t, busy, onChange }) {
			const locked = row.readOnlyReason !== void 0 || row.entryId === void 0;
			return (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Switch, {
				checked: row.enabled,
				label: t("partToggle", { name: row.rowId }),
				disabled: busy || locked,
				...row.readOnlyReason === void 0 ? {} : { title: managementText({ code: row.readOnlyReason }, t) },
				onChange
			});
		}
		/** What a row's state line says: off, or the phase its fiber is in. */
		function rowStateText(row, t) {
			if (!row.enabled) return t("partOff");
			return row.phase === null ? t("rowStateIdle") : t(PHASE_KEYS[row.phase]);
		}
		/** The dot beside a row: its fiber phase, or idle. */
		function rowDotState(row) {
			if (!row.enabled || row.phase === null) return "idle";
			return PHASE_STATES[row.phase];
		}
		/**
		* A pack's rows as a list in the order the pack declares them: a state dot,
		* the row id, one line saying its state, a configure control for a row that
		* registered a page, and, when the pack is on, a switch. A pack like base
		* carries close to a hundred rows, so a long list gets a filter.
		*/
		function RowsSection({ rows, t, toggle, configure }) {
			const [filter, setFilter] = (0, react.useState)("");
			const query = filter.trim().toLowerCase();
			const shown = query === "" ? rows : rows.filter((row) => row.rowId.toLowerCase().includes(query));
			return (0, react_jsx_runtime.jsxs)("section", {
				className: PluginManagerPage_module_css_default.detailSection,
				"data-plugin-rows": true,
				children: [
					(0, react_jsx_runtime.jsxs)("div", {
						className: PluginManagerPage_module_css_default.sectionHead,
						children: [(0, react_jsx_runtime.jsx)("h4", {
							className: PluginManagerPage_module_css_default.sectionTitle,
							children: t("partsLabel")
						}), rows.length === 0 ? null : (0, react_jsx_runtime.jsx)("span", {
							className: PluginManagerPage_module_css_default.sectionCount,
							children: partsSummary(rows, t)
						})]
					}),
					rows.length === 0 ? (0, react_jsx_runtime.jsx)("p", {
						className: PluginManagerPage_module_css_default.status,
						children: t("partsEmpty")
					}) : null,
					rows.length > ROW_FILTER_THRESHOLD ? (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
						type: "search",
						className: PluginManagerPage_module_css_default.partsFilter,
						placeholder: t("partsFilter"),
						"aria-label": t("partsFilter"),
						value: filter,
						onChange: (event) => {
							setFilter(event.target.value);
						}
					}) : null,
					rows.length > 0 && shown.length === 0 ? (0, react_jsx_runtime.jsx)("p", {
						className: PluginManagerPage_module_css_default.status,
						children: t("partsFilterEmpty")
					}) : null,
					shown.length === 0 ? null : (0, react_jsx_runtime.jsx)("ul", {
						className: PluginManagerPage_module_css_default.rows,
						children: shown.map((row) => (0, react_jsx_runtime.jsx)("li", {
							className: PluginManagerPage_module_css_default.row,
							"data-plugin-row": row.entryId ?? row.rowId,
							...row.phase === "failed" ? { "data-state": "failed" } : row.enabled ? {} : { "data-state": "off" },
							children: (0, react_jsx_runtime.jsxs)("div", {
								className: PluginManagerPage_module_css_default.rowLine,
								children: [
									(0, react_jsx_runtime.jsx)("span", {
										className: PluginManagerPage_module_css_default.rowIcon,
										"aria-hidden": "true",
										children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCordisPluginOutline14, {})
									}),
									(0, react_jsx_runtime.jsxs)("div", {
										className: PluginManagerPage_module_css_default.rowMain,
										children: [configure?.has(row) === true ? (0, react_jsx_runtime.jsxs)("button", {
											type: "button",
											className: PluginManagerPage_module_css_default.rowOpen,
											"aria-label": t("configureRow", { name: row.rowId }),
											onClick: () => {
												configure.open(row);
											},
											children: [(0, react_jsx_runtime.jsx)("span", {
												className: PluginManagerPage_module_css_default.rowId,
												children: row.rowId
											}), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronRightOutline14, {
												className: PluginManagerPage_module_css_default.rowOpenIcon,
												"aria-hidden": "true"
											})]
										}) : (0, react_jsx_runtime.jsx)("span", {
											className: PluginManagerPage_module_css_default.rowId,
											children: row.rowId
										}), (0, react_jsx_runtime.jsx)("span", {
											className: PluginManagerPage_module_css_default.rowModule,
											children: row.moduleName
										})]
									}),
									(0, react_jsx_runtime.jsxs)("span", {
										className: PluginManagerPage_module_css_default.rowState,
										children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
											state: rowDotState(row),
											size: 8
										}), rowStateText(row, t)]
									}),
									toggle === void 0 ? null : (0, react_jsx_runtime.jsx)(RowSwitch, {
										row,
										t,
										busy: toggle.busy(row),
										onChange: (enabled) => {
											toggle.onSetEnabled(row, enabled);
										}
									})
								]
							})
						}, row.rowId))
					})
				]
			});
		}
		/**
		* A bundle's enable switch on its card and its page: locked, saying why, for
		* one the Host protects; off and locked for one it cannot read.
		*/
		function EnableSwitch({ pkg, title, t, busy, onSetEnabled }) {
			return (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Switch, {
				checked: pkg.enabled,
				label: t("enableToggle", { name: title }),
				disabled: busy || pkg.readOnlyReason !== void 0 || !pkg.enabled && pkg.error !== void 0,
				...pkg.readOnlyReason === void 0 ? {} : { title: managementText({ code: pkg.readOnlyReason }, t) },
				onChange: onSetEnabled
			});
		}
		/** The status one card carries: running, off, or a problem the Host reported. */
		function packageStatus(pkg) {
			if (pkg.error !== void 0) return "problem";
			return pkg.enabled ? "running" : "disabled";
		}
		/** The head every card shares: the pinwheel icon, the name that opens the page beside its tags, its one-liner, and what sits at the end. */
		function CardHead({ title, t, onOpen, tags, description, end }) {
			return (0, react_jsx_runtime.jsxs)("div", {
				className: PluginManagerPage_module_css_default.cardHead,
				children: [
					(0, react_jsx_runtime.jsx)("span", {
						className: PluginManagerPage_module_css_default.cardIcon,
						"aria-hidden": "true",
						children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPluginPinwheelOutline16, { size: 20 })
					}),
					(0, react_jsx_runtime.jsxs)("div", {
						className: PluginManagerPage_module_css_default.cardMain,
						children: [(0, react_jsx_runtime.jsxs)("div", {
							className: PluginManagerPage_module_css_default.titleRow,
							children: [(0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: `${PluginManagerPage_module_css_default.cardTitle} ${PluginManagerPage_module_css_default.cardOpen}`,
								"aria-label": t("openDetail", { name: title }),
								onClick: onOpen,
								children: title
							}), tags]
						}), description === void 0 ? null : (0, react_jsx_runtime.jsx)("span", {
							className: PluginManagerPage_module_css_default.cardDesc,
							children: description
						})]
					}),
					end === void 0 ? null : (0, react_jsx_runtime.jsx)("div", {
						className: PluginManagerPage_module_css_default.cardEnd,
						children: end
					})
				]
			});
		}
		/** The top every page shares: the crumb that leads back, then the icon with the page's actions at its right. */
		function DetailTop({ crumbLabel, crumbText, onBack, icon, actions }) {
			return (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				className: PluginManagerPage_module_css_default.crumb,
				"aria-label": crumbLabel,
				onClick: onBack,
				children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutline14, {
					className: PluginManagerPage_module_css_default.crumbIcon,
					"aria-hidden": "true"
				}), (0, react_jsx_runtime.jsx)("span", { children: crumbText })]
			}), (0, react_jsx_runtime.jsxs)("div", {
				className: PluginManagerPage_module_css_default.detailHead,
				children: [(0, react_jsx_runtime.jsx)("span", {
					className: PluginManagerPage_module_css_default.cardIcon,
					"aria-hidden": "true",
					children: icon ?? (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPluginPinwheelOutline16, { size: 20 })
				}), actions]
			})] });
		}
		/** One package as a card that opens its page: its name, its one-liner, its tags, and its bundle switch. */
		function PackageCard({ pkg, t, busy, highlighted, onOpen, onSetEnabled }) {
			const { title, description, beta } = packageText(pkg, t);
			const status = packageStatus(pkg);
			return (0, react_jsx_runtime.jsx)("li", {
				className: `${PluginManagerPage_module_css_default.card} ${PluginManagerPage_module_css_default.cardLink}`,
				"data-plugin-package": pkg.name,
				"data-plugin-status": status,
				...highlighted ? { "data-plugin-highlight": "" } : {},
				children: (0, react_jsx_runtime.jsx)(CardHead, {
					title,
					t,
					onOpen,
					tags: (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [beta ? (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
						className: PluginManagerPage_module_css_default.statusTag,
						tone: "info",
						children: t("statusBeta")
					}) : null, status === "problem" ? (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
						className: PluginManagerPage_module_css_default.statusTag,
						tone: "danger",
						children: t("statusProblem")
					}) : null] }),
					description,
					end: (0, react_jsx_runtime.jsx)(EnableSwitch, {
						pkg,
						title,
						t,
						busy,
						onSetEnabled
					})
				})
			});
		}
		/**
		* One official plugin as a card that opens its page: its icon, its title from
		* the registration, and the one-liner the entry renders in its summary view.
		*/
		function ItemCard({ item, t, onOpen, renderSlot }) {
			return (0, react_jsx_runtime.jsx)("li", {
				className: `${PluginManagerPage_module_css_default.card} ${PluginManagerPage_module_css_default.cardLink}`,
				"data-plugin-item": item.id,
				children: (0, react_jsx_runtime.jsx)(CardHead, {
					title: item.label,
					t,
					onOpen,
					description: renderSlot("plugins.item", { view: "summary" }, { only: item.id })
				})
			});
		}
		/** An official plugin's page: the crumb back to the cards, its icon, its title over its one-liner, and the form the entry renders. */
		function ItemDetail({ item, t, onBack, renderSlot }) {
			return (0, react_jsx_runtime.jsxs)("div", {
				className: PluginManagerPage_module_css_default.detail,
				"data-plugin-item-detail": item.id,
				children: [
					(0, react_jsx_runtime.jsx)(DetailTop, {
						crumbLabel: t("backToList"),
						crumbText: t("crumbRoot"),
						onBack
					}),
					(0, react_jsx_runtime.jsxs)("div", {
						className: PluginManagerPage_module_css_default.detailMain,
						children: [(0, react_jsx_runtime.jsx)("div", {
							className: PluginManagerPage_module_css_default.titleRow,
							children: (0, react_jsx_runtime.jsx)("h3", {
								className: PluginManagerPage_module_css_default.detailTitle,
								children: item.label
							})
						}), (0, react_jsx_runtime.jsx)("p", {
							className: PluginManagerPage_module_css_default.detailDesc,
							children: renderSlot("plugins.item", { view: "summary" }, { only: item.id })
						})]
					}),
					(0, react_jsx_runtime.jsx)("div", {
						className: PluginManagerPage_module_css_default.detailSections,
						"data-plugin-config": true,
						children: renderSlot("plugins.item", { view: "page" }, { only: item.id })
					})
				]
			});
		}
		/**
		* A row's configuration page: the crumb back to its bundle's page, the row id
		* over the module it names and the entry's one-liner, and the form the entry renders.
		*/
		function RowDetail({ pkg, row, t, onBack, renderSlot }) {
			const { title } = packageText(pkg, t);
			const key = rowConfigKey(pkg.name, row.rowId);
			return (0, react_jsx_runtime.jsxs)("div", {
				className: PluginManagerPage_module_css_default.detail,
				"data-plugin-row-detail": key,
				children: [
					(0, react_jsx_runtime.jsx)(DetailTop, {
						crumbLabel: t("backToPackage", { name: title }),
						crumbText: title,
						onBack,
						icon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCordisPluginOutline14, { size: 20 })
					}),
					(0, react_jsx_runtime.jsxs)("div", {
						className: PluginManagerPage_module_css_default.detailMain,
						children: [
							(0, react_jsx_runtime.jsx)("div", {
								className: PluginManagerPage_module_css_default.titleRow,
								children: (0, react_jsx_runtime.jsx)("h3", {
									className: PluginManagerPage_module_css_default.detailTitle,
									children: row.rowId
								})
							}),
							(0, react_jsx_runtime.jsx)("p", {
								className: PluginManagerPage_module_css_default.detailName,
								children: (0, react_jsx_runtime.jsx)("code", { children: row.moduleName })
							}),
							(0, react_jsx_runtime.jsx)("p", {
								className: PluginManagerPage_module_css_default.detailDesc,
								children: renderSlot("plugins.row.config", { view: "summary" }, { entryKey: key })
							})
						]
					}),
					(0, react_jsx_runtime.jsx)("div", {
						className: PluginManagerPage_module_css_default.detailSections,
						"data-plugin-config": true,
						children: renderSlot("plugins.row.config", { view: "page" }, { entryKey: key })
					})
				]
			});
		}
		/**
		* One package's page: the crumb back to the list; its icon with its switch
		* and, for a package the profile installed, uninstall; its title beside its
		* version tag, its beta tag, and its problem tag; the package name the title
		* stands for, which is what installs it elsewhere; its one-liner; the Host's
		* problem when it reports one; the configuration the bundle registered for
		* itself; and its rows with their switches and configure controls.
		*/
		function PackageDetail({ pkg, t, busy, rowBusy, configured, configure, renderSlot, onBack, onSetEnabled, onUninstall, onSetRowEnabled }) {
			const { title, description, beta } = packageText(pkg, t);
			const status = packageStatus(pkg);
			return (0, react_jsx_runtime.jsxs)("div", {
				className: PluginManagerPage_module_css_default.detail,
				"data-plugin-detail": pkg.name,
				children: [
					(0, react_jsx_runtime.jsx)(DetailTop, {
						crumbLabel: t("backToList"),
						crumbText: t("crumbRoot"),
						onBack,
						actions: (0, react_jsx_runtime.jsxs)("div", {
							className: PluginManagerPage_module_css_default.detailActions,
							children: [pkg.installed ? (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								variant: "outline",
								size: "sm",
								className: PluginManagerPage_module_css_default.danger,
								icon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconTrashOutline16, { size: 13 }),
								"aria-label": t("uninstallLabel", { name: title }),
								disabled: busy || pkg.readOnlyReason !== void 0,
								onClick: onUninstall,
								children: t("uninstall")
							}) : null, (0, react_jsx_runtime.jsx)(EnableSwitch, {
								pkg,
								title,
								t,
								busy,
								onSetEnabled
							})]
						})
					}),
					(0, react_jsx_runtime.jsxs)("div", {
						className: PluginManagerPage_module_css_default.detailMain,
						children: [
							(0, react_jsx_runtime.jsxs)("div", {
								className: PluginManagerPage_module_css_default.titleRow,
								children: [
									(0, react_jsx_runtime.jsx)("h3", {
										className: PluginManagerPage_module_css_default.detailTitle,
										children: title
									}),
									pkg.version === void 0 ? null : (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
										className: PluginManagerPage_module_css_default.versionTag,
										tone: "neutral",
										children: t("versionTag", { version: pkg.version })
									}),
									beta ? (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
										className: PluginManagerPage_module_css_default.statusTag,
										tone: "info",
										children: t("statusBeta")
									}) : null,
									status === "problem" ? (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
										className: PluginManagerPage_module_css_default.statusTag,
										tone: "danger",
										children: t("statusProblem")
									}) : null
								]
							}),
							(0, react_jsx_runtime.jsx)("p", {
								className: PluginManagerPage_module_css_default.detailName,
								children: (0, react_jsx_runtime.jsx)("code", {
									"data-plugin-name": true,
									children: pkg.name
								})
							}),
							(0, react_jsx_runtime.jsx)("p", {
								className: PluginManagerPage_module_css_default.detailDesc,
								children: description ?? t("noDescription")
							})
						]
					}),
					pkg.error === void 0 ? null : (0, react_jsx_runtime.jsxs)("p", {
						className: PluginManagerPage_module_css_default.reason,
						role: "status",
						children: [
							t("reasonLabel"),
							": ",
							managementText(pkg.error, t)
						]
					}),
					pkg.readOnlyReason === void 0 ? null : (0, react_jsx_runtime.jsx)("p", {
						className: PluginManagerPage_module_css_default.reason,
						role: "status",
						children: managementText({ code: pkg.readOnlyReason }, t)
					}),
					(0, react_jsx_runtime.jsxs)("div", {
						className: PluginManagerPage_module_css_default.detailSections,
						children: [configured ? (0, react_jsx_runtime.jsx)("section", {
							className: PluginManagerPage_module_css_default.detailSection,
							"data-plugin-config": true,
							children: renderSlot("plugins.bundle.config", { view: "page" }, { entryKey: pkg.name })
						}) : null, (0, react_jsx_runtime.jsx)(RowsSection, {
							rows: pkg.rows,
							t,
							toggle: pkg.enabled ? {
								busy: (row) => busy || rowBusy(row),
								onSetEnabled: onSetRowEnabled
							} : void 0,
							configure
						})]
					})
				]
			});
		}
		/** Output lines an install run's terminal shows before its middle folds: the first and last six of a long pnpm log. */
		const INSTALL_TERMINAL_LINES = 12;
		/** The install terminal's display copy, from the tab's dictionary. */
		function terminalLabels(t) {
			return {
				/* v8 ignore next -- the Host reports a killed pnpm as a null exit code, never a signal name; the label interface needs one */
				signal: (signal) => t("terminalSignal", { signal }),
				exitCode: (code) => t("terminalExitCode", { code: String(code) }),
				noExitCode: t("terminalNoExitCode"),
				running: t("terminalRunning"),
				failed: t("terminalFailed"),
				done: t("terminalDone"),
				copy: t("terminalCopy"),
				copied: t("terminalCopied"),
				noOutput: t("terminalNoOutput"),
				collapseAria: t("terminalCollapseAria"),
				collapse: t("terminalCollapse"),
				expandAria: (hidden) => t("terminalExpandAria", { n: String(hidden) }),
				expand: (hidden) => t("terminalExpand", { n: String(hidden) })
			};
		}
		/** The sentence under the field for a spec the check refused. */
		const INPUT_PROBLEM_KEYS = {
			"invalid-spec": "installProblemInvalid",
			"already-installed": "installProblemInstalled",
			"not-found": "installProblemNotFound",
			"not-a-package": "installProblemNotPackage",
			"not-a-bundle": "installProblemNotBundle",
			"network": "installProblemNetwork",
			"unknown": "installProblemUnknown"
		};
		/** The spec forms the install guide shows, each with an example the person can drop into the field. */
		const GUIDE_EXAMPLES = [
			{
				key: "id",
				titleKey: "installGuideIdTitle",
				exampleKey: "installGuideIdExample",
				hintKey: "installGuideIdHint"
			},
			{
				key: "git",
				titleKey: "installGuideGitTitle",
				exampleKey: "installGuideGitExample",
				hintKey: "installGuideGitHint"
			},
			{
				key: "path",
				titleKey: "installGuidePathTitle",
				exampleKey: "installGuidePathExample",
				hintKey: "installGuidePathHint"
			}
		];
		/** The one-line reading of a classified pnpm failure. */
		const FAILURE_KIND_KEYS = {
			"pnpm-missing": "installFailurePnpmMissing",
			"timeout": "installFailureTimeout",
			"not-found": "installFailureNotFound",
			"no-matching-version": "installFailureNoMatchingVersion",
			"network": "installFailureNetwork",
			"disk-full": "installFailureDiskFull",
			"permission": "installFailurePermission",
			"build-blocked": "installFailureBuildBlocked",
			"integrity": "installFailureIntegrity",
			"unknown": "installFailureGeneric"
		};
		/** The heading of each screen past the spec. */
		const SCREEN_TITLE_KEYS = {
			starting: "installStarting",
			running: "installingTitle",
			cancelling: "installCancelling",
			applying: "installApplying",
			done: "installedTitle",
			failed: "installFailedTitle"
		};
		/** What the spec's kind reads as when the package carries no description of its own. */
		const SUBJECT_KIND_KEYS = {
			registry: void 0,
			path: "installSubjectPath",
			git: "installSubjectGit",
			tarball: "installSubjectTarball"
		};
		/**
		* The failed screen's one line: a pnpm failure by its kind, a refusal by its
		* code, any other failure in the Host's words; the run's output stays behind the details.
		*/
		function failureText(failure, t) {
			if (failure === null) return t("installFailureGeneric");
			if (failure.kind === "build-blocked" && !failure.pendingBuilds?.length) return t("installFailureBuildBlockedManual");
			if (failure.kind !== void 0) return t(FAILURE_KIND_KEYS[failure.kind]);
			if (failure.code !== void 0) return managementText({
				code: failure.code,
				diagnostic: failure.reason
			}, t);
			return failure.reason === "" ? t("installFailureGeneric") : failure.reason;
		}
		/** The package the install is about: its name, one-liner, and version, as the Host read them before installing. */
		function SubjectCard({ subject, t }) {
			const title = subject.name ?? subject.spec;
			const kindKey = SUBJECT_KIND_KEYS[subject.kind];
			const description = subject.description ?? (kindKey === void 0 ? void 0 : t(kindKey));
			return (0, react_jsx_runtime.jsxs)("div", {
				className: PluginManagerPage_module_css_default.subject,
				"data-install-subject": subject.spec,
				children: [
					(0, react_jsx_runtime.jsx)("p", {
						className: PluginManagerPage_module_css_default.subjectName,
						children: title
					}),
					description === void 0 ? null : (0, react_jsx_runtime.jsx)("p", {
						className: PluginManagerPage_module_css_default.subjectDesc,
						children: description
					}),
					subject.version === void 0 ? null : (0, react_jsx_runtime.jsx)("p", {
						className: PluginManagerPage_module_css_default.subjectMeta,
						children: t("installVersion", { version: subject.version })
					})
				]
			});
		}
		/**
		* The install dialog: the spec and its check, then the installing, installed,
		* and failed screens over the same subject card. A failed run that left
		* install scripts undecided shows them for approval in place of plain retry.
		*/
		function InstallDialog({ install, t, onClose, onEditSpec, onRun, onCancel, onCancelAndClose, onToggleDetails, onEnableNow, onApproveBuilds }) {
			const errorId = (0, react.useId)();
			const guideId = (0, react.useId)();
			const approvalId = (0, react.useId)();
			const [guideOpen, setGuideOpen] = (0, react.useState)(false);
			const { phase } = install;
			if (phase === "idle" || phase === "checking") {
				const checking = phase === "checking";
				const empty = install.spec.trim() === "";
				return (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
					open: install.open,
					onClose,
					title: t("installTitle"),
					closeLabel: t("close"),
					description: t("installDescription"),
					className: PluginManagerPage_module_css_default.installDialog,
					footer: (0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						variant: "primary",
						className: PluginManagerPage_module_css_default.wide,
						disabled: checking || empty,
						"aria-busy": checking,
						onClick: onRun,
						children: [checking ? (0, react_jsx_runtime.jsx)("span", {
							className: PluginManagerPage_module_css_default.spinner,
							"aria-hidden": "true"
						}) : null, t(checking ? "installChecking" : "installRun")]
					}),
					children: (0, react_jsx_runtime.jsxs)("div", {
						className: PluginManagerPage_module_css_default.installBody,
						children: [
							(0, react_jsx_runtime.jsxs)("label", {
								className: PluginManagerPage_module_css_default.installField,
								children: [(0, react_jsx_runtime.jsx)("span", { children: t("installSpecLabel") }), (0, react_jsx_runtime.jsx)("input", {
									type: "text",
									value: install.spec,
									placeholder: t("installSpecPlaceholder"),
									disabled: checking,
									"aria-invalid": install.inputError !== null,
									"aria-describedby": install.inputError === null ? void 0 : errorId,
									onChange: (event) => {
										onEditSpec(event.currentTarget.value);
									},
									onKeyDown: (event) => {
										if (event.key === "Enter" && !empty && !checking) onRun();
									}
								})]
							}),
							install.inputError === null ? null : (0, react_jsx_runtime.jsx)("p", {
								id: errorId,
								className: PluginManagerPage_module_css_default.inputError,
								role: "alert",
								children: t(INPUT_PROBLEM_KEYS[install.inputError.problem], { reason: install.inputError.reason })
							}),
							(0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: PluginManagerPage_module_css_default.guideToggle,
								"aria-expanded": guideOpen,
								"aria-controls": guideId,
								onClick: () => {
									setGuideOpen((open) => !open);
								},
								children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutline14, {
									className: PluginManagerPage_module_css_default.guideChevron,
									"aria-hidden": "true"
								}), (0, react_jsx_runtime.jsx)("span", { children: t(guideOpen ? "installGuideHide" : "installGuideToggle") })]
							}),
							guideOpen ? (0, react_jsx_runtime.jsxs)("div", {
								id: guideId,
								className: PluginManagerPage_module_css_default.guide,
								"data-install-guide": true,
								children: [
									(0, react_jsx_runtime.jsx)("p", {
										className: PluginManagerPage_module_css_default.guideIntro,
										children: t("installGuideIntro")
									}),
									(0, react_jsx_runtime.jsx)("p", {
										className: PluginManagerPage_module_css_default.guideNote,
										children: t("installGuideIdNote")
									}),
									(0, react_jsx_runtime.jsx)("ol", {
										className: PluginManagerPage_module_css_default.guideList,
										children: GUIDE_EXAMPLES.map(({ key, titleKey, exampleKey, hintKey }, index) => (0, react_jsx_runtime.jsxs)("li", {
											className: PluginManagerPage_module_css_default.guideItem,
											children: [
												(0, react_jsx_runtime.jsx)("span", {
													className: PluginManagerPage_module_css_default.guideIndex,
													"aria-hidden": "true",
													children: index + 1
												}),
												(0, react_jsx_runtime.jsxs)("div", {
													className: PluginManagerPage_module_css_default.guideMain,
													children: [
														(0, react_jsx_runtime.jsx)("span", {
															className: PluginManagerPage_module_css_default.guideTitle,
															children: t(titleKey)
														}),
														(0, react_jsx_runtime.jsxs)("span", {
															className: PluginManagerPage_module_css_default.guideExample,
															children: [(0, react_jsx_runtime.jsx)("span", {
																className: PluginManagerPage_module_css_default.guideExampleLabel,
																children: t("installGuideExampleLabel")
															}), (0, react_jsx_runtime.jsx)("code", { children: t(exampleKey) })]
														}),
														(0, react_jsx_runtime.jsx)("span", {
															className: PluginManagerPage_module_css_default.guideHint,
															children: t(hintKey)
														})
													]
												}),
												(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
													variant: "outline",
													size: "sm",
													"aria-label": t("installGuideFillAria", { example: t(exampleKey) }),
													disabled: checking,
													onClick: () => {
														onEditSpec(t(exampleKey));
													},
													children: t("installGuideFill")
												})
											]
										}, key))
									}),
									(0, react_jsx_runtime.jsxs)("p", {
										className: PluginManagerPage_module_css_default.guideSafety,
										role: "note",
										children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutline16, {
											size: 14,
											"aria-hidden": "true"
										}), (0, react_jsx_runtime.jsx)("span", { children: t("installGuideSafety") })]
									})
								]
							}) : null
						]
					})
				});
			}
			const heading = t(SCREEN_TITLE_KEYS[phase]);
			const pending = isInstallPending(phase);
			const stoppable = phase === "running" || phase === "failed";
			const unconfirmed = install.failure?.cancelUnconfirmed === true ? install.failure.reason : void 0;
			const pendingBuilds = phase === "failed" ? install.failure?.pendingBuilds ?? [] : [];
			const approvable = pendingBuilds.length > 0;
			const firstRun = install.runs[0];
			return (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
				open: install.open,
				onClose,
				title: heading,
				headless: true,
				className: PluginManagerPage_module_css_default.installDialog,
				children: (0, react_jsx_runtime.jsxs)("div", {
					className: PluginManagerPage_module_css_default.wizard,
					"data-install-phase": phase,
					children: [(0, react_jsx_runtime.jsxs)("div", {
						className: PluginManagerPage_module_css_default.wizardHead,
						children: [phase === "done" ? (0, react_jsx_runtime.jsx)("span", {}) : (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							className: PluginManagerPage_module_css_default.wizardBack,
							"aria-label": t("installEditAria"),
							disabled: !stoppable,
							onClick: onCancel,
							children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronLeftOutline14, { "aria-hidden": "true" }), (0, react_jsx_runtime.jsx)("span", { children: t("installEdit") })]
						}), (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: PluginManagerPage_module_css_default.wizardClose,
							"aria-label": t(phase === "running" ? "installCloseCancels" : "close"),
							disabled: pending && phase !== "running",
							onClick: phase === "running" ? onCancelAndClose : onClose,
							children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCloseOutline16, { size: 14 })
						})]
					}), (0, react_jsx_runtime.jsxs)("div", {
						className: PluginManagerPage_module_css_default.wizardScroll,
						children: [
							(0, react_jsx_runtime.jsxs)("div", {
								className: PluginManagerPage_module_css_default.wizardHero,
								children: [
									(0, react_jsx_runtime.jsx)("span", {
										className: PluginManagerPage_module_css_default.wizardIcon,
										"data-tone": pending ? "pending" : phase,
										"aria-hidden": "true",
										children: pending ? (0, react_jsx_runtime.jsx)("span", { className: PluginManagerPage_module_css_default.spinnerLarge }) : phase === "done" ? (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCheckOutline16, { size: 28 }) : (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutline16, { size: 28 })
									}),
									(0, react_jsx_runtime.jsx)("h2", {
										className: PluginManagerPage_module_css_default.wizardTitle,
										role: phase === "failed" ? "alert" : "status",
										children: heading
									}),
									phase === "failed" ? (0, react_jsx_runtime.jsx)("p", {
										className: PluginManagerPage_module_css_default.wizardSub,
										children: failureText(install.failure, t)
									}) : null,
									unconfirmed === void 0 ? null : (0, react_jsx_runtime.jsx)("p", {
										className: PluginManagerPage_module_css_default.wizardSub,
										role: "alert",
										children: t("installCancelUnconfirmed", { reason: unconfirmed })
									})
								]
							}),
							install.subject === null ? null : (0, react_jsx_runtime.jsx)(SubjectCard, {
								subject: install.subject,
								t
							}),
							approvable ? (0, react_jsx_runtime.jsxs)("section", {
								className: PluginManagerPage_module_css_default.approval,
								role: "group",
								"aria-labelledby": approvalId,
								"data-install-approval": true,
								children: [
									(0, react_jsx_runtime.jsx)("h3", {
										id: approvalId,
										className: PluginManagerPage_module_css_default.approvalTitle,
										children: t("installApprovalTitle")
									}),
									(0, react_jsx_runtime.jsx)("p", {
										className: PluginManagerPage_module_css_default.approvalText,
										children: t("installApprovalDescription")
									}),
									(0, react_jsx_runtime.jsx)("ul", {
										className: PluginManagerPage_module_css_default.approvalList,
										children: pendingBuilds.map((name) => (0, react_jsx_runtime.jsx)("li", { children: (0, react_jsx_runtime.jsx)("code", { children: name }) }, name))
									}),
									(0, react_jsx_runtime.jsx)("p", {
										className: PluginManagerPage_module_css_default.approvalText,
										children: t("installApprovalConsequence")
									}),
									(0, react_jsx_runtime.jsx)("p", {
										className: PluginManagerPage_module_css_default.approvalCaution,
										children: t("installApprovalCaution")
									}),
									(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
										variant: "primary",
										className: PluginManagerPage_module_css_default.wide,
										onClick: onApproveBuilds,
										children: t("installApproveAndRetry")
									})
								]
							}) : null,
							phase === "done" && install.installed === null ? (0, react_jsx_runtime.jsx)("p", {
								className: PluginManagerPage_module_css_default.result,
								role: "status",
								children: t("installDoneNothing")
							}) : null,
							phase === "done" && install.restartRequired ? (0, react_jsx_runtime.jsx)("p", {
								className: PluginManagerPage_module_css_default.resultWarn,
								role: "status",
								children: t("installDoneRestart")
							}) : null,
							phase === "done" && install.approvedBuilds.length > 0 ? (0, react_jsx_runtime.jsx)("p", {
								className: PluginManagerPage_module_css_default.result,
								role: "status",
								children: t("installDoneApproved", { names: install.approvedBuilds.join(", ") })
							}) : null,
							(0, react_jsx_runtime.jsxs)("div", {
								className: PluginManagerPage_module_css_default.wizardFoot,
								children: [
									(0, react_jsx_runtime.jsxs)("button", {
										type: "button",
										className: PluginManagerPage_module_css_default.detailsToggle,
										"aria-expanded": install.detailsOpen,
										onClick: onToggleDetails,
										children: [(0, react_jsx_runtime.jsx)("span", { children: t(install.detailsOpen ? "installDetailsHide" : "installDetailsShow") }), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutline14, {
											className: PluginManagerPage_module_css_default.detailsChevron,
											"aria-hidden": "true"
										})]
									}),
									pending ? (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
										variant: "outline",
										size: "sm",
										disabled: phase !== "running",
										onClick: onCancel,
										children: t(phase === "cancelling" ? "installCancelling" : "installCancel")
									}) : null,
									phase === "failed" && !approvable ? (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
										variant: "primary",
										size: "sm",
										onClick: onRun,
										children: t("installRetry")
									}) : null
								]
							}),
							install.detailsOpen ? (0, react_jsx_runtime.jsxs)("div", {
								className: PluginManagerPage_module_css_default.detailsBody,
								children: [(0, react_jsx_runtime.jsx)("p", {
									className: PluginManagerPage_module_css_default.installLocation,
									children: firstRun === void 0 ? t("terminalNoOutput") : t("installLocation", { dir: firstRun.cwd })
								}), install.runs.map((run) => (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.TerminalBlock, {
									command: run.command,
									output: run.output,
									running: run.exitCode === void 0,
									exitCode: run.exitCode,
									maxLines: INSTALL_TERMINAL_LINES,
									labels: {
										...terminalLabels(t),
										...phase === "cancelling" ? { failed: t("installCancelledShort") } : {}
									},
									className: PluginManagerPage_module_css_default.terminal
								}, run.jobId))]
							}) : null,
							phase !== "done" ? null : install.installed !== null ? (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								variant: "primary",
								className: PluginManagerPage_module_css_default.wide,
								disabled: install.enabling,
								"aria-busy": install.enabling,
								onClick: onEnableNow,
								children: t("installEnableNow")
							}) : (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								variant: "primary",
								className: PluginManagerPage_module_css_default.wide,
								onClick: onClose,
								children: t("installClose")
							})
						]
					})]
				})
			});
		}
		/** The confirmation an uninstall waits on. */
		function ConfirmDialog({ confirm, t, onConfirm, onCancel }) {
			const { title: name } = packageText({ name: confirm.packageName }, t);
			return (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
				open: true,
				onClose: onCancel,
				title: t("confirmUninstallTitle", { name }),
				closeLabel: t("close"),
				description: t("confirmUninstallDescription"),
				footer: (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "outline",
					onClick: onCancel,
					children: t("cancel")
				}), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "primary",
					className: PluginManagerPage_module_css_default.dangerButton,
					onClick: onConfirm,
					children: t("confirmUninstall")
				})] })
			});
		}
		/** Render the plugin manager: the official plugins and installed bundles, their pages, the install dialog, and the confirmation. */
		function PluginManagerPage(props) {
			const { t, ensure, renderSlot } = props;
			const state = props.usePluginManager((snapshot) => snapshot);
			const ledger = props.useConfigLedger((snapshot) => snapshot);
			const [view, setView] = (0, react.useState)({ kind: "list" });
			(0, react.useEffect)(() => {
				ensure();
			}, [ensure]);
			const { highlight, clearHighlight } = {
				highlight: state.highlight,
				clearHighlight: props.clearHighlight
			};
			(0, react.useEffect)(() => {
				if (highlight === null) return;
				const card = document.querySelector(`[data-plugin-package="${highlight}"]`);
				if (card !== null && typeof card.scrollIntoView === "function") card.scrollIntoView({
					block: "center",
					behavior: "smooth"
				});
				const timer = setTimeout(clearHighlight, HIGHLIGHT_MS);
				return () => {
					clearTimeout(timer);
				};
			}, [highlight, clearHighlight]);
			const noticeLine = state.notice === null ? null : noticeText(state.notice, t);
			const listed = state.packages.filter((pkg) => !BUILTIN_PROFILE_BUNDLES.has(pkg.name) && (pkg.installed || pkg.optional || pkg.error !== void 0));
			const mine = listed.filter((pkg) => pkg.installed || !pkg.optional);
			const official = listed.filter((pkg) => pkg.optional && !pkg.installed);
			const loaded = state.status === "ready" || state.status === "error";
			const openPkg = view.kind === "package" || view.kind === "row" ? listed.find((pkg) => pkg.name === view.name) : void 0;
			const openItem = view.kind === "item" ? ledger.items.find((item) => item.id === view.id) : void 0;
			const openRow = view.kind === "row" && openPkg !== void 0 ? openPkg.rows.find((row) => row.rowId === view.rowId) : void 0;
			const showsCards = openPkg === void 0 && openItem === void 0;
			const setRowEnabled = (row, enabled) => {
				/* v8 ignore next -- a row without a live entry has its switch disabled */
				if (row.entryId !== void 0) props.setRowEnabled(row.entryId, enabled);
			};
			const configure = (pkg) => ({
				has: (row) => ledger.rows.has(rowConfigKey(pkg.name, row.rowId)),
				open: (row) => {
					setView({
						kind: "row",
						name: pkg.name,
						rowId: row.rowId
					});
				}
			});
			const packageCard = (pkg) => (0, react_jsx_runtime.jsx)(PackageCard, {
				pkg,
				t,
				busy: state.busy.includes(pkg.name),
				highlighted: state.highlight === pkg.name,
				onOpen: () => {
					setView({
						kind: "package",
						name: pkg.name
					});
				},
				onSetEnabled: (enabled) => {
					props.setEnabled(pkg.name, enabled);
				}
			}, pkg.name);
			const officialCards = [...official.map(packageCard), ...ledger.items.map((item) => (0, react_jsx_runtime.jsx)(ItemCard, {
				item,
				t,
				renderSlot,
				onOpen: () => {
					setView({
						kind: "item",
						id: item.id
					});
				}
			}, `item:${item.id}`))];
			const renderGroup = (id, heading, cards) => cards.length === 0 ? null : (0, react_jsx_runtime.jsxs)("section", {
				className: PluginManagerPage_module_css_default.group,
				"data-plugin-scope": "global",
				"data-plugin-group": id,
				children: [(0, react_jsx_runtime.jsxs)("div", {
					className: PluginManagerPage_module_css_default.groupHead,
					children: [(0, react_jsx_runtime.jsx)("h3", {
						className: PluginManagerPage_module_css_default.groupTitle,
						children: heading
					}), (0, react_jsx_runtime.jsx)("span", {
						className: PluginManagerPage_module_css_default.count,
						"data-plugin-count": cards.length,
						children: cards.length
					})]
				}), (0, react_jsx_runtime.jsx)("ul", {
					className: PluginManagerPage_module_css_default.cards,
					children: cards
				})]
			});
			return (0, react_jsx_runtime.jsxs)("section", {
				className: PluginManagerPage_module_css_default.page,
				"data-plugin-panel": true,
				"aria-busy": state.status === "loading",
				children: [
					showsCards ? (0, react_jsx_runtime.jsxs)("header", {
						className: PluginManagerPage_module_css_default.pageHead,
						children: [(0, react_jsx_runtime.jsxs)("div", { children: [(0, react_jsx_runtime.jsx)("h1", {
							className: PluginManagerPage_module_css_default.pageTitle,
							children: t("title")
						}), (0, react_jsx_runtime.jsx)("p", {
							className: PluginManagerPage_module_css_default.pageIntro,
							children: t("intro")
						})] }), (0, react_jsx_runtime.jsxs)("div", {
							className: PluginManagerPage_module_css_default.toolbar,
							children: [(0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: PluginManagerPage_module_css_default.iconButton,
								"aria-label": t("refresh"),
								title: t("refresh"),
								disabled: !loaded,
								onClick: props.refresh,
								children: (0, react_jsx_runtime.jsx)("span", {
									className: PluginManagerPage_module_css_default.iconWrap,
									"aria-hidden": "true",
									children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutline16, {})
								})
							}), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								variant: "primary",
								size: "sm",
								icon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPlusOutline16, { size: 13 }),
								disabled: !loaded,
								onClick: props.openInstall,
								children: t("addPlugin")
							})]
						})]
					}) : null,
					state.status === "loading" ? (0, react_jsx_runtime.jsx)("p", {
						className: PluginManagerPage_module_css_default.status,
						children: t("loading")
					}) : null,
					state.status === "unavailable" ? (0, react_jsx_runtime.jsx)("p", {
						className: PluginManagerPage_module_css_default.status,
						role: "status",
						children: t("unavailable")
					}) : null,
					state.status === "error" ? (0, react_jsx_runtime.jsxs)("div", {
						className: PluginManagerPage_module_css_default.failure,
						children: [(0, react_jsx_runtime.jsx)("p", {
							role: "alert",
							children: t("error")
						}), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "outline",
							size: "sm",
							onClick: props.refresh,
							children: t("retry")
						})]
					}) : null,
					state.notice === null || noticeLine === null ? null : (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Toast, {
						text: noticeLine,
						icon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutline16, {}),
						holdMs: toastHoldMs(noticeLine),
						onDone: props.dismissNotice
					}, state.notice.seq),
					loaded && openPkg !== void 0 && openRow !== void 0 ? (0, react_jsx_runtime.jsx)(RowDetail, {
						pkg: openPkg,
						row: openRow,
						t,
						renderSlot,
						onBack: () => {
							setView({
								kind: "package",
								name: openPkg.name
							});
						}
					}) : null,
					loaded && openPkg !== void 0 && openRow === void 0 ? (0, react_jsx_runtime.jsx)(PackageDetail, {
						pkg: openPkg,
						t,
						busy: state.busy.includes(openPkg.name),
						rowBusy: (row) => row.entryId !== void 0 && state.busy.includes(rowKey(row.entryId)),
						configured: ledger.bundles.has(openPkg.name),
						configure: configure(openPkg),
						renderSlot,
						onBack: () => {
							setView({ kind: "list" });
						},
						onSetEnabled: (enabled) => {
							props.setEnabled(openPkg.name, enabled);
						},
						onUninstall: () => {
							props.uninstall(openPkg.name);
						},
						onSetRowEnabled: setRowEnabled
					}) : null,
					loaded && openItem !== void 0 ? (0, react_jsx_runtime.jsx)(ItemDetail, {
						item: openItem,
						t,
						renderSlot,
						onBack: () => {
							setView({ kind: "list" });
						}
					}) : null,
					loaded && showsCards ? officialCards.length === 0 && mine.length === 0 ? (0, react_jsx_runtime.jsx)("p", {
						className: PluginManagerPage_module_css_default.empty,
						children: t("empty")
					}) : (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [renderGroup("official", t("officialTitle"), officialCards), renderGroup("bundles", t("bundlesTitle"), mine.map(packageCard))] }) : null,
					(0, react_jsx_runtime.jsx)(InstallDialog, {
						install: state.install,
						t,
						onClose: props.closeInstall,
						onEditSpec: props.editInstallSpec,
						onRun: props.runInstall,
						onCancel: props.cancelInstall,
						onCancelAndClose: props.cancelInstallAndClose,
						onToggleDetails: props.toggleInstallDetails,
						onEnableNow: props.enableInstalled,
						onApproveBuilds: props.approveBuildsAndRetry
					}),
					state.confirm === null ? null : (0, react_jsx_runtime.jsx)(ConfirmDialog, {
						confirm: state.confirm,
						t,
						onConfirm: props.confirm,
						onCancel: props.cancelConfirm
					})
				]
			});
		}
		//#endregion
		//#region lib/types/client/PluginsPanelIcon.js
		/**
		* Render the plugin glyph at the size the sidebar asks for.
		* @param props - the sidebar's icon share: the requested edge and whether the panel is selected.
		* @returns the icon element.
		*/
		function PluginsPanelIcon({ size }) {
			return (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPluginPinwheelOutline16, { size });
		}
		//#endregion
		//#region lib/types/client/locales.js
		/** Plugin management copy and display names of shipped global rows. */
		/** Simplified Chinese dictionary and key source of truth. */
		const zh = {
			panel: "插件",
			title: "插件",
			intro: "添加和管理插件",
			loading: "正在读取插件…",
			error: "暂时无法读取插件。",
			unavailable: "本部署没有可管理的 profile，无法安装或启停插件。",
			retry: "重试",
			refresh: "刷新",
			empty: "还没有安装任何插件。",
			addPlugin: "添加插件",
			restartNotice: "更改将在下次启动生效",
			overriddenNotice: "{name} 已保存，但被更高优先级的配置覆盖，当前未生效",
			bundlesTitle: "已安装",
			officialTitle: "官方",
			builtinAgentTeamTitle: "智能体团队",
			builtinAgentTeamDescription: "启用智能体团队协作与团队工具。",
			builtinAgentTeamWebTitle: "智能体团队 Web 界面",
			builtinAgentTeamWebDescription: "在浏览器中查看团队成员、任务看板和成员会话。",
			builtinAutoReviewTitle: "自动授权审查",
			builtinAutoReviewDescription: "提供自动审查权限模式，由模型在每次工具调用前判断是否授权。",
			statusProblem: "异常",
			statusBeta: "Beta",
			reasonLabel: "原因",
			versionTag: "v{version}",
			noDescription: "暂无描述。",
			partsLabel: "包含的组件",
			partsEmpty: "这个插件包不包含任何组件。",
			partsCountTotal: "共 {count} 个",
			partsCountRunning: "{count} 运行中",
			partsCountOff: "{count} 已停用",
			partOff: "已关闭",
			partsCountFailed: "{count} 异常",
			partsFilter: "筛选组件",
			partsFilterEmpty: "没有匹配的组件。",
			partToggle: "启用组件 {name}",
			rowPhasePending: "等待依赖",
			rowPhaseLoading: "加载中",
			rowPhaseActive: "运行中",
			rowPhaseFailed: "异常",
			rowPhaseUnloading: "卸载中",
			enableToggle: "启用 {name}",
			openDetail: "查看 {name}",
			backToList: "返回插件列表",
			crumbRoot: "插件列表",
			backToPackage: "返回 {name}",
			configureRow: "配置 {name}",
			rowStateIdle: "未运行",
			uninstall: "卸载",
			uninstallLabel: "卸载 {name}",
			installTitle: "添加插件",
			installDescription: "输入插件的包名、GitHub 仓库地址或本地目录路径。",
			installSpecLabel: "包名或地址",
			installSpecPlaceholder: "例如 @deepseek-ai/dsh-experimental-auto-review",
			installGuideToggle: "不知道该填什么？",
			installGuideHide: "收起引导",
			installGuideIntro: "从插件的 README 或发布页面复制以下任意一项。",
			installGuideIdNote: "包名即 npm 包名，常见形式为 dsh-xxx 或 @作者/插件名；插件的显示名称不是包名。",
			installGuideIdTitle: "包名",
			installGuideIdExample: "@deepseek-ai/dsh-experimental-auto-review",
			installGuideIdHint: "README 安装命令中 dsh plugin add 或 pnpm add 之后的部分。",
			installGuideGitTitle: "GitHub 仓库地址",
			installGuideGitExample: "https://github.com/author/dsh-plugin",
			installGuideGitHint: "插件在 GitHub 上的开源仓库地址，也支持其他 Git 仓库。",
			installGuidePathTitle: "本地插件目录",
			installGuidePathExample: "/Users/name/my-plugin",
			installGuidePathHint: "本机上插件目录的绝对路径，适用于自行开发或已下载的插件。",
			installGuideExampleLabel: "示例：",
			installGuideFill: "填入示例",
			installGuideFillAria: "填入示例 {example}",
			installGuideSafety: "请确认插件来源可信。插件在本机以你的权限运行，来源不明的插件可能损坏 DeepSeek Harness，或读取和泄露你的数据。",
			installRun: "安装",
			installChecking: "正在检查…",
			installProblemInvalid: "无法识别这个包名或地址：{reason}",
			installProblemInstalled: "该插件已安装",
			installProblemNotFound: "未找到相关插件",
			installProblemNotPackage: "该路径不存在或不是有效的插件包",
			installProblemNotBundle: "这个包没有声明组合包，无法作为插件安装：{reason}",
			installProblemNetwork: "无法连接插件源，请检查网络后重试",
			installProblemUnknown: "无法获取插件信息：{reason}",
			installingTitle: "插件安装中…",
			installedTitle: "已安装",
			installFailedTitle: "插件安装失败",
			installEdit: "编辑",
			installEditAria: "返回编辑",
			installCancel: "取消安装",
			installCloseCancels: "取消安装并关闭",
			installStarting: "正在准备安装…",
			installCancelling: "正在停止安装…",
			installApplying: "正在应用配置，请稍候…",
			installCancelledShort: "已取消",
			installCancelled: "已取消安装，插件未启用，下载的文件可能保留",
			installCancelUnconfirmed: "尚未确认安装已停止，请重试取消或等待安装结果。{reason}",
			installEnableNow: "立即启用",
			installDetailsShow: "查看安装详情",
			installDetailsHide: "收起安装详情",
			installVersion: "版本 {version}",
			installSubjectPath: "本地目录",
			installSubjectGit: "Git 仓库",
			installSubjectTarball: "压缩包",
			installLocation: "安装位置：{dir}",
			installRetry: "重试",
			installFailureNetwork: "网络连接失败",
			installFailureNotFound: "未找到相关插件",
			installFailureNoMatchingVersion: "没有匹配的版本",
			installFailureDiskFull: "磁盘空间不足，安装已停止",
			installFailurePermission: "没有写入权限，无法安装",
			installFailureBuildBlocked: "有依赖的安装脚本需要你允许后才能继续",
			installFailureBuildBlockedManual: "有依赖的安装脚本被 pnpm 拦下，请在 profile 的 pnpm-workspace.yaml 的 allowBuilds 中放行后重试",
			installFailureIntegrity: "下载的安装包校验失败",
			installFailureTimeout: "安装超时",
			installFailurePnpmMissing: "没有找到 pnpm，无法安装",
			installFailureGeneric: "安装过程中出错，原因见安装详情",
			terminalRunning: "运行中",
			terminalFailed: "失败",
			terminalDone: "已完成",
			terminalCopy: "复制",
			terminalCopied: "复制成功",
			terminalNoOutput: "无输出",
			terminalCollapseAria: "收起输出",
			terminalCollapse: "收起",
			terminalExpandAria: "展开其余 {n} 行输出",
			terminalExpand: "… 其余 {n} 行",
			terminalExitCode: "退出码 {code}",
			terminalSignal: "信号 {signal}",
			terminalNoExitCode: "未正常退出",
			installDoneNothing: "安装完成，没有新增依赖。",
			installDoneRestart: "已安装，下次启动后加载。",
			installDoneApproved: "已允许运行安装脚本：{names}",
			installApprovalTitle: "需要允许安装脚本",
			installApprovalDescription: "以下包声明了安装脚本，pnpm 默认不运行。",
			installApprovalConsequence: "允许后，脚本会以你的权限在本机运行，授权保存在当前 profile，之后不再询问。",
			installApprovalCaution: "只在信任这些包时允许。",
			installApproveAndRetry: "允许这些脚本并重试",
			installClose: "完成",
			close: "关闭",
			cancel: "取消",
			confirmUninstallTitle: "卸载「{name}」？",
			confirmUninstallDescription: "卸载后它提供的功能会消失。",
			confirmUninstall: "卸载",
			failedEnable: "启用失败：{reason}",
			failedDisable: "停用失败：{reason}",
			failedUninstall: "卸载失败：{reason}",
			failedRowEnable: "组件启用失败：{reason}",
			failedRowDisable: "组件停用失败：{reason}",
			reasonManagementRequired: "插件管理所需，不能停用或卸载",
			reasonUnaddressable: "当前 profile 的 patch 无法唯一定位这一项",
			reasonUnknownPlugin: "找不到该插件",
			reasonInvalidSpec: "请输入有效的包名或地址",
			reasonAmbiguousInstall: "无法从依赖变更中确定安装了哪一个包",
			reasonNotBundle: "这个包没有声明组合包，不能作为插件管理",
			reasonNotRemovable: "这个包不属于当前 profile，或者是插件管理所需的组件",
			reasonStopProfile: "这个 profile 没有启用 HMR，正在使用的包要停止后用 dsh plugin 卸载",
			reasonBundleInUse: "其他配置仍在使用这个组合包的组件，请先停用它们",
			reasonStaleApproval: "待允许的安装脚本列表已变化，请重新安装以刷新",
			reasonOperationError: "Host 报告了一个错误"
		};
		/** English dictionary checked against the Chinese key set. */
		const en = {
			panel: "Plugins",
			title: "Plugins",
			intro: "Add and manage plugins",
			loading: "Reading plugins…",
			error: "Plugins are temporarily unavailable.",
			unavailable: "This deployment runs without a manageable profile, so plugins cannot be installed or switched here.",
			retry: "Retry",
			refresh: "Refresh",
			empty: "No plugins are installed yet.",
			addPlugin: "Add plugin",
			restartNotice: "The change takes effect at the next start",
			overriddenNotice: "{name} was saved, but a higher-priority configuration overrides it, so it is not in effect",
			bundlesTitle: "Installed",
			officialTitle: "Official",
			builtinAgentTeamTitle: "Agent Teams",
			builtinAgentTeamDescription: "Enable agent team collaboration and team tools.",
			builtinAgentTeamWebTitle: "Agent Teams Web UI",
			builtinAgentTeamWebDescription: "View team members, the task board, and teammate sessions in the browser.",
			builtinAutoReviewTitle: "Auto Authorization Review",
			builtinAutoReviewDescription: "Add an Auto review permission mode that uses the model to assess authorization before each tool call.",
			statusProblem: "Problem",
			statusBeta: "Beta",
			reasonLabel: "Reason",
			versionTag: "v{version}",
			noDescription: "No description.",
			partsLabel: "Components",
			partsEmpty: "This plugin pack contains no components.",
			partsCountTotal: "{count} total",
			partsCountRunning: "{count} running",
			partsCountOff: "{count} off",
			partOff: "Off",
			partsCountFailed: "{count} failed",
			partsFilter: "Filter components",
			partsFilterEmpty: "No component matches.",
			partToggle: "Enable component {name}",
			rowPhasePending: "Waiting for dependencies",
			rowPhaseLoading: "Loading",
			rowPhaseActive: "Running",
			rowPhaseFailed: "Problem",
			rowPhaseUnloading: "Unloading",
			enableToggle: "Enable {name}",
			openDetail: "View {name}",
			backToList: "Back to plugins",
			crumbRoot: "Plugins",
			backToPackage: "Back to {name}",
			configureRow: "Configure {name}",
			rowStateIdle: "Not running",
			uninstall: "Uninstall",
			uninstallLabel: "Uninstall {name}",
			installTitle: "Add plugin",
			installDescription: "Enter the plugin's package name, GitHub repository address, or local directory path.",
			installSpecLabel: "Package name or address",
			installSpecPlaceholder: "for example @deepseek-ai/dsh-experimental-auto-review",
			installGuideToggle: "Not sure what to enter?",
			installGuideHide: "Hide the guide",
			installGuideIntro: "Copy any one of these from the plugin's README or release page.",
			installGuideIdNote: "The package name is the npm package name, usually dsh-xxx or @author/plugin; the display name is not one.",
			installGuideIdTitle: "Package name",
			installGuideIdExample: "@deepseek-ai/dsh-experimental-auto-review",
			installGuideIdHint: "The part after dsh plugin add or pnpm add in the README's install command.",
			installGuideGitTitle: "GitHub repository address",
			installGuideGitExample: "https://github.com/author/dsh-plugin",
			installGuideGitHint: "The address of the plugin's open-source repository on GitHub; other Git hosts work too.",
			installGuidePathTitle: "Local plugin directory",
			installGuidePathExample: "/Users/name/my-plugin",
			installGuidePathHint: "The absolute path of a plugin directory on this machine, developed here or downloaded.",
			installGuideExampleLabel: "Example: ",
			installGuideFill: "Use example",
			installGuideFillAria: "Use the example {example}",
			installGuideSafety: "Install only plugins you trust: they run with your permissions and can damage DeepSeek Harness or leak your data.",
			installRun: "Install",
			installChecking: "Checking…",
			installProblemInvalid: "This is not a package name or address that can be installed: {reason}",
			installProblemInstalled: "This plugin is already installed",
			installProblemNotFound: "No such plugin was found",
			installProblemNotPackage: "The path does not exist or is not a valid plugin package",
			installProblemNotBundle: "This package declares no bundle, so it cannot be installed as a plugin: {reason}",
			installProblemNetwork: "The plugin registry could not be reached; check the network and try again",
			installProblemUnknown: "The plugin could not be looked up: {reason}",
			installingTitle: "Installing the plugin…",
			installedTitle: "Installed",
			installFailedTitle: "The plugin could not be installed",
			installEdit: "Edit",
			installEditAria: "Back to editing",
			installCancel: "Cancel install",
			installCloseCancels: "Cancel install and close",
			installStarting: "Preparing installation…",
			installCancelling: "Stopping installation…",
			installApplying: "Applying configuration, please wait…",
			installCancelledShort: "Cancelled",
			installCancelled: "Installation cancelled; the plugin is not enabled, and downloaded files may remain",
			installCancelUnconfirmed: "Installation has not been confirmed stopped. Retry cancellation or wait for the installation result. {reason}",
			installEnableNow: "Enable now",
			installDetailsShow: "Show install details",
			installDetailsHide: "Hide install details",
			installVersion: "Version {version}",
			installSubjectPath: "Local directory",
			installSubjectGit: "Git repository",
			installSubjectTarball: "Tarball",
			installLocation: "Installs into {dir}",
			installRetry: "Retry",
			installFailureNetwork: "The network connection failed",
			installFailureNotFound: "No such plugin was found",
			installFailureNoMatchingVersion: "No version matches the request",
			installFailureDiskFull: "The disk is full; the install stopped",
			installFailurePermission: "No write permission; the plugin cannot be installed",
			installFailureBuildBlocked: "A dependency's install scripts need your permission before the install can continue",
			installFailureBuildBlockedManual: "pnpm blocked install scripts; allow them under allowBuilds in pnpm-workspace.yaml and retry",
			installFailureIntegrity: "The downloaded package failed its integrity check",
			installFailureTimeout: "The install timed out",
			installFailurePnpmMissing: "pnpm was not found, so nothing can be installed",
			installFailureGeneric: "Something went wrong during the install; the details say what",
			terminalRunning: "Running",
			terminalFailed: "Failed",
			terminalDone: "Done",
			terminalCopy: "Copy",
			terminalCopied: "Copied",
			terminalNoOutput: "No output",
			terminalCollapseAria: "Collapse output",
			terminalCollapse: "Collapse",
			terminalExpandAria: "Expand the remaining {n} output lines",
			terminalExpand: "… {n} more lines",
			terminalExitCode: "exit code {code}",
			terminalSignal: "signal {signal}",
			terminalNoExitCode: "no exit code",
			installDoneNothing: "Install finished with no new dependency.",
			installDoneRestart: "Installed; it loads at the next start.",
			installDoneApproved: "Install scripts allowed for {names}",
			installApprovalTitle: "Install scripts need permission",
			installApprovalDescription: "These packages have install scripts that pnpm did not run.",
			installApprovalConsequence: "Once allowed, the scripts run here with your permissions, and the permission is saved in this profile.",
			installApprovalCaution: "Allow only packages you trust.",
			installApproveAndRetry: "Allow these scripts and retry",
			installClose: "Done",
			close: "Close",
			cancel: "Cancel",
			confirmUninstallTitle: "Uninstall \"{name}\"?",
			confirmUninstallDescription: "What it provides goes away once it is uninstalled.",
			confirmUninstall: "Uninstall",
			failedEnable: "Could not enable: {reason}",
			failedDisable: "Could not disable: {reason}",
			failedUninstall: "Could not uninstall: {reason}",
			failedRowEnable: "Could not enable the component: {reason}",
			failedRowDisable: "Could not disable the component: {reason}",
			reasonManagementRequired: "Plugin management needs it; it cannot be switched off or uninstalled.",
			reasonUnaddressable: "The profile patch cannot address this one uniquely.",
			reasonUnknownPlugin: "No such plugin.",
			reasonInvalidSpec: "Enter a valid package name or address.",
			reasonAmbiguousInstall: "Which package was installed cannot be told from the dependency change.",
			reasonNotBundle: "This package declares no bundle, so it cannot be managed as a plugin.",
			reasonNotRemovable: "This package is not owned by the profile, or plugin management needs it.",
			reasonStopProfile: "This profile runs without HMR; stop it and uninstall the package with dsh plugin.",
			reasonBundleInUse: "Other configuration still uses this bundle's components; switch them off first.",
			reasonStaleApproval: "The pending script approvals changed; install again to refresh them.",
			reasonOperationError: "The Host reported an error."
		};
		//#endregion
		//#region lib/types/client/index.js
		/**
		* Plugin manager, browser half: the **Plugins** entry of the sidebar and the
		* management page it opens in the main column. The page installs, enables,
		* disables, and removes the bundles of the Host's profile through the
		* `pluginManager` Remote and switches their rows in the profile's user layer.
		* A plugin that carries its own configuration renders it on this page through
		* the slots the page declares (`slot-contract.ts`).
		*/
		/** Dictionary namespace owned by this plugin. */
		const NS = "pluginManager";
		/** The id shared by the sidebar entry and the main panel it opens. */
		const PANEL_ID = "plugins";
		/** Services required by the sidebar registration and the Remote methods; the inventory says whether the Host manages a profile. */
		const inject = [
			"slots",
			"locale",
			"remote",
			"remote.pluginManager",
			"remote.pluginInventory"
		];
		/**
		* Contribute the Plugins entry to the sidebar with the management page it
		* opens, and keep it current on the Host's change events.
		* @param ctx - the browser plugin context.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "ui-plugin-manager: dictionaries");
			const t = ctx.locale.bind(NS);
			const controller = new PluginManagerController(ctx);
			ctx.effect(() => () => {
				controller.dispose();
			}, "ui-plugin-manager: controller");
			ctx.effect(() => {
				const refresh = () => {
					if (controller.getSnapshot().status !== "idle") controller.load();
				};
				const disposers = [
					ctx.remote.$on("plugin-manager/changed", refresh),
					ctx.remote.$on("plugin-manager/install-log", (chunk) => {
						controller.appendLog(chunk);
					}),
					ctx.remote.$on("plugin-manager/install-state", (progress) => {
						controller.installProgress(progress);
					}),
					ctx.on("connection/reset", refresh)
				];
				return () => {
					for (const dispose of disposers) dispose();
				};
			}, "ui-plugin-manager: host invalidations");
			const configLedger = configLedgerSource(ctx);
			ctx.slots.inject("main", () => ctx.slots.register({
				name: "main",
				key: PANEL_ID,
				locale: NS,
				inject: () => controller.inject(configLedger),
				children: {
					"plugins.item": {
						kind: "list",
						scope: "root"
					},
					"plugins.bundle.config": {
						kind: "keyed",
						scope: "root"
					},
					"plugins.row.config": {
						kind: "keyed",
						scope: "root"
					}
				}
			}, PluginManagerPage));
			ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
				name: "sidebar.panellist",
				id: PANEL_ID,
				order: 0,
				label: () => t("panel"),
				locale: NS
			}, PluginsPanelIcon));
		}
		//#endregion
		exports.NS = NS;
		exports.PANEL_ID = PANEL_ID;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map