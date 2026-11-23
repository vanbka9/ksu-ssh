import { exec, shellQuote } from "./vendor/kernelsu.js";

const CONTROLLER = "/data/adb/ssh/bin/ksu-ssh-webui";
const TRASH_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5M10 11v5M14 11v5"/></svg>';
const $ = (selector) => document.querySelector(selector);
const state = { running: false, user: "root", settings: {}, addresses: [], port: "22", connectUser: "shell", connectKey: "", configLoaded: false, configBase: "" };
try {
  if (localStorage.getItem("ksu-ssh.connect-user") === "root") state.connectUser = "root";
  state.connectKey = localStorage.getItem("ksu-ssh.connect-key") || "";
} catch { /* storage can be unavailable */ }
let toastTimer;
let configWrites = Promise.resolve();

function queueConfigWrite(operation) {
  const pending = configWrites.then(operation);
  configWrites = pending.catch(() => {});
  return pending;
}

async function showPage(name) {
  document.querySelectorAll(".page-panel").forEach((panel) => {
    const active = panel.dataset.page === name;
    panel.hidden = !active;
    panel.classList.toggle("active", active);
  });
  document.querySelectorAll(".nav-item").forEach((item) => {
    const active = item.dataset.target === name;
    item.classList.toggle("active", active);
    if (active) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  });
  window.scrollTo({ top: 0, behavior: "auto" });
  if (name === "advanced") {
    try {
      await configWrites;
      const [, encoded] = records(await run(["config", "get"]))[0];
      const editor = $("#config-editor");
      if (!state.configLoaded || editor.value === state.configBase) {
        editor.value = decode(encoded);
        state.configBase = editor.value;
        state.configLoaded = true;
      }
    } catch (error) { notify(errorMessage(error)); }
  }
}

async function run(args) {
  if (typeof globalThis.ksu === "undefined") throw new Error("Open this WebUI inside KernelSU or APatch");
  // ksu.spawn drops the newline after each stdout line, which merges the tab-separated records.
  const command = [CONTROLLER, ...args].map(shellQuote).join(" ");
  let timeout;
  const timedOut = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error("The root command did not respond")), 10000);
  });
  try {
    const { errno, stdout, stderr } = await Promise.race([exec(command), timedOut]);
    if (Number(errno) !== 0) throw new Error(stderr.trim() || `Command failed (${errno})`);
    return stdout;
  } finally { clearTimeout(timeout); }
}

function records(output) {
  return output.trim().split("\n").filter(Boolean).map((line) => line.split("\t"));
}

function encode(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function decode(value) {
  const binary = atob(value);
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

function notify(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove("visible"), 2600);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

let confirmAction = null;

function ask(title, text, label, action) {
  $("#confirm-title").textContent = title;
  $("#confirm-text").textContent = text;
  $("#confirm-action").textContent = label;
  confirmAction = action;
  $("#confirm-dialog").returnValue = "";
  $("#confirm-dialog").showModal();
}

function showUnavailable(error) {
  const message = errorMessage(error);
  $("#status").dataset.state = "unavailable";
  $("#service-title").textContent = "Unavailable";
  $("#service-detail").textContent = message;
  $("#service-detail").hidden = false;
  $("#service-toggle").hidden = true;
  $("#service-restart").hidden = true;
  $("#address-list").hidden = true;
  $("#interfaces-caption").hidden = true;
  $("#command-caption").hidden = true;
  $("#copy-command").hidden = true;
  $("#connect-hint").hidden = true;
  document.querySelectorAll(".page-panel button, .page-panel input").forEach((element) => {
    element.disabled = true;
  });
  notify(message);
}

function setBusy(busy) {
  document.querySelectorAll("button, input").forEach((element) => { element.disabled = busy; });
  if (!busy) renderSettings();
}

async function loadService() {
  const values = Object.fromEntries(records(await run(["state"])));
  state.running = values.state === "running";
  const addresses = parseAddresses(values.addresses);
  $("#status").dataset.state = state.running ? "running" : "stopped";
  $("#service-title").textContent = state.running ? "Running" : "Stopped";
  const appBound = state.running && values["app-bound"] === "1";
  const unknown = state.running && values["app-bound"] !== "0" && !appBound;
  let detail = "";
  if (unknown) detail = "Cannot verify SSH survives closing the manager";
  else if (appBound) detail = "Stops when KernelSU closes. Try Restart";
  else if (state.running && addresses.length === 0) detail = "No network connection";
  $("#service-detail").textContent = detail;
  $("#service-detail").hidden = !detail;
  state.addresses = addresses;
  state.port = values.port;
  renderConnect();
  const toggle = $("#service-toggle");
  toggle.textContent = state.running ? "Stop" : "Start";
  toggle.className = state.running ? "outlined" : "primary";
  toggle.hidden = false;
  $("#service-restart").hidden = !state.running;
}

function parseAddresses(encoded) {
  if (!encoded) return [];
  return decode(encoded).split("\n").filter(Boolean)
    .map((line) => line.split("\t"))
    .filter(([iface, address]) => iface && address);
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function rootLoginAllowed() {
  const value = state.settings["root-login"];
  return value === "keys" || value === "password";
}

function connectAddress() {
  const iface = state.connectKey.split("\t")[0];
  return state.addresses.find(([name, address]) => `${name}\t${address}` === state.connectKey)
    || state.addresses.find(([name]) => name === iface)
    || state.addresses[0];
}

function renderConnect() {
  const allowed = rootLoginAllowed();
  const user = allowed && state.connectUser === "root" ? "root" : "shell";
  $("#connect-root-option").dataset.disabled = allowed ? "" : "1";
  $("#connect-root-option").setAttribute("aria-disabled", String(!allowed));
  $("#connect-shell").checked = user === "shell";
  $("#connect-root").checked = user === "root";
  const selected = connectAddress();
  if (selected) state.connectKey = `${selected[0]}\t${selected[1]}`;
  const list = $("#address-list");
  list.replaceChildren(...state.addresses.map(([iface, address]) => addressRow(iface, address)));
  const live = state.running && Boolean(selected);
  list.hidden = !live;
  $("#interfaces-caption").hidden = !live;
  $("#command-caption").hidden = !live;
  $("#copy-command").hidden = !live;
  $("#connect-hint").hidden = live;
  $("#connect-hint").textContent = state.running
    ? "No reachable address. Connect the phone to Wi-Fi or a VPN."
    : "Start SSH to get a connection command.";
  const port = state.settings.port || state.port || "22";
  $("#connect-command").textContent = live ? `ssh ${user}@${selected[1]} -p ${port}` : "";
  $("#copy-command").disabled = !live;
}

function addressRow(iface, address) {
  const key = `${iface}\t${address}`;
  const selected = key === state.connectKey;
  const row = element("button", selected ? "address selected" : "address");
  row.type = "button";
  row.dataset.iface = iface;
  row.setAttribute("aria-pressed", String(selected));
  const text = element("span", "address-text");
  text.append(element("span", "address-iface", iface), element("code", "", address));
  row.append(element("span", "address-dot"), text);
  row.addEventListener("click", () => {
    state.connectKey = key;
    try { localStorage.setItem("ksu-ssh.connect-key", key); } catch { /* storage can be unavailable */ }
    renderConnect();
  });
  return row;
}

async function copyText(text) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    notify("Copied");
  } catch {
    notify(text);
  }
}

async function serviceAction(action) {
  setBusy(true);
  try {
    await run(["service", action]);
    await loadService();
    notify(action === "restart" ? "SSH restarted" : `SSH ${action === "start" ? "started" : "stopped"}`);
  } catch (error) { notify(errorMessage(error)); }
  finally { setBusy(false); }
}

function keyDetails(info) {
  const match = info.match(/^\d+\s+(\S+)\s+(.+)\s+\(([^)]+)\)$/);
  if (!match) return { fingerprint: info, comment: "SSH key", type: "KEY" };
  return {
    fingerprint: match[1],
    comment: match[2] === "no comment" ? "SSH key" : match[2],
    type: match[3].replace(/^ED25519$/i, "ED").replace(/^RSA$/i, "RSA").slice(0, 4).toUpperCase(),
  };
}

async function loadKeys() {
  const list = $("#key-list");
  list.dataset.user = state.user;
  list.replaceChildren();
  try {
    const output = await run(["keys", "list", state.user]);
    records(output).forEach(([, encodedKey, encodedInfo]) => {
      const key = decode(encodedKey);
      const detail = keyDetails(decode(encodedInfo));
      const row = document.createElement("div");
      row.className = "key-row";
      const mark = document.createElement("span");
      mark.className = "key-mark";
      mark.textContent = detail.type;
      const copy = document.createElement("div");
      copy.className = "key-copy";
      const title = document.createElement("strong");
      title.textContent = detail.comment;
      const fingerprint = document.createElement("code");
      fingerprint.textContent = detail.fingerprint;
      copy.append(title, fingerprint);
      const remove = document.createElement("button");
      remove.className = "remove-key";
      remove.type = "button";
      remove.innerHTML = TRASH_ICON;
      remove.setAttribute("aria-label", `Remove ${detail.comment}`);
      remove.addEventListener("click", () => {
        ask("Remove key?", `${detail.comment} · ${detail.fingerprint}`, "Remove", async () => {
          await run(["keys", "delete", state.user, encode(key)]);
          await loadKeys();
          notify("Key removed");
        });
      });
      row.append(mark, copy, remove);
      list.append(row);
    });
  } catch (error) { notify(errorMessage(error)); }
}

function selectUser(user) {
  state.user = user;
  ["root", "shell"].forEach((name) => {
    $(`#${name}-tab`).setAttribute("aria-selected", String(name === user));
  });
  loadKeys();
}

function renderSettings() {
  $("#autostart").checked = state.settings.autostart === "1";
  $("#port-value").textContent = state.settings.port;
  const passwords = state.settings["password-auth"] === "1";
  const root = state.settings["root-login"];
  $("#password-auth").checked = passwords;
  $("#root-off").checked = root === "disabled";
  $("#root-keys").checked = root === "keys";
  $("#root-password").checked = root === "password";
  renderConnect();
}

async function loadSettings() {
  state.settings = Object.fromEntries(records(await run(["settings", "get"])));
  renderSettings();
  await normalizeSettings();
}

// A hand edited config can leave root password login on while password
// sign-in is off. Fall back to key login so the page never shows an inert
// option; the corrective write must not re-enter the settings queue.
async function normalizeSettings() {
  if (state.settings["password-auth"] === "1") return;
  if (state.settings["root-login"] !== "password") return;
  await setSetting("root-login", "keys", false, false);
}

function markPending() {
  if (!state.running) { notify("Saved"); return; }
  $("#service-detail").textContent = "Restart to apply changes";
  $("#service-detail").hidden = false;
  notify("Saved. Restart SSH to apply");
}

function setSetting(name, value, queued = true, announce = true) {
  const operation = async () => {
    const previous = { ...state.settings };
    try {
      await run(["settings", "set", name, value]);
      if (announce) {
        if (name === "autostart") notify("Saved");
        else markPending();
      }
      await loadSettings();
    } catch (error) {
      state.settings = previous;
      renderSettings();
      notify(errorMessage(error));
    }
  };
  return queued ? queueConfigWrite(operation) : operation();
}

$("#service-toggle").addEventListener("click", () => serviceAction(state.running ? "stop" : "start"));
$("#service-restart").addEventListener("click", () => serviceAction("restart"));
$("#root-tab").addEventListener("click", () => selectUser("root"));
$("#shell-tab").addEventListener("click", () => selectUser("shell"));

$("#add-key").addEventListener("click", () => {
  $("#key-input").value = "";
  $("#key-error").textContent = "";
  $("#key-user").textContent = state.user;
  $("#key-dialog").showModal();
});
$("#key-dialog").addEventListener("close", async () => {
  if ($("#key-dialog").returnValue !== "default") return;
  const value = $("#key-input").value.trim();
  if (!value) return;
  try { await run(["keys", "add", state.user, encode(value)]); await loadKeys(); notify("Key added"); }
  catch (error) { notify(errorMessage(error)); }
});

$("#autostart").addEventListener("change", (event) => setSetting("autostart", event.target.checked ? "1" : "0"));
$("#password-auth").addEventListener("change", (event) => setSetting("password-auth", event.target.checked ? "1" : "0"));
["root-off", "root-keys"].forEach((id) => {
  $(`#${id}`).addEventListener("change", (event) => {
    if (event.target.checked) return setSetting("root-login", event.target.value);
  });
});

$("#root-password").addEventListener("change", async (event) => {
  if (!event.target.checked) return;
  if (!$("#password-auth").checked) {
    ask("Turn on Password Sign-in?",
      "Shell passwords become allowed too. Root login keeps its own setting.",
      "Turn on",
      async () => {
        await setSetting("password-auth", "1", true, false);
        if (state.settings["password-auth"] !== "1") return;
        await setSetting("root-login", "password");
      });
    renderSettings();
    return;
  }
  await setSetting("root-login", "password");
});

$("#port-row").addEventListener("click", () => {
  $("#port-input").value = state.settings.port;
  $("#port-error").textContent = "";
  $("#port-dialog").showModal();
});
$("#confirm-dialog").addEventListener("close", async () => {
  const action = confirmAction;
  confirmAction = null;
  if ($("#confirm-dialog").returnValue !== "default" || !action) return;
  try { await action(); }
  catch (error) { notify(errorMessage(error)); }
});

$("#port-dialog").addEventListener("close", async () => {
  if ($("#port-dialog").returnValue !== "default") return;
  const value = $("#port-input").value;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) { notify("Port must be between 1 and 65535"); return; }
  await setSetting("port", value);
});

document.querySelectorAll(".nav-item").forEach((item) => {
  item.addEventListener("click", () => showPage(item.dataset.target));
});
function rememberConnectUser(user) {
  state.connectUser = user;
  try { localStorage.setItem("ksu-ssh.connect-user", user); } catch { /* storage can be unavailable */ }
}
$("#connect-shell").addEventListener("change", (event) => {
  if (!event.target.checked) return;
  rememberConnectUser("shell");
  renderConnect();
});
$("#connect-root").addEventListener("change", (event) => {
  if (!event.target.checked) return;
  if (!rootLoginAllowed()) {
    $("#root-dialog").showModal();
    return;
  }
  rememberConnectUser("root");
  renderConnect();
});
$("#root-dialog").addEventListener("close", async () => {
  const choice = $("#root-dialog").returnValue;
  if (choice !== "keys" && choice !== "password") { renderConnect(); return; }
  try {
    if (choice === "password" && state.settings["password-auth"] !== "1") {
      await setSetting("password-auth", "1", true, false);
      if (state.settings["password-auth"] !== "1") { renderConnect(); return; }
    }
    await setSetting("root-login", choice, true, false);
    if (state.settings["root-login"] === choice) {
      rememberConnectUser("root");
      markPending();
      notify(state.running ? "Root login enabled. Restart SSH to apply" : "Root login enabled. Start SSH to apply");
    }
  } catch (error) { notify(errorMessage(error)); }
  renderConnect();
});
$("#copy-command").addEventListener("click", () => copyText($("#connect-command").textContent));
$("#save-config").addEventListener("click", async () => {
  const button = $("#save-config");
  button.disabled = true;
  try {
    await queueConfigWrite(async () => {
      const [, encoded] = records(await run(["config", "get"]))[0];
      if (decode(encoded) !== state.configBase) {
        throw new Error("Configuration changed. Reload the WebUI before saving your edits.");
      }
      const value = $("#config-editor").value;
      await run(["config", "save", encode(value)]);
      state.configBase = value;
      markPending();
    });
  }
  catch (error) { notify(errorMessage(error)); }
  finally { button.disabled = false; }
});

Promise.all([loadService(), loadSettings(), loadKeys()]).catch(showUnavailable);
