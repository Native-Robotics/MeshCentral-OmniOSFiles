# Native MeshAgent compatibility audit

Scope: all JavaScript in `modules_meshcore/`, checked on 2026-09-12.
The local Linux x86-64 binary used for validation has SHA-256
`891da8d32d0fbfec933b7ca5aa64b27650c05531a772f993601f20ae7c2c0a3b`.
These results do not certify other builds or the deployed device.

| Operation | Current use and validation |
| --- | --- |
| Remove upload escape byte | Allocate a standalone Buffer and copy indexed bytes. Native tunnel tests cover first bytes 0x00 and 0x7B; ordinary 0x2A uploads are also copied before queueing. Python verifies SHA-256 and Node compares the published file. |
| Add download escape byte | Allocate length + 1, explicitly assign byte zero, then copy content. No Buffer.from(array), concat, or typed-array view. Native tunnel test covers both markers, an ordinary chunk and a one-byte final chunk; Node independently decodes and compares every byte. |
| Buffer.from(JSON string) | Control frames only. Native upload/download tests parse bound/ack messages. No array or view input. |
| Buffer.from(base64 string) | Worker download response; native download test verifies decoded and transmitted bytes. |
| toString(base64) | Upload always uses an allocated, owned copy. Tests overwrite input frames after the callback to check queued data lifetime. No subarray views are encoded. |
| GenerateRandom(32).toString(hex) | omniosfiles-auth.js receives the native EncryptionStream result directly; native authorization tests exercise this path. No intermediate view. |
| omniosfiles-helper.js | Generated Python source string, not executable Buffer code. Python's base64 decoding remains strict. |

Native Buffer array/view conversions must not be assumed equivalent to Node.
The browser and Node-only tests may use standard Buffer/TypedArray operations;
that does not qualify the same operations for agent modules.

Run `MESHCENTRAL_SOURCE=/path/to/MeshCentral node --test tests/native-runtime.test.js`.
Use `MESHAGENT_BINARY` to select another compatible local binary. Missing binaries
produce explicit skips. The harness replaces network transport and filesystem
root/UID, but executes the actual agent modules and Python worker. At successful
process shutdown the fake tunnel ignores further writes, so worker-exit callbacks
do not overwrite a completed test's exit status; errors before completion still fail.

The 16 KiB chunk limit and elapsed-timer handling from rc.10 remain unchanged.
After installing this agent-module update, rebuild and synchronize the agent core
before repeating the failed 13 MiB upload and a matching download on the device.

## Text frames and core controls

Native tunnel callbacks may receive strings as well as Buffers. Do not identify
JSON only by a numeric first byte: a text string's first element is a character.
The redirect's 56-character RTT message must go to the original core handler,
not through numeric Buffer copying. The native multi-chunk test interleaves
RTT/ping strings and verifies replies with MeshCentral's onTunnelControlData.
