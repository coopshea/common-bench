# Common Bench on the glasses (phone app)

The same job as `../glasses-mac`, done from your phone instead of the Mac: a Mentra miniapp that runs inside the
Mentra app and follows Common Bench's requests. Use it when the glasses need to roam beyond Bluetooth reach of
the Mac. Speech comes from Mentra's own transcription here, rather than Whisper on the Mac.

```bash
bun install
bun dev
```

`bun dev` prints a QR code. In the Mentra app: Settings → Developer settings → Scan Mini App QR Code. The phone,
the glasses and the Mac need to be on the same network. The build finds Common Bench at this Mac's network
address on port 8787 and reads its key from `../app/recordings/.key` (start Common Bench once first).

Not yet tried on a phone: built and type-checked only.
