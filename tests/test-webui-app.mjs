import assert from "node:assert/strict";

class Element {
  constructor(dataset = {}) {
    this.dataset = dataset;
    this.listeners = {};
    this.classList = { add() {}, remove() {}, toggle() {} };
    this.lastChild = { textContent: "" };
    this.textContent = "";
    this.value = "";
    this.checked = false;
    this.className = "";
    this.children = [];
  }
  addEventListener(name, listener) { this.listeners[name] = listener; }
  trigger(name) { return this.listeners[name]({ target: this }); }
  setAttribute() {}
  removeAttribute() {}
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  showModal() { this.open = true; }
  close(value) { this.open = false; this.returnValue = value; return this.trigger("close"); }
}

const ids = new Map();
const get = (id) => {
  if (!ids.has(id)) ids.set(id, new Element());
  return ids.get(id);
};
const panels = [new Element({ page: "home" }), new Element({ page: "advanced" })];
const home = new Element({ target: "home" });
const advanced = new Element({ target: "advanced" });
globalThis.document = {
  createElement(tag) {
    const element = new Element();
    element.tag = tag;
    return element;
  },
  querySelector(selector) { return get(selector.slice(1)); },
  querySelectorAll(selector) {
    if (selector === ".page-panel") return panels;
    if (selector === ".nav-item") return [home, advanced];
    return [];
  },
};
globalThis.window = globalThis;
window.scrollTo = () => {};
globalThis.atob = (value) => Buffer.from(value, "base64").toString("binary");
globalThis.btoa = (value) => Buffer.from(value, "binary").toString("base64");
const deletedKeys = [];

let config = "Port 22\nPasswordAuthentication yes\nPermitRootLogin prohibit-password\n";
let completedSets = 0;
let appBound = "0";
let running = true;
const addresses = Buffer.from("wlan2\t192.168.1.42\ntun1\t100.64.13.131\n").toString("base64");
globalThis.ksu = {
  exec(commandLine, _options, callbackName) {
    const [command, ...args] = [...commandLine.matchAll(/'([^']*)'/g)].map((match) => match[1]);
    assert.equal(command, "/data/adb/ssh/bin/ksu-ssh-webui");
    const snapshot = config;
    setTimeout(() => {
      let output = "";
      if (args[0] === "state") output = `state\t${running ? "running" : "stopped"}\nport\t22\naddresses\t${addresses}\napp-bound\t${appBound}\n`;
      if (args[0] === "keys" && args[1] === "list") {
        output = `key\t${Buffer.from("ssh-ed25519 AAAA test").toString("base64")}\t${Buffer.from("256 SHA256:abc123 test@host (ED25519)").toString("base64")}\n`;
      }
      if (args[0] === "keys" && args[1] === "delete") deletedKeys.push(args.join(" "));
      if (args[0] === "settings" && args[1] === "get") {
        output = `autostart\t1\nport\t22\npassword-auth\t${config.includes("PasswordAuthentication yes") ? 1 : 0}\nroot-login\t${config.includes("PermitRootLogin no") ? "disabled" : config.includes("PermitRootLogin yes") ? "password" : "keys"}\n`;
      }
      if (args[0] === "settings" && args[1] === "set") {
        completedSets++;
        if (args[2] !== "autostart") {
          const directive = args[2] === "password-auth" ? "PasswordAuthentication" : "PermitRootLogin";
          const value = args[2] === "password-auth"
            ? (args[3] === "1" ? "yes" : "no")
            : (args[3] === "disabled" ? "no" : args[3] === "keys" ? "prohibit-password" : "yes");
          config = snapshot.replace(new RegExp(`^${directive} .*`, "m"), `${directive} ${value}`);
        }
      }
      if (args[0] === "config" && args[1] === "get") {
        output = `config\t${Buffer.from(config).toString("base64")}\n`;
      }
      if (args[0] === "config" && args[1] === "save") {
        config = Buffer.from(args[2], "base64").toString();
      }
      window[callbackName](0, output, "");
    }, args[0] === "settings" && args[1] === "set" ? 20 : 0);
  },
};

await import("../module_data/webroot/app.js");
for (let attempt = 0; get("port-value").textContent !== "22"; attempt++) {
  assert.ok(attempt < 100, "initial settings did not load");
  await new Promise((resolve) => setTimeout(resolve, 5));
}

if (process.argv[2] === "stale") {
  await advanced.trigger("click");
  assert.match(get("config-editor").value, /PasswordAuthentication yes/);
  await home.trigger("click");
  get("password-auth").checked = false;
  await get("password-auth").trigger("change");
  await advanced.trigger("click");
  assert.match(get("config-editor").value, /PasswordAuthentication no/);
  await get("save-config").trigger("click");
  assert.match(config, /PasswordAuthentication no/, "Advanced restored stale password settings");
  get("config-editor").value += "# local draft\n";
  config = config.replace("Port 22", "Port 2222");
  await get("save-config").trigger("click");
  assert.match(config, /Port 2222/, "saving a draft overwrote an external change");
  assert.match(get("toast").textContent, /Configuration changed/);
} else if (process.argv[2] === "concurrent") {
  get("password-auth").checked = false;
  const first = get("password-auth").trigger("change");
  get("root-off").checked = true;
  get("root-off").value = "disabled";
  const second = get("root-off").trigger("change");
  await Promise.all([first, second]);
  assert.equal(completedSets, 2);
  assert.match(config, /PasswordAuthentication no/, "password setting was lost");
  assert.match(config, /PermitRootLogin no/, "root setting was lost");
} else if (process.argv[2] === "state") {
  assert.equal(get("service-toggle").textContent, "Stop");
  assert.equal(get("autostart").checked, true);
  assert.equal(get("address-list").hidden, false);
  const rows = get("address-list").children;
  assert.equal(rows.length, 2);
  assert.equal(rows[0].dataset.iface, "wlan2");
  assert.equal(rows[0].className, "address selected");
  assert.equal(rows[1].dataset.iface, "tun1");
  assert.equal(get("connect-command").textContent, "ssh shell@192.168.1.42 -p 22");
  await rows[1].trigger("click");
  assert.equal(get("address-list").children[1].className, "address selected");
  assert.equal(get("connect-command").textContent, "ssh shell@100.64.13.131 -p 22");
  get("connect-root").checked = true;
  await get("connect-root").trigger("change");
  assert.equal(get("connect-command").textContent, "ssh root@100.64.13.131 -p 22");
  await get("copy-command").trigger("click");
  assert.equal(get("toast").textContent, "ssh root@100.64.13.131 -p 22");
  assert.equal(get("service-detail").hidden, true);
  for (let attempt = 0; get("key-list").children.length === 0; attempt++) {
    assert.ok(attempt < 100, "keys did not load");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  const keyRow = get("key-list").children[0];
  keyRow.children[2].trigger("click");
  assert.equal(get("confirm-dialog").open, true);
  await get("confirm-dialog").close("cancel");
  assert.equal(deletedKeys.length, 0, "cancelled dialog must not delete the key");
  keyRow.children[2].trigger("click");
  await get("confirm-dialog").close("default");
  assert.equal(deletedKeys.length, 1, "confirmed dialog must delete the key");
  get("key-list").children[0].children[2].trigger("click");
  await get("confirm-dialog").close("");
  assert.equal(deletedKeys.length, 1, "dismissing the dialog must not delete anything");
  assert.ok(!get("root-password").disabled);
  // The checkbox, not the cached settings, must decide whether to ask.
  get("password-auth").checked = false;
  const pendingToggle = get("password-auth").trigger("change");
  get("root-password").checked = true;
  await get("root-password").trigger("change");
  assert.equal(get("confirm-dialog").open, true, "turning passwords off must still prompt");
  await get("confirm-dialog").close("cancel");
  await pendingToggle;
  assert.match(config, /PasswordAuthentication no/);
  assert.match(config, /PermitRootLogin prohibit-password/);
  assert.doesNotMatch(get("toast").textContent, /Root set to Key/);

  get("root-password").checked = true;
  await get("root-password").trigger("change");
  assert.equal(get("confirm-dialog").open, true);
  assert.equal(get("root-keys").checked, true, "opening the dialog restores the previous choice");
  await get("confirm-dialog").close("cancel");
  assert.match(config, /PermitRootLogin prohibit-password/);

  get("root-password").checked = true;
  await get("root-password").trigger("change");
  await get("confirm-dialog").close("default");
  assert.match(config, /PasswordAuthentication yes/);
  assert.match(config, /PermitRootLogin yes/);
  assert.match(get("toast").textContent, /Restart SSH to apply/);
  assert.doesNotMatch(get("toast").textContent, /Root set to Key/);

  get("password-auth").checked = false;
  await get("password-auth").trigger("change");
  assert.match(config, /PermitRootLogin prohibit-password/);
  assert.match(get("toast").textContent, /Restart SSH to apply/);
  assert.doesNotMatch(get("toast").textContent, /Root set to Key/);

  // A hand edited config is normalized quietly when settings are loaded.
  config = config.replace(/^PermitRootLogin .*/m, "PermitRootLogin yes");
  get("autostart").checked = false;
  await get("autostart").trigger("change");
  assert.match(config, /PermitRootLogin prohibit-password/);
  assert.doesNotMatch(get("toast").textContent, /Root set to Key/);

  // Root: Off greys the root option and falls back to shell.
  config = config.replace(/^PermitRootLogin .*/m, "PermitRootLogin no");
  get("autostart").checked = true;
  await get("autostart").trigger("change");
  assert.equal(get("connect-root-option").dataset.disabled, "1");
  assert.equal(get("connect-command").textContent, "ssh shell@100.64.13.131 -p 22");

  // Tapping the greyed option asks how to enable root.
  get("connect-root").checked = true;
  await get("connect-root").trigger("change");
  assert.equal(get("root-dialog").open, true);
  await get("root-dialog").close("cancel");
  assert.equal(get("connect-command").textContent, "ssh shell@100.64.13.131 -p 22");

  get("connect-root").checked = true;
  await get("connect-root").trigger("change");
  await get("root-dialog").close("keys");
  assert.match(config, /PermitRootLogin prohibit-password/);
  assert.equal(get("connect-root-option").dataset.disabled, "");
  assert.equal(get("connect-command").textContent, "ssh root@100.64.13.131 -p 22");
  assert.match(get("toast").textContent, /Restart SSH to apply/);

  // The same dialog can enable key and password login.
  config = config.replace(/^PermitRootLogin .*/m, "PermitRootLogin no");
  get("autostart").checked = false;
  await get("autostart").trigger("change");
  get("connect-root").checked = true;
  await get("connect-root").trigger("change");
  await get("root-dialog").close("password");
  assert.match(config, /PasswordAuthentication yes/);
  assert.match(config, /PermitRootLogin yes/);
  assert.equal(get("connect-command").textContent, "ssh root@100.64.13.131 -p 22");

  for (const [value, message] of [["1", "Stops when KernelSU closes. Try Restart"], ["unknown", "Cannot verify SSH survives closing the manager"]]) {
    appBound = value;
    await get("service-restart").trigger("click");
    assert.equal(get("service-detail").hidden, false);
    assert.equal(get("service-detail").textContent, message);
  }

  // A stopped server keeps the Connect card stable and hides the command.
  running = false;
  await get("service-restart").trigger("click");
  assert.equal(get("service-toggle").textContent, "Start");
  assert.equal(get("service-detail").hidden, true);
  assert.equal(get("connect-hint").hidden, false);
  assert.equal(get("connect-hint").textContent, "Start SSH to get a connection command.");
  assert.equal(get("address-list").hidden, true);
  assert.equal(get("copy-command").hidden, true);
  assert.equal(get("connect-command").textContent, "");
} else {
  assert.fail("choose stale, concurrent or state");
}

console.log(`webui app ${process.argv[2]} test passed`);
