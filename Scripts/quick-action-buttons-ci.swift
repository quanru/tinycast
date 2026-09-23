import AppKit
import CoreGraphics
import Foundation

guard CommandLine.arguments.count == 3 else {
    FileHandle.standardError.write(Data("usage: helper visible-window-count <bundle-id>\n".utf8))
    exit(2)
}

let command = CommandLine.arguments[1]
let bundleID = CommandLine.arguments[2]

guard command == "visible-window-count" else {
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

let count = windows.count { window in
    guard
        (window[kCGWindowOwnerPID as String] as? Int32) == application.processIdentifier,
        let bounds = window[kCGWindowBounds as String] as? [String: CGFloat],
        let width = bounds["Width"],
        let height = bounds["Height"]
    else { return false }
    let alpha = window[kCGWindowAlpha as String] as? CGFloat ?? 1
    return alpha > 0 && width > 100 && height > 100
}

print(count)
