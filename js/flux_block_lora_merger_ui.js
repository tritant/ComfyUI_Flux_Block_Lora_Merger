import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

app.registerExtension({
    name: "FluxBlockLoraMerger_UI",
    async beforeRegisterNodeDef(nodeType, nodeData, appInstance) {
        if (nodeData.name !== "FluxBlockLoraMerger") return;

        nodeType.prototype.onNodeCreated = function () {
            const self = this;
            const blockListWidget = this.widgets.find(w => w.name === "block_prefixes");

            if (!blockListWidget) return;

            blockListWidget.inputEl.readOnly = true;

            // 🔧 Ajout d'un label info flottant avec padding propre
            requestAnimationFrame(() => {
                const input = blockListWidget.inputEl;
                if (!input) return;
                const container = input.parentElement;
                if (!container || container.querySelector(".flux-label")) return;

                const label = document.createElement("div");
                label.innerText = "ⓘ List of excluded blocks";
                label.className = "flux-label";
                Object.assign(label.style, {
                    position: "absolute",
                    top: "-10px",
                    left: "0",
                    fontSize: "12px",
                    color: "#aaa",
                    paddingLeft: "4px",
                    pointerEvents: "none",
                    userSelect: "none"
                });

                container.style.position = "relative";
                container.style.paddingTop = "7px"; // ✅ décalage visuel propre
                container.appendChild(label);
            });

            const addCheckbox = (block) => {
                const name = `block:${block}`;
                if (self.widgets.find(w => w.name === name)) return;

                self.addWidget("toggle", name, false, (val) => {
                    const lines = blockListWidget.value.split("\n").map(l => l.trim()).filter(Boolean);
                    const set = new Set(lines);
                    if (val) {
                        set.delete(name);
                    } else {
                        set.add(name);
                    }
                    const result = [...set].join("\n");
                    blockListWidget.value = result;
                    blockListWidget.inputEl.value = result;
                });
                self.widgets_changed = true;
                self.onResize?.();
            };

            const updateRemover = () => {
                const lines = blockListWidget.value.split("\n").map(l => l.trim());
                const filtered = lines.filter(l => l.startsWith("block:"));
                remover.options.values = filtered.length ? filtered.map(l => l.replace("block:", "")) : ["none"];
                remover.value = "none";
            };

            const selector = this.addWidget("combo", "➕ Add Block To Exclusions", "", (val) => {
                if (!val) return;
                const entry = `block:${val}`;
                const current = blockListWidget.value.split("\n").map(l => l.trim());
                if (!current.includes(entry)) {
                    current.push(entry);
                    blockListWidget.value = current.join("\n");
                    blockListWidget.inputEl.value = blockListWidget.value;
                    addCheckbox(val);
                    updateRemover();
                }
            }, { values: [] });

            const remover = this.addWidget("combo", "➖ Remove Block From Exclusions", "none", (val) => {
                if (!val || val === "none") return;
                const entry = `block:${val}`;
                const lines = blockListWidget.value.split("\n").map(l => l.trim());
                const updated = lines.filter(l => l !== entry);
                blockListWidget.value = updated.join("\n");
                blockListWidget.inputEl.value = blockListWidget.value;
                const i = self.widgets.findIndex(w => w.name === entry);
                if (i !== -1) self.widgets.splice(i, 1);
                updateRemover();
                self.widgets_changed = true;
                self.onResize?.();
            }, { values: ["none"] });

            this.addWidget("button", "🧹 Remove All Exclusions", "", () => {
                const lines = blockListWidget.value.split("\n").map(l => l.trim());
                const cleared = lines.filter(l => !l.startsWith("block:"));
                blockListWidget.value = cleared.join("\n");
                blockListWidget.inputEl.value = blockListWidget.value;

                const togglesToRemove = self.widgets.filter(w => w.name && w.name.startsWith("block:"));
                for (const w of togglesToRemove) {
                    const idx = self.widgets.indexOf(w);
                    if (idx !== -1) self.widgets.splice(idx, 1);
                }

                remover.options.values = ["none"];
                remover.value = "none";
                self.widgets_changed = true;
                self.onResize?.();
            }, { serialize: false });

            const loraDropdown = this.widgets.find(w => w.name === "lora_path");
            if (loraDropdown) {
                // ✅ Change le label visible du champ LoRA
                loraDropdown.label = "📂 Select Lora file";

                loraDropdown.callback = async () => {
                    const file = loraDropdown.value;
                    if (!file) return;
                    try {
                        const res = await api.fetchApi(`/custom/flux_block_lora_merger/list_blocks?file=${file}`);
                        const json = await res.json();
                        if (json.blocks) {
                            selector.options.values = json.blocks;
                        }
                    } catch (e) {
                        console.error("[Flux UI] Error loading blocks:", e);
                    }
                };
                loraDropdown.callback();
            }

            // ✅ Rename weight slider
            const weightSlider = this.widgets.find(w => w.name === "weight");
            if (weightSlider) {
                weightSlider.label = "⚖️ Lora Weight";
            }
			// ✅ Renommer le toggle "save_model"
            const saveToggle = this.widgets.find(w => w.name === "save_model");
            if (saveToggle) {
                saveToggle.label = "💾 Save merged model";
            }
			const saveName = this.widgets.find(w => w.name === "save_filename");
            if (saveName) {
                saveName.label = "📝 Output filename";
            }
        };
    }
});
