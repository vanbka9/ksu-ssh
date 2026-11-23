# Changelog

## Unreleased

- Treat vendor scheduler cgroups as outside the manager, so a healthy daemon
  no longer looks unverified.
- Add a KernelSU and APatch WebUI for service control, authorized keys,
  common settings, and validated `sshd_config` editing.
- List the IPv4 interfaces other devices can reach, with their names, in the
  WebUI SSH commands. Mobile data is hidden, and a VPN tunnel address no
  longer passes for the LAN one.
- Replace the `state` `address` field with `addresses`; scripts that read the
  old field must switch to the new one.
- Offer to turn password sign-in on when root passwords are chosen, and fall
  back to root key login when passwords are turned off.
- Keep the Root option visible in the Connect card when root login is off;
  enabling it asks for key-only or key and password login.
- Confirm key removal and password enabling in styled dialogs.
- Fall back to root key login when a hand edited config enables root passwords
  while password sign-in is off.
- Choose the interface and the Shell or Root account for the connection
  command; the WebUI builds and copies one command.
- Isolate SSH terminals with a private `devpts` instance.
- Start SSH in the primary mount namespace so sessions can reach internal
  storage at `/sdcard` and `/storage/emulated/0`.
- Run without system mounts on KernelSU and APatch.
- Add password authentication for the `root` and `shell` accounts.
- Add an Android shadow-password backend with MD5-crypt and SHA-512-crypt
  support.

## v0.28 — 2026-08-29

- Update OpenSSL to 3.6.4.
- Update OpenSSH to 10.5p1.
- Update Rsync to 3.5.0.

## v0.27 — 2026-05-09

- Update OpenSSL to 3.6.2.
- Update OpenSSH to 10.3p1.
- Update Rsync to 3.4.2.
- Fix builds with Android NDK versions newer than r25c.

Earlier release history remains available in the Git history and upstream
[MagiskSSH repository](https://gitlab.com/d4rcm4rc/MagiskSSH).
