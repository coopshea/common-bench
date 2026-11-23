// swift-tools-version: 5.9
import PackageDescription

// Bench Glasses: the Mac talks to Mentra Live glasses directly over Bluetooth, no phone.
// Builds against Mentra's Bluetooth SDK source (native macOS support is on their dev branch; run.sh fetches it).
let package = Package(
    name: "BenchGlasses",
    platforms: [.macOS(.v13)],
    dependencies: [
        .package(name: "MentraBluetoothSDK", path: "vendor/MentraOS/mobile/modules/bluetooth-sdk"),
    ],
    targets: [.executableTarget(name: "BenchGlasses", dependencies: [
        .product(name: "MentraBluetoothSDK", package: "MentraBluetoothSDK"),
    ])]
)
