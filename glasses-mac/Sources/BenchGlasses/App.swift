// Bench Glasses: this Mac drives Mentra Live glasses directly over Bluetooth, with no phone.
//
// It pairs with the glasses, puts them on Wi-Fi, and then does what Common Bench asks: it polls Common Bench's
// server on this Mac every two seconds, and when a recording is wanted it tells the glasses to publish their
// camera and microphone straight to this computer (RTMP). The glasses' button starts or stops a recording
// (short press) or marks the moment (long press). Common Bench decides; this app carries it out.
//
// Built on Mentra's Bluetooth SDK (the same Swift package as their iOS SDK). See ../glasses-mac/README.md.

import AppKit
import MentraBluetoothSDK

@main
@MainActor
struct BenchGlasses {
    static func main() {
        let application = NSApplication.shared
        let delegate = AppDelegate()
        application.setActivationPolicy(.regular)
        application.delegate = delegate
        application.run()
        withExtendedLifetime(delegate) {}
    }
}

/// What Common Bench wants right now.
private struct Wanted: Decodable {
    let want: String
    let url: String?
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, MentraBluetoothSDKDelegate {
    private let sdk = MentraBluetoothSDK()
    private var window: NSWindow!

    // Glasses
    private let glassesLine = NSTextField(wrappingLabelWithString: "Glasses: not connected")
    private let picker = NSPopUpButton()
    private var scanButton: NSButton!
    private var pairButton: NSButton!
    private var connectButton: NSButton!
    private var devices: [Device] = []
    private var scanSession: ScanSession?

    // Wi-Fi
    private let wifiLine = NSTextField(wrappingLabelWithString: "Glasses Wi-Fi: unknown")
    private let networks = NSComboBox()
    private let password = NSSecureTextField(string: "")
    private var wifiScanButton: NSButton!
    private var joinButton: NSButton!

    // Common Bench
    private let benchLine = NSTextField(wrappingLabelWithString: "Common Bench: …")
    private let streamLine = NSTextField(wrappingLabelWithString: "Camera: idle")
    private let note = NSTextField(wrappingLabelWithString: "")

    private var benchUrl = "http://127.0.0.1:8787"
    private var keyFile = ""
    private var busy = false
    private var streaming = false
    private var starting = false
    private var retryAt = Date.distantPast
    private var streamText = "idle"
    private var pollTimer: Timer?
    private var polling = false
    private var wantConnected = true // false after Disconnect or Unpair, until Connect or Pair
    private var nextConnect = Date.distantPast
    private var logFile = ""
    private var secretInUse = "" // the Wi-Fi password while it is being sent, so it never reaches the log

    /// A plain log beside the app, for working out what the glasses said when something doesn't work.
    private func log(_ message: String) {
        guard !logFile.isEmpty else { return }
        var line = message
        if !secretInUse.isEmpty { line = line.replacingOccurrences(of: secretInUse, with: "<redacted>") }
        if line.range(of: "pass", options: .caseInsensitive) != nil { line = "(a line mentioning a password was left out)" }
        let stamp = ISO8601DateFormatter().string(from: Date())
        guard let data = "\(stamp) \(line.prefix(600))\n".data(using: .utf8) else { return }
        if let handle = FileHandle(forWritingAtPath: logFile) { handle.seekToEndOfFile(); handle.write(data); try? handle.close() }
        else { try? data.write(to: URL(fileURLWithPath: logFile)) }
    }

    private func say(_ message: String) {
        note.stringValue = message
        log("note: \(message)")
    }

    // MARK: Window

    func applicationDidFinishLaunching(_: Notification) {
        sdk.delegate = self
        loadConfig()

        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 520, height: 420),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Bench Glasses"
        window.minSize = NSSize(width: 460, height: 380)
        let stack = NSStackView()
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 12
        stack.edgeInsets = NSEdgeInsets(top: 20, left: 20, bottom: 20, right: 20)
        stack.translatesAutoresizingMaskIntoConstraints = false
        window.contentView!.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: window.contentView!.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: window.contentView!.trailingAnchor),
            stack.topAnchor.constraint(equalTo: window.contentView!.topAnchor),
            stack.bottomAnchor.constraint(lessThanOrEqualTo: window.contentView!.bottomAnchor),
        ])

        scanButton = button("Scan", #selector(scan))
        pairButton = button("Pair", #selector(pairOrUnpair))
        connectButton = button("Connect", #selector(connectOrDisconnect))
        picker.widthAnchor.constraint(greaterThanOrEqualToConstant: 200).isActive = true
        let glassesRow = NSStackView(views: [scanButton, picker, connectButton, pairButton])

        wifiScanButton = button("Find networks", #selector(scanWifi))
        joinButton = button("Join", #selector(joinWifi))
        networks.placeholderString = "Network name"
        networks.widthAnchor.constraint(greaterThanOrEqualToConstant: 170).isActive = true
        password.placeholderString = "Password"
        password.widthAnchor.constraint(greaterThanOrEqualToConstant: 130).isActive = true
        let wifiRow = NSStackView(views: [wifiScanButton, networks, password, joinButton])

        for label in [glassesLine, wifiLine, benchLine, streamLine, note] { label.isSelectable = true }
        note.textColor = .secondaryLabelColor
        let rows: [NSView] = [heading("Glasses"), glassesLine, glassesRow, heading("Wi-Fi for the glasses"), wifiLine, wifiRow,
                              heading("Common Bench"), benchLine, streamLine, note]
        for view in rows {
            stack.addArrangedSubview(view)
            view.widthAnchor.constraint(lessThanOrEqualTo: stack.widthAnchor, constant: -40).isActive = true
        }

        let menu = NSMenu()
        let appItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Quit Bench Glasses", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        menu.addItem(appItem)
        let editItem = NSMenuItem()
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = editMenu
        menu.addItem(editItem)
        NSApplication.shared.mainMenu = menu

        refresh()
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApplication.shared.activate(ignoringOtherApps: true)

        // Glasses paired before are connected to again without being asked: see keepConnected().

        pollTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
            Task { @MainActor in await self?.poll() }
        }
        Task { await poll() }
    }

    private func button(_ title: String, _ action: Selector) -> NSButton {
        NSButton(title: title, target: self, action: action)
    }

    private func heading(_ text: String) -> NSTextField {
        let label = NSTextField(labelWithString: text.uppercased())
        label.font = .monospacedSystemFont(ofSize: 10, weight: .regular)
        label.textColor = .secondaryLabelColor
        return label
    }

    private func loadConfig() {
        guard let url = Bundle.main.url(forResource: "bench", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: String] else { return }
        benchUrl = json["benchUrl"] ?? benchUrl
        keyFile = json["keyFile"] ?? ""
        logFile = json["logFile"] ?? ""
        log("--- Bench Glasses opened ---")
    }

    /// Common Bench makes the key when its server first starts, so read it each time rather than once.
    private var benchKey: String {
        ((try? String(contentsOfFile: keyFile, encoding: .utf8)) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var paired: Bool {
        sdk.glasses.connection != .disconnected || sdk.defaultDevice != nil
    }

    private func refresh() {
        let glasses = sdk.glasses
        let disconnected = glasses.connection == .disconnected
        scanButton.isHidden = paired
        picker.isHidden = paired
        scanButton.isEnabled = !busy
        connectButton.isHidden = !paired
        connectButton.title = disconnected ? "Connect" : "Disconnect"
        pairButton.title = paired ? "Unpair" : "Pair"
        pairButton.isEnabled = paired ? !busy : devices.indices.contains(picker.indexOfSelectedItem) && !busy
        for control in [wifiScanButton, joinButton] as [NSButton] { control.isEnabled = glasses.ready && !busy }

        if glasses.connected {
            let name = glasses.device?.bluetoothName ?? "Glasses"
            let battery = glasses.battery?.level.map { " · battery \($0)%" } ?? ""
            glassesLine.stringValue = "\(name)\(battery)\(glasses.ready ? "" : " · getting ready")"
        } else {
            glassesLine.stringValue = disconnected ? (paired ? "Paired, not connected" : "Not paired: turn the glasses on, then Scan") : glasses.connection.rawValue.capitalized
        }
        switch glasses.wifi {
        case let .connected(ssid, ip): wifiLine.stringValue = "On \(ssid)\(ip.map { " · \($0)" } ?? "")"
        case .disconnected: wifiLine.stringValue = "Not on Wi-Fi. The glasses need the same network as this Mac to send video."
        case nil: wifiLine.stringValue = glasses.connected ? "Checking…" : "—"
        }
        streamLine.stringValue = "Camera: \(streamText)"
    }

    // MARK: Glasses

    @objc private func scan() {
        do {
            scanSession?.stop()
            scanSession = try sdk.scan(model: .mentraLive, timeout: 15) { [weak self] found in
                guard let self else { return }
                devices = found
                picker.removeAllItems()
                picker.addItems(withTitles: found.map(\.name))
                refresh()
            } onComplete: { [weak self] _ in
                guard let self else { return }
                scanSession = nil
                if devices.isEmpty { note.stringValue = "No glasses found. Are they on, and not connected to a phone?" }
                else if !paired { note.stringValue = "Choose your glasses, then Pair." }
            }
            note.stringValue = "Scanning…"
        } catch { note.stringValue = error.localizedDescription }
    }

    @objc private func pairOrUnpair() {
        if paired {
            wantConnected = false
            run("Unpairing…") { try await self.sdk.unpair(); self.note.stringValue = "Unpaired" }
            return
        }
        wantConnected = true
        guard devices.indices.contains(picker.indexOfSelectedItem) else { return }
        let device = devices[picker.indexOfSelectedItem]
        scanSession?.stop()
        scanSession = nil
        devices = []
        picker.removeAllItems()
        do { try sdk.connect(to: device); note.stringValue = "Pairing…" }
        catch { note.stringValue = error.localizedDescription }
        refresh()
    }

    @objc private func connectOrDisconnect() {
        if sdk.glasses.connection != .disconnected { wantConnected = false; sdk.disconnect(); return }
        wantConnected = true
        do { try sdk.connectDefault(); note.stringValue = "Connecting…" }
        catch { note.stringValue = error.localizedDescription }
    }

    // MARK: Wi-Fi

    @objc private func scanWifi() {
        run("The glasses are looking for networks…") {
            let found = try await self.sdk.requestWifiScan()
            let names = Array(Set(found.map(\.ssid).filter { !$0.isEmpty })).sorted()
            self.networks.removeAllItems()
            self.networks.addItems(withObjectValues: names)
            self.note.stringValue = names.isEmpty ? "The glasses found no networks." : "Choose a network, type its password, then Join."
        }
    }

    @objc private func joinWifi() {
        let ssid = networks.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !ssid.isEmpty else { note.stringValue = "Type or choose a network name first."; return }
        let secret = password.stringValue
        secretInUse = secret
        run("Joining \(ssid)…") {
            defer { self.secretInUse = "" }
            let result = try await self.sdk.sendWifiCredentials(ssid: ssid, password: secret)
            self.password.stringValue = ""
            if let error = result.error { self.say("Couldn’t join \(ssid): \(error)") }
            else { self.say("Glasses Wi-Fi: \(result.status)") }
        }
    }

    private func run(_ message: String, _ operation: @escaping @MainActor () async throws -> Void) {
        guard !busy else { return }
        busy = true
        note.stringValue = message
        refresh()
        Task {
            do { try await operation() } catch { say("\(message) failed: \(error.localizedDescription)") }
            busy = false
            refresh()
        }
    }

    // MARK: Common Bench

    private func post(_ path: String, _ body: [String: Any]) async throws -> Data {
        guard let url = URL(string: "\(benchUrl)/api/glasses/device\(path)") else { throw URLError(.badURL) }
        var request = URLRequest(url: url, timeoutInterval: 4)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.setValue(benchKey, forHTTPHeaderField: "x-bench-key")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200 ..< 300).contains(http.statusCode) else {
            throw NSError(domain: "bench", code: (response as? HTTPURLResponse)?.statusCode ?? 0)
        }
        return data
    }

    /// Paired glasses that aren't connected get another try every few seconds: right after opening (Bluetooth takes
    /// a moment to be ready), after the Mac wakes, and when the glasses come back into reach.
    private func keepConnected() {
        guard wantConnected, !busy, sdk.defaultDevice != nil, sdk.glasses.connection == .disconnected, Date() >= nextConnect else { return }
        nextConnect = Date().addingTimeInterval(8)
        do { try sdk.connectDefault(); log("connect: trying the paired glasses") }
        catch { log("connect: \(error.localizedDescription)") }
    }

    /// Ask Common Bench what is wanted and say how the glasses are; then do it.
    private func poll() async {
        guard !polling else { return }
        polling = true
        defer { polling = false }
        keepConnected()
        let glasses = sdk.glasses
        guard glasses.connected else {
            // Only a connected pair of glasses counts as "the glasses are here" to Common Bench.
            benchLine.stringValue = "Common Bench: waiting for the glasses"
            return
        }
        var report: [String: Any] = ["model": glasses.device?.bluetoothName ?? "Mentra Live", "stream": streamText]
        if let level = glasses.battery?.level { report["battery"] = level }
        if let charging = glasses.battery?.charging { report["charging"] = charging }
        switch glasses.wifi {
        case let .connected(ssid, ip)?: report["wifi"] = ssid; report["wifiState"] = "connected\(ip.map { " \($0)" } ?? "")"
        case .disconnected?: report["wifiState"] = "disconnected"
        case nil: report["wifiState"] = "unknown"
        }
        report["ready"] = glasses.ready
        do {
            let wanted = try JSONDecoder().decode(Wanted.self, from: await post("/poll", report))
            benchLine.stringValue = "Common Bench: connected · \(wanted.want == "stream" ? "recording" : "ready")"
            await follow(wanted)
        } catch let error as NSError where error.domain == "bench" && error.code == 401 {
            benchLine.stringValue = "Common Bench: key not accepted. Start its server once, then reopen this app."
        } catch {
            benchLine.stringValue = "Common Bench: can’t reach it at \(benchUrl). Is its server running?"
        }
        refresh()
    }

    private func follow(_ wanted: Wanted) async {
        if wanted.want == "stream", let url = wanted.url, !streaming, !starting, Date() >= retryAt {
            guard sdk.glasses.ready else { streamText = "waiting for the glasses"; return }
            if case .disconnected? = sdk.glasses.wifi { streamText = "the glasses need Wi-Fi first"; return }
            starting = true
            streamText = "starting"
            refresh()
            do {
                log("stream: asking the glasses to start")
                let event = try await sdk.startStream(StreamRequest(streamUrl: url, video: StreamVideoConfig(width: 1280, height: 720, fps: 30)))
                streaming = true
                streamText = event.state.rawValue
                log("stream: \(event.status)")
            } catch {
                streamText = "couldn’t start: \(error.localizedDescription)"
                log("stream: \(streamText)")
                retryAt = Date().addingTimeInterval(6)
            }
            starting = false
        } else if wanted.want == "idle", streaming {
            streaming = false
            streamText = "idle"
            _ = try? await sdk.stopStream()
        } else if wanted.want == "idle", !starting {
            streamText = "idle"
        }
    }

    // MARK: SDK delegate

    private var lastConnection = ""
    func mentraBluetoothSDK(_: MentraBluetoothSDK, didUpdateGlasses glasses: GlassesRuntimeState) {
        let now = "\(glasses.connection.rawValue)\(glasses.ready ? " ready" : "")"
        if now != lastConnection { lastConnection = now; log("glasses: \(now)") }
        if !glasses.connected, streaming { streaming = false; streamText = "idle" }
        refresh()
    }

    func mentraBluetoothSDK(_: MentraBluetoothSDK, didChangeDefaultDevice _: Device?) {
        refresh()
    }

    func mentraBluetoothSDK(_: MentraBluetoothSDK, didReceive event: BluetoothEvent) {
        switch event {
        case let .buttonPress(press):
            let kind = press.pressType.lowercased().contains("long") ? "long" : "short"
            Task { _ = try? await post("/button", ["pressType": kind]); await poll() }
        case let .streamStatus(status):
            streamText = status.state.rawValue
            log("stream status: \(status.status)")
            // Ended for good: the next poll starts a new stream if a recording is still wanted.
            if [.stopped, .error, .reconnectFailed].contains(status.state) {
                streaming = false
                retryAt = Date().addingTimeInterval(6)
            }
            refresh()
        case let .wifiStatus(status):
            log("wifi status: \(status.status)\(status.error.map { " error \($0)" } ?? "")")
            // A first try can fail and the next one hold: once the glasses are on Wi-Fi, an old "couldn't join" is no longer true.
            if case .connected = status.status, status.error == nil, !busy { note.stringValue = "The glasses are on Wi-Fi." }
            refresh()
        default: break
        }
    }

    func mentraBluetoothSDK(_: MentraBluetoothSDK, didLog message: String) {
        log("sdk: \(message)")
    }

    func applicationWillTerminate(_: Notification) {
        pollTimer?.invalidate()
        sdk.invalidate()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_: NSApplication) -> Bool {
        true
    }
}
