import AppKit
import CoreGraphics
import Foundation

guard CommandLine.arguments.count == 3 else {
    FileHandle.standardError.write(
        Data("usage: helper <visible-window-count|window-bounds> <bundle-id>\n".utf8))
    exit(2)
}

let command = CommandLine.arguments[1]
let bundleID = CommandLine.arguments[2]

guard ["visible-window-count", "window-bounds"].contains(command) else {
    FileHandle.standardError.write(Data("unknown command: \(command)\n".utf8))
    exit(2)
}

guard let application = NSRunningApplication.runningApplications(
    withBundleIdentifier: bundleID
).first else {
    print(0)
    exit(0)
}

let windows = CGWindowListCopyWindowInfo(
    [.optionOnScreenOnly, .excludeDesktopElements],
    kCGNullWindowID
) as? [[String: Any]] ?? []

let visibleWindows = windows.compactMap { window -> CGRect? in
    guard
        (window[kCGWindowOwnerPID as String] as? Int32) == application.processIdentifier,
        let bounds = window[kCGWindowBounds as String] as? [String: CGFloat],
        let width = bounds["Width"],
        let height = bounds["Height"]
    else { return nil }
    let alpha = window[kCGWindowAlpha as String] as? CGFloat ?? 1
    guard alpha > 0 && width > 100 && height > 100 else { return nil }
    let x = bounds["X"] ?? 0
    let y = bounds["Y"] ?? 0
    return CGRect(x: x, y: y, width: width, height: height)
}

if command == "visible-window-count" {
    print(visibleWindows.count)
} else if let bounds = visibleWindows.max(by: { $0.width * $0.height < $1.width * $1.height }) {
    let value: [String: CGFloat] = [
        "x": bounds.minX,
        "y": bounds.minY,
        "width": bounds.width,
        "height": bounds.height,
    ]
    let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    print(String(decoding: data, as: UTF8.self))
} else {
    print("null")
}
