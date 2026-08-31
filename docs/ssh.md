# SSH target and host-key policy

Cronicle Edge bundles two SSH runners:

- `sshplug` streams a configured script to a command on the remote host and retains its legacy, explicitly configured local mode.
- `sshxplug` uploads and runs a temporary script over SSH and never has a local execution mode.

## Target precedence

`SSH_HOST` is operator-controlled event/plugin configuration and always wins over `JOB_ARG`.  Keep `SSH_HOST` blank only when a Workflow argument is intentionally allowed to select a remote host.

For `sshplug`, local execution now requires an explicit `SSH_HOST=localhost` (or an operator-controlled environment alias that resolves to `localhost`).  A blank host no longer means local execution.  `JOB_ARG=localhost` is rejected by both plugins and cannot override a configured target.

When `sshxplug` consumes `JOB_ARG` (or an environment alias named by it) as the remote target, that selector is not exported into the remote bootstrap script because its URI may contain connection credentials.  Use a separate `ARG*` variable for data that the remote script needs.  SSH credentials and host-key policy variables are never exported.

## Host-key fingerprints

Use an OpenSSH SHA-256 host-key fingerprint, for example:

```text
SHA256:2V9mTQ7RzN4LkD8bVQhLxQb0w1fXvJ1m4XJf0qP7abc
```

Obtain and verify the fingerprint out of band with the server operator.  Do not copy it from an untrusted connection error.  Configure it in `SSH_HOST_FINGERPRINT`; a comma- or whitespace-separated list supports host-key rotation.

For events that intentionally accept multiple remote hosts through `JOB_ARG`, an operator-controlled JSON map can bind each host to one or more pins:

```json
{
  "worker-a.example.com:22": "SHA256:...",
  "worker-b.example.com": ["SHA256:old...", "SHA256:new..."]
}
```

Store this as `SSH_HOST_FINGERPRINT_MAP` in plugin/event secrets or another trusted environment source.  URI query parameters are never accepted as fingerprints, so a run-only caller cannot submit an attacker host together with its own pin.

When a fingerprint or map is configured, verification is always enforced.  A mismatch fails before SSH authentication and before a script is sent.

## Migration and strict mode

New bundled plugin definitions set `SSH_HOST_KEY_STRICT=1`, so new remote jobs require a trusted pin.

Existing persisted plugin definitions do not automatically gain new parameters.  They temporarily remain in compatibility mode when both the strict flag and fingerprints are absent.  This compatibility applies only to remote host-key verification.  It does not restore the legacy blank-host local mode: an existing `sshplug` job that used an empty `SSH_HOST` for local execution must now set `SSH_HOST=localhost` explicitly.  Unpinned remote jobs log a warning while retaining their previous connection behavior.  Migrate existing remote jobs in this order:

1. Record and independently verify the remote server fingerprint.
2. Set `SSH_HOST_FINGERPRINT` or `SSH_HOST_FINGERPRINT_MAP` and test the job.  Merely configuring a pin already enables verification.
3. Set `SSH_HOST_KEY_STRICT=1` so a missing host entry also fails closed.

Strict mode with no matching trusted pin returns an error before `ssh2.connect()`.  Set `SSH_HOST_KEY_STRICT=0` only as a temporary compatibility measure during migration; it never disables a pin that is already configured.
