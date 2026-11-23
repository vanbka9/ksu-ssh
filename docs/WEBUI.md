# WebUI development

The WebUI is plain HTML, CSS, and JavaScript in `module_data/webroot`, with no
build step. It runs in the KernelSU or APatch WebView.

`vendor/kernelsu.js` wraps the native `ksu` object from `kernelsu-alt` 3.1.2.
Commands go through `/data/adb/ssh/bin/ksu-ssh-webui`, which validates requests
and manages root-owned files. The page never handles account passwords.

## Controller protocol

Single-quote the controller path and each argument, then call `exec()`.
Do not use `spawn()`: it drops stdout newlines and merges response records.

```text
state
service start|stop|restart
keys list|add|delete root|shell
settings get
settings set autostart|port|password-auth|root-login value
config get|save
```

Unknown commands, values, and extra arguments are rejected. Key and config
payloads are base64. Responses use tab-separated records, with user-controlled
text encoded as base64:

```text
state\trunning|stopped
port\tPORT
addresses\tBASE64
app-bound\t0|1|unknown
key\tBASE64_PUBLIC_KEY\tBASE64_SSH_KEYGEN_OUTPUT
autostart\t0|1
password-auth\t0|1
root-login\tdisabled|keys|password
config\tBASE64_SSHD_CONFIG
```

Settings changes, key edits, and config saves print nothing on success.
Failures print an error to stderr and exit nonzero.

## Service state and startup

`state` reads the configured `PidFile`, defaulting to `/data/ssh/sshd.pid`.
It checks that the PID exists and its executable matches the installed sshd.
`opensshd.init` has no status action.

`addresses` decodes to one `iface<TAB>ip` line per reachable IPv4 address,
most reachable first: LAN-like interfaces (`wlan`, `swlan`, `ap`, `eth`,
`usb`, `rndis`, `ncm`), then anything else, then tunnels (`tun`, `tap`,
`ppp`, `wg`, `ipsec`). Loopback is skipped, and so are mobile data (`rmnet`,
`ccmni`, `pdp`, `seth`) and CLAT (`v4-`, `clat`): no other device can open a
connection to them. The
first entry is selected by default. The Connect card picks an interface and
Shell or Root, then builds one `ssh` command to copy. Root is offered only
when root login is enabled. The WebUI shows the interface name next to the
address, so a VPN address reads as `tun1` instead of passing for a LAN one.
The list is empty without a network address.

Some manager WebUI shells stay in the app's cgroup, so Android can kill their
children when the app closes. Start and restart use `su -c` because KernelSU
and APatch `su` leave those cgroups. Without `su`, startup runs directly.

`app-bound` describes the running daemon's cgroup membership:

- `1`: an app or UID group. The page warns that SSH stops with the manager.
- `0`: no app or UID group was found. Scheduler groups such as `top-app` and
  vendor named groups count as safe.
- `unknown`: unreadable or unrecognized membership. The page shows a warning.

Every start must use
`/data/adb/ssh/usr/libexec/ssh-core/sshd-private-devpts`:

```text
sshd-private-devpts opensshd.init start
```

Restart stops through `opensshd.init`, then starts through the launcher.
Do not use the init script's restart action or start it directly. Both bypass
the private `devpts` instance.

## Settings

| WebUI control | Controller value | sshd_config |
| --- | --- | --- |
| Password sign-in off | `password-auth 0` | `PasswordAuthentication no` |
| Password sign-in on | `password-auth 1` | `PasswordAuthentication yes` |
| Root: Off | `root-login disabled` | `PermitRootLogin no` |
| Root: Key | `root-login keys` | `PermitRootLogin prohibit-password` |
| Root: Key or password | `root-login password` | `PermitRootLogin yes` |

Root passwords require password sign-in. When root login is off, the Connect
card keeps Root greyed out; tapping it offers Key only or Key and password,
and the change needs an SSH restart. Port and sign-in changes take effect
after SSH restarts. Start on boot changes take effect immediately.
If `sshd_config` is edited by hand so that `PermitRootLogin yes` meets
`PasswordAuthentication no`, the page falls back to root key login when it loads
the settings.

`internal/colors.css` supplies KernelSU's Material You colors. Missing colors
fall back to the page's light and dark themes.

## File writes

Writes hold a controller lock. The page also queues its writes to avoid lost
updates.

Keys are validated with `ssh-keygen -lf`. Each request accepts one public key.

Config saves decode beside `sshd_config` and run `sshd -t -f CANDIDATE`.
Validation failure leaves the live file unchanged. Successful saves back up
the old file as `sshd_config.bak`, then rename the candidate into place.

The editor preserves unsaved edits. A save fails if the file changed since it
was loaded.

## Tests

```sh
sh tests/test-webui-controller.sh
sh tests/test-webui-static.sh
sh tests/test-passwd.sh
sh tests/test-password-crypt.sh
sh tests/test-uninstall-links.sh
node tests/test-webui-bridge.mjs
node tests/test-webui-app.mjs stale
node tests/test-webui-app.mjs concurrent
node tests/test-webui-app.mjs state
```

These tests use temporary files, stubbed service commands, and a simulated
`ksu` bridge. They cover validation, file writes, settings, service dispatch,
state reporting, and page behavior. They do not prove survival after closing
the manager on a device.
